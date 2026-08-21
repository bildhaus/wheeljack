param(
    [string]$Executable = '',
    [string]$MetricsBaseline = '',
    [string]$MetricsTargets = '',
    [switch]$MetricsContractSelfTest,
    [switch]$SkipDevTools
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

function Get-ThreeRunMetricsMedian {
    param([Parameter(Mandatory = $true)] [object[]] $Samples)

    if ($Samples.Count -ne 3) { throw 'The six-session metrics contract requires exactly three runs.' }
    $median = [ordered]@{}
    foreach ($property in @('workingSetMiB', 'inputP95Milliseconds', 'resizeP95Milliseconds', 'frameP95Milliseconds')) {
        $values = @($Samples | ForEach-Object { [double] $_.$property } | Sort-Object)
        $median[$property] = [Math]::Round($values[1], 3)
    }
    [pscustomobject] $median
}

function Compare-MetricsToBaseline {
    param(
        [Parameter(Mandatory = $true)] $Actual,
        [Parameter(Mandatory = $true)] $Baseline
    )

    $ceilings = [ordered]@{}
    $failures = @()
    foreach ($property in @('workingSetMiB', 'inputP95Milliseconds', 'resizeP95Milliseconds', 'frameP95Milliseconds')) {
        $baselineProperty = $Baseline.PSObject.Properties[$property]
        $actualProperty = $Actual.PSObject.Properties[$property]
        if ($null -eq $baselineProperty -or $null -eq $baselineProperty.Value -or [double] $baselineProperty.Value -le 0) {
            throw "Six-session baseline metric '$property' must be greater than zero."
        }
        if ($null -eq $actualProperty -or $null -eq $actualProperty.Value -or [double] $actualProperty.Value -lt 0) {
            throw "Six-session result metric '$property' is invalid."
        }
        $ceiling = [decimal] $baselineProperty.Value * [decimal] 1.2
        $ceilings[$property] = $ceiling
        if ([decimal] $actualProperty.Value -gt $ceiling) {
            $failures += "$property=$($actualProperty.Value) exceeded $ceiling"
        }
    }
    [pscustomobject]@{
        multiplier = 1.2
        baseline = $Baseline
        ceilings = [pscustomobject] $ceilings
        actual = $Actual
        failures = $failures
    }
}

function Compare-MetricsToTarget {
    param(
        [Parameter(Mandatory = $true)] $Actual,
        [Parameter(Mandatory = $true)] $Target
    )

    $remaining = [ordered]@{}
    foreach ($property in @('workingSetMiB', 'inputP95Milliseconds', 'frameP95Milliseconds')) {
        $targetProperty = $Target.PSObject.Properties[$property]
        $actualProperty = $Actual.PSObject.Properties[$property]
        if ($null -eq $targetProperty -or $null -eq $targetProperty.Value -or [double] $targetProperty.Value -le 0) {
            throw "Six-session target metric '$property' must be greater than zero."
        }
        if ($null -eq $actualProperty -or $null -eq $actualProperty.Value -or [double] $actualProperty.Value -lt 0) {
            throw "Six-session result metric '$property' is invalid."
        }
        $remaining[$property] = [Math]::Round([double] $actualProperty.Value - [double] $targetProperty.Value, 3)
    }
    [pscustomobject]@{
        target = $Target
        actual = $Actual
        achieved = @($remaining.Values | Where-Object { $_ -gt 0 }).Count -eq 0
        remaining = [pscustomobject] $remaining
    }
}

function Assert-MetricsTargetImprovesBaseline {
    param(
        [Parameter(Mandatory = $true)] $Baseline,
        [Parameter(Mandatory = $true)] $Target
    )

    foreach ($property in @('workingSetMiB', 'inputP95Milliseconds', 'frameP95Milliseconds')) {
        if ([double] $Target.$property -ge [double] $Baseline.$property) {
            throw "Six-session target metric '$property' must improve on its baseline."
        }
    }
}

if ($MetricsContractSelfTest) {
    $fixtureSamples = @(
        [pscustomobject]@{ workingSetMiB = 90; inputP95Milliseconds = 9; resizeP95Milliseconds = 19; frameP95Milliseconds = 29 },
        [pscustomobject]@{ workingSetMiB = 100; inputP95Milliseconds = 10; resizeP95Milliseconds = 20; frameP95Milliseconds = 30 },
        [pscustomobject]@{ workingSetMiB = 110; inputP95Milliseconds = 11; resizeP95Milliseconds = 21; frameP95Milliseconds = 31 }
    )
    $fixtureMedian = Get-ThreeRunMetricsMedian $fixtureSamples
    if ($fixtureMedian.workingSetMiB -ne 100 -or $fixtureMedian.frameP95Milliseconds -ne 30) {
        throw 'Six-session median calculation failed.'
    }
    if ((Compare-MetricsToBaseline $fixtureMedian $fixtureMedian).failures.Count -ne 0) {
        throw 'Six-session baseline comparison rejected a matching result.'
    }
    $regressed = [pscustomobject]@{
        workingSetMiB = 121
        inputP95Milliseconds = 10
        resizeP95Milliseconds = 20
        frameP95Milliseconds = 30
    }
    if ((Compare-MetricsToBaseline $regressed $fixtureMedian).failures.Count -ne 1) {
        throw 'Six-session baseline comparison did not reject a result above 1.2x.'
    }
    $fixtureTarget = [pscustomobject]@{
        workingSetMiB = 80
        inputP95Milliseconds = 8
        frameP95Milliseconds = 24
    }
    Assert-MetricsTargetImprovesBaseline $fixtureMedian $fixtureTarget
    if ((Compare-MetricsToTarget $fixtureMedian $fixtureTarget).achieved) {
        throw 'Six-session target comparison accepted a result that has not reached its target.'
    }
    if (-not (Compare-MetricsToTarget $fixtureTarget $fixtureTarget).achieved) {
        throw 'Six-session target comparison rejected a result that reached its target.'
    }
    Write-Output 'Six-session metrics contract self-test passed.'
    exit 0
}

if ([string]::IsNullOrWhiteSpace($Executable)) {
    throw '-Executable is required.'
}
$exe = if ([IO.Path]::IsPathRooted($Executable)) {
    [IO.Path]::GetFullPath($Executable)
} else {
    [IO.Path]::GetFullPath((Join-Path $root $Executable))
}
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
    throw "Desktop executable was not found: $exe"
}
$exeBytes = [IO.File]::ReadAllBytes($exe)
$peOffset = [BitConverter]::ToInt32($exeBytes, 0x3c)
if ([BitConverter]::ToUInt16($exeBytes, $peOffset + 92) -ne 2) {
    throw 'wheeljack must use the Windows GUI subsystem and never open a console window.'
}
$profileDir = Join-Path ([IO.Path]::GetTempPath()) ("wheeljack-tauri-ui-smoke-{0}" -f [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $profileDir | Out-Null
$previousProfile = $env:WHEELJACK_DESKTOP_DATA_DIR
$previousSmoke = $env:WHEELJACK_UI_SMOKE
$previousAutoClose = $env:WHEELJACK_UI_SMOKE_AUTO_CLOSE
$previousWebViewDataFolder = $env:WEBVIEW2_USER_DATA_FOLDER
$env:WHEELJACK_DESKTOP_DATA_DIR = $profileDir
$env:WHEELJACK_UI_SMOKE = '1'
$env:WHEELJACK_UI_SMOKE_AUTO_CLOSE = '1'
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $profileDir 'webview2'
$process = $null
try {
    $process = Start-Process -FilePath $exe -ArgumentList @('--ui-smoke', '--ui-smoke-auto-close') -PassThru
    if (-not $process.WaitForExit(120000)) {
        throw 'wheeljack did not close cleanly after the packaged WebView smoke.'
    }
    if ($process.ExitCode -ne 0) {
        throw "wheeljack exited with code $($process.ExitCode)."
    }
    $resultPath = Join-Path $profileDir 'ui-smoke-result.json'
    if (-not (Test-Path -LiteralPath $resultPath -PathType Leaf)) {
        throw 'wheeljack did not write the packaged WebView smoke result.'
    }
    $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
    if (-not $result.ok) {
        throw "Packaged WebView smoke failed: $($result.message)"
    }
    Write-Output ($result | ConvertTo-Json -Compress)
} finally {
    if ($process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force
    }
    $env:WHEELJACK_DESKTOP_DATA_DIR = $previousProfile
    $env:WHEELJACK_UI_SMOKE = $previousSmoke
    $env:WHEELJACK_UI_SMOKE_AUTO_CLOSE = $previousAutoClose
    $env:WEBVIEW2_USER_DATA_FOLDER = $previousWebViewDataFolder
    $resolvedProfile = [IO.Path]::GetFullPath($profileDir)
    if ((Split-Path $resolvedProfile -Parent) -ne [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') -or
        -not (Split-Path $resolvedProfile -Leaf).StartsWith('wheeljack-tauri-ui-smoke-', [StringComparison]::Ordinal)) {
        throw "Refusing unsafe smoke cleanup path: $resolvedProfile"
    }
    Remove-Item -LiteralPath $resolvedProfile -Recurse -Force -ErrorAction SilentlyContinue
}

if ($SkipDevTools) {
    Write-Output 'Packaged native WebView smoke passed; DevTools interaction suite skipped.'
    return
}

$bun = (Get-Command bun -ErrorAction Stop).Source
& (Join-Path $root 'scripts\smoke-desktop-agent-memory-windows.ps1') -Executable $exe
$runtimeProfile = Join-Path ([IO.Path]::GetTempPath()) ("wheeljack-tauri-runtime-smoke-{0}" -f [Guid]::NewGuid().ToString('N'))
$dataProfile = Join-Path ([IO.Path]::GetTempPath()) ("wheeljack-tauri-data-smoke-{0}" -f [Guid]::NewGuid().ToString('N'))
$runtimeProject = Join-Path $runtimeProfile 'project'
$dataProject = Join-Path $dataProfile 'project'
New-Item -ItemType Directory -Path $runtimeProject, $dataProject -Force | Out-Null
$git = (Get-Command git -ErrorAction Stop).Source
& $git -C $runtimeProject init --quiet
if ($LASTEXITCODE -ne 0) { throw 'Could not initialize the task-lane smoke repository.' }
& $git -C $runtimeProject config user.name 'wheeljack smoke'
& $git -C $runtimeProject config user.email 'wheeljack-smoke@example.invalid'
[IO.File]::WriteAllText((Join-Path $runtimeProject 'lane-proof.txt'), "WHEELJACK_LANE_BASE`n")
[IO.File]::WriteAllText((Join-Path $runtimeProject 'primary-proof.txt'), "WHEELJACK_PRIMARY_BASE`n")
& $git -C $runtimeProject add -- lane-proof.txt primary-proof.txt
& $git -C $runtimeProject commit --quiet -m 'Initialize task-lane smoke fixture'
if ($LASTEXITCODE -ne 0) { throw 'Could not commit the task-lane smoke fixture.' }
$laneStatePath = Join-Path $runtimeProfile 'task-lane-smoke.json'
$previousBrowserArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$previousWebViewDataFolder = $env:WEBVIEW2_USER_DATA_FOLDER
$runtimeProcess = $null
$recoveryProcess = $null
$gracefulRecoveryProcess = $null
$dataProcess = $null
$metricsProcess = $null
$metricsProfiles = @()

function Get-ProcessTreeWorkingSet {
    param([Parameter(Mandatory = $true)] [int] $RootProcessId)

    $rootStartedAt = (Get-Process -Id $RootProcessId -ErrorAction Stop).StartTime.AddSeconds(-2)
    $processes = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CreationDate
    $ids = [Collections.Generic.HashSet[int]]::new()
    [void] $ids.Add($RootProcessId)
    do {
        $added = $false
        foreach ($candidate in $processes) {
            if ($candidate.CreationDate -ge $rootStartedAt -and
                $ids.Contains([int] $candidate.ParentProcessId) -and
                $ids.Add([int] $candidate.ProcessId)) {
                $added = $true
            }
        }
    } while ($added)
    ($ids | ForEach-Object { (Get-Process -Id $_ -ErrorAction SilentlyContinue).WorkingSet64 } | Measure-Object -Sum).Sum
}

try {
    $env:WHEELJACK_UI_SMOKE = '1'
    $env:WHEELJACK_UI_SMOKE_AUTO_CLOSE = $null
    $env:WHEELJACK_DESKTOP_DATA_DIR = $runtimeProfile
    $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $runtimeProfile 'webview2-runtime'
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--force-renderer-accessibility --remote-debugging-port=9334'
    $runtimeProcess = Start-Process -FilePath $exe -PassThru
    & $bun (Join-Path $root 'scripts\smoke-desktop-webview.mjs') --port 9334 --project $runtimeProject --lane-state $laneStatePath --leave-open true
    if ($LASTEXITCODE -ne 0) {
        $runtimeState = if ($runtimeProcess.HasExited) {
            "process exited with code $($runtimeProcess.ExitCode)"
        } else {
            "process $($runtimeProcess.Id) is still running"
        }
        throw "Packaged WebView runtime smoke failed: $runtimeState."
    }
    Stop-Process -Id $runtimeProcess.Id -Force
    $runtimeProcess.WaitForExit()

    $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $runtimeProfile 'webview2-recovery'
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--force-renderer-accessibility --remote-debugging-port=9344'
    $recoveryProcess = Start-Process -FilePath $exe -PassThru
    & $bun (Join-Path $root 'scripts\smoke-desktop-recovery-webview.mjs') --port 9344 --expected-panes 10 --lane-state $laneStatePath --close-flush true
    if ($LASTEXITCODE -ne 0) { throw 'Packaged forced-recovery smoke failed.' }
    if (-not $recoveryProcess.WaitForExit(30000) -or $recoveryProcess.ExitCode -ne 0) {
        throw 'wheeljack did not close cleanly after flushing the recovered layout.'
    }

    $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $runtimeProfile 'webview2-graceful-recovery'
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--force-renderer-accessibility --remote-debugging-port=9354'
    $gracefulRecoveryProcess = Start-Process -FilePath $exe -PassThru
    & $bun (Join-Path $root 'scripts\smoke-desktop-recovery-webview.mjs') --port 9354 --expected-panes 11 --lane-state $laneStatePath --expect-interrupted false
    if ($LASTEXITCODE -ne 0) { throw 'Packaged graceful-recovery smoke failed.' }
    if (-not $gracefulRecoveryProcess.WaitForExit(30000) -or $gracefulRecoveryProcess.ExitCode -ne 0) {
        throw 'wheeljack did not close cleanly after graceful recovery.'
    }

    $env:WHEELJACK_DESKTOP_DATA_DIR = $dataProfile
    $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $dataProfile 'webview2'
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--force-renderer-accessibility --remote-debugging-port=9364'
    $dataProcess = Start-Process -FilePath $exe -PassThru
    & $bun (Join-Path $root 'scripts\smoke-desktop-webview.mjs') --port 9364 --project $dataProject --data-panes-only true
    if ($LASTEXITCODE -ne 0) { throw 'Packaged data-pane smoke failed.' }
    if (-not $dataProcess.WaitForExit(30000) -or $dataProcess.ExitCode -ne 0) {
        throw 'wheeljack did not close cleanly after the data-pane smoke.'
    }
    foreach ($relativePath in @('.wheeljack\coordination', 'KANBAN.md', 'PRD.md', 'TDD.md')) {
        if (Test-Path -LiteralPath (Join-Path $dataProject $relativePath)) {
            throw "Work-only close created Plan state on disk: $relativePath"
        }
    }

    $metricsSamples = @()
    for ($metricsRun = 1; $metricsRun -le 3; $metricsRun++) {
        $metricsProfile = Join-Path ([IO.Path]::GetTempPath()) ("wheeljack-tauri-metrics-smoke-{0}" -f [Guid]::NewGuid().ToString('N'))
        $metricsProject = Join-Path $metricsProfile 'project'
        New-Item -ItemType Directory -Path $metricsProject -Force | Out-Null
        $metricsProfiles += $metricsProfile
        $metricsPort = 9364 + (10 * $metricsRun)

        $env:WHEELJACK_DESKTOP_DATA_DIR = $metricsProfile
        $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $metricsProfile 'webview2'
        $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--force-renderer-accessibility --remote-debugging-port=$metricsPort"
        $metricsProcess = Start-Process -FilePath $exe -PassThru
        $metricsOutput = & $bun (Join-Path $root 'scripts\smoke-desktop-webview.mjs') --port $metricsPort --project $metricsProject --six-session-only true --leave-open true | Out-String
        $metricsExitCode = $LASTEXITCODE
        if (-not [string]::IsNullOrWhiteSpace($metricsOutput)) {
            Write-Output ($metricsOutput.TrimEnd())
        }
        if ($metricsExitCode -ne 0) { throw "Packaged six-session metrics smoke run $metricsRun failed." }
        try {
            $webviewMetrics = $metricsOutput | ConvertFrom-Json
        } catch {
            throw "Packaged six-session metrics smoke run $metricsRun did not return valid JSON."
        }
        foreach ($metricName in @('input', 'resize', 'frame')) {
            $metricProperty = $webviewMetrics.p95.PSObject.Properties[$metricName]
            if ($null -eq $metricProperty -or $null -eq $metricProperty.Value -or [double] $metricProperty.Value -lt 0) {
                throw "Packaged six-session metrics smoke run $metricsRun did not report a valid $metricName p95."
            }
        }

        $activeWorkingSet = Get-ProcessTreeWorkingSet -RootProcessId $metricsProcess.Id
        if ($null -eq $activeWorkingSet -or [double] $activeWorkingSet -le 0) {
            throw "Packaged six-session metrics smoke run $metricsRun did not report a valid working set."
        }
        $sample = [pscustomobject][ordered]@{
            run = $metricsRun
            workingSetBytes = [long] $activeWorkingSet
            workingSetMiB = [Math]::Round($activeWorkingSet / 1MB, 3)
            inputP95Milliseconds = [Math]::Round([double] $webviewMetrics.p95.input, 3)
            resizeP95Milliseconds = [Math]::Round([double] $webviewMetrics.p95.resize, 3)
            frameP95Milliseconds = [Math]::Round([double] $webviewMetrics.p95.frame, 3)
        }
        $metricsSamples += $sample
        Write-Output ("SIX_SESSION_METRICS_SAMPLE " + ($sample | ConvertTo-Json -Compress))

        [void] $metricsProcess.CloseMainWindow()
        if (-not $metricsProcess.WaitForExit(30000) -or $metricsProcess.ExitCode -ne 0) {
            throw "wheeljack did not close cleanly after six-session metrics smoke run $metricsRun."
        }
        $metricsProcess = $null
    }

    $metricsMedian = Get-ThreeRunMetricsMedian $metricsSamples
    $candidate = [pscustomobject][ordered]@{
        version = 1
        runs = 3
        median = $metricsMedian
    }
    Write-Output ("SIX_SESSION_METRICS_BASELINE_CANDIDATE " + ($candidate | ConvertTo-Json -Compress))

    $defaultMetricsBaseline = Join-Path $root 'scripts\desktop-six-session-baseline.json'
    $metricsBaselinePath = $null
    if (-not [string]::IsNullOrWhiteSpace($MetricsBaseline)) {
        $metricsBaselinePath = if ([IO.Path]::IsPathRooted($MetricsBaseline)) {
            [IO.Path]::GetFullPath($MetricsBaseline)
        } else {
            [IO.Path]::GetFullPath((Join-Path $root $MetricsBaseline))
        }
        if (-not (Test-Path -LiteralPath $metricsBaselinePath -PathType Leaf)) {
            throw "Six-session metrics baseline was not found: $metricsBaselinePath"
        }
    } elseif (Test-Path -LiteralPath $defaultMetricsBaseline -PathType Leaf) {
        $metricsBaselinePath = $defaultMetricsBaseline
    }

    if ($metricsBaselinePath) {
        $baseline = Get-Content -LiteralPath $metricsBaselinePath -Raw | ConvertFrom-Json
        if ($baseline.version -ne 1 -or $baseline.runs -ne 3 -or $null -eq $baseline.median) {
            throw "Six-session metrics baseline must use version 1 with exactly three runs: $metricsBaselinePath"
        }
        $comparison = Compare-MetricsToBaseline $metricsMedian $baseline.median
        Write-Output ("SIX_SESSION_METRICS_CEILINGS " + ($comparison | ConvertTo-Json -Compress))
        if ($comparison.failures.Count -gt 0) {
            throw "Six-session metrics exceeded the 1.2x baseline ceiling: $($comparison.failures -join '; ')"
        }
        $defaultMetricsTargets = Join-Path $root 'scripts\desktop-performance-targets.json'
        $metricsTargetsPath = if (-not [string]::IsNullOrWhiteSpace($MetricsTargets)) {
            if ([IO.Path]::IsPathRooted($MetricsTargets)) {
                [IO.Path]::GetFullPath($MetricsTargets)
            } else {
                [IO.Path]::GetFullPath((Join-Path $root $MetricsTargets))
            }
        } else {
            $defaultMetricsTargets
        }
        if (-not (Test-Path -LiteralPath $metricsTargetsPath -PathType Leaf)) {
            throw "Desktop performance targets were not found: $metricsTargetsPath"
        }
        $targets = Get-Content -LiteralPath $metricsTargetsPath -Raw | ConvertFrom-Json
        if ($targets.version -ne 1 -or $null -eq $targets.sixSession.target) {
            throw "Desktop performance targets must use version 1 with a sixSession target: $metricsTargetsPath"
        }
        Assert-MetricsTargetImprovesBaseline $baseline.median $targets.sixSession.target
        $targetProgress = Compare-MetricsToTarget $metricsMedian $targets.sixSession.target
        Write-Output ("SIX_SESSION_METRICS_TARGET_PROGRESS " + ($targetProgress | ConvertTo-Json -Compress -Depth 4))
    } else {
        Write-Output 'SIX_SESSION_METRICS_BASELINE_PENDING Rebuild the packaged app, review the candidate, then check it in as scripts\desktop-six-session-baseline.json.'
    }
} finally {
    foreach ($candidateProcess in @($runtimeProcess, $recoveryProcess, $gracefulRecoveryProcess, $dataProcess, $metricsProcess)) {
        if ($candidateProcess -and -not $candidateProcess.HasExited) {
            Stop-Process -Id $candidateProcess.Id -Force
        }
    }
    $env:WHEELJACK_DESKTOP_DATA_DIR = $previousProfile
    $env:WHEELJACK_UI_SMOKE = $previousSmoke
    $env:WHEELJACK_UI_SMOKE_AUTO_CLOSE = $previousAutoClose
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousBrowserArguments
    $env:WEBVIEW2_USER_DATA_FOLDER = $previousWebViewDataFolder
    foreach ($candidateProfile in (@($runtimeProfile, $dataProfile) + @($metricsProfiles))) {
        $resolvedCandidate = [IO.Path]::GetFullPath($candidateProfile)
        $leaf = Split-Path $resolvedCandidate -Leaf
        if ((Split-Path $resolvedCandidate -Parent) -ne [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') -or
            (-not $leaf.StartsWith('wheeljack-tauri-runtime-smoke-', [StringComparison]::Ordinal) -and
             -not $leaf.StartsWith('wheeljack-tauri-data-smoke-', [StringComparison]::Ordinal) -and
             -not $leaf.StartsWith('wheeljack-tauri-metrics-smoke-', [StringComparison]::Ordinal))) {
            throw "Refusing unsafe smoke cleanup path: $resolvedCandidate"
        }
        Remove-Item -LiteralPath $resolvedCandidate -Recurse -Force -ErrorAction SilentlyContinue
    }
}

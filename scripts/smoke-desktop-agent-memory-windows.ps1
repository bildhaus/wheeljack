param(
    [Parameter(Mandatory = $true)]
    [string]$Executable
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$exe = if ([IO.Path]::IsPathRooted($Executable)) {
    [IO.Path]::GetFullPath($Executable)
} else {
    [IO.Path]::GetFullPath((Join-Path $root $Executable))
}
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
    throw "Desktop executable was not found: $exe"
}

function Get-ProcessTreeWorkingSet {
    param([Parameter(Mandatory = $true)] [int] $RootProcessId)

    $rootProcess = Get-Process -Id $RootProcessId -ErrorAction Stop
    $rootStartedAt = $rootProcess.StartTime.AddSeconds(-2)
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
    [long] (($ids | ForEach-Object {
        (Get-Process -Id $_ -ErrorAction SilentlyContinue).WorkingSet64
    } | Measure-Object -Sum).Sum)
}

function Get-Median {
    param([Parameter(Mandatory = $true)] [long[]] $Values)

    if ($Values.Count -eq 0) { throw 'Cannot calculate a median without samples.' }
    $sorted = @($Values | Sort-Object)
    $middle = [Math]::Floor($sorted.Count / 2)
    if ($sorted.Count % 2 -eq 1) { return [double] $sorted[$middle] }
    ([double] $sorted[$middle - 1] + [double] $sorted[$middle]) / 2
}

$profile = Join-Path ([IO.Path]::GetTempPath()) ("wheeljack-tauri-agent-memory-{0}" -f [Guid]::NewGuid().ToString('N'))
$project = Join-Path $profile 'project'
$statePath = Join-Path $profile 'agent-memory-state.json'
$stdoutPath = Join-Path $profile 'smoke.stdout.log'
$stderrPath = Join-Path $profile 'smoke.stderr.log'
New-Item -ItemType Directory -Path $project -Force | Out-Null

$previousProfile = $env:WHEELJACK_DESKTOP_DATA_DIR
$previousSmoke = $env:WHEELJACK_UI_SMOKE
$previousAutoClose = $env:WHEELJACK_UI_SMOKE_AUTO_CLOSE
$previousBrowserArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$previousWebViewDataFolder = $env:WEBVIEW2_USER_DATA_FOLDER
$appProcess = $null
$smokeProcess = $null
$samples = @()

try {
    $port = 9454
    $env:WHEELJACK_DESKTOP_DATA_DIR = $profile
    $env:WHEELJACK_UI_SMOKE = '1'
    $env:WHEELJACK_UI_SMOKE_AUTO_CLOSE = $null
    $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $profile 'webview2'
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--force-renderer-accessibility --remote-debugging-port=$port"
    $appProcess = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden

    $bunShim = (Get-Command bun -ErrorAction Stop).Source
    $bun = if ([IO.Path]::GetExtension($bunShim) -eq '.exe') {
        $bunShim
    } else {
        Join-Path (Split-Path $bunShim -Parent) 'node_modules\bun\bin\bun.exe'
    }
    if (-not (Test-Path -LiteralPath $bun -PathType Leaf)) {
        throw "Bun executable was not found behind the command shim: $bun"
    }
    $smokeProcess = Start-Process -FilePath $bun -ArgumentList @(
        (Join-Path $root 'scripts\smoke-desktop-webview.mjs'),
        '--port', $port,
        '--project', $project,
        '--agent-flood-only', 'true',
        '--agent-memory-state', $statePath
    ) -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru -WindowStyle Hidden

    $deadline = [DateTime]::UtcNow.AddMinutes(5)
    while (-not $smokeProcess.HasExited -and [DateTime]::UtcNow -lt $deadline) {
        $phase = $null
        if (Test-Path -LiteralPath $statePath -PathType Leaf) {
            try { $phase = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json } catch { $phase = $null }
        }
        if ($phase -and -not $appProcess.HasExited) {
            $workingSet = Get-ProcessTreeWorkingSet -RootProcessId $appProcess.Id
            if ($workingSet -gt 0) {
                $samples += [pscustomobject]@{
                    phase = [string] $phase.phase
                    run = [int] $phase.run
                    workingSetBytes = $workingSet
                }
            }
        }
        Start-Sleep -Milliseconds 200
        $smokeProcess.Refresh()
        $appProcess.Refresh()
    }
    if (-not $smokeProcess.HasExited) {
        Stop-Process -Id $smokeProcess.Id -Force
        throw 'Packaged structured-agent memory smoke timed out.'
    }
    $summaryLine = if (Test-Path -LiteralPath $stdoutPath -PathType Leaf) {
        Get-Content -LiteralPath $stdoutPath | Where-Object { $_.TrimStart().StartsWith('{') } | Select-Object -Last 1
    } else { $null }
    $preliminarySummary = if ($summaryLine) {
        try { $summaryLine | ConvertFrom-Json } catch { $null }
    } else { $null }
    if ($smokeProcess.ExitCode -ne 0) {
        $contractCompleted = $preliminarySummary -and
            $preliminarySummary.completed -eq $true -and
            $preliminarySummary.finalTailVisible -eq $true -and
            [int] $preliminarySummary.runs -eq 6 -and
            [double] $preliminarySummary.snapshotRatePerSecond -le 20
        if (-not $contractCompleted) {
            $stdout = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -LiteralPath $stdoutPath -Raw } else { '' }
            $stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw } else { '' }
            $failureOutput = ($stdout + "`n" + $stderr).Trim()
            if ($failureOutput.Length -gt 8192) {
                $failureOutput = $failureOutput.Substring(0, 4096) + "`n...[failure output truncated]...`n" + $failureOutput.Substring($failureOutput.Length - 4096)
            }
            throw "Packaged structured-agent memory smoke failed: $failureOutput"
        }
    }
    if (-not $appProcess.WaitForExit(30000) -or $appProcess.ExitCode -ne 0) {
        throw 'wheeljack did not close cleanly after the structured-agent memory smoke.'
    }

    if (-not $summaryLine) { throw 'Structured-agent memory smoke did not return a summary.' }
    $summary = $summaryLine | ConvertFrom-Json

    $baselineSamples = @($samples | Where-Object phase -eq 'baseline' | ForEach-Object workingSetBytes)
    if ($baselineSamples.Count -lt 3) { throw 'Structured-agent memory smoke captured too few baseline samples.' }
    $baselineMedian = Get-Median $baselineSamples
    $runMedians = @()
    for ($run = 1; $run -le 6; $run++) {
        $runSamples = @($samples | Where-Object { $_.phase -eq 'settle' -and $_.run -eq $run } | ForEach-Object workingSetBytes)
        if ($runSamples.Count -lt 3) { throw "Structured-agent memory smoke captured too few samples for run $run." }
        $runMedians += Get-Median $runSamples
    }
    $plateauAnchor = ($runMedians[2] + $runMedians[3]) / 2
    $plateauTail = ($runMedians[4] + $runMedians[5]) / 2
    $tailGrowth = [Math]::Max(0, $plateauTail - $plateauAnchor)
    $tailGrowthCeiling = [Math]::Max(32MB, $plateauAnchor * 0.08)
    $overallGrowth = [Math]::Max(0, $plateauTail - $baselineMedian)
    $overallGrowthCeiling = 256MB
    $memoryDiagnostic = [pscustomobject][ordered]@{
        baselineMiB = [Math]::Round($baselineMedian / 1MB, 3)
        settledRunMiB = @($runMedians | ForEach-Object { [Math]::Round($_ / 1MB, 3) })
        tailGrowthMiB = [Math]::Round($tailGrowth / 1MB, 3)
        tailGrowthCeilingMiB = [Math]::Round($tailGrowthCeiling / 1MB, 3)
        overallGrowthMiB = [Math]::Round($overallGrowth / 1MB, 3)
        overallGrowthCeilingMiB = [Math]::Round($overallGrowthCeiling / 1MB, 3)
    } | ConvertTo-Json -Compress
    if ($tailGrowth -gt $tailGrowthCeiling) {
        throw "Structured-agent working set did not plateau: $memoryDiagnostic"
    }
    if ($overallGrowth -gt $overallGrowthCeiling) {
        throw "Structured-agent working set exceeded its growth ceiling: $memoryDiagnostic"
    }

    [pscustomobject][ordered]@{
        runs = 6
        protocolUpdates = [int] $summary.protocolUpdates
        snapshotRatePerSecond = [Math]::Round([double] $summary.snapshotRatePerSecond, 3)
        baselineMiB = [Math]::Round($baselineMedian / 1MB, 3)
        settledRunMiB = @($runMedians | ForEach-Object { [Math]::Round($_ / 1MB, 3) })
        tailGrowthMiB = [Math]::Round($tailGrowth / 1MB, 3)
        tailGrowthCeilingMiB = [Math]::Round($tailGrowthCeiling / 1MB, 3)
        overallGrowthMiB = [Math]::Round($overallGrowth / 1MB, 3)
        overallGrowthCeilingMiB = [Math]::Round($overallGrowthCeiling / 1MB, 3)
        toolTextBytes = [int] $summary.toolTextBytes
    } | ConvertTo-Json -Compress
} finally {
    foreach ($candidate in @($smokeProcess, $appProcess)) {
        if ($candidate -and -not $candidate.HasExited) {
            Stop-Process -Id $candidate.Id -Force -ErrorAction SilentlyContinue
        }
    }
    $env:WHEELJACK_DESKTOP_DATA_DIR = $previousProfile
    $env:WHEELJACK_UI_SMOKE = $previousSmoke
    $env:WHEELJACK_UI_SMOKE_AUTO_CLOSE = $previousAutoClose
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousBrowserArguments
    $env:WEBVIEW2_USER_DATA_FOLDER = $previousWebViewDataFolder
    $resolvedProfile = [IO.Path]::GetFullPath($profile)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
    if ((Split-Path $resolvedProfile -Parent) -ne $tempRoot -or
        -not (Split-Path $resolvedProfile -Leaf).StartsWith('wheeljack-tauri-agent-memory-', [StringComparison]::Ordinal)) {
        throw "Refusing unsafe agent-memory smoke cleanup path: $resolvedProfile"
    }
    Remove-Item -LiteralPath $resolvedProfile -Recurse -Force -ErrorAction SilentlyContinue
}

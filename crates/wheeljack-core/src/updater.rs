use super::*;

pub(crate) fn current_updater_platform() -> UpdaterPlatformDto {
    let os = if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(windows) {
        "windows"
    } else {
        "linux"
    };
    let arch = if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else if cfg!(target_arch = "x86_64") {
        "x86_64"
    } else {
        "unknown"
    };
    UpdaterPlatformDto {
        key: format!("{os}-{arch}"),
        os: os.to_string(),
        arch: arch.to_string(),
        asset_name: if os == "darwin" {
            MACOS_NATIVE_UPDATE_ASSET
        } else {
            WINDOWS_NATIVE_UPDATE_ASSET
        }
        .to_string(),
    }
}

pub(crate) fn get_json<T: for<'de> Deserialize<'de>>(url: &str) -> Result<T> {
    let response = ureq::get(url)
        .set("Accept", "application/vnd.github+json")
        .set("User-Agent", UPDATE_USER_AGENT)
        .call()
        .map_err(|error| anyhow!("Update request failed: {error}"))?;
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(MAX_UPDATE_METADATA_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| anyhow!("Could not read update response: {error}"))?;
    if bytes.len() as u64 > MAX_UPDATE_METADATA_BYTES {
        bail!("Update metadata exceeded the 1 MiB limit.");
    }
    serde_json::from_slice(&bytes)
        .map_err(|error| anyhow!("Could not parse update response: {error}"))
}

pub(crate) fn get_text(url: &str, allow_local_http: bool) -> Result<String> {
    String::from_utf8(get_bytes(url, allow_local_http, MAX_UPDATE_CHECKSUM_BYTES)?)
        .map_err(|error| anyhow!("Update response was not UTF-8: {error}"))
}

fn get_bytes(url: &str, allow_local_http: bool, max_bytes: u64) -> Result<Vec<u8>> {
    validate_download_url(url, allow_local_http)?;
    let response = ureq::get(url)
        .set("Accept", "application/octet-stream")
        .set("User-Agent", UPDATE_USER_AGENT)
        .call()
        .map_err(|error| anyhow!("Update download failed: {error}"))?;
    reject_oversized_response(&response, max_bytes)?;
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(max_bytes + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| anyhow!("Could not read update download: {error}"))?;
    if bytes.is_empty() {
        bail!("Update download was empty.");
    }
    if bytes.len() as u64 > max_bytes {
        bail!("Update download exceeded the configured size limit.");
    }
    Ok(bytes)
}

pub(crate) fn download_update_file(
    url: &str,
    allow_local_http: bool,
    destination: &Path,
    mut progress: impl FnMut(u64, Option<u64>),
) -> Result<(u64, String)> {
    validate_download_url(url, allow_local_http)?;
    let response = ureq::get(url)
        .set("Accept", "application/octet-stream")
        .set("User-Agent", UPDATE_USER_AGENT)
        .call()
        .map_err(|error| anyhow!("Update download failed: {error}"))?;
    reject_oversized_response(&response, MAX_UPDATE_PACKAGE_BYTES)?;
    let total = response_content_length(&response);
    progress(0, total);
    let mut reader = response.into_reader();
    let mut file = fs::File::create(destination)?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let size = reader
            .read(&mut buffer)
            .map_err(|error| anyhow!("Could not read update download: {error}"))?;
        if size == 0 {
            break;
        }
        downloaded += size as u64;
        if downloaded > MAX_UPDATE_PACKAGE_BYTES {
            bail!("Update download exceeded the 512 MiB limit.");
        }
        file.write_all(&buffer[..size])?;
        hasher.update(&buffer[..size]);
        progress(downloaded, total);
    }
    file.flush()?;
    if downloaded == 0 {
        bail!("Update download was empty.");
    }
    Ok((downloaded, format!("{:x}", hasher.finalize())))
}

fn response_content_length(response: &ureq::Response) -> Option<u64> {
    response
        .header("Content-Length")
        .and_then(|value| value.parse::<u64>().ok())
}

fn reject_oversized_response(response: &ureq::Response, max_bytes: u64) -> Result<()> {
    if response_content_length(response).is_some_and(|size| size > max_bytes) {
        bail!("Update download exceeded the configured size limit.");
    }
    Ok(())
}

fn release_asset_url(release: &GithubRelease, name: &str) -> Result<String> {
    release_asset(release, name).map(|asset| asset.browser_download_url.clone())
}

pub(crate) fn update_status_for_release(
    current_version: &str,
    platform: UpdaterPlatformDto,
    release: &GithubRelease,
    allow_local_http: bool,
    checksum_text: impl FnOnce(&str) -> Result<String>,
) -> Result<UpdaterStatusDto> {
    let latest_version = release_version(release)?;
    if compare_versions(&latest_version, current_version) <= 0 {
        return Ok(no_update_status(
            current_version,
            platform,
            "wheeljack is up to date.",
        ));
    }

    let Some(asset) = find_release_asset(release, &platform.asset_name) else {
        return Ok(no_update_status(
            current_version,
            platform,
            format!("No native update asset is available for {latest_version}."),
        ));
    };

    let asset_name = asset.name.clone();
    let download_url = asset.browser_download_url.clone();
    let size = asset.size;
    validate_download_url(&download_url, allow_local_http)?;
    if size.is_some_and(|value| value > MAX_UPDATE_PACKAGE_BYTES) {
        bail!("Update package exceeded the 512 MiB limit.");
    }
    let notes = release.body.clone();
    let published_at = release.published_at.clone();
    let checksum_url = release_asset_url(release, &format!("{}.sha256", platform.asset_name))?;
    validate_download_url(&checksum_url, allow_local_http)?;
    let sha256 = parse_sha256_sidecar(&checksum_text(&checksum_url)?)?;
    Ok(UpdaterStatusDto {
        current_version: current_version.to_string(),
        platform: platform.clone(),
        checked_at: now(),
        update: Some(UpdateInfoDto {
            version: latest_version,
            notes,
            published_at,
            platform: platform.key,
            asset_name,
            download_url,
            sha256,
            size,
        }),
        message: "Update available.".to_string(),
    })
}

pub(crate) fn no_update_status(
    current_version: &str,
    platform: UpdaterPlatformDto,
    message: impl Into<String>,
) -> UpdaterStatusDto {
    UpdaterStatusDto {
        current_version: current_version.to_string(),
        platform,
        checked_at: now(),
        update: None,
        message: message.into(),
    }
}

fn release_asset<'a>(release: &'a GithubRelease, name: &str) -> Result<&'a GithubReleaseAsset> {
    find_release_asset(release, name).ok_or_else(|| anyhow!("Release is missing {name}."))
}

fn find_release_asset<'a>(
    release: &'a GithubRelease,
    name: &str,
) -> Option<&'a GithubReleaseAsset> {
    release.assets.iter().find(|asset| asset.name == name)
}

fn release_version(release: &GithubRelease) -> Result<String> {
    release
        .tag_name
        .as_deref()
        .or(release.name.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| anyhow!("Release is missing a version tag."))
}

pub(crate) fn parse_sha256_sidecar(text: &str) -> Result<String> {
    let hash = text
        .split_whitespace()
        .next()
        .ok_or_else(|| anyhow!("Update checksum sidecar was empty."))?
        .to_ascii_lowercase();
    validate_sha256(&hash)?;
    Ok(hash)
}

pub(crate) fn validate_download_url(url: &str, allow_local_http: bool) -> Result<()> {
    if allow_local_http {
        if let Some(authority) = url
            .strip_prefix("http://")
            .and_then(|value| value.split('/').next())
        {
            let host = authority.split(':').next().unwrap_or_default();
            if host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1" {
                return Ok(());
            }
        }
    }
    let Some(rest) = url.strip_prefix("https://") else {
        bail!("Update URLs must use HTTPS GitHub release URLs.");
    };
    let Some((authority, path)) = rest.split_once('/') else {
        bail!("Update URL is missing a GitHub release path.");
    };
    if !authority.eq_ignore_ascii_case("github.com")
        || !path.contains("/releases/download/")
        || authority.contains('@')
        || authority.contains(':')
    {
        bail!("Update URL must be a GitHub release download.");
    }
    Ok(())
}

fn validate_sha256(value: &str) -> Result<()> {
    if value.len() == 64 && value.chars().all(|ch| ch.is_ascii_hexdigit()) {
        Ok(())
    } else {
        bail!("Update checksum sidecar contains an invalid SHA-256 hash.")
    }
}

#[cfg(test)]
pub(crate) fn verify_sha256(bytes: &[u8], expected: &str) -> Result<()> {
    validate_sha256(expected)?;
    let actual = sha256_hex(bytes);
    if actual == expected.to_ascii_lowercase() {
        Ok(())
    } else {
        bail!("Update checksum mismatch.")
    }
}

#[cfg(test)]
pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn normalize_version(version: &str) -> Vec<u64> {
    version
        .trim()
        .trim_start_matches(['v', 'V'])
        .split('-')
        .next()
        .unwrap_or_default()
        .split('.')
        .map(|part| part.parse::<u64>().unwrap_or(0))
        .collect()
}

pub(crate) fn compare_versions(left: &str, right: &str) -> i8 {
    let left = normalize_version(left);
    let right = normalize_version(right);
    let max = left.len().max(right.len());
    for index in 0..max {
        let left_value = *left.get(index).unwrap_or(&0);
        let right_value = *right.get(index).unwrap_or(&0);
        if left_value > right_value {
            return 1;
        }
        if left_value < right_value {
            return -1;
        }
    }
    0
}

pub(crate) fn update_file_name(update: &UpdateInfoDto) -> Result<String> {
    if update.platform.starts_with("darwin-") {
        Ok(format!("wheeljack-{}.app.zip", update.version))
    } else if update.platform.starts_with("windows-") {
        Ok(format!("wheeljack-{}.exe", update.version))
    } else {
        bail!("Auto-update is not supported on this platform.")
    }
}

pub(crate) fn validate_update_archive_name(file_name: &str) -> Result<()> {
    if file_name.trim().is_empty()
        || file_name.contains('/')
        || file_name.contains('\\')
        || file_name.starts_with('.')
    {
        bail!("Invalid update file name.");
    }
    let lower = file_name.to_ascii_lowercase();
    if lower.ends_with(".exe") || lower.ends_with(".app.zip") {
        Ok(())
    } else {
        bail!("Unsupported update file type.")
    }
}

pub(crate) fn downloaded_update_path(
    archive_path: &Path,
    update: &UpdateInfoDto,
) -> Result<PathBuf> {
    if update.platform.starts_with("darwin-") {
        extract_app_zip(archive_path)
    } else {
        Ok(archive_path.to_path_buf())
    }
}

pub(crate) fn verify_update_signature(update_path: &Path) -> Result<String> {
    if update_path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("exe"))
        .unwrap_or(false)
    {
        verify_windows_authenticode(update_path)
    } else if update_path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("app"))
    {
        verify_macos_app(update_path)
    } else {
        Ok("not_applicable".to_string())
    }
}

#[cfg(windows)]
fn verify_windows_authenticode(update_path: &Path) -> Result<String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{
        HWND, TRUST_E_NOSIGNATURE, TRUST_E_PROVIDER_UNKNOWN, TRUST_E_SUBJECT_FORM_UNKNOWN,
    };
    use windows::Win32::Security::WinTrust::{
        WinVerifyTrust, WINTRUST_ACTION_GENERIC_VERIFY_V2, WINTRUST_DATA, WINTRUST_DATA_0,
        WINTRUST_FILE_INFO, WTD_CHOICE_FILE, WTD_REVOCATION_CHECK_NONE, WTD_REVOKE_NONE,
        WTD_SAFER_FLAG, WTD_STATEACTION_IGNORE, WTD_UICONTEXT_EXECUTE, WTD_UI_NONE,
    };

    let wide_path = update_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let mut file_info = WINTRUST_FILE_INFO {
        cbStruct: std::mem::size_of::<WINTRUST_FILE_INFO>() as u32,
        pcwszFilePath: PCWSTR(wide_path.as_ptr()),
        ..Default::default()
    };
    let mut trust_data = WINTRUST_DATA {
        cbStruct: std::mem::size_of::<WINTRUST_DATA>() as u32,
        dwUIChoice: WTD_UI_NONE,
        fdwRevocationChecks: WTD_REVOKE_NONE,
        dwUnionChoice: WTD_CHOICE_FILE,
        Anonymous: WINTRUST_DATA_0 {
            pFile: &mut file_info,
        },
        dwStateAction: WTD_STATEACTION_IGNORE,
        dwProvFlags: WTD_REVOCATION_CHECK_NONE | WTD_SAFER_FLAG,
        dwUIContext: WTD_UICONTEXT_EXECUTE,
        ..Default::default()
    };
    let mut action = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    let status = unsafe {
        WinVerifyTrust(
            HWND::default(),
            &mut action,
            (&mut trust_data as *mut WINTRUST_DATA).cast(),
        )
    };
    match status {
        0 => Ok("valid".to_string()),
        status
            if [
                TRUST_E_NOSIGNATURE.0,
                TRUST_E_PROVIDER_UNKNOWN.0,
                TRUST_E_SUBJECT_FORM_UNKNOWN.0,
            ]
            .contains(&status) =>
        {
            Ok("unsigned".to_string())
        }
        status => {
            bail!(
                "Downloaded Windows update is not signed by a trusted publisher (WinVerifyTrust status 0x{:08x}).",
                status as u32
            )
        }
    }
}

#[cfg(not(windows))]
fn verify_windows_authenticode(update_path: &Path) -> Result<String> {
    let _ = update_path;
    Ok("not_applicable".to_string())
}

#[cfg(target_os = "macos")]
fn verify_macos_app(update_path: &Path) -> Result<String> {
    let signature = Command::new("/usr/bin/codesign")
        .args(["--verify", "--deep", "--strict", "--verbose=2"])
        .arg(update_path)
        .output()?;
    if !signature.status.success() {
        let detail = String::from_utf8_lossy(&signature.stderr)
            .trim()
            .to_string();
        bail!("Downloaded macOS update has an invalid code signature: {detail}");
    }
    let assessment = Command::new("/usr/sbin/spctl")
        .args(["--assess", "--type", "execute", "--verbose=2"])
        .arg(update_path)
        .output()?;
    if !assessment.status.success() {
        let detail = String::from_utf8_lossy(&assessment.stderr)
            .trim()
            .to_string();
        bail!("Downloaded macOS update was not accepted by Gatekeeper: {detail}");
    }
    Ok("valid".to_string())
}

#[cfg(not(target_os = "macos"))]
fn verify_macos_app(update_path: &Path) -> Result<String> {
    let _ = update_path;
    Ok("not_applicable".to_string())
}

#[cfg(target_os = "macos")]
fn extract_app_zip(zip_file: &Path) -> Result<PathBuf> {
    let parent = zip_file
        .parent()
        .ok_or_else(|| anyhow!("Invalid zip path."))?;
    let app_path = parent.join("wheeljack.app");
    if app_path.exists() {
        fs::remove_dir_all(&app_path)?;
    }
    let status = Command::new("ditto")
        .args(["-x", "-k"])
        .arg(zip_file)
        .arg(parent)
        .status()?;
    if !status.success() {
        bail!("Could not extract macOS app zip.");
    }
    if !app_path.exists() {
        bail!("Extracted update did not contain wheeljack.app.");
    }
    let _ = fs::remove_file(zip_file);
    Ok(app_path)
}

#[cfg(not(target_os = "macos"))]
fn extract_app_zip(zip_file: &Path) -> Result<PathBuf> {
    let _ = zip_file;
    bail!("macOS app zip extraction is only available on macOS.")
}

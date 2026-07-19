//! Update check against GitHub Releases. Notify + button model:
//! on launch we query the latest release; if it's a newer semver than the
//! running build, the UI shows an "Update available" button whose click opens
//! the release page in the default browser. No silent auto-install.

const REPO: &str = "Rhaone21/promptdb";
const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

pub struct UpdateInfo {
    pub version: String,
    pub url: String,
}

/// Compare a release tag (e.g. "v2.1.0" or "2.1.0") against the current build.
/// Returns Some(newer) when the tag is a strictly greater semver.
fn newer_than_current(tag: &str) -> Option<semver::Version> {
    let cleaned = tag.trim_start_matches('v').trim();
    let remote = semver::Version::parse(cleaned).ok()?;
    let current = semver::Version::parse(CURRENT_VERSION).ok()?;
    if remote > current {
        Some(remote)
    } else {
        None
    }
}

/// Blocking network call — run this off the UI thread.
/// Returns Some(UpdateInfo) only if a strictly newer release exists.
pub fn check_for_update() -> Option<UpdateInfo> {
    let api = format!("https://api.github.com/repos/{}/releases/latest", REPO);
    let resp = ureq::get(&api)
        .set("User-Agent", "PromptDB-Updater")
        .set("Accept", "application/vnd.github+json")
        .timeout(std::time::Duration::from_secs(8))
        .call()
        .ok()?;
    let json: serde_json::Value = resp.into_json().ok()?;
    let tag = json.get("tag_name")?.as_str()?;
    let newer = newer_than_current(tag)?;
    let url = json
        .get("html_url")
        .and_then(|v| v.as_str())
        .unwrap_or("https://github.com/Rhaone21/promptdb/releases")
        .to_string();
    Some(UpdateInfo {
        version: newer.to_string(),
        url,
    })
}

/// Open the release page in the user's default browser.
pub fn open_release_page(url: &str) {
    let _ = open::that(url);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_strictly_newer() {
        // CURRENT_VERSION is 2.0.0 (Cargo.toml). Anything higher is an update.
        assert!(newer_than_current("v2.0.1").is_some());
        assert!(newer_than_current("2.1.0").is_some());
        assert!(newer_than_current("v3.0.0").is_some());
    }

    #[test]
    fn ignores_same_or_older() {
        assert!(newer_than_current("v2.0.0").is_none());
        assert!(newer_than_current("1.9.9").is_none());
        assert!(newer_than_current("garbage").is_none());
    }
}

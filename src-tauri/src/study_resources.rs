use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, Window};

fn validated_study_url(value: &str) -> Result<tauri::Url, String> {
    let url = tauri::Url::parse(value).map_err(|_| "Invalid study link".to_string())?;
    let allowed = matches!(url.host_str(), Some("chessable.com" | "www.chessable.com" | "lichess.org" | "chess.com" | "www.chess.com"));
    if url.scheme() != "https" || !allowed || !url.username().is_empty() || url.password().is_some() || url.port().is_some() {
        return Err("Use an HTTPS Chessable, Lichess or Chess.com link".to_string());
    }
    Ok(url)
}

#[tauri::command]
#[specta::specta]
pub async fn open_study_resource(window: Window, app: AppHandle, url: String) -> Result<(), String> {
    if window.label() != "main" { return Err("Open study links from the main app".to_string()); }
    let url = validated_study_url(&url)?;
    let host = url.host_str().unwrap_or("study").trim_start_matches("www.").replace('.', "-");
    let label = format!("study-{host}");
    if let Some(existing) = app.get_webview_window(&label) {
        existing.navigate(url).map_err(|_| "Could not load the course".to_string())?;
        existing.show().map_err(|_| "Could not show the course".to_string())?;
        return existing.set_focus().map_err(|_| "Could not focus the course".to_string());
    }
    let profile = app.path().app_local_data_dir().map_err(|_| "Could not find the study profile".to_string())?.join("study-browser");
    // The remote window receives no app capabilities. Persist only its normal
    // WebView browser profile; never collect passwords or copy Chrome cookies.
    WebviewWindowBuilder::new(&app, label, WebviewUrl::External(url))
        .title("En Croissant · Study")
        .inner_size(1100.0, 800.0)
        .min_inner_size(600.0, 450.0)
        .data_directory(profile)
        .on_navigation(|destination| destination.scheme() == "https")
        .build()
        .map_err(|_| "Could not open the study window. Try Open in browser.".to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_normal_study_links_are_admitted() {
        assert!(validated_study_url("https://www.chessable.com/course/123/").is_ok());
        for url in ["http://www.chessable.com/", "https://www.chessable.com.evil.test/", "https://password@www.chessable.com/", "file:///C:/private.txt", "https://www.chessable.com:8443/", "https://example.com/"] {
            assert!(validated_study_url(url).is_err(), "{url}");
        }
    }
}

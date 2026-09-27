use encroissant_tournament_core::Service;
use tauri::Manager;

static SERVICE: tokio::sync::OnceCell<Service> = tokio::sync::OnceCell::const_new();

#[tauri::command]
#[specta::specta]
pub async fn tournament_request(app: tauri::AppHandle, request: String) -> Result<String, String> {
    if request.len() > 34 * 1024 * 1024 { return Err("Tournament request is too large.".into()); }
    let service = SERVICE.get_or_try_init(|| async {
        Service::open(
            app.path().app_data_dir().map_err(|e| e.to_string())?.join("tournaments"),
            app.path().app_cache_dir().map_err(|e| e.to_string())?.join("otb-game-import"),
        )
    }).await?;
    let value = serde_json::from_str(&request).map_err(|e| e.to_string())?;
    serde_json::to_string(&service.request(value).await?).map_err(|e| e.to_string())
}

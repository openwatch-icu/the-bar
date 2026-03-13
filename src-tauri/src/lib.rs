use tauri_plugin_shell::ShellExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![spawn_server])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn spawn_server(
    app_handle: tauri::AppHandle,
    license_key: String,
    license_server_url: String,
    data_dir: String,
    http_addr: String,
    instance_slug: String,
    access_code: String,
    bar_user_allowed: bool,
    session_bar_minutes: u32,
    minimum_age: u32,
    log_broadcast_body: bool,
    persist_messages: bool,
    inactivity_minutes: u32,
) -> Result<(), String> {
    let sidecar = app_handle
        .shell()
        .sidecar("thebar-server")
        .map_err(|e: tauri_plugin_shell::Error| e.to_string())?;
    let sidecar = sidecar
        .env("DATA_DIR", data_dir)
        .env("HTTP_ADDR", http_addr)
        .env(
            "INSTANCE_SLUG",
            if instance_slug.is_empty() {
                "default"
            } else {
                &instance_slug
            },
        )
        .env("ACCESS_CODE", access_code)
        .env(
            "BAR_USER_ALLOWED",
            if bar_user_allowed { "true" } else { "false" },
        )
        .env("SESSION_BAR_MINUTES", session_bar_minutes.to_string())
        .env("MINIMUM_AGE", minimum_age.to_string())
        .env(
            "LOG_BROADCAST_BODY",
            if log_broadcast_body { "1" } else { "0" },
        )
        .env(
            "PERSIST_MESSAGES",
            if persist_messages { "true" } else { "false" },
        )
        .env(
            "INACTIVITY_DISCONNECT_MINUTES",
            inactivity_minutes.to_string(),
        );

    // When both license key and URL are empty, skip license check (personal/public instance).
    let sidecar = if license_key.trim().is_empty() && license_server_url.trim().is_empty() {
        sidecar.env("DISABLE_LICENSE_CHECK", "1")
    } else {
        sidecar
            .env("LICENSE_KEY", license_key.trim())
            .env("LICENSE_SERVER_URL", license_server_url.trim())
    };

    let (_rx, child) = sidecar
        .spawn()
        .map_err(|e: tauri_plugin_shell::Error| e.to_string())?;
    // Detach so the server keeps running after this command returns.
    std::mem::forget(child);
    Ok(())
}

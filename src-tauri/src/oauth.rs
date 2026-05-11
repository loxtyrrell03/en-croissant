use axum::{
    extract::Query,
    http::StatusCode,
    response::{Html, IntoResponse},
    routing::get,
    Extension, Router,
};
use log::{info, warn};
use oauth2::{
    basic::BasicClient, reqwest::async_http_client, AuthUrl, AuthorizationCode, ClientId,
    CsrfToken, PkceCodeChallenge, PkceCodeVerifier, RedirectUrl, Scope, TokenResponse, TokenUrl,
};
use serde::Deserialize;
use std::{
    net::{SocketAddr, TcpListener},
    sync::{Arc, Mutex},
};
use tauri::Emitter;
use tauri_plugin_opener::OpenerExt;
use tokio::sync::oneshot;

use crate::error::Error;

fn create_client(redirect_url: RedirectUrl) -> BasicClient {
    let client_id = ClientId::new("org.encroissant.app".to_string());
    let auth_url = AuthUrl::new("https://lichess.org/oauth".to_string());
    let token_url = TokenUrl::new("https://lichess.org/api/token".to_string());

    BasicClient::new(client_id, None, auth_url.unwrap(), token_url.ok())
        .set_redirect_uri(redirect_url)
}

fn bind_callback_listener() -> Result<(TcpListener, SocketAddr), Error> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let addr = listener.local_addr()?;
    Ok((listener, addr))
}

#[derive(Clone)]
struct CallbackState {
    app: tauri::AppHandle,
    csrf_token: CsrfToken,
    pkce_verifier: String,
    client: Arc<BasicClient>,
    shutdown: Arc<Mutex<Option<oneshot::Sender<()>>>>,
}

#[tauri::command]
#[specta::specta]
pub async fn authenticate(username: String, app: tauri::AppHandle) -> Result<(), Error> {
    info!("Authenticating user {}", username);
    let (listener, socket_addr) = bind_callback_listener()?;
    let (pkce_code_challenge, pkce_code_verifier) = PkceCodeChallenge::new_random_sha256();
    let csrf_token = CsrfToken::new_random();
    let redirect_url = format!("http://{socket_addr}/callback");
    let client = Arc::new(create_client(RedirectUrl::new(redirect_url).unwrap()));
    let (shutdown_tx, shutdown_rx) = oneshot::channel();

    let callback_state = CallbackState {
        app: app.clone(),
        csrf_token: csrf_token.clone(),
        pkce_verifier: PkceCodeVerifier::secret(&pkce_code_verifier).to_string(),
        client: client.clone(),
        shutdown: Arc::new(Mutex::new(Some(shutdown_tx))),
    };
    let shutdown = callback_state.shutdown.clone();

    run_server(listener, callback_state, shutdown_rx)?;

    let (auth_url, _) = client
        .authorize_url(|| csrf_token)
        .add_scope(Scope::new("preference:read".to_string()))
        .add_extra_param("username", username)
        .set_pkce_challenge(pkce_code_challenge)
        .url();
    if let Err(error) = app.opener().open_url(auth_url.as_str(), None::<&str>) {
        signal_shutdown(&shutdown);
        return Err(error.into());
    }
    Ok(())
}

#[derive(Deserialize)]
struct CallbackQuery {
    code: Option<AuthorizationCode>,
    state: Option<CsrfToken>,
    error: Option<String>,
    error_description: Option<String>,
}

async fn authorize(
    state: Extension<CallbackState>,
    query: Query<CallbackQuery>,
) -> impl IntoResponse {
    let response = if let Some(error) = &query.error {
        let description = query.error_description.as_deref().unwrap_or(error);
        (
            StatusCode::BAD_REQUEST,
            callback_page(
                "Lichess authorization was cancelled",
                &format!("Lichess returned: {description}"),
            ),
        )
    } else if query.state.as_ref().map(CsrfToken::secret) != Some(state.csrf_token.secret()) {
        warn!("Rejected Lichess OAuth callback with an invalid state token");
        (
            StatusCode::BAD_REQUEST,
            callback_page(
                "Authorization could not be completed",
                "The callback did not match the login request. Please return to En Croissant and try again.",
            ),
        )
    } else if let Some(code) = query.code.clone() {
        match state
            .client
            .exchange_code(code)
            .set_pkce_verifier(PkceCodeVerifier::new(state.pkce_verifier.clone()))
            .request_async(async_http_client)
            .await
        {
            Ok(token) => {
                let access_token = token.access_token().secret();
                if let Err(error) = state.app.emit("access_token", access_token) {
                    warn!("Failed to emit Lichess access token: {error}");
                }
                (
                    StatusCode::OK,
                    callback_page(
                        "Lichess login complete",
                        "You can close this tab and return to En Croissant.",
                    ),
                )
            }
            Err(error) => {
                warn!("Failed to exchange Lichess OAuth code: {error}");
                (
                    StatusCode::BAD_GATEWAY,
                    callback_page(
                        "Lichess login failed",
                        "The authorization code could not be exchanged. Please return to En Croissant and try again.",
                    ),
                )
            }
        }
    } else {
        (
            StatusCode::BAD_REQUEST,
            callback_page(
                "Lichess login failed",
                "The callback did not include an authorization code. Please return to En Croissant and try again.",
            ),
        )
    };

    signal_shutdown(&state.shutdown);

    response.into_response()
}

fn callback_page(title: &str, message: &str) -> Html<String> {
    let title = escape_html(title);
    let message = escape_html(message);
    Html(format!(
        r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <style>
    body {{
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #202020;
      color: #f4f4f4;
    }}
    main {{
      width: min(34rem, calc(100vw - 3rem));
    }}
    h1 {{
      margin: 0 0 0.75rem;
      font-size: 1.5rem;
    }}
    p {{
      margin: 0;
      color: #cfcfcf;
      line-height: 1.5;
    }}
  </style>
</head>
<body>
  <main>
    <h1>{title}</h1>
    <p>{message}</p>
  </main>
  <script>setTimeout(() => window.close(), 800);</script>
</body>
</html>"#
    ))
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn signal_shutdown(shutdown: &Arc<Mutex<Option<oneshot::Sender<()>>>>) {
    if let Ok(mut shutdown) = shutdown.lock() {
        if let Some(shutdown) = shutdown.take() {
            let _ = shutdown.send(());
        }
    }
}

fn run_server(
    listener: TcpListener,
    state: CallbackState,
    shutdown_rx: oneshot::Receiver<()>,
) -> Result<(), Error> {
    let app = Router::new()
        .route("/callback", get(authorize))
        .layer(Extension(state.clone()));

    let server = axum::Server::from_tcp(listener)
        .map_err(|error| {
            std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("failed to create OAuth callback server: {error}"),
            )
        })?
        .serve(app.into_make_service())
        .with_graceful_shutdown(async move {
            let _ = shutdown_rx.await;
        });

    tauri::async_runtime::spawn(async move {
        if let Err(error) = server.await {
            warn!("Lichess OAuth callback server failed: {error}");
        }
    });
    Ok(())
}

//! Optional artwork from the organizer URL explicitly published with an event.
use super::{discovery::public_link, selector, Html, Url};
use std::{
    net::{IpAddr, ToSocketAddrs},
    time::Duration,
};

fn public_address(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, _, _] = ip.octets();
            !ip.is_private()
                && !ip.is_loopback()
                && !ip.is_link_local()
                && !ip.is_broadcast()
                && !ip.is_documentation()
                && !ip.is_multicast()
                && a != 0
                && a < 240
                && !(a == 100 && (64..128).contains(&b))
                && !(a == 198 && (18..20).contains(&b))
        }
        IpAddr::V6(ip) => ip
            .to_ipv4()
            .map(|v| public_address(IpAddr::V4(v)))
            .unwrap_or_else(|| {
                let first = ip.segments()[0];
                !ip.is_loopback()
                    && !ip.is_unspecified()
                    && !ip.is_multicast()
                    && first & 0xfe00 != 0xfc00
                    && first & 0xffc0 != 0xfe80
            }),
    }
}

fn artwork_link(base: &Url, raw: &str) -> Option<String> {
    let mut url = base.join(raw.trim()).ok()?;
    // The renderer's existing CSP permits HTTPS remote artwork.
    if url.scheme() == "http" {
        url.set_scheme("https").ok()?;
    }
    public_link(url.as_str()).filter(|_| url.scheme() == "https")
}

fn organizer_image(html: &str, base: &Url) -> Option<String> {
    let document = Html::parse_document(html);
    // Prefer the page's social/featured artwork, then its own published logo.
    // No guessed URLs, site favicons, advertisements or arbitrary first images.
    for query in [
        "meta[property='og:image:secure_url'], meta[property='og:image'], meta[property='og:image:url']",
        "meta[name='twitter:image'], meta[property='twitter:image']",
        "link[rel='image_src']",
        "img.wp-post-image, .entry-content img[class*='wp-image-'], .post-content img[class*='wp-image-']",
        "img.custom-logo, img[itemprop='logo'], img[alt*='logo' i]",
    ] {
        for element in document.select(&selector(query)) {
            let value = element.value();
            if let Some(raw) = value.attr("content").or_else(|| value.attr("href"))
                .or_else(|| value.attr("data-src")).or_else(|| value.attr("src")) {
                if let Some(url) = artwork_link(base, raw) { return Some(url); }
            }
        }
    }
    None
}

async fn fetch_organizer_image(raw: &str) -> Option<String> {
    let mut url = Url::parse(&public_link(raw)?).ok()?;
    for _ in 0..4 {
        public_link(url.as_str())?;
        let host = url.host_str()?.to_owned();
        let port = url.port_or_known_default()?;
        let lookup_host = host.clone();
        let addresses = tokio::task::spawn_blocking(move || {
            (lookup_host.as_str(), port)
                .to_socket_addrs()
                .map(|items| items.collect::<Vec<_>>())
        })
        .await
        .ok()?
        .ok()?;
        if addresses.is_empty()
            || addresses
                .iter()
                .any(|address| !public_address(address.ip()))
        {
            return None;
        }
        // Pin the validated DNS answers; revalidate each redirect before fetching.
        let client = reqwest::Client::builder()
            .no_proxy()
            .resolve_to_addrs(&host, &addresses)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(3))
            .timeout(Duration::from_secs(6))
            .user_agent("Mozilla/5.0 (compatible; Novelty tournament artwork)")
            .build()
            .ok()?;
        let mut response = client
            .get(url.clone())
            .header("Accept", "text/html")
            .send()
            .await
            .ok()?;
        if response.status().is_redirection() {
            url = url
                .join(response.headers().get("location")?.to_str().ok()?)
                .ok()?;
            continue;
        }
        if !response.status().is_success() {
            return None;
        }
        if !response
            .headers()
            .get("content-type")?
            .to_str()
            .ok()?
            .contains("text/html")
        {
            return None;
        }
        const MAX_HTML: usize = 2 * 1024 * 1024;
        if response
            .content_length()
            .is_some_and(|n| n > MAX_HTML as u64)
        {
            return None;
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.ok()? {
            if bytes.len() + chunk.len() > MAX_HTML {
                return None;
            }
            bytes.extend_from_slice(&chunk);
        }
        return organizer_image(&String::from_utf8_lossy(&bytes), &url);
    }
    None
}

pub(super) async fn organizer_artwork(url: &str) -> Option<String> {
    // Artwork must never block tournament discovery or following indefinitely.
    tokio::time::timeout(Duration::from_secs(10), fetch_organizer_image(url))
        .await
        .ok()
        .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resolves_published_relative_and_extensionless_artwork() {
        let base = Url::parse("https://organizer.example/congress/").unwrap();
        assert_eq!(organizer_image("<meta property='og:image' content='/media/image?id=42'><img class='custom-logo' src='/logo.svg'>", &base).as_deref(), Some("https://organizer.example/media/image?id=42"));
        assert_eq!(
            organizer_image("<img class='custom-logo' src='../logo.svg'>", &base).as_deref(),
            Some("https://organizer.example/logo.svg")
        );
    }
    #[test]
    fn ignores_unrelated_images_and_local_addresses() {
        let base = Url::parse("https://organizer.example/").unwrap();
        assert!(organizer_image(
            "<img src='/ad.png'><link rel='icon' href='/icon.png'>",
            &base
        )
        .is_none());
        assert!(organizer_image(
            "<meta property='og:image' content='file:///private.png'>",
            &base
        )
        .is_none());
        for ip in [
            "127.0.0.1",
            "10.0.0.1",
            "169.254.169.254",
            "100.64.0.1",
            "::1",
            "fc00::1",
            "::ffff:127.0.0.1",
        ] {
            assert!(!public_address(ip.parse().unwrap()), "{ip}");
        }
        assert!(public_address("1.1.1.1".parse().unwrap()));
    }
}

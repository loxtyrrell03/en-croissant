//! Source-filtered discovery. Kept separate from the round/pairing parser.
use super::*;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

const SOURCE_LIMIT: usize = 2000;

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryRequest {
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub country: String,
    #[serde(default)]
    pub federations: Vec<String>,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub time_control: String,
    pub from: String,
    pub to: String,
    pub today: String,
    pub period: String,
    #[serde(default)]
    pub include_undated: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryResponse {
    pub events: Vec<TournamentSearchResult>,
    pub source_count: usize,
    pub source_limit_reached: bool,
    pub fetched_at: String,
}

pub(super) fn parse_date(value: &str) -> Option<NaiveDate> {
    ["%Y-%m-%d", "%Y/%m/%d", "%d.%m.%Y"]
        .iter()
        .find_map(|format| NaiveDate::parse_from_str(value.trim(), format).ok())
}

fn validate(request: &DiscoveryRequest) -> Result<(NaiveDate, NaiveDate, NaiveDate), String> {
    let from = parse_date(&request.from).ok_or("Choose a valid start date.")?;
    let to = parse_date(&request.to).ok_or("Choose a valid end date.")?;
    let today = parse_date(&request.today).ok_or("The current date is unavailable.")?;
    if from > to {
        return Err("The end date must follow the start date.".into());
    }
    if request.query.chars().count() > 50 || request.location.chars().count() > 30 {
        return Err("Use a shorter tournament name or location.".into());
    }
    if !["upcoming", "ongoing", "past", "all"].contains(&request.period.as_str()) {
        return Err("Choose a valid event period.".into());
    }
    if !["", "1", "2", "3"].contains(&request.time_control.as_str()) {
        return Err("Choose a valid time control.".into());
    }
    if request.federations.len() > 300
        || request
            .federations
            .iter()
            .chain(std::iter::once(&request.country))
            .any(|code| {
                !code.is_empty()
                    && (code.len() > 3 || !code.chars().all(|c| c.is_ascii_uppercase()))
            })
    {
        return Err("Choose a valid country or region.".into());
    }
    Ok((from, to, today))
}

fn discovery_form(base: &[(String, String)], request: &DiscoveryRequest) -> Vec<(String, String)> {
    let mut form: Vec<_> = base
        .iter()
        .filter(|(name, _)| name.starts_with("__"))
        .cloned()
        .collect();
    let fields = [
        ("txt_bez", request.query.trim()),
        ("txt_ort", request.location.trim()),
        (
            "combo_land",
            if request.country.is_empty() {
                "-"
            } else {
                &request.country
            },
        ),
        ("combo_art", "5"),
        ("combo_sort", "1"),
        ("combo_anzahl_zeilen", "5"),
        (
            "combo_bedenkzeit",
            if request.time_control.is_empty() {
                "0"
            } else {
                &request.time_control
            },
        ),
        // The source filters END dates. Fetch all possible future ends, then
        // filter exact START dates below so an event crossing `to` is retained.
        // Both bounds must be explicit: an omitted upper bound means one day.
        (
            "txt_von_tag",
            if request.include_undated {
                "1900-01-01"
            } else {
                &request.from
            },
        ),
        ("txt_bis_tag", "9999-12-31"),
        ("cb_suchen", "Search"),
    ];
    form.extend(
        fields
            .into_iter()
            .map(|(key, value)| (format!("ctl00$P1${key}"), value.to_string())),
    );
    form
}

fn matches(
    event: &TournamentSearchResult,
    request: &DiscoveryRequest,
    dates: (NaiveDate, NaiveDate, NaiveDate),
) -> bool {
    let (from, to, today) = dates;
    if !request.country.is_empty() && event.federation.as_deref() != Some(&request.country) {
        return false;
    }
    if !request.federations.is_empty()
        && !event
            .federation
            .as_ref()
            .is_some_and(|code| request.federations.contains(code))
    {
        return false;
    }
    let start = event.start_date.as_deref().and_then(parse_date);
    let end = event.end_date.as_deref().and_then(parse_date).or(start);
    let Some(start) = start else {
        return request.include_undated;
    };
    let end = end.unwrap_or(start);
    let phase = match request.period.as_str() {
        "upcoming" => start > today,
        "ongoing" => start <= today && end >= today,
        "past" => end < today,
        _ => true,
    };
    phase
        && if request.period == "ongoing" {
            start <= to && end >= from
        } else {
            start >= from && start <= to
        }
}

fn readable_results_page(html: &str) -> bool {
    Html::parse_document(html)
        .select(&selector("table.CRs2"))
        .next()
        .is_some()
        || [
            "No tournament was found with this selection.",
            "No tournaments found",
            "No records found",
            "No data found",
        ]
        .iter()
        .any(|message| html.contains(message))
}

// Small regions can be retrieved completely without letting the worldwide
// 2,000-row cap hide their events. Use only federation values advertised by
// the source form (some FIDE aliases are not valid ASP.NET select values).
fn source_countries(html: &str, request: &DiscoveryRequest) -> Vec<String> {
    if !request.country.is_empty()
        || request.federations.is_empty()
        || request.federations.len() > 12
    {
        return vec![request.country.clone()];
    }
    let document = Html::parse_document(html);
    let mut seen = HashSet::new();
    document
        .select(&selector("select[name='ctl00$P1$combo_land'] option"))
        .filter_map(|option| option.value().attr("value"))
        .filter(|code| request.federations.iter().any(|fed| fed == code))
        .filter(|code| seen.insert(code.to_string()))
        .map(str::to_string)
        .collect()
}

async fn fetch_discovery_page(
    client: &Client,
    url: Url,
    base: &[(String, String)],
    request: &DiscoveryRequest,
) -> Result<Vec<TournamentSearchResult>, String> {
    let response = client
        .post(url)
        .timeout(Duration::from_secs(30))
        .form(&discovery_form(base, request))
        .send()
        .await
        .map_err(|e| format!("Tournament search failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Tournament search failed: {e}"))?;
    let html = response.text().await.map_err(|e| e.to_string())?;
    if !readable_results_page(&html) {
        return Err("The tournament source returned an unreadable results page. Try again.".into());
    }
    Ok(parse_tournament_search_results(&html))
}

pub async fn discover_tournaments(request: DiscoveryRequest) -> Result<DiscoveryResponse, String> {
    let dates = validate(&request)?;
    let client = tournament_client()?;
    let response = client
        .get(format!("{CHESS_RESULTS_ORIGIN}/TurnierSuche.aspx?lan=1"))
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| format!("Could not open tournament search: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Could not open tournament search: {e}"))?;
    let url = response.url().clone();
    let html = response.text().await.map_err(|e| e.to_string())?;
    let base = parse_tournament_search_form(&html)?;
    let countries = source_countries(&html, &request);
    if countries.is_empty() {
        return Err("The tournament source does not list the selected region's federations. Try a country instead.".into());
    }
    let pages = stream::iter(countries.into_iter().map(|country| {
        let client = client.clone();
        let url = url.clone();
        let base = &base;
        let mut scoped = request.clone();
        scoped.country = country;
        async move { fetch_discovery_page(&client, url, base, &scoped).await }
    }))
    .buffered(3)
    .collect::<Vec<_>>()
    .await;
    let mut events = Vec::new();
    let mut source_count = 0;
    let mut source_limit_reached = false;
    for page in pages {
        // A failed federation must not be silently reported as no matches.
        let mut page = page?;
        source_count += page.len();
        source_limit_reached |= page.len() >= SOURCE_LIMIT;
        events.append(&mut page);
    }
    events.retain(|event| matches(event, &request, dates));
    let mut seen = HashSet::new();
    events.retain(|event| seen.insert(event.tournament_id.clone()));
    events.sort_by_key(|event| {
        event
            .start_date
            .as_deref()
            .and_then(parse_date)
            .unwrap_or(NaiveDate::MAX)
    });
    Ok(DiscoveryResponse {
        events,
        source_count,
        source_limit_reached,
        fetched_at: Utc::now().to_rfc3339(),
    })
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventMetadata {
    pub location: Option<String>,
    pub organizer: Option<String>,
    pub organizer_url: Option<String>,
    pub image_url: Option<String>,
}

pub(super) fn public_link(value: &str) -> Option<String> {
    let url = Url::parse(value).ok()?;
    let host = url.host_str()?;
    if !["https", "http"].contains(&url.scheme())
        || !url.username().is_empty()
        || url.password().is_some()
        || !host.contains('.')
        || host.ends_with(".local")
        || host.ends_with(".localhost")
        || host.parse::<std::net::IpAddr>().is_ok()
        || url.port().is_some_and(|p| p != 80 && p != 443)
    {
        return None;
    }
    Some(url.to_string())
}

pub(super) fn parse_metadata(html: &str) -> EventMetadata {
    let document = Html::parse_document(html);
    let mut metadata = EventMetadata::default();
    for row in document.select(&selector("tr")) {
        let cells = direct_cells(row);
        if cells.len() != 2 {
            continue;
        }
        match normalized_header(&clean_text(cells[0])).as_str() {
            "location" => metadata.location = non_empty(clean_text(cells[1])),
            "organizers" | "organizer" => metadata.organizer = non_empty(clean_text(cells[1])),
            "links" => {
                for link in cells[1].select(&selector("a[href]")) {
                    if clean_text(link)
                        .to_ascii_lowercase()
                        .contains("homepage of the organizer")
                    {
                        metadata.organizer_url = link.value().attr("href").and_then(public_link);
                    }
                }
            }
            _ => {}
        }
    }
    // Only publisher-supplied event artwork, never the Chess-Results banner,
    // flag, ad or an invented stock photo. Organizer enrichment is separate.
    for image in document.select(&selector(
        "meta[property='og:image'], #P1_pnl_turdet img, #P1_pnl_turinfo img",
    )) {
        let raw = image
            .value()
            .attr("content")
            .or_else(|| image.value().attr("src"));
        if let Some(raw) = raw {
            if let Ok(url) = Url::parse(CHESS_RESULTS_ORIGIN).and_then(|base| base.join(raw)) {
                let lower = url.path().to_ascii_lowercase();
                if !lower.contains("chessresults")
                    && !lower.contains("chess-results")
                    && !lower.contains("flag")
                    && !lower.contains("banner")
                    && [".jpg", ".jpeg", ".png", ".webp"]
                        .iter()
                        .any(|ext| lower.ends_with(ext))
                {
                    metadata.image_url = public_link(url.as_str());
                    if metadata.image_url.is_some() {
                        break;
                    }
                }
            }
        }
    }
    metadata
}

pub async fn tournament_event_metadata(url: String) -> Result<EventMetadata, String> {
    let id = tournament_id_from_url(&url)?;
    let html = fetch_html(
        &tournament_client()?,
        &tournament_page_url(&id, "turdet=YES"),
    )
    .await?;
    let mut metadata = parse_metadata(&html);
    if metadata.image_url.is_none() {
        if let Some(organizer) = metadata.organizer_url.as_deref() {
            metadata.image_url = super::media::organizer_artwork(organizer).await;
        }
    }
    Ok(metadata)
}

pub fn open_tournament_website(url: String) -> Result<(), String> {
    let _url = public_link(&url).ok_or("This tournament website address is not supported.")?;
    Err("Open the validated link using the host browser adapter.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn small_regions_request_each_supported_country_before_the_source_cap() {
        let mut r = request();
        r.federations = vec!["ENG".into(), "WLS".into(), "GBR".into()];
        let html = "<select name='ctl00$P1$combo_land'><option value='-'>All</option><option value='ENG'>England</option><option value='WLS'>Wales</option><option value='USA'>USA</option><option value='ENG'>Duplicate</option></select>";
        assert_eq!(source_countries(html, &r), vec!["ENG", "WLS"]);
        r.country = "WLS".into();
        assert_eq!(source_countries(html, &r), vec!["WLS"]);
        r.country.clear();
        r.federations.clear();
        assert_eq!(source_countries(html, &r), vec![""]);
        r.federations = (0..13).map(|n| n.to_string()).collect();
        assert_eq!(source_countries(html, &r), vec![""]);
    }
    #[test]
    fn accepts_empty_source_results_but_not_a_challenge_page() {
        assert!(readable_results_page(
            "<span>No tournament was found with this selection.</span>"
        ));
        assert!(readable_results_page("<table class='CRs2'></table>"));
        assert!(!readable_results_page(
            "<h1>Please verify your browser</h1>"
        ));
    }
    fn request() -> DiscoveryRequest {
        DiscoveryRequest {
            from: "2026-09-11".into(),
            to: "2026-12-11".into(),
            today: "2026-09-11".into(),
            period: "upcoming".into(),
            ..Default::default()
        }
    }
    fn event(start: &str, end: &str) -> TournamentSearchResult {
        parse_tournament_search_results(&format!("<table class='CRs2'><tr><td>1</td><td><a href='tnr42.aspx'>Future Open</a></td><td>ENG</td><td></td><td>today</td><td>{start}</td><td>{end}</td></tr></table>")).remove(0)
    }
    #[test]
    fn future_and_spanning_events_are_found_without_a_name() {
        let r = request();
        let d = validate(&r).unwrap();
        assert!(matches(&event("2026/09/12", "2027/05/01"), &r, d));
        assert!(!matches(&event("2026/09/10", "2026/10/01"), &r, d));
        assert!(!matches(&event("2027/01/01", "2027/01/02"), &r, d));
    }
    #[test]
    fn form_clears_finished_only_and_source_defaults() {
        let r = request();
        let f = discovery_form(
            &[
                ("__VIEWSTATE".into(), "x".into()),
                ("ctl00$P1$cbox_zuEnde".into(), "on".into()),
            ],
            &r,
        );
        assert!(f.contains(&("ctl00$P1$txt_bis_tag".into(), "9999-12-31".into())));
        assert!(!f.iter().any(|(k, _)| k.contains("zuEnde")));
        assert!(f.contains(&("ctl00$P1$txt_bez".into(), String::new())));
    }
    #[test]
    fn country_region_unknown_dates_and_boundaries() {
        let mut r = request();
        r.country = "WLS".into();
        assert!(!matches(
            &event("2026/09/12", "2026/09/12"),
            &r,
            validate(&r).unwrap()
        ));
        r.country.clear();
        r.include_undated = true;
        assert!(matches(&event("", ""), &r, validate(&r).unwrap()));
        r.include_undated = false;
        assert!(!matches(&event("", ""), &r, validate(&r).unwrap()));
        r.period = "ongoing".into();
        assert!(matches(
            &event("2026/09/10", "2026/09/11"),
            &r,
            validate(&r).unwrap()
        ));
    }
    #[test]
    fn metadata_ignores_site_branding_and_unsafe_links() {
        let m=parse_metadata("<meta property='og:image' content='/images/chessResults_ENG.jpg'><table><tr><td>Location</td><td>Cardiff</td></tr><tr><td>Links</td><td><a href='http://127.0.0.1/'>Official Homepage of the Organizer</a></td></tr></table>");
        assert_eq!(m.location.as_deref(), Some("Cardiff"));
        assert!(m.image_url.is_none());
        assert!(m.organizer_url.is_none());
        assert!(public_link("https://organizer.example/event").is_some());
    }
    #[test]
    fn keeps_publisher_supplied_event_artwork() {
        let m = parse_metadata(
            "<meta property='og:image' content='https://organizer.example/autumn-open.png'>",
        );
        assert_eq!(
            m.image_url.as_deref(),
            Some("https://organizer.example/autumn-open.png")
        );
    }
}

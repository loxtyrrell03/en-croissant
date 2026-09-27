//! Read only the published round-one schedule; never substitute midnight or the server clock.
use super::*;
use chrono::{FixedOffset, NaiveTime, TimeZone};

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundOneStart {
    pub date: Option<String>,
    pub time: Option<String>,
    /// Present only when the source also publishes an unambiguous UTC offset.
    pub starts_at: Option<String>,
}

fn offset_seconds(value: &str) -> Option<i32> {
    let normalized = value.trim().to_ascii_uppercase().replace(' ', "");
    if normalized.is_empty() {
        return None;
    }
    let normalized = normalized
        .strip_prefix("UTC")
        .or_else(|| normalized.strip_prefix("GMT"))
        .unwrap_or(&normalized);
    if normalized.is_empty() || normalized == "Z" {
        return Some(0);
    }
    let sign = match normalized.chars().next()? {
        '+' => 1,
        '-' => -1,
        _ => return None,
    };
    let digits = &normalized[1..];
    let (hours, minutes) = if digits.len() == 4 && digits.bytes().all(|byte| byte.is_ascii_digit())
    {
        digits.split_at(2)
    } else {
        digits.split_once(':').unwrap_or((digits, "0"))
    };
    let hours: i32 = hours.parse().ok()?;
    let minutes: i32 = minutes.parse().ok()?;
    ((0..=14).contains(&hours) && (0..60).contains(&minutes) && (hours < 14 || minutes == 0))
        .then_some(sign * (hours * 3600 + minutes * 60))
}

pub(super) fn parse_round_one_start(html: &str) -> Option<RoundOneStart> {
    let document = Html::parse_document(html);
    let row_selector = selector("tr");
    let mut published_offset = None;
    for row in document.select(&selector("tr")) {
        let cells = direct_cells(row);
        if cells.len() == 2
            && matches!(
                normalized_header(&clean_text(cells[0])).as_str(),
                "timezone" | "utcoffset"
            )
        {
            published_offset = offset_seconds(&clean_text(cells[1]));
        }
    }
    for table in document.select(&selector("table.CRs1")) {
        let mut rows = table.select(&row_selector);
        let Some(header) = rows.next() else {
            continue;
        };
        let headers: Vec<_> = direct_cells(header)
            .into_iter()
            .map(clean_text)
            .map(|s| normalized_header(&s))
            .collect();
        let (Some(round), Some(date), Some(time)) = (
            header_index(&headers, &["round", "rd"]),
            header_index(&headers, &["date"]),
            header_index(&headers, &["time"]),
        ) else {
            continue;
        };
        for row in rows {
            let cells = direct_cells(row);
            if cells.get(round).map(|c| clean_text(*c)).as_deref() != Some("1") {
                continue;
            }
            let parsed_date = cells
                .get(date)
                .and_then(|c| discovery::parse_date(&clean_text(*c)));
            let raw_time = cells.get(time).map(|c| clean_text(*c)).unwrap_or_default();
            let parts: Vec<_> = raw_time.split_whitespace().collect();
            let parsed_time = parts.first().and_then(|s| {
                NaiveTime::parse_from_str(s, "%H:%M")
                    .or_else(|_| NaiveTime::parse_from_str(s, "%H:%M:%S"))
                    .ok()
            });
            let explicit_offset = if parts.len() > 1 {
                offset_seconds(&parts[1..].join(" "))
            } else {
                published_offset
            };
            let starts_at = parsed_date
                .zip(parsed_time)
                .zip(explicit_offset)
                .and_then(|((date, time), offset)| {
                    FixedOffset::east_opt(offset)?
                        .from_local_datetime(&date.and_time(time))
                        .single()
                })
                .map(|date| date.to_rfc3339());
            return Some(RoundOneStart {
                date: parsed_date.map(|date| date.format("%Y-%m-%d").to_string()),
                time: parsed_time.map(|time| time.format("%H:%M").to_string()),
                starts_at,
            });
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    fn html(date: &str, time: &str) -> String {
        format!("<table class='CRs1'><tr><th>Round</th><th>Date</th><th>Time</th></tr><tr><td>1</td><td>{date}</td><td>{time}</td></tr><tr><td>2</td><td>2026/09/14</td><td>15:00 UTC</td></tr></table>")
    }
    #[test]
    fn keeps_unknown_schedule_unknown() {
        let value = parse_round_one_start(&html("", "unknown")).unwrap();
        assert!(value.date.is_none() && value.time.is_none() && value.starts_at.is_none());
        assert!(parse_round_one_start("<p>Last update 13.09.2026 09:00</p>").is_none());
    }
    #[test]
    fn preserves_local_time_without_guessing_timezone() {
        let value = parse_round_one_start(&html("13.09.2026", "09:30")).unwrap();
        assert_eq!(value.date.as_deref(), Some("2026-09-13"));
        assert_eq!(value.time.as_deref(), Some("09:30"));
        assert!(value.starts_at.is_none());
    }
    #[test]
    fn uses_published_offset_and_round_one_only() {
        let value = parse_round_one_start(&html("2026/09/13", "09:30 UTC-03:00")).unwrap();
        assert_eq!(
            value.starts_at.as_deref(),
            Some("2026-09-13T09:30:00-03:00")
        );
        let page = format!(
            "<table><tr><td>Time zone</td><td>UTC+01:00</td></tr></table>{}",
            html("2026/09/13", "09:30")
        );
        assert_eq!(
            parse_round_one_start(&page).unwrap().starts_at.as_deref(),
            Some("2026-09-13T09:30:00+01:00")
        );
    }
    #[test]
    fn rejects_invalid_dates_times_and_ambiguous_zones() {
        for (date, time) in [
            ("2026/02/30", "09:30 UTC"),
            ("2026/09/13", "25:30 UTC"),
            ("2026/09/13", "09:30 CST"),
            ("2026/09/13", "09:30 UTC+15"),
        ] {
            assert!(parse_round_one_start(&html(date, time))
                .unwrap()
                .starts_at
                .is_none());
        }
    }
}

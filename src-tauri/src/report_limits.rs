use serde::Deserialize;
use specta::Type;

use crate::engine::GoMode;

#[derive(Clone, Debug, Default, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GameAnalysisLimits {
    #[specta(optional)]
    pub depth: Option<u32>,
    #[specta(optional)]
    pub time_ms: Option<u32>,
}

impl GameAnalysisLimits {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.depth.is_none() && self.time_ms.is_none() {
            return Err("Choose a depth or time limit for game analysis.");
        }
        if self.depth.is_some_and(|depth| !(2..=30).contains(&depth)) {
            return Err("Game analysis depth must be between 2 and 30.");
        }
        if self
            .time_ms
            .is_some_and(|time| !(50..=5000).contains(&time))
        {
            return Err("Game analysis time must be between 50 and 5,000 ms per position.");
        }
        Ok(())
    }
}

/// Report limits supplement the legacy engine mode without changing practice
/// games, live analysis, or existing depth/time/node preferences.
pub fn validate_report_limits(
    mode: &GoMode,
    limits: Option<&GameAnalysisLimits>,
) -> Result<(), &'static str> {
    if let Some(limits) = limits {
        return limits.validate();
    }
    match mode {
        GoMode::Depth(value) | GoMode::Time(value) | GoMode::Nodes(value) if *value > 0 => Ok(()),
        _ => Err("Game analysis requires a finite depth, time or node limit."),
    }
}

pub fn report_time_ms(mode: &GoMode, limits: Option<&GameAnalysisLimits>) -> Option<u32> {
    limits
        .map(|limits| limits.time_ms)
        .unwrap_or_else(|| match mode {
            GoMode::Time(time) => Some(*time),
            _ => None,
        })
}

pub fn report_depth(mode: &GoMode, limits: Option<&GameAnalysisLimits>) -> Option<u32> {
    limits
        .map(|limits| limits.depth)
        .unwrap_or_else(|| match mode {
            GoMode::Depth(depth) => Some(*depth),
            _ => None,
        })
}

pub fn report_go_command(mode: &GoMode, limits: Option<&GameAnalysisLimits>) -> String {
    let depth = report_depth(mode, limits);
    let time = report_time_ms(mode, limits);
    if depth.is_none() && time.is_none() {
        return mode.to_uci_string();
    }
    let mut command = String::from("go");
    if let Some(depth) = depth {
        command.push_str(&format!(" depth {depth}"));
    }
    // Exact bestmove recovery shares the same per-position time allowance.
    if let Some(time) = time {
        command.push_str(&format!(" movetime {}", (u64::from(time) * 4 / 5).max(1)));
    }
    command
}

pub fn recovery_go_command(
    mode: &GoMode,
    limits: Option<&GameAnalysisLimits>,
    remaining_ms: u32,
    candidate: &str,
) -> String {
    format!(
        "go depth {} movetime {} searchmoves {candidate}",
        report_depth(mode, limits).unwrap_or(12).min(12),
        remaining_ms.max(1)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presets_stop_at_the_first_bound_and_recovery_never_deepens_them() {
        for (depth, time) in [(8, 50), (16, 250), (22, 1000)] {
            let limits = GameAnalysisLimits {
                depth: Some(depth),
                time_ms: Some(time),
            };
            assert!(validate_report_limits(&GoMode::Infinite, Some(&limits)).is_ok());
            assert_eq!(
                report_go_command(&GoMode::Time(500), Some(&limits)),
                format!("go depth {depth} movetime {}", time * 4 / 5)
            );
            assert_eq!(
                recovery_go_command(&GoMode::Depth(30), Some(&limits), 7, "e2e4"),
                format!("go depth {} movetime 7 searchmoves e2e4", depth.min(12))
            );
        }
    }

    #[test]
    fn legacy_finite_preferences_keep_their_own_units_and_bounds() {
        assert_eq!(report_go_command(&GoMode::Depth(18), None), "go depth 18");
        assert_eq!(
            report_go_command(&GoMode::Nodes(50000), None),
            "go nodes 50000"
        );
        assert_eq!(
            report_go_command(&GoMode::Time(500), None),
            "go movetime 400"
        );
        assert_eq!(report_time_ms(&GoMode::Depth(18), None), None);
        assert!(validate_report_limits(&GoMode::Infinite, None).is_err());
        assert!(validate_report_limits(&GoMode::Time(0), None).is_err());
    }

    #[test]
    fn rejects_empty_or_invalid_external_limits() {
        assert!(GameAnalysisLimits::default().validate().is_err());
        for depth in [0, 1, 31, u32::MAX] {
            assert!(GameAnalysisLimits {
                depth: Some(depth),
                time_ms: Some(50)
            }
            .validate()
            .is_err());
        }
        for time in [0, 49, 5001, u32::MAX] {
            assert!(GameAnalysisLimits {
                depth: Some(8),
                time_ms: Some(time)
            }
            .validate()
            .is_err());
        }
        assert!(GameAnalysisLimits {
            depth: None,
            time_ms: Some(50)
        }
        .validate()
        .is_ok());
        assert!(GameAnalysisLimits {
            depth: Some(8),
            time_ms: None
        }
        .validate()
        .is_ok());
    }
}

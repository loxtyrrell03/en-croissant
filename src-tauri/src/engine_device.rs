//! Read-only host resource snapshot. This never starts or configures an engine.
use serde::Serialize;
use specta::Type;
use sysinfo::{System, SystemExt};

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EngineDeviceInfo {
    pub logical_threads: u32,
    pub total_memory_mb: Option<u32>,
    pub available_memory_mb: Option<u32>,
}

fn memory_mib(bytes: u64) -> Option<u32> {
    u32::try_from(bytes / 1_048_576)
        .ok()
        .filter(|value| *value > 0)
}

fn from_snapshot(
    logical_threads: usize,
    total_bytes: u64,
    available_bytes: u64,
) -> EngineDeviceInfo {
    let total_memory_mb = memory_mib(total_bytes);
    EngineDeviceInfo {
        logical_threads: u32::try_from(logical_threads.max(1)).unwrap_or(u32::MAX),
        total_memory_mb,
        // A known zero available value is different from missing memory data.
        available_memory_mb: total_memory_mb.map(|total| {
            (available_bytes.min(total_bytes) / 1_048_576).min(u64::from(total)) as u32
        }),
    }
}

pub fn snapshot() -> EngineDeviceInfo {
    let mut system = System::new();
    system.refresh_memory();
    from_snapshot(
        std::thread::available_parallelism()
            .map(usize::from)
            .unwrap_or(1),
        system.total_memory(),
        system.available_memory(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn units_are_mib_and_available_zero_remains_known() {
        let value = from_snapshot(20, 32 * 1_073_741_824, 20 * 1_073_741_824);
        assert_eq!(value.logical_threads, 20);
        assert_eq!(value.total_memory_mb, Some(32768));
        assert_eq!(value.available_memory_mb, Some(20480));
        assert_eq!(
            from_snapshot(2, 1_073_741_824, 0).available_memory_mb,
            Some(0)
        );
    }

    #[test]
    fn unknown_or_out_of_wire_range_memory_is_not_fabricated() {
        let missing = from_snapshot(0, 0, 0);
        assert_eq!(missing.logical_threads, 1);
        assert!(missing.total_memory_mb.is_none());
        assert!(missing.available_memory_mb.is_none());
        let enormous = from_snapshot(1, u64::MAX, u64::MAX);
        assert!(enormous.total_memory_mb.is_none());
        assert!(enormous.available_memory_mb.is_none());
        assert_eq!(
            from_snapshot(1, 1_073_741_824, u64::MAX).available_memory_mb,
            Some(1024)
        );
    }

    #[test]
    fn actual_host_read_has_valid_units_without_an_engine_or_profile() {
        let value = snapshot();
        assert!(value.logical_threads >= 1);
        if let (Some(total), Some(available)) = (value.total_memory_mb, value.available_memory_mb) {
            assert!(total > 0);
            assert!(available <= total);
        }
        #[cfg(windows)]
        assert!(value.total_memory_mb.is_some());
    }

    #[test]
    fn pure_wire_type_matches_the_saved_frontend_contract() {
        let config = specta_typescript::Typescript::default()
            .bigint(specta_typescript::BigIntExportBehavior::BigInt);
        let exported = specta_typescript::export::<EngineDeviceInfo>(&config).unwrap();
        let actual = include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../src/bindings/generated.ts"
        ));
        let contract = actual
            .lines()
            .find(|line| line.starts_with("export type EngineDeviceInfo ="))
            .unwrap();
        let normalize = |value: &str| {
            value
                .chars()
                .filter(|c| !c.is_whitespace())
                .collect::<String>()
        };
        assert_eq!(
            normalize(&exported).trim_end_matches(';'),
            normalize(contract).trim_end_matches(';')
        );
        let json = serde_json::to_value(from_snapshot(2, 0, 0)).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"logicalThreads":2,"totalMemoryMb":null,"availableMemoryMb":null})
        );
    }
}

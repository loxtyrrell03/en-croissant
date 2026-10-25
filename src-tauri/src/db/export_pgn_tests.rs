const EXPORT_FIXTURE: &str = "[Event \"Export fixture\"]\n[Site \"Synthetic\"]\n[White \"One\"]\n[Black \"Two\"]\n[Result \"*\"]\n\n{root note} 1. e4 {saved note} (1. d4 d5) e5 *";

use std::fs;

#[test]
fn database_pgn_export_command_keeps_its_two_argument_transport() {
    let mut types = specta::TypeMap::default();
    let functions = (specta::function::collect_functions![export_to_pgn])(&mut types);
    assert_eq!(functions[0].name(), "export_to_pgn");
    assert_eq!(
        functions[0]
            .args()
            .map(|argument| argument.0.clone())
            .collect::<Vec<_>>(),
        ["file", "dest_file"]
    );
    let generated = include_str!("../../../src/bindings/generated.ts");
    assert!(generated.contains("TAURI_INVOKE(\"export_to_pgn\", { file, destFile })"));
}

fn export_fixture() -> (tempfile::TempDir, std::path::PathBuf, SqliteConnection) {
    let directory = tempfile::Builder::new()
        .prefix("en-pgn-export-")
        .tempdir()
        .unwrap();
    let source = directory.path().join("source # % space.db3");
    let mut db = SqliteConnection::establish(source.to_str().unwrap()).unwrap();
    db.batch_execute(CREATE_TABLES_SQL).unwrap();
    import_single_game(EXPORT_FIXTURE)
        .insert_to_db(&mut db)
        .unwrap();
    import_single_game(EXPORT_FIXTURE)
        .insert_to_db(&mut db)
        .unwrap();
    (directory, source, db)
}

#[test]
fn database_pgn_export_row_errors_keep_the_previous_export_instead_of_skipping_games() {
    let (directory, source, mut db) = export_fixture();
    db.batch_execute("UPDATE Games SET Moves=NULL WHERE ID=2")
        .unwrap();
    let output = directory.path().join("export.pgn");
    fs::write(&output, b"previous export").unwrap();
    let result = export_database_pgn(&mut db, &source, &output);
    assert!(
        result.is_err(),
        "A corrupt database row must fail the export rather than vanish"
    );
    assert_eq!(fs::read(&output).unwrap(), b"previous export");
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 2);
}

#[test]
fn database_pgn_export_invalid_positions_keep_existing_output() {
    let (directory, source, mut db) = export_fixture();
    let output = directory.path().join("export.pgn");
    for fen in ["invalid position", "8/8/8/8/8/8/8/8 w - - 0 1"] {
        db.batch_execute(&format!("UPDATE Games SET FEN='{fen}' WHERE ID=2"))
            .unwrap();
        fs::write(&output, b"previous export").unwrap();
        let result = export_database_pgn(&mut db, &source, &output);
        assert!(
            result.is_err(),
            "An unreadable starting position must not become the standard start"
        );
        assert!(result.unwrap_err().to_string().contains("game 2"));
        assert_eq!(fs::read(&output).unwrap(), b"previous export");
    }
}

#[test]
fn database_pgn_export_cannot_truncate_its_source_database() {
    let (_directory, source, mut db) = export_fixture();
    let before = fs::read(&source).unwrap();
    assert!(export_database_pgn(&mut db, &source, &source).is_err());
    assert_eq!(fs::read(&source).unwrap(), before);
}

#[test]
fn database_pgn_export_refuses_missing_linked_metadata_and_bad_moves() {
    let (directory, source, mut db) = export_fixture();
    let output = directory.path().join("export.pgn");
    fs::write(&output, b"previous").unwrap();
    db.batch_execute("UPDATE Games SET Moves=X'FE' WHERE ID=2")
        .unwrap();
    assert!(export_database_pgn(&mut db, &source, &output)
        .unwrap_err()
        .to_string()
        .contains("game 2"));
    assert_eq!(fs::read(&output).unwrap(), b"previous");
    db.batch_execute("PRAGMA foreign_keys=OFF; DELETE FROM Events WHERE ID<>0")
        .unwrap();
    assert!(export_database_pgn(&mut db, &source, &output)
        .unwrap_err()
        .to_string()
        .contains("missing linked"));
    assert_eq!(fs::read(&output).unwrap(), b"previous");
}

#[test]
fn database_pgn_export_preserves_notes_variations_custom_starts_and_escaped_headers() {
    let (directory, source, mut db) = export_fixture();
    db.batch_execute("UPDATE Events SET Name='Quoted \"event\" \\ path' WHERE ID<>0")
        .unwrap();
    let custom = "[Event \"Custom\"]\n[White \"One\"]\n[Black \"Two\"]\n[Result \"*\"]\n[SetUp \"1\"]\n[FEN \"8/8/k7/8/8/8/7K/8 b - - 0 20\"]\n\n20... Kb5 *";
    import_single_game(custom).insert_to_db(&mut db).unwrap();
    let output = directory.path().join("export.pgn");
    export_database_pgn(&mut db, &source, &output).unwrap();
    let pgn = fs::read_to_string(&output).unwrap();
    assert_eq!(pgn.matches("[Event ").count(), 3);
    assert_eq!(
        pgn.matches("[Event \"Quoted \\\"event\\\" \\\\ path\"]")
            .count(),
        2
    );
    assert!(pgn.contains("root note") && pgn.contains("saved note") && pgn.contains("(1. d4 d5)"));
    assert!(pgn.contains("[SetUp \"1\"]") && pgn.contains("20... Kb5"));
    let reimported = import_single_game(&pgn);
    let first: Game = games::table.order(games::id).first(&mut db).unwrap();
    assert_eq!(reimported.moves, first.moves);
    db.batch_execute("UPDATE Events SET Name='line'||char(10)||'break' WHERE ID=1")
        .unwrap();
    assert!(export_database_pgn(&mut db, &source, &output).is_err());
    assert_eq!(fs::read_to_string(&output).unwrap(), pgn);
}

#[test]
fn database_pgn_export_source_is_read_only_and_missing_sources_are_never_created() {
    let (directory, source, _db) = export_fixture();
    let before = fs::read(&source).unwrap();
    let mut reader = open_export_source(&source).unwrap();
    assert!(reader
        .batch_execute("UPDATE Games SET Result='1-0'")
        .is_err());
    assert_eq!(
        games::table.count().get_result::<i64>(&mut reader).unwrap(),
        2
    );
    assert_eq!(fs::read(&source).unwrap(), before);
    let missing = directory.path().join("missing.db3");
    assert!(open_export_source(&missing).is_err());
    assert!(!missing.exists());
}

#[test]
fn database_pgn_export_reads_one_snapshot_during_concurrent_wal_writes() {
    let (_directory, source, mut db) = export_fixture();
    db.batch_execute("PRAGMA journal_mode=WAL").unwrap();
    struct ConcurrentWriter {
        source: std::path::PathBuf,
        bytes: Vec<u8>,
        changed: bool,
    }
    impl Write for ConcurrentWriter {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            if !self.changed {
                let other = rusqlite::Connection::open(&self.source).unwrap();
                other
                    .execute("UPDATE Events SET Name='New generation' WHERE ID<>0", [])
                    .unwrap();
                self.changed = true;
            }
            self.bytes.extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    let mut writer = ConcurrentWriter {
        source: source.clone(),
        bytes: Vec::new(),
        changed: false,
    };
    write_database_pgn_snapshot(&mut db, &mut writer).unwrap();
    let pgn = String::from_utf8(writer.bytes).unwrap();
    assert!(writer.changed);
    assert_eq!(pgn.matches("Export fixture").count(), 2);
    assert!(!pgn.contains("New generation"));
    assert_eq!(
        events::table
            .filter(events::id.ne(0))
            .select(events::name)
            .first::<Option<String>>(&mut db)
            .unwrap()
            .as_deref(),
        Some("New generation")
    );
}

#[tokio::test]
async fn database_pgn_export_native_command_reports_locked_source_then_retries() {
    let (directory, source, mut db) = export_fixture();
    let output = directory.path().join("export.pgn");
    fs::write(&output, b"previous export").unwrap();
    db.batch_execute("BEGIN EXCLUSIVE").unwrap();
    assert!(export_to_pgn(source.clone(), output.clone()).await.is_err());
    assert_eq!(fs::read(&output).unwrap(), b"previous export");
    db.batch_execute("ROLLBACK").unwrap();
    export_to_pgn(source, output.clone()).await.unwrap();
    assert!(fs::read_to_string(output)
        .unwrap()
        .contains("Export fixture"));
}

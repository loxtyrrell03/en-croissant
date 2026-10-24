const SAVE_ORIGINAL: &str = "[Event \"Fixture\"]\n[Site \"Test\"]\n[White \"One\"]\n[Black \"Two\"]\n[Result \"*\"]\n\n1. e4 e5 {original} *";
const SAVE_EDITED: &str = "[Event \"Edited event\"]\n[Site \"Test\"]\n[White \"Edited player\"]\n[Black \"Two\"]\n[Result \"*\"]\n\n1. e4 e5 {edited} *";

fn save_fixture(db: &mut SqliteConnection) -> (i32, String) {
    import_single_game(SAVE_ORIGINAL).insert_to_db(db).unwrap();
    let id = games::table.select(games::id).first(db).unwrap();
    (id, game_save::read_identity(db, id).unwrap())
}

#[test]
fn database_game_save_query_captures_the_stored_snapshot() {
    let db = &mut setup_test_db();
    let (_, original) = save_fixture(db);
    let (white, black) = diesel::alias!(players as fixture_white, players as fixture_black);
    let rows: Vec<(Game, Player, Player, Event, Site)> = games::table
        .inner_join(white.on(games::white_id.eq(white.field(players::id))))
        .inner_join(black.on(games::black_id.eq(black.field(players::id))))
        .inner_join(events::table.on(games::event_id.eq(events::id)))
        .inner_join(sites::table.on(games::site_id.eq(sites::id)))
        .load(db)
        .unwrap();
    let normalized = normalize_games(rows);
    assert_eq!(
        normalized[0].source_identity.as_deref(),
        Some(original.as_str())
    );
    assert!(normalized[0].moves.contains("original"));
}

#[test]
fn database_game_save_updates_identity_and_rejects_a_second_tab_without_side_effects() {
    let db = &mut setup_test_db();
    let (id, original) = save_fixture(db);
    let written = write_db_game_checked(db, id, SAVE_EDITED, Some(&original)).unwrap();
    assert_ne!(written, original);
    assert_eq!(written, game_save::read_identity(db, id).unwrap());
    let names_before: i64 = players::table.count().get_result(db).unwrap();
    let rejected = SAVE_EDITED.replace("Edited player", "Must not be created");
    assert!(matches!(
        write_db_game_checked(db, id, &rejected, Some(&original)),
        Err(Error::DatabaseGameConflict(_))
    ));
    assert_eq!(
        players::table.count().get_result::<i64>(db).unwrap(),
        names_before
    );
    assert_eq!(game_save::read_identity(db, id).unwrap(), written);
    assert_eq!(
        write_db_game_checked(db, id, SAVE_ORIGINAL, Some(&written)).unwrap(),
        original
    );
}

#[test]
fn database_game_save_captures_raw_annotations_and_joined_name_changes() {
    let db = &mut setup_test_db();
    let (id, original) = save_fixture(db);
    db.batch_execute("UPDATE Players SET Name = 'Renamed' WHERE Name = 'One'")
        .unwrap();
    assert_ne!(game_save::read_identity(db, id).unwrap(), original);
    assert!(write_db_game_checked(db, id, SAVE_EDITED, Some(&original)).is_err());
    db.batch_execute("UPDATE Players SET Name = 'One' WHERE Name = 'Renamed'")
        .unwrap();
    let annotated = SAVE_ORIGINAL.replace("original", "new note");
    let next = write_db_game_checked(db, id, &annotated, Some(&original)).unwrap();
    assert_ne!(next, original);
    assert!(write_db_game_checked(db, id, SAVE_EDITED, Some(&original)).is_err());
}

#[test]
fn database_game_save_requires_identity_and_preserves_deleted_rows() {
    let db = &mut setup_test_db();
    let (id, original) = save_fixture(db);
    for expected in [None, Some("")] {
        assert!(matches!(
            write_db_game_checked(db, id, SAVE_EDITED, expected),
            Err(Error::DatabaseGameConflict(_))
        ));
        assert_eq!(game_save::read_identity(db, id).unwrap(), original);
    }
    diesel::delete(games::table.filter(games::id.eq(id)))
        .execute(db)
        .unwrap();
    assert!(matches!(
        write_db_game_checked(db, id, SAVE_EDITED, Some(&original)),
        Err(Error::GameNotFound(_))
    ));
    assert_eq!(games::table.count().get_result::<i64>(db).unwrap(), 0);
}

#[test]
fn database_game_save_rolls_back_related_names_when_update_fails() {
    let db = &mut setup_test_db();
    let (id, original) = save_fixture(db);
    let names_before: i64 = players::table.count().get_result(db).unwrap();
    let events_before: i64 = events::table.count().get_result(db).unwrap();
    db.batch_execute("CREATE TRIGGER reject_save BEFORE UPDATE ON Games BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;").unwrap();
    assert!(write_db_game_checked(db, id, SAVE_EDITED, Some(&original)).is_err());
    assert_eq!(
        players::table.count().get_result::<i64>(db).unwrap(),
        names_before
    );
    assert_eq!(
        events::table.count().get_result::<i64>(db).unwrap(),
        events_before
    );
    assert_eq!(game_save::read_identity(db, id).unwrap(), original);
}

#[test]
fn database_game_save_serializes_competing_sqlite_connections() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("fixture.db3");
    let mut db = SqliteConnection::establish(path.to_str().unwrap()).unwrap();
    db.batch_execute(CREATE_TABLES_SQL).unwrap();
    let (id, original) = save_fixture(&mut db);
    drop(db);
    let start = std::sync::Arc::new(std::sync::Barrier::new(2));
    let handles = (0..2)
        .map(|n| {
            let path = path.clone();
            let original = original.clone();
            let start = start.clone();
            std::thread::spawn(move || {
                let mut db = SqliteConnection::establish(path.to_str().unwrap()).unwrap();
                db.batch_execute("PRAGMA busy_timeout = 5000").unwrap();
                start.wait();
                write_db_game_checked(
                    &mut db,
                    id,
                    &SAVE_EDITED.replace("edited}", &format!("edited {n}}}")),
                    Some(&original),
                )
            })
        })
        .collect::<Vec<_>>();
    let results = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result, Err(Error::DatabaseGameConflict(_))))
            .count(),
        1
    );
}

#[test]
fn database_game_save_generated_protocol_matches_native() {
    let generated = tauri_specta::Builder::<tauri::Wry>::new()
        .commands(tauri_specta::collect_commands!(
            write_db_game,
            delete_db_game
        ))
        .export_str(specta_typescript::Typescript::default())
        .unwrap();
    let command = |text: &str| {
        let start = text.find("async writeDbGame(").unwrap();
        text[start..]
            .split("\n},")
            .next()
            .unwrap()
            .split_whitespace()
            .map(str::to_string)
            .collect::<Vec<_>>()
    };
    assert_eq!(
        command(&generated),
        command(include_str!("../../../src/bindings/generated.ts"))
    );
}

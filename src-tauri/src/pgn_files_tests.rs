use super::*;

#[test]
fn complete_exports_replace_or_create_without_mutating_sources_or_metadata() {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("source.db3");
    let output = directory.path().join("export.pgn");
    fs::write(&source, b"source database bytes").unwrap();
    for previous in [None, Some("previous export")] {
        if let Some(previous) = previous {
            fs::write(&output, previous).unwrap();
        }
        let pgn = game("complete");
        export_file::<io::Error>(&output, &source, |writer| writer.write_all(pgn.as_bytes()))
            .unwrap();
        assert_eq!(fs::read_to_string(&output).unwrap(), pgn);
        assert_eq!(fs::read(&source).unwrap(), b"source database bytes");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 2);
    }
}

#[test]
fn failed_export_body_keeps_old_output_and_discards_only_owned_staging() {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("source.db3");
    let output = directory.path().join("export.pgn");
    fs::write(&source, b"source").unwrap();
    for exists in [false, true] {
        if exists {
            fs::write(&output, b"previous export").unwrap();
        }
        let error = export_file::<io::Error>(&output, &source, |writer| {
            writer.write_all(b"incomplete").unwrap();
            Err(problem("fixture cursor stopped"))
        })
        .unwrap_err();
        assert!(error.to_string().contains("fixture cursor stopped"));
        assert_eq!(output.exists(), exists);
        if exists {
            assert_eq!(fs::read(&output).unwrap(), b"previous export");
        }
        assert_eq!(
            fs::read_dir(directory.path()).unwrap().count(),
            if exists { 2 } else { 1 }
        );
    }
}

#[test]
fn final_export_flush_errors_are_observed_instead_of_lost_on_drop() {
    struct FullDisk;
    impl Write for FullDisk {
        fn write(&mut self, _: &[u8]) -> io::Result<usize> {
            Err(problem("fixture disk full"))
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    let mut buffered = BufWriter::new(FullDisk);
    let error =
        write_export::<io::Error>(&mut buffered, |writer| writer.write_all(b"buffered PGN"))
            .unwrap_err();
    assert!(error.to_string().contains("fixture disk full"));
}

#[test]
fn export_refuses_database_aliases_and_sidecars_before_writing() {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("source.db3");
    let alias = directory.path().join("alias.pgn");
    fs::write(&source, b"database bytes").unwrap();
    fs::hard_link(&source, &alias).unwrap();
    for output in [
        source.clone(),
        alias.clone(),
        source.with_file_name("source.db3-wal"),
        source.with_file_name("source.db3-shm"),
        source.with_file_name("source.db3-journal"),
    ] {
        let mut called = false;
        assert!(export_file::<io::Error>(&output, &source, |_| {
            called = true;
            Ok(())
        })
        .is_err());
        assert!(!called);
        assert_eq!(fs::read(&source).unwrap(), b"database bytes");
    }
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 2);
}

#[test]
fn export_refuses_hardlinked_sqlite_sidecar_aliases() {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("source.db3");
    let wal = directory.path().join("source.db3-wal");
    let alias = directory.path().join("alias.pgn");
    fs::write(&source, b"source database").unwrap();
    fs::write(&wal, b"source WAL").unwrap();
    fs::hard_link(&wal, &alias).unwrap();
    let mut called = false;
    assert!(export_file::<io::Error>(&alias, &source, |_| {
        called = true;
        Ok(())
    })
    .is_err());
    assert!(!called);
    assert_eq!(fs::read(&wal).unwrap(), b"source WAL");
    assert_eq!(fs::read(&alias).unwrap(), b"source WAL");
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 3);
}

#[test]
fn export_keeps_a_destination_created_or_changed_during_preparation() {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("source.db3");
    let output = directory.path().join("export.pgn");
    fs::write(&source, b"source").unwrap();
    assert!(export_file::<io::Error>(&output, &source, |writer| {
        writer.write_all(b"new export")?;
        fs::write(&output, b"new owner file")?;
        Ok(())
    })
    .is_err());
    assert_eq!(fs::read(&output).unwrap(), b"new owner file");
    let before = fs::metadata(&output).unwrap();
    assert!(export_file::<io::Error>(&output, &source, |writer| {
        writer.write_all(b"new export")?;
        fs::write(&output, b"changed bytes!")?;
        File::options()
            .write(true)
            .open(&output)?
            .set_times(fs::FileTimes::new().set_modified(before.modified()?))?;
        Ok(())
    })
    .is_err());
    assert_eq!(fs::read(&output).unwrap(), b"changed bytes!");
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 2);
}

#[test]
fn export_refuses_nonfile_or_readonly_destinations_and_does_not_create_parents() {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("source.db3");
    fs::write(&source, b"source").unwrap();
    let parent = directory.path().join("missing");
    assert!(export_file::<io::Error>(&parent.join("out.pgn"), &source, |_| Ok(())).is_err());
    assert!(!parent.exists());
    let output = directory.path().join("output.pgn");
    fs::create_dir(&output).unwrap();
    assert!(export_file::<io::Error>(&output, &source, |_| Ok(())).is_err());
    fs::remove_dir(&output).unwrap();
    fs::write(&output, b"keep").unwrap();
    let original = fs::metadata(&output).unwrap().permissions();
    let mut readonly = original.clone();
    readonly.set_readonly(true);
    fs::set_permissions(&output, readonly).unwrap();
    let rejected = export_file::<io::Error>(&output, &source, |_| Ok(()));
    fs::set_permissions(&output, original).unwrap();
    assert!(rejected.is_err());
    assert_eq!(fs::read(&output).unwrap(), b"keep");
}

#[cfg(windows)]
#[test]
fn locked_export_destination_survives_failed_publication_and_can_retry() {
    use std::os::windows::fs::OpenOptionsExt;
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("source.db3");
    let output = directory.path().join("export.pgn");
    fs::write(&source, b"source").unwrap();
    fs::write(&output, b"previous").unwrap();
    let locked = File::options()
        .read(true)
        .share_mode(1)
        .open(&output)
        .unwrap();
    let rejected =
        export_file::<io::Error>(&output, &source, |writer| writer.write_all(b"complete"));
    assert!(rejected.is_err());
    assert_eq!(fs::read(&output).unwrap(), b"previous");
    drop(locked);
    export_file::<io::Error>(&output, &source, |writer| writer.write_all(b"complete")).unwrap();
    assert_eq!(fs::read(&output).unwrap(), b"complete");
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 2);
}

const INFO: &str = "{\"type\":\"game\",\"tags\":[]}";
fn game(name: &str) -> String {
    format!("[Event \"{name}\"]\n[Result \"*\"]\n\n1. e4 *\n\n")
}
fn fixture(text: &str) -> (tempfile::TempDir, PathBuf) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("games.pgn");
    fs::write(&path, text).unwrap();
    (directory, path)
}

#[test]
fn lexical_boundaries_preserve_bom_comments_quoted_tags_and_headerless_games() {
    let first = "[Event \"quoted { brace \\\" and }\"]\r\n[Result \"*\"]\r\n\r\n{Root note\r\n[Event \"not a game\"]\r\n* 1-0}\r\n1. e4 (1. d4 {0-1}) ; [not a game]\r\n e5 *\r\n\r\n";
    let second = "[Event \"Unicode ♟\"]\n\n*\n\n";
    let text = format!("\u{feff}{first}{second}1. d4 * 1. c4 1/2-1/2\n");
    let (_directory, path) = fixture(&text);
    assert_eq!(count_games(&path).unwrap(), 4);
    let games = read_games(&path, 0, 3).unwrap();
    assert_eq!(games[0], first);
    assert_eq!(games[1], second);
    assert_eq!(games[2], "1. d4 * ");
    assert_eq!(games[3], "1. c4 1/2-1/2\n");
    assert_eq!(format!("\u{feff}{}", games.concat()), text);
}

#[test]
fn blank_small_and_custom_root_games_count_without_fabrication() {
    for (text, count) in [
        ("", 0),
        (" \n\r\n", 0),
        ("*", 1),
        ("\u{feff}", 0),
        ("[FEN \"7k/8/8/8/8/8/8/K7 b - - 11 37\"]\n\n*", 1),
    ] {
        let (_directory, path) = fixture(text);
        assert_eq!(count_games(&path).unwrap(), count, "{text}");
    }
}

#[test]
fn snapshot_batches_include_current_counts_and_camel_case_wire_fields() {
    let (_directory, path) = fixture(&game("a"));
    let batch = read_snapshots(&path, 0, 0).unwrap();
    let json = serde_json::to_value(&batch).unwrap();
    assert_eq!(json["gameCount"], 1);
    assert_eq!(json["games"][0]["index"], 0);
    assert_eq!(json["games"][0]["gameCount"], 1);
    assert_eq!(json["games"][0]["identity"].as_str().unwrap().len(), 64);
    fs::write(&path, "").unwrap();
    let empty = read_snapshots(&path, 0, 3).unwrap();
    assert_eq!(empty.game_count, 0);
    assert!(empty.games.is_empty());
}

#[test]
fn replaces_only_the_captured_game_and_keeps_neighbouring_bytes() {
    let first = game("first").replace('\n', "\r\n");
    let last = game("last ♟");
    let (_directory, path) = fixture(&format!("\u{feff}{first}{}{last}", game("middle")));
    let old = read_game(&path, 1).unwrap();
    let result = write_game(&path, 1, &old.identity, &game("edited"), INFO).unwrap();
    assert_eq!(result.index, 1);
    assert_eq!(result.game_count, 3);
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        format!("\u{feff}{first}{}{last}", game("edited"))
    );
    assert_eq!(read_game(&path, 1).unwrap().identity, result.identity);
    // Repeated saves use the refreshed identity.
    write_game(&path, 1, &result.identity, &game("edited again"), INFO).unwrap();
    assert!(read_game(&path, 1).unwrap().pgn.contains("edited again"));
}

#[test]
fn source_edits_missing_files_and_missing_identity_fail_closed() {
    let (_directory, path) = fixture(&game("original"));
    let old = read_game(&path, 0).unwrap();
    fs::write(&path, game("external edit")).unwrap();
    let before = fs::read(&path).unwrap();
    assert!(write_game(&path, 0, &old.identity, &game("mine"), INFO).is_err());
    assert_eq!(fs::read(&path).unwrap(), before);
    assert!(write_game(&path, 0, "", &game("mine"), INFO).is_err());
    fs::remove_file(&path).unwrap();
    assert!(write_game(&path, 0, &old.identity, &game("mine"), INFO).is_err());
    assert!(!path.exists());
}

#[test]
fn unique_relocated_game_is_followed_but_ambiguous_or_missing_sources_are_not() {
    let a = game("a");
    let b = game("b");
    let c = game("c");
    let (_directory, path) = fixture(&format!("{a}{b}{c}"));
    let old = read_game(&path, 0).unwrap();
    fs::write(&path, format!("{c}{b}{a}")).unwrap();
    let result = write_game(&path, 0, &old.identity, &game("changed a"), INFO).unwrap();
    assert_eq!(result.index, 2);
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        format!("{c}{b}{}", game("changed a"))
    );
    fs::write(&path, format!("{c}{a}{a}")).unwrap();
    let before = fs::read(&path).unwrap();
    assert!(write_game(&path, 0, &old.identity, &game("mine"), INFO)
        .unwrap_err()
        .to_string()
        .contains("more than one"));
    assert_eq!(fs::read(&path).unwrap(), before);
}

#[test]
fn separate_tabs_can_update_other_games_after_offsets_change() {
    let (_directory, path) = fixture(&format!("{}{}", game("a"), game("b")));
    let a = read_game(&path, 0).unwrap();
    let b = read_game(&path, 1).unwrap();
    write_game(
        &path,
        0,
        &a.identity,
        &game("a substantially longer replacement with notes"),
        INFO,
    )
    .unwrap();
    write_game(&path, 1, &b.identity, &game("updated b"), INFO).unwrap();
    let games = read_games(&path, 0, 1).unwrap();
    assert!(games[0].contains("substantially longer"));
    assert!(games[1].contains("updated b"));
}

#[test]
fn overlapping_same_game_writes_have_one_winner_and_a_visible_conflict() {
    let (_directory, path) = fixture(&game("a"));
    let old = read_game(&path, 0).unwrap();
    let gate = Arc::new(std::sync::Barrier::new(3));
    let threads: Vec<_> = ["one", "two"]
        .into_iter()
        .map(|name| {
            let path = path.clone();
            let identity = old.identity.clone();
            let gate = gate.clone();
            std::thread::spawn(move || {
                gate.wait();
                write_game(&path, 0, &identity, &game(name), INFO)
            })
        })
        .collect();
    gate.wait();
    let results: Vec<_> = threads
        .into_iter()
        .map(|thread| thread.join().unwrap())
        .collect();
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(count_games(&path).unwrap(), 1);
}

#[test]
fn staging_rechecks_all_bytes_even_when_size_and_timestamp_are_unchanged() {
    let (_directory, path) = fixture(&format!("{}{}", game("a"), game("b")));
    let old = read_game(&path, 0).unwrap();
    let timestamp = fs::metadata(&path).unwrap().modified().unwrap();
    let external = format!("{}{}", game("a"), game("c"));
    let result = replace_inner(
        &path,
        Edit::Replace(0, &old.identity),
        Some(&game("mine")),
        INFO,
        || {
            fs::write(&path, &external).unwrap();
            File::options()
                .write(true)
                .open(&path)
                .unwrap()
                .set_modified(timestamp)
                .unwrap();
        },
    );
    assert!(result.is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), external);
}

#[test]
fn sparse_ranges_rebuild_after_same_size_source_edits_and_local_writes() {
    let text: String = (0..140).map(|n| game(&n.to_string())).collect();
    let (_directory, path) = fixture(&format!("{text}                    "));
    assert_eq!(count_games(&path).unwrap(), 140);
    let changed = format!(
        "{}{}          ",
        game("longer zero"),
        (1..140).map(|n| game(&n.to_string())).collect::<String>()
    );
    assert_eq!(changed.len() as u64, fs::metadata(&path).unwrap().len());
    fs::write(&path, changed).unwrap();
    assert!(read_game(&path, 121).unwrap().pgn.contains("\"121\""));
    let old = read_game(&path, 1).unwrap();
    write_game(
        &path,
        1,
        &old.identity,
        &game("a longer indexed game"),
        INFO,
    )
    .unwrap();
    assert!(read_game(&path, 121).unwrap().pgn.contains("\"121\""));
}

#[test]
fn simultaneous_cold_reads_share_one_sparse_index() {
    let text: String = (0..300).map(|n| game(&format!("game {n}"))).collect();
    let (_directory, path) = fixture(&text);
    let path = fs::canonicalize(path).unwrap();
    INDEXES.lock().unwrap().clear();
    let gate = Arc::new(std::sync::Barrier::new(9));
    let threads: Vec<_> = (0..8)
        .map(|_| {
            let path = path.clone();
            let gate = gate.clone();
            std::thread::spawn(move || {
                let mut source = File::open(&path).unwrap();
                gate.wait();
                index(&path, &mut source).unwrap()
            })
        })
        .collect();
    gate.wait();
    let values: Vec<_> = threads
        .into_iter()
        .map(|thread| thread.join().unwrap())
        .collect();
    for value in &values {
        assert!(Arc::ptr_eq(&values[0], value));
    }
}

#[test]
fn deletion_checks_identity_and_preserves_other_games_including_bom() {
    let (_directory, path) = fixture(&format!("\u{feff}{}{}{}", game("a"), game("b"), game("c")));
    let b = read_game(&path, 1).unwrap();
    let result = delete_game(&path, 1, &b.identity).unwrap();
    assert_eq!(result.game_count, 2);
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        format!("\u{feff}{}{}", game("a"), game("c"))
    );
    assert!(delete_game(&path, 1, &b.identity).is_err());
}

#[test]
fn appending_uses_the_actual_current_count_and_handles_empty_files() {
    let (_directory, path) = fixture("");
    assert_eq!(append_game(&path, &game("one"), INFO).unwrap().index, 0);
    assert_eq!(append_game(&path, &game("two"), INFO).unwrap().index, 1);
    assert_eq!(count_games(&path).unwrap(), 2);
}

#[test]
fn new_files_never_clobber_pgn_or_existing_metadata() {
    let (directory, path) = fixture(&game("owner"));
    fs::write(directory.path().join("games (2).info"), "owner metadata").unwrap();
    let saved = create_game(&path, &game("new"), INFO, None).unwrap();
    assert_eq!(Path::new(&saved.file).file_name().unwrap(), "games (3).pgn");
    assert_eq!(fs::read_to_string(&path).unwrap(), game("owner"));
    assert_eq!(
        fs::read_to_string(directory.path().join("games (2).info")).unwrap(),
        "owner metadata"
    );
    assert_eq!(
        read_game(Path::new(&saved.file), 0).unwrap().identity,
        saved.identity
    );
}

#[test]
fn optional_coach_metadata_is_preserved_and_cleanup_retains_owner_edits() {
    let (directory, path) = fixture(&game("owner"));
    fs::write(
        directory.path().join("games (2).pgn.coach.json"),
        "owner analysis",
    )
    .unwrap();
    let result = create_game(&path, &game("new"), INFO, None).unwrap();
    assert_eq!(
        Path::new(&result.file).file_name().unwrap(),
        "games (3).pgn"
    );
    let info = directory.path().join("reserved.info");
    fs::write(&info, "owner edit after reservation").unwrap();
    discard_reserved_info(&info, INFO.as_bytes());
    assert_eq!(
        fs::read_to_string(info).unwrap(),
        "owner edit after reservation"
    );
}

#[test]
fn temporary_file_promotion_keeps_all_games_and_original_bytes() {
    let (directory, path) = fixture(&format!("{}{}{}", game("a"), game("b"), game("c")));
    let old = read_game(&path, 1).unwrap();
    let before = fs::read(&path).unwrap();
    let result = create_game(
        &directory.path().join("copy.pgn"),
        &game("changed b"),
        INFO,
        Some(&PgnSourceRef {
            file: path.to_string_lossy().into_owned(),
            index: 1,
            identity: old.identity,
        }),
    )
    .unwrap();
    assert_eq!(result.game_count, 3);
    assert_eq!(result.index, 1);
    assert_eq!(fs::read(&path).unwrap(), before);
    assert_eq!(
        fs::read_to_string(&result.file).unwrap(),
        format!("{}{}{}", game("a"), game("changed b"), game("c"))
    );
}

#[test]
fn readonly_files_and_invalid_payloads_leave_originals_intact() {
    let (_directory, path) = fixture(&game("a"));
    let before = fs::read(&path).unwrap();
    let old = read_game(&path, 0).unwrap();
    assert!(write_game(
        &path,
        0,
        &old.identity,
        &format!("{}{}", game("x"), game("y")),
        INFO
    )
    .is_err());
    let mut permissions = fs::metadata(&path).unwrap().permissions();
    permissions.set_readonly(true);
    fs::set_permissions(&path, permissions).unwrap();
    let result = write_game(&path, 0, &old.identity, &game("x"), INFO);
    let mut permissions = fs::metadata(&path).unwrap().permissions();
    permissions.set_readonly(false);
    fs::set_permissions(&path, permissions).unwrap();
    assert!(result.is_err());
    assert_eq!(fs::read(&path).unwrap(), before);
}

#[cfg(windows)]
#[test]
fn locked_destination_does_not_truncate_the_original() {
    use std::os::windows::fs::OpenOptionsExt;
    let (_directory, path) = fixture(&game("a"));
    let old = read_game(&path, 0).unwrap();
    let before = fs::read(&path).unwrap();
    let _locked = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(&path)
        .unwrap();
    assert!(write_game(&path, 0, &old.identity, &game("replacement"), INFO).is_err());
    assert_eq!(fs::read(&path).unwrap(), before);
}

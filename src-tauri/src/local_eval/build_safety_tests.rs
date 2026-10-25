use super::*;

const START_FEN: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

fn valid_source() -> String {
    serde_json::json!({"fen":START_FEN,"evals":[{"depth":20,"pvs":[{"cp":12,"line":"e2e4 e7e5"}]}]})
        .to_string()
        + "\n"
}

fn build_source(
    parent: &Path,
    output: &Path,
    contents: &str,
) -> Result<LocalEvalBuildReport, LocalEvalError> {
    let source = parent.join("tiny-source.zst");
    fs::write(&source, zstd::encode_all(contents.as_bytes(), 1).unwrap()).unwrap();
    build_compact_eval_database(
        LocalEvalBuildOptions {
            id: "synthetic-build".into(),
            source: LocalEvalSource::File(source),
            output_dir: output.into(),
            max_pvs: 5,
            shard_count: 16,
        },
        |_| {},
    )
}

#[test]
fn build_refuses_existing_output_without_changing_its_files() {
    let dir = tempfile::tempdir().unwrap();
    let output = dir.path().join("existing");
    fs::create_dir(&output).unwrap();
    fs::write(output.join("owner.txt"), "keep this exact file").unwrap();
    let result = build_source(dir.path(), &output, &valid_source());
    assert!(result.is_err(), "an existing output must never be replaced");
    assert_eq!(
        fs::read_to_string(output.join("owner.txt")).unwrap(),
        "keep this exact file"
    );
    assert_eq!(fs::read_dir(&output).unwrap().count(), 1);
}

#[test]
fn failed_build_removes_only_its_owned_incomplete_output() {
    let dir = tempfile::tempdir().unwrap();
    let output = dir.path().join("new-output");
    let previous = dir.path().join("new-output-building-1");
    fs::create_dir(&previous).unwrap();
    fs::write(previous.join("retained.txt"), "previous unfinished source").unwrap();
    assert!(build_source(dir.path(), &output, "{invalid json\n").is_err());
    assert!(!output.exists());
    assert_eq!(
        fs::read_to_string(previous.join("retained.txt")).unwrap(),
        "previous unfinished source"
    );
    let mut names = fs::read_dir(dir.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    names.sort();
    assert_eq!(
        names,
        vec!["new-output-building-1", "tiny-source.zst"],
        "failed attempt must not retain a new staging copy"
    );
}

#[test]
fn empty_export_is_not_published_as_a_completed_database() {
    let dir = tempfile::tempdir().unwrap();
    let output = dir.path().join("empty-output");
    assert!(build_source(dir.path(), &output, "\n").is_err());
    assert!(!output.exists());
}

#[test]
fn built_store_round_trips_and_cannot_be_overwritten_by_a_second_build() {
    let dir = tempfile::tempdir().unwrap();
    let output = dir.path().join("complete");
    let report = build_source(dir.path(), &output, &valid_source()).unwrap();
    assert_eq!(report.positions, 1);
    let before = fs::read(output.join(MANIFEST_FILE)).unwrap();
    let result = lookup_eval(&output, START_FEN, 1).unwrap().unwrap();
    assert_eq!(result.depth, 20);
    assert_eq!(result.pvs[0].moves, "e2e4 e7e5");
    assert!(build_source(dir.path(), &output, &valid_source()).is_err());
    assert_eq!(fs::read(output.join(MANIFEST_FILE)).unwrap(), before);
}

#[test]
fn a_second_build_cannot_take_an_in_progress_output() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("tiny-source.zst");
    fs::write(
        &source,
        zstd::encode_all(valid_source().as_bytes(), 1).unwrap(),
    )
    .unwrap();
    let options = LocalEvalBuildOptions {
        id: "first".into(),
        source: LocalEvalSource::File(source),
        output_dir: dir.path().join("in-progress"),
        max_pvs: 5,
        shard_count: 16,
    };
    let second_options = options.clone();
    let mut second = None;
    let first = build_compact_eval_database(options, |progress| {
        if progress.phase == "ingesting" && second.is_none() {
            second = Some(build_compact_eval_database(second_options.clone(), |_| {}));
        }
    })
    .unwrap();
    assert!(second.unwrap().is_err());
    assert_eq!(first.positions, 1);
    assert!(database_status(Path::new(&first.output_dir)).available);
}

#[test]
fn ownership_change_refuses_publication_and_preserves_new_owner_contents() {
    for contents in ["{invalid\n".to_string(), valid_source()] {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("invalid-source.zst");
        fs::write(&source, zstd::encode_all(contents.as_bytes(), 1).unwrap()).unwrap();
        let output = dir.path().join("new-output");
        let result = build_compact_eval_database(
            LocalEvalBuildOptions {
                id: "fixture".into(),
                source: LocalEvalSource::File(source),
                output_dir: output.clone(),
                max_pvs: 5,
                shard_count: 16,
            },
            |progress| {
                if progress.phase == "ingesting" {
                    fs::write(output.join(".encroissant-eval-build"), "changed owner").unwrap();
                    fs::write(output.join("owner.txt"), "preserve on failed cleanup").unwrap();
                }
            },
        );
        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(output.join("owner.txt")).unwrap(),
            "preserve on failed cleanup"
        );
        assert_eq!(
            fs::read_to_string(output.join(".encroissant-eval-build")).unwrap(),
            "changed owner"
        );
        assert!(!output.join(MANIFEST_FILE).exists());
    }
}

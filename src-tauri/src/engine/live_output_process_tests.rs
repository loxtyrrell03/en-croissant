use super::*;

async fn complete_latest(
    proc: &mut EngineProcess,
    reader: &mut EngineReader,
) -> (BestMovesPayload, usize) {
    let clock = Instant::now();
    let mut superseded = 0;
    let completion = tokio::time::timeout(Duration::from_secs(15), async {
        while let Some(line) = reader.next_line().await.unwrap() {
            match parse_one(&line) {
                UciMessage::Info(attrs) => {
                    // Freeze only the display clock: real Stockfish and UCI
                    // parsing run normally, even on slower test machines.
                    proc.record_live_info(attrs, clock).unwrap_or_else(|error| {
                        assert!(matches!(error, Error::NoMovesFound));
                    });
                    assert!(proc
                        .take_live_payload("fixture-engine", "fixture-tab", false, clock)
                        .is_none());
                    assert!(proc.live_output.published().is_none());
                }
                UciMessage::BestMove { .. } => {
                    if !proc.note_bestmove() {
                        superseded += 1;
                        continue;
                    }
                    let final_result = proc
                        .take_live_payload("fixture-engine", "fixture-tab", true, clock)
                        .unwrap();
                    proc.mark_finished();
                    return final_result;
                }
                _ => {}
            }
        }
        panic!("Stockfish exited before the latest final result");
    })
    .await;
    if completion.is_err() {
        proc.kill_sync();
    }
    (
        completion.expect("bounded real Stockfish fixture"),
        superseded,
    )
}

#[tokio::test]
#[ignore = "Requires LIVE_OUTPUT_ENGINE pointing to an existing local UCI engine"]
async fn live_output_real_stockfish_final_cache_and_retarget_preserve_exact_multipv() {
    let path = std::env::var("LIVE_OUTPUT_ENGINE").expect("Set LIVE_OUTPUT_ENGINE");
    let (mut proc, mut reader) = EngineProcess::new(path.into()).await.unwrap();
    let initial = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    let next = "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1";
    let options = |fen: &str| EngineOptions {
        fen: fen.into(),
        moves: vec![],
        search_moves: None,
        extra_options: vec![
            EngineOption {
                name: "Threads".into(),
                value: "1".into(),
            },
            EngineOption {
                name: "Hash".into(),
                value: "16".into(),
            },
            EngineOption {
                name: "MultiPV".into(),
                value: "2".into(),
            },
        ],
    };
    proc.set_options(options(initial)).await.unwrap();
    proc.go(&GoMode::Depth(8)).await.unwrap();
    let (completed, old) = complete_latest(&mut proc, &mut reader).await;
    assert_eq!(old, 0);
    assert_eq!(completed.progress, 100.0);
    assert_eq!(completed.fen, initial);
    assert_eq!(completed.best_lines.len(), 2);
    assert!(completed.best_lines.iter().all(|line| line.depth == 8
        && line.score.lower_bound != Some(true)
        && line.score.upper_bound != Some(true)));
    assert_eq!(proc.live_output.published().unwrap().0, 100.0);
    // Late output after bestmove cannot reopen a completed search or its timer.
    let root = &completed.best_lines[0].uci_moves[0];
    if let UciMessage::Info(attrs) =
        parse_one(&format!("info depth 99 multipv 1 score cp 9999 pv {root}"))
    {
        proc.record_live_info(attrs, Instant::now()).unwrap();
    }
    assert_eq!(proc.last_depth, 8);
    assert_eq!(proc.live_output.deadline(), None);

    // Reuse the process, stop a search, and enqueue a different position before
    // consuming its old bestmove boundary. Old scores must never be reattributed.
    proc.go(&GoMode::Depth(20)).await.unwrap();
    proc.stop().await.unwrap();
    proc.set_options(options(next)).await.unwrap();
    proc.go(&GoMode::Depth(8)).await.unwrap();
    assert!(proc.live_output.published().is_none());
    let (completed, old) = complete_latest(&mut proc, &mut reader).await;
    assert_eq!(old, 1);
    assert_eq!(completed.fen, next);
    assert_eq!(completed.progress, 100.0);
    assert_eq!(completed.best_lines.len(), 2);
    assert!(completed.best_lines.iter().all(|line| line.depth == 8));
    let position = parse_fen_and_apply_moves(next, &[]).unwrap();
    for line in &completed.best_lines {
        let uci: UciMove = line.uci_moves[0].parse().unwrap();
        assert!(uci.to_move(&position).is_ok());
    }
    proc.kill().await.unwrap();
}

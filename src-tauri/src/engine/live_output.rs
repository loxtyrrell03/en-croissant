use std::{
    io,
    time::{Duration, Instant},
};
use tokio::io::{AsyncBufRead, Lines};

/// A search owns its pending and published output. The first complete result
/// waits one interval so shallow startup iterations can be replaced.
pub(crate) struct LiveOutput<T> {
    interval: Duration,
    pending: Option<T>,
    published: Option<T>,
    last_publication: Option<Instant>,
    deadline: Option<Instant>,
}

impl<T: Clone> LiveOutput<T> {
    pub(crate) fn new(interval: Duration) -> Self {
        Self {
            interval,
            pending: None,
            published: None,
            last_publication: None,
            deadline: None,
        }
    }
    pub(crate) fn reset(&mut self) {
        self.cancel_pending();
        self.published = None;
        self.last_publication = None;
    }
    pub(crate) fn cancel_pending(&mut self) {
        self.pending = None;
        self.deadline = None;
    }
    pub(crate) fn push(&mut self, value: T, now: Instant) {
        self.pending = Some(value);
        if self.deadline.is_none() {
            self.deadline = Some(self.last_publication.unwrap_or(now) + self.interval);
        }
    }
    pub(crate) fn deadline(&self) -> Option<Instant> {
        self.deadline
    }
    pub(crate) fn published(&self) -> Option<&T> {
        self.published.as_ref()
    }
    pub(crate) fn take_due(&mut self, now: Instant) -> Option<T> {
        if !self.deadline.is_some_and(|deadline| now >= deadline) {
            return None;
        }
        self.deadline = None;
        let value = self.pending.take()?;
        self.published = Some(value.clone());
        self.last_publication = Some(now);
        Some(value)
    }
    pub(crate) fn finish(&mut self, value: T) -> T {
        self.cancel_pending();
        self.published = Some(value.clone());
        value
    }
}

pub(crate) enum EngineInput {
    Line(Option<String>),
    Publish,
}

pub(crate) async fn next_line_or_publication<R: AsyncBufRead + Unpin>(
    reader: &mut Lines<R>,
    deadline: Option<Instant>,
) -> io::Result<EngineInput> {
    tokio::select! {
        // At a boundary, consume an available newer line before publishing the
        // parked result. Lines::next_line retains partial input if cancelled.
        biased;
        line = reader.next_line() => line.map(EngineInput::Line),
        _ = async {
            if let Some(deadline) = deadline { tokio::time::sleep_until(deadline.into()).await; }
            else { std::future::pending::<()>().await; }
        } => Ok(EngineInput::Publish),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    const PERIOD: Duration = Duration::from_millis(500);

    #[test]
    fn live_output_startup_burst_keeps_only_the_latest_complete_result() {
        let now = Instant::now();
        let mut output = LiveOutput::new(PERIOD);
        output.push(-1800, now);
        assert_eq!(output.take_due(now), None);
        output.push(32, now + Duration::from_millis(5));
        assert_eq!(output.published(), None);
        assert_eq!(
            output.take_due(now + PERIOD - Duration::from_millis(1)),
            None
        );
        output.push(28, now + PERIOD);
        assert_eq!(output.take_due(now + PERIOD), Some(28));
        assert_eq!(output.published(), Some(&28));
    }

    #[test]
    fn live_output_continuous_search_keeps_the_two_hz_budget_without_bursts() {
        let now = Instant::now();
        let mut output = LiveOutput::new(PERIOD);
        let mut sent = vec![];
        for ms in 0..=2000 {
            let time = now + Duration::from_millis(ms);
            output.push(ms, time);
            if let Some(value) = output.take_due(time) {
                sent.push(value);
            }
        }
        assert_eq!(sent, vec![500, 1000, 1500, 2000]);
        assert_eq!(output.deadline(), None);
    }

    #[test]
    fn live_output_final_result_is_immediate_and_cancels_the_parked_result() {
        let now = Instant::now();
        let mut output = LiveOutput::new(PERIOD);
        output.push(900, now);
        output.push(25, now + Duration::from_millis(2));
        assert_eq!(output.finish(24), 24);
        assert_eq!(output.published(), Some(&24));
        assert_eq!(output.deadline(), None);
        assert_eq!(output.take_due(now + PERIOD), None);
    }

    #[test]
    fn live_output_retarget_discards_old_pending_and_cached_results() {
        let now = Instant::now();
        let mut output = LiveOutput::new(PERIOD);
        output.push(900, now);
        output.take_due(now + PERIOD);
        output.push(20, now + PERIOD);
        output.reset();
        assert_eq!(output.published(), None);
        assert_eq!(output.take_due(now + PERIOD * 2), None);
        output.push(-30, now + PERIOD * 2);
        assert_eq!(output.take_due(now + PERIOD * 2), None);
        assert_eq!(output.take_due(now + PERIOD * 3), Some(-30));
    }

    #[test]
    fn live_output_stop_discards_pending_but_preserves_the_published_snapshot() {
        let now = Instant::now();
        let mut output = LiveOutput::new(PERIOD);
        output.push(20, now);
        output.take_due(now + PERIOD);
        output.push(25, now + PERIOD);
        output.cancel_pending();
        assert_eq!(output.take_due(now + PERIOD * 2), None);
        assert_eq!(output.published(), Some(&20));
    }

    #[tokio::test]
    async fn live_output_quiet_engine_timer_preserves_a_partial_uci_line() {
        let (mut writer, stream) = tokio::io::duplex(128);
        let mut reader = BufReader::new(stream).lines();
        writer.write_all(b"info dep").await.unwrap();
        assert!(matches!(
            next_line_or_publication(&mut reader, Some(Instant::now()))
                .await
                .unwrap(),
            EngineInput::Publish
        ));
        writer.write_all(b"th 20\n").await.unwrap();
        match next_line_or_publication(&mut reader, None).await.unwrap() {
            EngineInput::Line(Some(line)) => assert_eq!(line, "info depth 20"),
            _ => panic!("The timer must not consume partial engine input"),
        }
    }

    #[tokio::test]
    async fn live_output_ready_line_wins_over_a_due_publication() {
        let (mut writer, stream) = tokio::io::duplex(128);
        let mut reader = BufReader::new(stream).lines();
        writer.write_all(b"info depth 21\n").await.unwrap();
        assert!(matches!(
            next_line_or_publication(&mut reader, Some(Instant::now()))
                .await
                .unwrap(),
            EngineInput::Line(Some(_))
        ));
        drop(writer);
        assert!(matches!(
            next_line_or_publication(&mut reader, None).await.unwrap(),
            EngineInput::Line(None)
        ));
    }
}

import { PerformanceHelp } from "@/shared/PerformanceHelp";
import { Button, Group, Stack, Switch, Text } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { type PcServicesStatus, requestPcServices } from "./pcServices";
import classes from "./PhonePcServices.module.css";

export default function PhonePcServices() {
  const [status, setStatus] = useState<PcServicesStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [requested, setRequested] = useState<boolean | undefined>();
  const [error, setError] = useState("");

  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);
  async function load(enabled?: boolean) {
    if (request.current) return;
    const abort = new AbortController();
    request.current = abort;
    setPending(enabled !== undefined);
    setRequested(enabled);
    try {
      const next = await requestPcServices(
        enabled,
        AbortSignal.any([abort.signal, AbortSignal.timeout(enabled === undefined ? 5000 : 60_000)]),
      );
      if (mounted.current) {
        setStatus(next);
        setError("");
      }
    } catch {
      if (mounted.current)
        setError("PC control is unreachable. Check the PC is awake and connected to Tailscale.");
    } finally {
      request.current = null;
      if (mounted.current) setPending(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 5000);
    const visible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      mounted.current = false;
      request.current?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  const ready = status?.enabled && status.home && status.engine;
  const label = pending
    ? requested
      ? "Starting…"
      : "Stopping…"
    : error
      ? "Unreachable"
      : !status
        ? "Checking…"
        : status.error
          ? "Unavailable"
          : !status.enabled
            ? "Off"
            : ready
              ? "Ready"
              : "Starting…";
  return (
    <section className={classes.root} aria-label="PC services">
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Group gap={5} wrap="nowrap">
          <Text size="sm" fw={700}>
            PC services
          </Text>
          <PerformanceHelp label="About PC services">Starts the PC engine and review server. The PC must be awake and connected to Tailscale.</PerformanceHelp>
        </Group>
        <Group gap="sm" wrap="nowrap">
          <Text
            size="xs"
            c={error || status?.error ? "orange" : ready ? "green" : "dimmed"}
            role="status"
          >
            {label}
          </Text>
          <Switch
            aria-label="Turn PC services on or off"
            checked={status?.enabled ?? false}
            disabled={!status || !!error || pending || !!status.busy}
            onChange={(event) => void load(event.currentTarget.checked)}
              className={classes.toggle}
              styles={{
                body: { minHeight: 44, alignItems: "center" },
                thumb: { insetInlineStart: status?.enabled ? "calc(100% - var(--switch-thumb-size) - var(--switch-track-label-padding))" : "var(--switch-track-label-padding)" },
              }}
          />
        </Group>
      </Group>
      {error || status?.error ? (
        <Stack gap={4}>
          <Text size="xs" c="orange" role="alert">
            {error || status?.error}
          </Text>
          <Button
            size="compact-sm"
            variant="subtle"
            loading={pending}
            onClick={() => void load(error ? undefined : status?.enabled)}
          >
            Retry
          </Button>
        </Stack>
      ) : (
        status &&
        !ready && (
          <Text size="xs" c="dimmed">
            {status.enabled
              ? `Engine ${status.engine ? "ready" : "starting"} · Reviews ${status.home ? "ready" : "starting"}`
              : "PC analysis and reviews are stopped."}
          </Text>
        )
      )}
      {status?.enabled && (
        <Text size="xs" c="dimmed">
          Off stops PC analysis and reviews. Saved games stay.
        </Text>
      )}
    </section>
  );
}

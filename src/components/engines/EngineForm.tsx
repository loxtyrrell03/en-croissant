import { Button, Group, Input, NumberInput, Stack, Text, TextInput } from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { type LocalEngine, requiredEngineSettings } from "@/utils/engines";
import { usePlatform } from "@/utils/files";
import FileInput from "../common/FileInput";

// These errors belong beside this operation, without a second global toast or
// an unowned asynchronous logging request when the native window is closing.
function checked<T>(result: { status: "ok"; data: T } | { status: "error"; error: string }): T {
  if (result.status === "error") throw new Error(result.error);
  return result.data;
}
type Request = {
  id: string;
  cancelled: boolean;
  stage: "picker" | "checking" | "saving";
  draftId: string;
  path: string;
  name: string;
};
export default function EngineForm({
  onSubmit,
  onSuccess,
  form,
  submitLabel,
  active = true,
  trustedPath,
  disabled = false,
  registration,
}: {
  onSubmit: (values: LocalEngine) => void | Promise<void>;
  onSuccess?: () => void;
  form: UseFormReturnType<LocalEngine, (values: LocalEngine) => LocalEngine>;
  submitLabel: string;
  active?: boolean;
  trustedPath?: string;
  disabled?: boolean;
  registration?: { saved: boolean };
}) {
  const { t } = useTranslation();
  const { os } = usePlatform();
  const current = useRef<Request | null>(null);
  const live = useRef(true);
  const activeNow = useRef(active);
  activeNow.current = active;
  const validated = useRef<{ path: string; draftId: string } | null>(null);
  const autofilledName = useRef<string | null>(null);
  const [phase, setPhase] = useState<Request["stage"] | "cancelling" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryPath, setRetryPath] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const filters = os === "windows" ? [{ name: "Executable Files", extensions: ["exe"] }] : [];
  const owns = (request: Request) =>
    live.current &&
    activeNow.current &&
    current.current === request &&
    form.getValues().id === request.draftId;
  const invalidate = useCallback(() => {
    const request = current.current;
    current.current = null;
    if (request) {
      request.cancelled = true;
      if (request.stage === "checking")
        void commands.cancelLocalEngineValidation(request.id).catch(() => {});
    }
  }, []);
  useEffect(() => {
    live.current = true;
    if (!active) {
      invalidate();
      setPhase(null);
      setError(null);
      setRetryPath(null);
    }
    return () => {
      live.current = false;
      invalidate();
    };
  }, [active, invalidate]);
  function begin(stage: Request["stage"]) {
    if (!activeNow.current || disabled || current.current) return null;
    const values = form.getValues();
    const request: Request = {
      id: `engine-check-${crypto.randomUUID()}`,
      cancelled: false,
      stage,
      draftId: values.id,
      path: values.path,
      name: values.name,
    };
    current.current = request;
    setPhase(stage);
    setError(null);
    setCancelled(false);
    return request;
  }
  function finish(request: Request) {
    if (owns(request)) {
      current.current = null;
      setPhase(null);
      if (request.cancelled) setCancelled(true);
    }
  }
  async function check(path: string, request: Request) {
    request.stage = "checking";
    setPhase("checking");
    setRetryPath(path);
    const config = checked(await commands.validateLocalEngine(request.id, path));
    if (!owns(request) || request.cancelled || form.getValues().path !== request.path) return false;
    const values = form.getValues();
    const settings = values.path === path ? [...(values.settings ?? [])] : [];
    for (const option of config.options) {
      if (
        option.type === "button" ||
        !requiredEngineSettings.includes(option.value.name) ||
        settings.some((setting) => setting.name === option.value.name)
      )
        continue;
      settings.push({
        name: option.value.name,
        value: option.value.default as string | number | boolean | null,
      });
    }
    const canFillName =
      values.name === request.name &&
      (!values.name.trim() || values.name === autofilledName.current);
    const name = canFillName ? config.name || values.name : values.name;
    if (canFillName && config.name) autofilledName.current = config.name;
    form.setValues({
      ...values,
      path,
      name,
      version: values.path === path ? values.version : "",
      settings,
    });
    validated.current = { path, draftId: request.draftId };
    request.path = path;
    setRetryPath(null);
    setError(null);
    return true;
  }
  async function choose(path?: string) {
    const request = begin(path ? "checking" : "picker");
    if (!request) return;
    try {
      const selected = path ?? (await open({ multiple: false, filters }));
      if (!owns(request) || request.cancelled || typeof selected !== "string" || !selected) return;
      await check(selected, request);
    } catch (error) {
      if (owns(request) && !request.cancelled)
        setError(
          `Could not check this engine: ${error instanceof Error ? error.message : String(error)}`,
        );
    } finally {
      finish(request);
    }
  }
  async function cancel() {
    const request = current.current;
    if (!request) {
      setError(null);
      setRetryPath(null);
      setCancelled(true);
      return;
    }
    if (request.stage === "saving") return;
    request.cancelled = true;
    setPhase("cancelling");
    setError(null);
    if (request.stage === "checking") {
      try {
        checked(await commands.cancelLocalEngineValidation(request.id));
      } catch (error) {
        if (owns(request))
          setError(`Could not request cancellation: ${String(error)}. Retry Cancel.`);
      }
    }
  }
  async function chooseImage() {
    const request = begin("picker");
    if (!request) return;
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Image", extensions: ["png", "jpeg"] }],
      });
      if (owns(request) && !request.cancelled && typeof selected === "string")
        form.setFieldValue("image", selected);
    } catch (error) {
      if (owns(request) && !request.cancelled)
        setError(`Could not choose an image: ${String(error)}`);
    } finally {
      finish(request);
    }
  }
  async function submit() {
    const request = begin("saving");
    if (!request) return;
    try {
      let values = form.getValues();
      if (
        !registration &&
        values.path !== trustedPath &&
        (validated.current?.path !== values.path || validated.current.draftId !== values.id)
      ) {
        if (!(await check(values.path, request))) return;
        values = form.getValues();
      }
      if (!owns(request) || request.cancelled) return;
      request.stage = "saving";
      setPhase("saving");
      await onSubmit({
        ...values,
        ...(trustedPath === undefined
          ? { loaded: values.loaded ?? true, enabled: values.enabled ?? false }
          : {}),
      });
      if (owns(request) && !request.cancelled) onSuccess?.();
    } catch (error) {
      if (owns(request) && !request.cancelled)
        setError(String(error instanceof Error ? error.message : error));
    } finally {
      finish(request);
    }
  }
  const busy = phase !== null;
  return (
    <form
      onSubmit={(event) => {
        if (registration) {
          event.preventDefault();
          void submit();
        } else
          form.onSubmit(() => {
            void submit();
          })(event);
      }}
    >
      {registration ? (
        <Text size="sm" role="status">
          {registration.saved
            ? "Engine settings saved."
            : "Engine settings need saving. Keep this app open and retry saving."}
        </Text>
      ) : (
        <>
          <FileInput
            label={t("Engines.Add.BinaryFile")}
            description={t("Engines.Add.BinaryFile.Desc")}
            filename={form.values.path}
            withAsterisk
            disabled={busy || disabled}
            onClick={() => {
              void choose();
            }}
          />
          <TextInput
            label={t("Engines.Add.Name")}
            placeholder={t("Engines.Add.Name.Autodetect")}
            withAsterisk
            disabled={phase === "saving" || disabled}
            {...form.getInputProps("name")}
          />
          <NumberInput
            label="Elo"
            placeholder={t("Engines.Add.Elo.Desc")}
            disabled={phase === "saving" || disabled}
            {...form.getInputProps("elo")}
          />
          <Input.Wrapper
            label={t("Engines.Add.ImageFile")}
            description={t("Engines.Add.ImageFile.Desc")}
            {...form.getInputProps("image")}
          >
            <Input
              component="button"
              type="button"
              disabled={busy || disabled}
              onClick={() => {
                void chooseImage();
              }}
            >
              <Text lineClamp={1}>{form.values.image}</Text>
            </Input>
          </Input.Wrapper>
        </>
      )}
      {phase && (
        <Text size="sm" role="status">
          {phase === "checking"
            ? "Checking engine…"
            : phase === "cancelling"
              ? "Waiting for the engine check to stop…"
              : phase === "saving"
                ? "Saving engine settings. Keep this app open."
                : "Choosing a file…"}
        </Text>
      )}
      {cancelled && (
        <Text size="sm" role="status">
          Engine check cancelled.
        </Text>
      )}
      {error && (
        <Text size="sm" c="red" role="alert">
          {error}
        </Text>
      )}
      <Stack gap="xs" mt="md">
        {!busy && retryPath && error && (
          <Button
            variant="default"
            onClick={() => {
              void choose(retryPath);
            }}
          >
            Retry engine check
          </Button>
        )}
        {((phase && phase !== "saving") || (!busy && retryPath && error)) && (
          <Group>
            <Button
              variant="default"
              disabled={phase === "cancelling" && !error}
              onClick={() => {
                void cancel();
              }}
            >
              {phase === "cancelling" && error ? "Retry Cancel" : "Cancel engine check"}
            </Button>
          </Group>
        )}
        <Button
          fullWidth
          type="submit"
          disabled={busy || disabled || (!!retryPath && !!error && !registration)}
        >
          {registration ? (registration.saved ? "Done" : "Retry save") : submitLabel}
        </Button>
      </Stack>
    </form>
  );
}

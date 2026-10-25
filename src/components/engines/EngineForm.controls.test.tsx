import { MantineProvider } from "@mantine/core";
import { useForm } from "@mantine/form";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LocalEngine } from "@/utils/engines";
import EngineForm from "./EngineForm";

const fixture = vi.hoisted(() => ({
  open: vi.fn(),
  validate: vi.fn(),
  request: vi.fn(),
  cancel: vi.fn(),
  submit: vi.fn(),
  success: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: fixture.open }));
vi.mock("@/utils/files", () => ({ usePlatform: () => ({ os: "windows" }) }));
vi.mock("@/bindings", async (original) => {
  const actual = await original<typeof import("@/bindings")>();
  return {
    ...actual,
    commands: {
      ...actual.commands,
      getEngineConfig: fixture.validate,
      validateLocalEngine: fixture.request,
      cancelLocalEngineValidation: fixture.cancel,
    },
  };
});
const initial: LocalEngine = {
  type: "local",
  id: "owner",
  path: "C:/Owner/keep.exe",
  name: "Owner draft",
  version: "18",
  loaded: false,
  image: "C:/Owner/logo.png",
  settings: [
    { name: "WeightsFile", value: "C:/Owner/network.pb.gz" },
    { name: "Threads", value: 2 },
  ],
};
beforeEach(() => {
  fixture.open.mockReset();
  fixture.validate.mockReset();
  fixture.cancel.mockReset().mockResolvedValue({ status: "ok", data: true });
  fixture.request
    .mockReset()
    .mockImplementation((_id: string, path: string) => fixture.validate(path));
  fixture.success.mockReset();
  fixture.submit.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());
async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let show!: (value: boolean) => void,
    rename!: (name: string) => void,
    activate!: (value: boolean) => void;
  function Harness() {
    const [visible, setVisible] = useState(true);
    show = setVisible;
    const [active, setActive] = useState(true);
    activate = setActive;
    const form = useForm<LocalEngine>({ initialValues: initial });
    rename = (name) => form.setFieldValue("name", name);
    return (
      <>
        <pre>{JSON.stringify(form.values)}</pre>
        {visible && (
          <EngineForm
            form={form}
            active={active}
            submitLabel="Save fixture"
            onSubmit={fixture.submit}
            onSuccess={fixture.success}
            trustedPath={initial.path}
          />
        )}
      </>
    );
  }
  await act(async () =>
    root.render(
      <MantineProvider env="test">
        <Harness />
      </MantineProvider>,
    ),
  );
  const labelled = (text: string) => {
    const label = Array.from(host.querySelectorAll("label")).find((item) =>
      item.textContent?.startsWith(text),
    )!;
    return host.querySelector<HTMLElement>(`[id="${label.htmlFor}"]`)!;
  };
  return {
    host,
    values: () => JSON.parse(host.querySelector("pre")!.textContent!),
    choose: () => act(async () => labelled("Engines.Add.BinaryFile").click()),
    image: () => act(async () => labelled("Engines.Add.ImageFile").click()),
    hide: () => act(async () => show(false)),
    show: () => act(async () => show(true)),
    rename: (name: string) => act(async () => rename(name)),
    active: (value: boolean) => act(async () => activate(value)),
    click: (text: string) =>
      act(async () =>
        Array.from(host.querySelectorAll("button"))
          .find((button) => button.textContent === text)!
          .click(),
      ),
    submit: () =>
      act(async () =>
        host
          .querySelector("form")!
          .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
      ),
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

it("discards a delayed UCI reply after the form closes while its parent draft survives", async () => {
  fixture.open.mockResolvedValue("C:/Fixture/new.exe");
  let finish!: (value: unknown) => void;
  fixture.validate.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const h = await mount();
  try {
    await h.choose();
    await vi.waitFor(() => expect(fixture.validate).toHaveBeenCalled());
    await h.hide();
    await act(async () => finish({ status: "ok", data: { name: "Late program", options: [] } }));
    expect(h.values()).toEqual(initial);
  } finally {
    await h.close();
  }
});
it("discards a late file-picker response after closing, without starting native validation", async () => {
  let finish!: (value: unknown) => void;
  fixture.open.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const h = await mount();
  try {
    await h.choose();
    await h.hide();
    await act(async () => finish("C:/Fixture/late.exe"));
    expect(h.values()).toEqual(initial);
    expect(fixture.request).not.toHaveBeenCalled();
  } finally {
    await h.close();
  }
});
it("invalidates checks when the containing dialog closes or changes tabs before its transition unmounts", async () => {
  fixture.open.mockResolvedValue("C:/Fixture/new.exe");
  let finish!: (value: unknown) => void;
  fixture.validate.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const h = await mount();
  try {
    await h.choose();
    await vi.waitFor(() => expect(fixture.request).toHaveBeenCalled());
    await h.active(false);
    expect(fixture.cancel).toHaveBeenCalledWith(fixture.request.mock.calls[0][0]);
    await act(async () => finish({ status: "ok", data: { name: "Late program", options: [] } }));
    await h.active(true);
    expect(h.values()).toEqual(initial);
  } finally {
    await h.close();
  }
});
it("keeps cancellation busy until its native check settles and ignores a late successful result", async () => {
  fixture.open.mockResolvedValue("C:/Fixture/new.exe");
  let finish!: (value: unknown) => void;
  fixture.validate.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const h = await mount();
  try {
    await h.choose();
    await vi.waitFor(() => expect(fixture.request).toHaveBeenCalled());
    await h.click("Cancel engine check");
    expect(h.host.textContent).toContain("Waiting for the engine check to stop");
    expect(fixture.cancel).toHaveBeenCalledWith(fixture.request.mock.calls[0][0]);
    await act(async () => finish({ status: "ok", data: { name: "Cancelled reply", options: [] } }));
    expect(h.values()).toEqual(initial);
    expect(h.host.textContent).toContain("Engine check cancelled.");
    expect(fixture.submit).not.toHaveBeenCalled();
  } finally {
    await h.close();
  }
});
it("keeps a failed cancellation request retryable while the native owner remains active", async () => {
  fixture.open.mockResolvedValue("C:/Fixture/new.exe");
  fixture.cancel.mockResolvedValueOnce({ status: "error", error: "Fixture IPC error" });
  let finish!: (value: unknown) => void;
  fixture.validate.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const h = await mount();
  try {
    await h.choose();
    await vi.waitFor(() => expect(fixture.request).toHaveBeenCalled());
    await h.click("Cancel engine check");
    expect(h.host.textContent).toContain("Retry Cancel");
    await h.click("Retry Cancel");
    expect(fixture.cancel).toHaveBeenCalledTimes(2);
    await act(async () => finish({ status: "error", error: "Engine check cancelled" }));
    expect(h.values()).toEqual(initial);
  } finally {
    await h.close();
  }
});
it("shows a failed check beside Retry and blocks saving the previous program until it is resolved", async () => {
  fixture.open.mockResolvedValue("C:/Fixture/new.exe");
  fixture.validate
    .mockResolvedValueOnce({ status: "error", error: "Fixture program not responding" })
    .mockResolvedValueOnce({ status: "ok", data: { name: "Config Fixture", options: [] } });
  const h = await mount();
  try {
    await h.choose();
    expect(h.host.querySelector('[role="alert"]')?.textContent).toContain("not responding");
    expect(
      Array.from(h.host.querySelectorAll("button")).find(
        (button) => button.textContent === "Save fixture",
      )?.disabled,
    ).toBe(true);
    await h.click("Retry engine check");
    expect(h.values().path).toBe("C:/Fixture/new.exe");
    expect(h.values().name).toBe(initial.name);
    expect(fixture.open).toHaveBeenCalledTimes(1);
  } finally {
    await h.close();
  }
});
it("preserves the image when its picker replies to a replaced form instance", async () => {
  let finish!: (value: unknown) => void;
  fixture.open.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const h = await mount();
  try {
    await h.image();
    await h.hide();
    await h.show();
    await act(async () => finish("C:/Fixture/late.png"));
    expect(h.values().image).toBe(initial.image);
  } finally {
    await h.close();
  }
});
it("rechecks a retained unsaved program after remount and keeps a chosen custom name", async () => {
  fixture.open.mockResolvedValue("C:/Fixture/new.exe");
  fixture.validate.mockResolvedValue({
    status: "ok",
    data: { name: "Config Fixture", options: [] },
  });
  const h = await mount();
  try {
    await h.choose();
    await h.rename("My chosen engine name");
    await h.hide();
    await h.show();
    await h.submit();
    await vi.waitFor(() => expect(fixture.submit).toHaveBeenCalled());
    expect(fixture.request).toHaveBeenCalledTimes(2);
    expect(fixture.submit.mock.calls[0][0].name).toBe("My chosen engine name");
  } finally {
    await h.close();
  }
});
it("does not complete a different dialog session when an old profile-save promise finishes", async () => {
  let finish!: () => void;
  fixture.submit.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const h = await mount();
  try {
    await h.submit();
    await vi.waitFor(() => expect(fixture.submit).toHaveBeenCalled());
    await h.hide();
    await h.show();
    await h.rename("New dialog draft");
    await act(async () => finish());
    expect(fixture.success).not.toHaveBeenCalled();
    expect(h.values().name).toBe("New dialog draft");
  } finally {
    await h.close();
  }
});
it("keeps a name edited during validation instead of overwriting it with the native reply", async () => {
  fixture.open.mockResolvedValue("C:/Fixture/new.exe");
  let finish!: (value: unknown) => void;
  fixture.validate.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const h = await mount();
  try {
    await h.choose();
    await vi.waitFor(() => expect(fixture.validate).toHaveBeenCalled());
    await h.rename("Owner typed while checking");
    await act(async () => finish({ status: "ok", data: { name: "Found program", options: [] } }));
    expect(h.values().name).toBe("Owner typed while checking");
    expect(h.values().path).toBe("C:/Fixture/new.exe");
  } finally {
    await h.close();
  }
});
it("preserves the selected image when the native image picker is cancelled", async () => {
  fixture.open.mockResolvedValue(null);
  const h = await mount();
  try {
    await h.image();
    expect(h.values().image).toBe(initial.image);
  } finally {
    await h.close();
  }
});
it("retains existing hidden state, tuning and network when saving metadata for the same trusted program", async () => {
  const h = await mount();
  try {
    await h.submit();
    await vi.waitFor(() => expect(fixture.submit).toHaveBeenCalled());
    expect(fixture.submit.mock.calls[0][0]).toMatchObject({
      loaded: false,
      settings: initial.settings,
      version: initial.version,
    });
    expect(fixture.validate).not.toHaveBeenCalled();
  } finally {
    await h.close();
  }
});

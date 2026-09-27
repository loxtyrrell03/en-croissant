import { Modal } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { createContext, useContext, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { TournamentHelp } from "./TournamentHelp";
import styles from "./TournamentSurface.module.css";

export const TournamentEmbedded = createContext(false);
export const HelpTip = TournamentHelp;
export function pushToast({
  tone,
  message,
  detail,
}: {
  tone: "success" | "error" | "info" | "warning";
  message: string;
  detail?: string;
}) {
  notifications.show({
    title: message,
    message: detail,
    color:
      tone === "error"
        ? "red"
        : tone === "success"
          ? "green"
          : tone === "warning"
            ? "yellow"
            : "blue",
  });
}
export function HomeModal({
  title,
  onClose,
  children,
  wide,
  workspace,
  tall,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  workspace?: boolean;
  tall?: boolean;
}) {
  const embedded = useContext(TournamentEmbedded);
  if (embedded)
    return (
      <section className={styles.surface} aria-label={title}>
        {children}
      </section>
    );
  return (
    <Modal
      opened
      onClose={onClose}
      title={title}
      size={workspace ? "90%" : wide ? "xl" : "lg"}
      fullScreen={false}
      styles={{ body: { minHeight: tall ? "65vh" : undefined } }}
    >
      <section className={styles.surface}>{children}</section>
    </Modal>
  );
}
/** Native <dialog> provides contained keyboard focus above either host's modal. */
export function confirmDialog({
  title,
  message,
  confirmLabel,
  tone,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  tone?: "danger";
}): Promise<boolean> {
  return new Promise((resolve) => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const previous = document.activeElement;
    const finish = (value: boolean) => {
      root.unmount();
      container.remove();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
      resolve(value);
    };
    root.render(
      <dialog
        ref={(dialog) => {
          dialog?.showModal();
        }}
        className={`${styles.surface} ${styles.confirm}`}
        onCancel={(event) => {
          event.preventDefault();
          finish(false);
        }}
        aria-label={title}
      >
        <h2>{title}</h2>
        <p>{message}</p>
        <div className={styles.actions}>
          <button autoFocus onClick={() => finish(false)}>
            Cancel
          </button>
          <button data-danger={tone === "danger" || undefined} onClick={() => finish(true)}>
            {confirmLabel}
          </button>
        </div>
      </dialog>,
    );
  });
}

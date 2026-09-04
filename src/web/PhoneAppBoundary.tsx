import { Component, type ReactNode } from "react";

/** Also covers provider, header and state-loading failures outside the workspace. */
export default class PhoneAppBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    console.error("Phone app failed", error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main
        role="alert"
        style={{
          padding: 24,
          color: "#eee",
          background: "#111315",
          minHeight: "100svh",
          fontFamily: "system-ui",
        }}
      >
        <h1>The app could not display this screen</h1>
        <p>
          Reload to try again. This does not erase your saved games or the import completed on your
          PC.
        </p>
        <button
          type="button"
          style={{ minHeight: 44, fontSize: 16, padding: "8px 16px" }}
          onClick={() => window.location.reload()}
        >
          Reload app
        </button>
      </main>
    );
  }
}

import { Component, type ReactNode } from "react";
import { Alert, Button, Stack, Text } from "@mantine/core";

export default class PhoneErrorBoundary extends Component<
  { children: ReactNode; onRecover: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("Phone workspace failed", error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Stack p="md">
        <Alert color="orange" title="This view could not open">
          <Text size="sm">
            Your imported games are still available. Return to Import to continue.
          </Text>
        </Alert>
        <Button
          onClick={() => {
            this.props.onRecover();
            this.setState({ error: null });
          }}
        >
          Return to Import
        </Button>
        <Text size="xs" c="dimmed" style={{ overflowWrap: "anywhere" }}>
          {this.state.error.message}
        </Text>
      </Stack>
    );
  }
}

import { Group, Text } from "@mantine/core";
import type { ReactNode } from "react";

interface BoardBarProps {
  name: string;
  rating?: string | number | null;
  onNameClick: () => void;
  height: string;
  leftSection?: ReactNode;
  children?: ReactNode;
}

export function BoardBar({
  name,
  rating,
  onNameClick,
  height,
  leftSection,
  children,
}: BoardBarProps) {
  return (
    <Group ml="2.5rem" mr="xs" h={height} justify="space-between" wrap="nowrap" align="flex-end">
      <Group gap="xs" align="flex-end" wrap="nowrap" style={{ minWidth: 0 }}>
        {leftSection}
        <Group gap={6} align="baseline" wrap="nowrap" style={{ minWidth: 0 }}>
          <Text fw="bold" size="md" truncate style={{ cursor: "pointer" }} onClick={onNameClick}>
            {name !== "?" && name}
          </Text>
          {rating && (
            <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
              ({rating})
            </Text>
          )}
        </Group>
      </Group>

      <Group align="flex-end" wrap="nowrap">
        {children}
      </Group>
    </Group>
  );
}

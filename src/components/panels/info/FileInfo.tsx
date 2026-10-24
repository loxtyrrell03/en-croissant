import type { PgnGameListEntry } from "@/utils/pgnGameList";
import { ActionIcon, Code, Divider, Group, Text, Tooltip } from "@mantine/core";
import { IconReload } from "@tabler/icons-react";
import { useAtomValue } from "jotai";
import { notifications } from "@mantine/notifications";
import { useTabSaveTargets } from "@/utils/tabSaveTarget";
import { withPgnFileTask } from "@/utils/pgnFileQueue";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { currentTabAtom } from "@/state/atoms";
import { formatNumber } from "@/utils/format";
import { getTabFile } from "@/utils/tabs";
import { unwrap } from "@/utils/unwrap";

function FileInfo({
  setGames,
}: {
  setGames: React.Dispatch<React.SetStateAction<Map<number, PgnGameListEntry>>>;
}) {
  const { t } = useTranslation();
  const tab = useAtomValue(currentTabAtom);
  const targetFor = useTabSaveTargets();
  const tabFile = getTabFile(tab);

  if (!tabFile) return null;
  return (
    <>
      <Group justify="space-between" py="sm" px="md">
        <Text>
          {formatNumber(tabFile.numGames || 0)} {t("Files.GameCountSuffix")}
          {tabFile.numGames === 1 ? "" : "s"}
        </Text>
        <Group>
          <Tooltip label={tabFile.path}>
            <Code>{tabFile.path.split(/[\\/]/).pop()}</Code>
          </Tooltip>

          <Tooltip label={t("Files.Reload")}>
            <ActionIcon
              variant="outline"
              size="sm"
              onClick={async () => {
                const target = targetFor(tab?.value);
                try {
                  await withPgnFileTask(tabFile.path, async () => {
                    const count = unwrap(await commands.countPgnGames(tabFile.path));
                    if (getTabFile(target.get())?.path !== tabFile.path) return;
                    target.update((prev) => {
                      const origin = prev.gameOrigin;
                      if (
                        (origin.kind !== "file" && origin.kind !== "temp_file") ||
                        origin.file.path !== tabFile.path
                      )
                        return prev;
                      return {
                        ...prev,
                        gameOrigin: {
                          ...origin,
                          file: {
                            ...origin.file,
                            numGames: count,
                            numGamesKnown: true,
                            lastModified: Math.max(Date.now(), origin.file.lastModified + 1),
                          },
                        },
                      };
                    });
                    setGames(new Map());
                  });
                } catch (error) {
                  notifications.show({
                    title: "Could not reload game list",
                    message: String(error),
                    color: "red",
                  });
                }
              }}
            >
              <IconReload size="1rem" />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      <Divider />
    </>
  );
}

export default FileInfo;

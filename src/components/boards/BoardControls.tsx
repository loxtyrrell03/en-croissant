import { ActionIcon, Stack, Tooltip } from "@mantine/core";
import {
  IconArrowBack,
  IconCamera,
  IconDeviceFloppy,
  IconEdit,
  IconEditOff,
  IconEraser,
  IconRobot,
  IconSparkles,
  IconSwitchVertical,
  IconTarget,
  IconZoomCheck,
} from "@tabler/icons-react";
import { useLoaderData } from "@tanstack/react-router";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { memo, useContext } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import {
  autoSaveAtom,
  aiCoachEnabledAtom,
  currentGameStateAtom,
  currentTabAtom,
  eraseDrawablesOnClickAtom,
} from "@/state/atoms";
import { keyMapAtom } from "@/state/keybinds";
import { usePracticeAgainstBot } from "@/hooks/usePracticeAgainstBot";

interface BoardControlsProps {
  editingMode: boolean;
  toggleEditingMode: () => void;
  dirty: boolean;
  saveFile?: () => void;
  onOpenCoach?: () => void;
  canTakeBack?: boolean;
  onTakeBack?: () => void;
  disableVariations?: boolean;
  allowEditing?: boolean;
}

function BoardControls({
  editingMode,
  toggleEditingMode,
  dirty,
  saveFile,
  onOpenCoach,
  canTakeBack,
  onTakeBack,
  disableVariations,
  allowEditing,
}: BoardControlsProps) {
  const { t } = useTranslation();
  const { documentDir } = useLoaderData({ from: "/" });

  const store = useContext(TreeStateContext)!;
  const headers = useStore(store, (s) => s.headers);
  const root = useStore(store, (s) => s.root);
  const currentNode = useStore(store, (s) => s.currentNode());
  const setHeaders = useStore(store, (s) => s.setHeaders);
  const setFen = useStore(store, (s) => s.setFen);
  const clearShapes = useStore(store, (s) => s.clearShapes);

  const keyMap = useAtomValue(keyMapAtom);
  const [currentTab, setCurrentTab] = useAtom(currentTabAtom);
  const setGameState = useSetAtom(currentGameStateAtom);
  const autoSave = useAtomValue(autoSaveAtom);
  const aiCoachEnabled = useAtomValue(aiCoachEnabledAtom);
  const eraseDrawablesOnClick = useAtomValue(eraseDrawablesOnClickAtom);
  const practiceAgainstBot = usePracticeAgainstBot();

  const orientation = headers.orientation || "white";
  const toggleOrientation = () =>
    setHeaders({
      ...headers,
      fen: root.fen,
      orientation: orientation === "black" ? "white" : "black",
    });

  function changeTabType() {
    if (currentTab?.type === "analysis") {
      setFen(currentNode.fen);
      setHeaders({
        ...headers,
        fen: currentNode.fen,
        result: "*",
      });
      setGameState("settingUp");
    }

    setCurrentTab((t) => {
      return {
        ...t,
        type: t.type === "analysis" ? "play" : "analysis",
      };
    });
  }

  const takeSnapshot = async () => {
    const snapshotTarget = document.querySelector(".cg-wrap") as HTMLElement | null;
    if (!snapshotTarget) return;

    const { default: domtoimage } = await import("dom-to-image");
    domtoimage.toBlob(snapshotTarget).then(async (blob) => {
      if (blob == null) return;

      const filePath = await save({
        title: "Save board snapshot",
        defaultPath: documentDir,
        filters: [
          {
            name: "PNG Image",
            extensions: ["png"],
          },
        ],
      });
      const arrayBuffer = await blob.arrayBuffer();
      if (filePath == null) return;
      await writeFile(filePath, new Uint8Array(arrayBuffer));
    });
  };

  return (
    <>
      <Stack gap={4} align="center">
        <Tooltip position="right" label={t("Board.Action.TakeSnapshot")}>
          <ActionIcon onClick={() => takeSnapshot()}>
            <IconCamera size="1.2rem" />
          </ActionIcon>
        </Tooltip>
        {canTakeBack && onTakeBack && (
          <Tooltip label="Take Back" position="right">
            <ActionIcon onClick={() => onTakeBack()}>
              <IconArrowBack />
            </ActionIcon>
          </Tooltip>
        )}
        <Tooltip
          position="right"
          label={t(
            currentTab?.type === "analysis"
              ? "Board.Action.PlayFromHere"
              : "Board.Action.AnalyzeGame",
          )}
        >
          <ActionIcon onClick={changeTabType}>
            {currentTab?.type === "analysis" ? (
              <IconTarget size="1.2rem" />
            ) : (
              <IconZoomCheck size="1.2rem" />
            )}
          </ActionIcon>
        </Tooltip>
        {currentTab?.type !== "play" && (
          <Tooltip position="right" label="Practice against bot">
            <ActionIcon onClick={practiceAgainstBot}>
              <IconRobot size="1.2rem" />
            </ActionIcon>
          </Tooltip>
        )}
        <Tooltip
          position="right"
          label={aiCoachEnabled ? "AI Coach" : "AI Coach disabled in Settings"}
        >
          <ActionIcon
            disabled={!onOpenCoach}
            onClick={onOpenCoach}
            variant={aiCoachEnabled ? "filled" : "subtle"}
          >
            <IconSparkles size="1.2rem" />
          </ActionIcon>
        </Tooltip>
        {!eraseDrawablesOnClick && (
          <Tooltip position="right" label={t("Board.Action.ClearDrawings")}>
            <ActionIcon onClick={() => clearShapes()}>
              <IconEraser size="1.2rem" />
            </ActionIcon>
          </Tooltip>
        )}
        {(!disableVariations || allowEditing) && (
          <Tooltip position="right" label={t("Board.Action.EditPosition")}>
            <ActionIcon onClick={() => toggleEditingMode()}>
              {editingMode ? <IconEditOff size="1.2rem" /> : <IconEdit size="1.2rem" />}
            </ActionIcon>
          </Tooltip>
        )}

        {saveFile && (
          <Tooltip
            position="right"
            label={t("Board.Action.SavePGN", { key: keyMap.SAVE_FILE.keys })}
          >
            <ActionIcon
              onClick={() => saveFile()}
              variant={dirty && !autoSave ? "default" : "transparent"}
            >
              <IconDeviceFloppy size="1.2rem" />
            </ActionIcon>
          </Tooltip>
        )}
        <Tooltip
          position="right"
          label={t("Board.Action.FlipBoard", {
            key: keyMap.SWAP_ORIENTATION.keys,
          })}
        >
          <ActionIcon onClick={() => toggleOrientation()}>
            <IconSwitchVertical size="1.2rem" />
          </ActionIcon>
        </Tooltip>
      </Stack>
    </>
  );
}

export default memo(BoardControls);

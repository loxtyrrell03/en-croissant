import { Stack, Tabs } from "@mantine/core";
import { useAtom, useAtomValue } from "jotai";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { currentAnalysisTabAtom, enginesAtom } from "@/state/atoms";
import EnginePanelContent from "./EnginePanelContent";
import LogsPanel from "./LogsPanel";
import ReportPanel from "./ReportPanel";

function AnalysisPanel() {
  const { t } = useTranslation();
  const engines = useAtomValue(enginesAtom);
  const loadedLocalEngines = (engines ?? []).filter(
    (engine) => engine.loaded && engine.type === "local",
  );
  const [tab, setTab] = useAtom(currentAnalysisTabAtom);

  return (
    <Stack h="100%" pl="sm" style={{ minHeight: 0 }}>
      <Tabs
        h="100%"
        orientation="vertical"
        placement="right"
        value={tab}
        onChange={(v) => setTab(v!)}
        style={{
          display: "flex",
          minHeight: 0,
        }}
        keepMounted={false}
      >
        <Tabs.List>
          <Tabs.Tab value="engines">{t("Board.Analysis.Engines")}</Tabs.Tab>
          <Tabs.Tab value="report">{t("Board.Analysis.Report")}</Tabs.Tab>
          <Tabs.Tab value="logs" disabled={loadedLocalEngines.length === 0}>
            {t("Board.Analysis.Logs")}
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel
          value="engines"
          style={{
            overflow: "hidden",
            display: tab === "engines" ? "flex" : "none",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
          }}
          pt="sm"
        >
          <EnginePanelContent />
        </Tabs.Panel>
        <Tabs.Panel
          value="report"
          pt="xs"
          style={{
            overflow: "hidden",
            display: tab === "report" ? "flex" : "none",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
          }}
        >
          <ReportPanel />
        </Tabs.Panel>
        <Tabs.Panel
          value="logs"
          pt="xs"
          style={{
            overflow: "hidden",
            display: tab === "logs" ? "flex" : "none",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
          }}
        >
          <LogsPanel />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

export default memo(AnalysisPanel);

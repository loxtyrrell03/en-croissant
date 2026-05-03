"use no memo";
import { AppShellSection, Stack, Tooltip } from "@mantine/core";
import {
  type Icon,
  IconChess,
  IconCpu,
  IconDatabase,
  IconFiles,
  IconHome,
  IconSettings,
} from "@tabler/icons-react";
import { Link, useMatchRoute, useNavigate } from "@tanstack/react-router";
import cx from "clsx";
import { useAtom, useSetAtom, useStore } from "jotai";
import type { MouseEventHandler } from "react";
import { useTranslation } from "react-i18next";
import { activeTabAtom, tabFamily, tabsAtom } from "@/state/atoms";
import { createTab } from "@/utils/tabs";
import classes from "./Sidebar.module.css";

interface NavbarLinkProps {
  icon: Icon;
  label: string;
  url: string;
  active?: boolean;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
}

function NavbarLink({ url, icon: Icon, label, onClick }: NavbarLinkProps) {
  const match = useMatchRoute();
  const active =
    match({
      to: url,
      fuzzy: url !== "/",
    }) !== false;

  return (
    <Tooltip label={label} position="right">
      <Link
        to={url}
        className={cx(classes.link, {
          [classes.active]: active,
        })}
        onClick={onClick}
      >
        <Icon size="1.5rem" stroke={1.5} />
      </Link>
    </Tooltip>
  );
}

const linksdata: Pick<NavbarLinkProps, "icon" | "label" | "url">[] = [
  { icon: IconHome, label: "Home", url: "/home" },
  { icon: IconChess, label: "Board", url: "/" },
  { icon: IconFiles, label: "Files", url: "/files" },
  {
    icon: IconDatabase,
    label: "Databases",
    url: "/databases",
  },
  { icon: IconCpu, label: "Engines", url: "/engines" },
];

export function SideBar() {
  const { t } = useTranslation();
  const [tabs, setTabs] = useAtom(tabsAtom);
  const setActiveTab = useSetAtom(activeTabAtom);
  const store = useStore();
  const navigate = useNavigate();

  const openBoard: MouseEventHandler<HTMLAnchorElement> = (event) => {
    const hasBoardTab = tabs.some((tab) => tab.type !== "new");
    if (hasBoardTab) return;

    event.preventDefault();
    void createTab({
      tab: {
        name: t("Home.Card.AnalysisBoard.Title"),
        type: "analysis",
      },
      setTabs,
      setActiveTab,
    }).then((tabId) => {
      store.set(tabFamily(tabId), "analysis");
      navigate({ to: "/" });
    });
  };

  const links = linksdata.map((link) => (
    <NavbarLink
      {...link}
      label={t(`SideBar.${link.label}`, { defaultValue: link.label })}
      key={link.label}
      onClick={link.url === "/" ? openBoard : undefined}
    />
  ));

  return (
    <>
      <AppShellSection grow>
        <Stack justify="center" gap={0}>
          {links}
        </Stack>
      </AppShellSection>
      <AppShellSection>
        <Stack justify="center" gap={0}>
          <NavbarLink icon={IconSettings} label={t("SideBar.Settings")} url="/settings" />
        </Stack>
      </AppShellSection>
    </>
  );
}

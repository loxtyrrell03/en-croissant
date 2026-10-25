import { Accordion, Anchor, Modal, ScrollArea, Text } from "@mantine/core";
import { getTauriVersion, getVersion } from "@tauri-apps/api/app";
import { arch, version as OSVersion, type } from "@tauri-apps/plugin-os";
import { useEffect, useState } from "react";
import thirdPartyNotices from "../../licenses/THIRD_PARTY_NOTICES.txt?raw";

function AboutModal({
  opened,
  setOpened,
}: {
  opened: boolean;
  setOpened: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const [info, setInfo] = useState<{
    version: string;
    tauri: string;
    os: string;
    architecture: string;
    osVersion: string;
  } | null>(null);

  useEffect(() => {
    async function load() {
      const os = await type();
      const version = await getVersion();
      const tauri = await getTauriVersion();
      const architecture = await arch();
      const osVersion = await OSVersion();
      setInfo({ version, tauri, os, architecture, osVersion });
    }
    load();
  }, []);
  return (
    <Modal
      centered
      opened={opened}
      onClose={() => setOpened(false)}
      title="En Croissant"
      closeButtonProps={{ "aria-label": "Close" }}
    >
      <Text>Version: {info?.version}</Text>
      <Text>Tauri version: {info?.tauri}</Text>
      <Text>
        OS: {info?.os} {info?.architecture} {info?.osVersion}
      </Text>

      <br />

      <Anchor href="https://www.encroissant.org" target="_blank" rel="noreferrer">
        www.encroissant.org
      </Anchor>
      <Accordion mt="md">
        <Accordion.Item value="compression-notices">
          <Accordion.Control>Compression library notices</Accordion.Control>
          <Accordion.Panel>
            <ScrollArea.Autosize mah="min(35dvh, 16rem)" type="auto" offsetScrollbars>
              <Text
                component="pre"
                size="xs"
                tabIndex={0}
                aria-label="Compression library notice text"
                style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "inherit" }}
              >
                {thirdPartyNotices}
              </Text>
            </ScrollArea.Autosize>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Modal>
  );
}

export default AboutModal;

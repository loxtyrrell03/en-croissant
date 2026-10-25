import { IconCloud, IconCpu } from "@tabler/icons-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import stockfishLogo from "@/assets/engines/stockfish.png?inline";
import lc0Logo from "@/assets/engines/lc0.png?inline";

export type EngineLogoProfile = {
  id?: string;
  name: string;
  path?: string;
  image?: string | null;
  type?: "local" | "pc" | "chessdb" | "lichess";
  engineKind?: "stockfish" | "lc0";
};

export function builtInEngineLogo(engine: EngineLogoProfile): string | null {
  // Remote tablebases are services, even when their editable label names an engine.
  if (engine.type === "chessdb" || engine.type === "lichess") return null;
  if (engine.engineKind === "stockfish") return stockfishLogo;
  if (engine.engineKind === "lc0") return lc0Logo;
  const executable = engine.path?.split(/[\\/]/).pop() ?? "";
  const identities = [engine.name, executable];
  if (identities.some((value) => /^stockfish(?:\b|_)/i.test(value))) return stockfishLogo;
  if (identities.some((value) => /^(?:lc0|lczero)(?:\b|_)|^leela chess zero\b/i.test(value)))
    return lc0Logo;
  return null;
}

export function EngineLogo({
  engine,
  size = "2.5rem",
}: {
  engine: EngineLogoProfile;
  size?: string;
}) {
  // A new owner gets fresh failure/loading state before effects run. Replies and
  // error events from a previous profile/image cannot change the current one.
  const owner = JSON.stringify([
    engine.id,
    engine.type,
    engine.engineKind,
    engine.name,
    engine.path,
    engine.image,
  ]);
  return <OwnedEngineLogo key={owner} engine={engine} size={size} />;
}

function OwnedEngineLogo({ engine, size }: { engine: EngineLogoProfile; size: string }) {
  const image = engine.image;
  const direct = !!image && /^(?:https?:|data:image\/|blob:|asset:|tauri:)/i.test(image);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [customFailed, setCustomFailed] = useState(false);
  const [bundledFailed, setBundledFailed] = useState(false);
  useEffect(() => {
    if (!image || direct) return;
    let cancelled = false;
    void (async () => {
      try {
        const url = await convertFileSrc(image);
        if (!cancelled) setLoaded(url);
      } catch {
        if (!cancelled) setCustomFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [image, direct]);
  const custom = direct ? image : loaded;
  const usesCustom = !!custom && !customFailed;
  const src = usesCustom ? custom : bundledFailed ? null : builtInEngineLogo(engine);
  if (src)
    return (
      <img
        key={`${usesCustom}:${src}`}
        src={src}
        alt=""
        aria-hidden="true"
        style={{ width: size, height: size, objectFit: "contain", flexShrink: 0, display: "block" }}
        onError={() => {
          if (usesCustom) setCustomFailed(true);
          else setBundledFailed(true);
        }}
      />
    );
  const cloud = engine.type === "chessdb" || engine.type === "lichess";
  const Icon = cloud ? IconCloud : IconCpu;
  return (
    <Icon
      size={size}
      aria-hidden="true"
      data-engine-logo-fallback={cloud ? "cloud" : "cpu"}
      style={{ flexShrink: 0 }}
    />
  );
}

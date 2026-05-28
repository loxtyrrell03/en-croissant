import { convertFileSrc } from "@tauri-apps/api/core";
import { resolveResource } from "@tauri-apps/api/path";
import { platform } from "@tauri-apps/plugin-os";
import { getDefaultStore } from "jotai";
import { commands } from "@/bindings/generated";
import { boardStyleAtom, soundCollectionAtom, soundVolumeAtom } from "@/state/atoms";
import { getEffectiveSoundCollection } from "@/utils/boardStyle";

const POOL_SIZE = 5;
const DEFAULT_SOUND_COLLECTION = "standard";
const audioPool = Array.from({ length: POOL_SIZE }, () => new Audio());
let poolIndex = 0;

let soundServerPort: number | null = null;
const soundUrlCache = new Map<string, string>();

function getDevServerSoundUrl(collection: string, type: string): string | null {
    if (typeof window === "undefined") {
        return null;
    }

    const { protocol, hostname } = window.location;
    const isDevServer =
        protocol === "http:" && (hostname === "localhost" || hostname === "127.0.0.1");

    return isDevServer ? `/sound/${collection}/${type}.mp3` : null;
}

function isLinux(): boolean {
    try {
        return platform() === "linux";
    } catch {
        return false;
    }
}

let lastTime = 0;

async function getSoundServerPort(): Promise<number> {
    if (soundServerPort !== null) {
        return soundServerPort;
    }
    const result = await commands.getSoundServerPort();
    if (result.status === "ok") {
        soundServerPort = result.data;
        return soundServerPort;
    }
    throw new Error("Failed to get sound server port");
}

export function playSound(capture: boolean, check: boolean) {
    // only play at most 1 sound every 75ms
    const now = Date.now();
    if (now - lastTime < 75) {
        return;
    }
    lastTime = now;

    const store = getDefaultStore();
    const boardStyle = store.get(boardStyleAtom);
    const selectedCollection = store.get(soundCollectionAtom);
    const collection = getEffectiveSoundCollection(boardStyle, selectedCollection);
    const volume = store.get(soundVolumeAtom);

    let type = "Move";
    if (capture) {
        type = "Capture";
    }
    if (collection !== DEFAULT_SOUND_COLLECTION && check) {
        type = "Check";
    }

    const cacheKey = `${collection}/${type}`;

    const playWithUrl = (url: string) => {
        const player = audioPool[poolIndex];
        poolIndex = (poolIndex + 1) % POOL_SIZE;

        player.src = url;
        player.volume = volume;
        player.play().catch((e) => console.error("Audio playback error:", e));
    };

    if (isLinux()) {
        getSoundServerPort()
            .then((port) => {
                const url = `http://127.0.0.1:${port}/${collection}/${type}.mp3`;
                playWithUrl(url);
            })
            .catch(() => {
                // fails if Tauri APIs are unavailable (e.g., in tests)
            });
    } else {
        if (soundUrlCache.has(cacheKey)) {
            playWithUrl(soundUrlCache.get(cacheKey)!);
            return;
        }

        const devServerUrl = getDevServerSoundUrl(collection, type);
        if (devServerUrl !== null) {
            soundUrlCache.set(cacheKey, devServerUrl);
            playWithUrl(devServerUrl);
            return;
        }

        const path = `sound/${collection}/${type}.mp3`;
        resolveResource(path)
            .then((filePath) => {
                const assetUrl = convertFileSrc(filePath);
                soundUrlCache.set(cacheKey, assetUrl);

                playWithUrl(assetUrl);
            })
            .catch(() => {
                // fails if Tauri APIs are unavailable (e.g., in tests)
            });
    }
}

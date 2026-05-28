import { convertFileSrc } from "@tauri-apps/api/core";
import { resolveResource } from "@tauri-apps/api/path";
import { platform } from "@tauri-apps/plugin-os";
import { getDefaultStore } from "jotai";
import { commands } from "@/bindings/generated";
import { boardStyleAtom, soundCollectionAtom, soundVolumeAtom } from "@/state/atoms";
import { CHESS_COM_STYLE_SOUND_COLLECTION, getEffectiveSoundCollection } from "@/utils/boardStyle";

const POOL_SIZE = 5;
const audioPool = Array.from({ length: POOL_SIZE }, () => new Audio());
let poolIndex = 0;

let soundServerPort: number | null = null;
const soundUrlCache = new Map<string, string>();
let chessComAudioContext: AudioContext | null = null;

function isLinux(): boolean {
    try {
        return platform() === "linux";
    } catch {
        return false;
    }
}

function getBrowserAudioContext(): AudioContext | null {
    const AudioContextClass =
        window.AudioContext ??
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;

    chessComAudioContext ??= new AudioContextClass();
    return chessComAudioContext;
}

function playClickTone(
    context: AudioContext,
    time: number,
    frequency: number,
    duration: number,
    volume: number,
) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(frequency, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), time + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(time);
    oscillator.stop(time + duration + 0.02);
}

function playNoiseClick(context: AudioContext, time: number, duration: number, volume: number) {
    const sampleRate = context.sampleRate;
    const buffer = context.createBuffer(1, Math.floor(sampleRate * duration), sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }

    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();

    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1150, time);
    filter.Q.setValueAtTime(0.9, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    source.start(time);
}

function playChessComStyleSound(capture: boolean, check: boolean, volume: number) {
    const context = getBrowserAudioContext();
    if (!context) return false;

    void context.resume().catch(() => {});
    const time = context.currentTime + 0.01;
    const scaledVolume = Math.max(0.0001, Math.min(1, volume)) * 0.42;

    if (capture) {
        playNoiseClick(context, time, 0.065, scaledVolume * 0.7);
        playClickTone(context, time, 360, 0.07, scaledVolume * 0.8);
        playClickTone(context, time + 0.035, 250, 0.08, scaledVolume * 0.55);
    } else {
        playNoiseClick(context, time, 0.04, scaledVolume * 0.48);
        playClickTone(context, time, 520, 0.055, scaledVolume * 0.62);
    }

    if (check) {
        playClickTone(context, time + 0.07, 760, 0.1, scaledVolume * 0.5);
    }

    return true;
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
    const collection = getEffectiveSoundCollection(
        store.get(boardStyleAtom),
        store.get(soundCollectionAtom),
    );
    const volume = store.get(soundVolumeAtom);

    let type = "Move";
    if (capture) {
        type = "Capture";
    }
    if (collection !== "standard" && check) {
        type = "Check";
    }

    const cacheKey = `${collection}/${type}`;

    if (collection === CHESS_COM_STYLE_SOUND_COLLECTION) {
        playChessComStyleSound(capture, check, volume);
        return;
    }

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
        const path = `sound/${collection}/${type}.mp3`;

        if (soundUrlCache.has(cacheKey)) {
            playWithUrl(soundUrlCache.get(cacheKey)!);
            return;
        }
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

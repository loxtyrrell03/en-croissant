import { resolve } from "@tauri-apps/api/path";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { fetch } from "@tauri-apps/plugin-http";
import type {
    LichessStudyDatabaseUpdateRecord,
    LichessStudyDatabaseUpdateRecords,
} from "@/state/atoms";
import type { DatabaseInfo } from "@/bindings";
import { apiHeaders } from "@/utils/http";

const LICHESS_STUDY_ID_PATTERN = /^[A-Za-z0-9]{8}$/;
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]+/g;
const RESERVED_WINDOWS_FILENAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export type LichessStudyReference = {
    studyId: string;
    chapterId: string | null;
    canonicalUrl: string;
    pgnUrl: string;
};

export type LichessStudyDownload = {
    reference: LichessStudyReference;
    pgn: string;
    pgnHash: string;
    title: string;
};

export function parseLichessStudyLink(value: string): LichessStudyReference | null {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (LICHESS_STUDY_ID_PATTERN.test(trimmed)) {
        return createLichessStudyReference(trimmed, null);
    }

    let url: URL;
    try {
        url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    } catch {
        return null;
    }

    if (!isLichessHost(url.hostname)) return null;

    const parts = url.pathname.split("/").filter(Boolean);
    const studyIndex = parts.findIndex((part) => part === "study");
    if (studyIndex === -1) return null;

    const studyId = stripPgnExtension(parts[studyIndex + 1] ?? "");
    if (!LICHESS_STUDY_ID_PATTERN.test(studyId)) return null;

    const pathChapterCandidate = stripPgnExtension(parts[studyIndex + 2] ?? "");
    const hashChapterCandidate = stripPgnExtension(url.hash.replace(/^#/, ""));
    const chapterId = LICHESS_STUDY_ID_PATTERN.test(pathChapterCandidate)
        ? pathChapterCandidate
        : LICHESS_STUDY_ID_PATTERN.test(hashChapterCandidate)
          ? hashChapterCandidate
          : null;

    return createLichessStudyReference(studyId, chapterId);
}

export function getDefaultLichessStudyDatabaseTitle(link: string) {
    const reference = parseLichessStudyLink(link);
    return reference ? `Lichess Study ${reference.studyId}` : "";
}

export function getLichessStudyPgnFilename(studyId: string) {
    return `lichess_study_${sanitizeFileSegment(studyId)}.pgn`;
}

export async function downloadLichessStudyPgn(
    link: string,
    token?: string,
): Promise<LichessStudyDownload> {
    const reference = parseLichessStudyLink(link);
    if (!reference) {
        throw new Error("Paste a valid Lichess study link.");
    }

    let response = await fetchLichessStudyPgn(reference, token);
    if (token && (response.status === 401 || response.status === 403)) {
        response = await fetchLichessStudyPgn(reference);
    }

    if (!response.ok) {
        throw new Error(`Lichess study download failed: ${response.status} ${response.statusText}`);
    }

    const pgn = await response.text();
    if (!pgn.trim().startsWith("[")) {
        throw new Error("Lichess did not return a PGN for that study.");
    }

    return {
        reference,
        pgn,
        pgnHash: await hashText(pgn),
        title: extractLichessStudyName(pgn) ?? `Lichess Study ${reference.studyId}`,
    };
}

function fetchLichessStudyPgn(reference: LichessStudyReference, token?: string) {
    return fetch(reference.pgnUrl, {
        headers: apiHeaders({
            Accept: "application/x-chess-pgn",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        }),
    });
}

export async function downloadLichessStudyPgnToDatabaseDir({
    databaseDir,
    link,
    token,
}: {
    databaseDir: string;
    link: string;
    token?: string;
}) {
    const download = await downloadLichessStudyPgn(link, token);
    const path = await resolve(databaseDir, getLichessStudyPgnFilename(download.reference.studyId));
    await writeTextFile(path, download.pgn);
    return {
        ...download,
        path,
    };
}

export function extractLichessStudyName(pgn: string) {
    const match = pgn.match(/^\[StudyName\s+"((?:\\.|[^"\\])*)"\]/m);
    const studyName = match?.[1] ? unescapePgnTagValue(match[1]).trim() : "";
    return studyName || null;
}

export function getLichessStudyDatabaseUpdateRecord(
    database: DatabaseInfo,
    records: LichessStudyDatabaseUpdateRecords,
): LichessStudyDatabaseUpdateRecord | null {
    if (database.type !== "success") return null;
    return records[database.file] ?? null;
}

export function upsertLichessStudyDatabaseUpdateRecord(
    records: LichessStudyDatabaseUpdateRecords,
    record: Omit<
        LichessStudyDatabaseUpdateRecord,
        "lastCheckedAt" | "lastUpdatedAt" | "lastKnownGameCount"
    > &
        Partial<
            Pick<
                LichessStudyDatabaseUpdateRecord,
                "lastCheckedAt" | "lastUpdatedAt" | "lastKnownGameCount"
            >
        >,
): LichessStudyDatabaseUpdateRecords {
    const previous = records[record.dbPath];
    return {
        ...records,
        [record.dbPath]: {
            ...previous,
            ...record,
            lastCheckedAt: record.lastCheckedAt ?? previous?.lastCheckedAt ?? null,
            lastUpdatedAt: record.lastUpdatedAt ?? previous?.lastUpdatedAt ?? null,
            lastKnownGameCount: record.lastKnownGameCount ?? previous?.lastKnownGameCount ?? null,
        },
    };
}

export function getLichessStudyDatabaseUpdateLabel(record: LichessStudyDatabaseUpdateRecord) {
    return `Lichess study ${record.title}`;
}

export async function hashText(value: string) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

export function sanitizeFileSegment(value: string) {
    const clean = value
        .replace(INVALID_FILENAME_CHARS, " ")
        .replace(/\s+/g, " ")
        .replace(/[. ]+$/g, "")
        .trim();
    if (!clean) return "";
    return RESERVED_WINDOWS_FILENAME.test(clean) ? `${clean}_` : clean;
}

function createLichessStudyReference(
    studyId: string,
    chapterId: string | null,
): LichessStudyReference {
    const pgnUrl = new URL(`https://lichess.org/api/study/${studyId}.pgn`);
    pgnUrl.searchParams.set("comments", "true");
    pgnUrl.searchParams.set("variations", "true");
    pgnUrl.searchParams.set("clocks", "true");

    return {
        studyId,
        chapterId,
        canonicalUrl: chapterId
            ? `https://lichess.org/study/${studyId}/${chapterId}`
            : `https://lichess.org/study/${studyId}`,
        pgnUrl: pgnUrl.toString(),
    };
}

function isLichessHost(hostname: string) {
    const host = hostname.toLowerCase();
    return host === "lichess.org" || host === "www.lichess.org";
}

function stripPgnExtension(value: string) {
    return value.replace(/\.pgn$/i, "");
}

function unescapePgnTagValue(value: string) {
    return value.replace(/\\(["\\])/g, "$1");
}

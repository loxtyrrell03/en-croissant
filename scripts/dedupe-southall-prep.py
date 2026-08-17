#!/usr/bin/env python3
"""Remove duplicate Southall OTB prep games and rebuild the app databases."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import io
import json
import logging
import re
import shutil
import sqlite3
import subprocess
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import chess.pgn


DEFAULT_PREP_ROOT = Path(
    r"C:\Users\loxty\Documents\EnCroissant\Southall Congress 260620 U2400 player games"
)
DEFAULT_CONVERTER = Path(
    r"C:\Users\loxty\Desktop\Repos\En croissant chess\src-tauri\target\debug\pgn_to_ec_db.exe"
)


def eprint(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def normalize_date(value: str) -> str:
    parts = re.split(r"[.\-]", value or "")
    out: list[int] = []
    for item in parts[:3]:
        if item.isdigit():
            out.append(int(item))
        else:
            out.append(0)
    while len(out) < 3:
        out.append(0)
    if out[0]:
        return f"{out[0]:04d}.{out[1]:02d}.{out[2]:02d}"
    return re.sub(r"[^0-9?]+", ".", value or "")


def normalize_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def date_from_filename(path: Path) -> str | None:
    match = re.search(r"(\d{4})[.\-](\d{2})[.\-](\d{2})", path.name)
    if not match:
        return None
    return ".".join(match.groups())


def parse_game_block(text: str) -> tuple[chess.pgn.Game | None, list[chess.Move]]:
    game = chess.pgn.read_game(io.StringIO(text))
    if game is None:
        return None, []
    moves = list(game.mainline_moves())
    return game, moves


def game_key_from_block(text: str) -> tuple[str, str, str] | tuple[str, str]:
    game, moves = parse_game_block(text)
    if game is None or not moves:
        return ("raw", hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest())
    headers = game.headers
    return (
        normalize_date(headers.get("Date", "")),
        headers.get("Result", ""),
        " ".join(move.uci() for move in moves),
    )


def quality_score(text: str, target_name: str) -> int:
    game, moves = parse_game_block(text)
    if game is None:
        return len(text)
    headers = game.headers
    score = len(moves) * 3 + min(len(text) // 80, 80)
    for field, weight in (
        ("Date", 120),
        ("GameURL", 80),
        ("BroadcastURL", 60),
        ("WhiteFideId", 40),
        ("BlackFideId", 40),
        ("Opening", 25),
        ("ECO", 20),
        ("WhiteElo", 10),
        ("BlackElo", 10),
        ("Site", 5),
        ("Round", 5),
    ):
        if headers.get(field) and not str(headers.get(field)).startswith("????"):
            score += weight
    target_key = normalize_name(target_name)
    if normalize_name(headers.get("White", "")) == target_key or normalize_name(headers.get("Black", "")) == target_key:
        score += 25
    return score


def split_pgn_blocks(text: str) -> list[str]:
    blocks: list[list[str]] = []
    current: list[str] = []
    for line in text.splitlines():
        if line.startswith("[Event ") and current and any(item.strip() for item in current):
            blocks.append(current)
            current = [line]
        else:
            current.append(line)
    if current and any(item.strip() for item in current):
        blocks.append(current)
    return ["\n".join(block).strip() + "\n" for block in blocks if "\n".join(block).strip()]


def pgn_file_key(path: Path) -> tuple[str, str, str] | tuple[str, str]:
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    blocks = split_pgn_blocks(text)
    if len(blocks) != 1:
        return ("multi", hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest())
    game, moves = parse_game_block(blocks[0])
    if game is None or not moves:
        return ("raw", hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest())
    date = game.headers.get("Date", "")
    if not date or date.startswith("????"):
        date = date_from_filename(path) or date
    return (
        normalize_date(date),
        game.headers.get("Result", ""),
        " ".join(move.uci() for move in moves),
    )


def pgn_file_quality(path: Path, target_name: str) -> int:
    return quality_score(path.read_text(encoding="utf-8-sig", errors="replace"), target_name)


def move_with_sidecars(path: Path, destination_dir: Path) -> list[str]:
    destination_dir.mkdir(parents=True, exist_ok=True)
    moved: list[str] = []
    sidecars = [
        path,
        path.with_suffix(".info"),
        Path(str(path) + ".info"),
    ]
    for item in sidecars:
        if item.exists():
            target = destination_dir / item.name
            if target.exists():
                target = destination_dir / f"{item.stem}-{hashlib.sha1(str(item).encode()).hexdigest()[:8]}{item.suffix}"
            shutil.move(str(item), str(target))
            moved.append(str(target))
    return moved


def dedupe_player_folder(folder: Path, target_name: str, backup_dir: Path) -> dict[str, Any]:
    files = sorted(path for path in folder.glob("*.pgn") if "prep" not in path.name.lower())
    groups: dict[tuple[Any, ...], list[Path]] = defaultdict(list)
    for path in files:
        groups[tuple(pgn_file_key(path))].append(path)

    removed: list[dict[str, Any]] = []
    kept_files: list[Path] = []
    for key, group in groups.items():
        if len(group) == 1:
            kept_files.append(group[0])
            continue
        ranked = sorted(group, key=lambda item: (pgn_file_quality(item, target_name), -len(item.name)), reverse=True)
        keep = ranked[0]
        kept_files.append(keep)
        for duplicate in ranked[1:]:
            moved = move_with_sidecars(duplicate, backup_dir / folder.name)
            removed.append({"key": list(key), "kept": str(keep), "removed": str(duplicate), "backup": moved})
    kept_files.sort(key=lambda item: item.name.lower())
    return {"keptFiles": [str(path) for path in kept_files], "removed": removed}


def write_combined_source(kept_files: list[str], output_path: Path, backup_dir: Path) -> int:
    backup_dir.mkdir(parents=True, exist_ok=True)
    if output_path.exists():
        shutil.copy2(output_path, backup_dir / output_path.name)
    blocks: list[str] = []
    for file_name in kept_files:
        text = Path(file_name).read_text(encoding="utf-8-sig", errors="replace").strip()
        if text:
            blocks.append(text)
    output_path.write_text("\n\n".join(blocks) + "\n", encoding="utf-8")
    return len(blocks)


def db_duplicate_summary(db_path: Path) -> dict[str, Any]:
    con = sqlite3.connect(db_path)
    total = con.execute("select count(*) from Games").fetchone()[0]
    rows = con.execute(
        """
        select replace(coalesce(Date,''),'-','.'), Result, PlyCount, hex(Moves), count(*)
        from Games
        group by replace(coalesce(Date,''),'-','.'), Result, PlyCount, hex(Moves)
        having count(*) > 1
        """
    ).fetchall()
    con.close()
    return {"total": total, "duplicateRows": sum(row[4] - 1 for row in rows), "duplicateGroups": len(rows)}


def target_name_counts_in_db(db_path: Path, target_name: str) -> dict[str, int]:
    target_key = normalize_name(target_name)
    con = sqlite3.connect(db_path)
    rows = con.execute(
        """
        select p.Name, count(*)
        from Players p
        join (
          select WhiteID as PlayerID from Games
          union all
          select BlackID as PlayerID from Games
        ) gp on gp.PlayerID = p.ID
        group by p.ID, p.Name
        """
    ).fetchall()
    con.close()
    return {name: count for name, count in rows if normalize_name(name) == target_key}


def target_name_counts_in_pgn(pgn_path: Path, target_name: str) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    target_key = normalize_name(target_name)
    text = pgn_path.read_text(encoding="utf-8-sig", errors="replace")
    for block in split_pgn_blocks(text):
        game, _ = parse_game_block(block)
        if game is None:
            continue
        for field in ("White", "Black"):
            name = game.headers.get(field, "")
            if normalize_name(name) == target_key:
                counts[name] += 1
    return dict(counts)


def remove_search_index(db_path: Path, backup_dir: Path) -> str | None:
    index_path = db_path.with_suffix(".ecsi")
    if not index_path.exists():
        return None
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup = backup_dir / index_path.name
    shutil.copy2(index_path, backup)
    index_path.unlink()
    return str(backup)


def rebuild_database(converter: Path, source_pgn: Path, db_path: Path, player: str, backup_dir: Path) -> None:
    backup_dir.mkdir(parents=True, exist_ok=True)
    if db_path.exists():
        shutil.copy2(db_path, backup_dir / db_path.name)
    title = f"Southall U2400 deduped OTB prep - {player}"
    description = f"Deduplicated Southall U2400 OTB and broadcast prep games for {player}"
    subprocess.run(
        [str(converter), str(source_pgn), str(db_path), title, description],
        check=True,
        cwd=str(converter.parent),
        capture_output=True,
        text=True,
    )


def update_manifest(prep_root: Path, manifest: dict[str, Any], player_results: list[dict[str, Any]]) -> None:
    by_player = {item["player"]: item for item in player_results}
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    manifest["updatedAt"] = now
    manifest.setdefault("dedupeCleanup", {})
    manifest["dedupeCleanup"].update(
        {
            "updatedAt": now,
            "scope": "Southall OTB prep source PGNs, Files-side player folders, and app-side OTB .db3 databases",
            "players": {
                item["player"]: {
                    "sourceGamesAfter": item["sourceGamesAfter"],
                    "dbGamesBefore": item["dbBefore"]["total"],
                    "dbGamesAfter": item["dbAfter"]["total"],
                    "duplicateFilesRemoved": len(item["folderRemoved"]),
                    "dbDuplicatesAfter": item["dbAfter"]["duplicateRows"],
                }
                for item in player_results
            },
        }
    )
    manifest["databaseCounts"] = manifest.get("databaseCounts", {})
    manifest["canonicalNameAudit"] = manifest.get("canonicalNameAudit", {})
    for target in manifest["targets"]:
        result = by_player.get(target["player"])
        if not result:
            continue
        target["sourcePgnCount"] = result["sourceGamesAfter"]
        target.setdefault("notes", [])
        note = (
            f"Duplicate cleanup on {now}: removed {len(result['folderRemoved'])} duplicate Files-side PGNs, "
            f"rewrote the app-side source PGN to {result['sourceGamesAfter']} unique games, and rebuilt the OTB database "
            f"from {result['dbBefore']['total']} to {result['dbAfter']['total']} games."
        )
        if note not in target["notes"]:
            target["notes"].append(note)
        manifest["databaseCounts"][target["player"]] = result["dbAfter"]["total"]
        manifest["canonicalNameAudit"][target["player"]] = {
            "pgnTargetNames": result["pgnTargetNames"],
            "dbTargetNames": result["dbTargetNames"],
            "pgnOk": list(result["pgnTargetNames"].keys()) == [target["player"]],
            "dbOk": list(result["dbTargetNames"].keys()) == [target["player"]],
        }
    (prep_root / "_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prep-root", default=str(DEFAULT_PREP_ROOT))
    parser.add_argument("--converter", default=str(DEFAULT_CONVERTER))
    args = parser.parse_args()

    logging.getLogger("chess.pgn").setLevel(logging.CRITICAL)
    prep_root = Path(args.prep_root)
    converter = Path(args.converter)
    if not converter.exists():
        raise SystemExit(f"Converter not found: {converter}")

    manifest_path = prep_root / "_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_root = prep_root / f"_dedupe_backup_{stamp}"
    backup_root.mkdir(parents=True, exist_ok=True)

    results: list[dict[str, Any]] = []
    for target in manifest["targets"]:
        player = target["player"]
        folder = Path(target["folder"])
        source_pgn = Path(target["appOtbSourcePgnPath"])
        db_path = Path(target["appOtbDatabasePath"])
        eprint(f"Deduping {player}")
        folder_result = dedupe_player_folder(folder, player, backup_root / "Files")
        source_count = write_combined_source(folder_result["keptFiles"], source_pgn, backup_root / "AppSourcePGNs")
        db_before = db_duplicate_summary(db_path)
        index_backup = remove_search_index(db_path, backup_root / "SearchIndexes")
        rebuild_database(converter, source_pgn, db_path, player, backup_root / "Databases")
        db_after = db_duplicate_summary(db_path)
        result = {
            "player": player,
            "folder": str(folder),
            "sourcePgn": str(source_pgn),
            "database": str(db_path),
            "sourceGamesAfter": source_count,
            "folderRemoved": folder_result["removed"],
            "dbBefore": db_before,
            "dbAfter": db_after,
            "searchIndexBackup": index_backup,
            "pgnTargetNames": target_name_counts_in_pgn(source_pgn, player),
            "dbTargetNames": target_name_counts_in_db(db_path, player),
        }
        results.append(result)
        eprint(
            f"  files removed {len(folder_result['removed'])}; db {db_before['total']} -> {db_after['total']}; "
            f"remaining duplicate rows {db_after['duplicateRows']}"
        )

    update_manifest(prep_root, manifest, results)
    summary_path = prep_root / "_dedupe_cleanup_summary.json"
    summary_path.write_text(
        json.dumps(
            {
                "generatedAt": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
                "backupRoot": str(backup_root),
                "results": results,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    eprint(f"Wrote {summary_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

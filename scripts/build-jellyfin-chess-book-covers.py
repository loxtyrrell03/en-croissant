#!/usr/bin/env python3
"""Build persistent Jellyfin cover sidecars for the AI Chess Coach PDF shelf.

Installed books use the official product artwork exposed by their publisher or
retailer product page. PDFs that are not catalogue book records (currently the
two shelf guides), or whose artwork cannot be downloaded, fall back to a sharp
render of their first PDF page. The resulting JPEG uses the PDF basename so
Jellyfin can rediscover it on every library scan.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps, ImageStat


DEFAULT_LIBRARY = (
    Path.home() / "Documents" / "EnCroissant" / "AI Chess Coach Library"
)
DEFAULT_CATALOG = (
    DEFAULT_LIBRARY
    / "00 Master Library Guide"
    / "AI Chess Coach Library catalogue.json"
)
DEFAULT_REPORT = (
    DEFAULT_LIBRARY
    / "00 Master Library Guide"
    / "Jellyfin cover report.json"
)
DEFAULT_JELLYFIN_DB = (
    Path.home()
    / "AppData"
    / "Local"
    / "JellyfinPrivate"
    / "data"
    / "data"
    / "jellyfin.db"
)

# These catalogue entries either point at a publisher index/search page with no
# social artwork or, in one case, at a retired store listing that now resolves
# to the wrong product. Every override was visually checked against its title.
COVER_OVERRIDES: dict[str, dict[str, Any]] = {
    "endgame-mastering-strategy": {
        "source_page": "https://chessreads.com/review/mastering-endgame-strategy/",
        "image_url": "https://chessreads-s3.s3.us-east-1.amazonaws.com/chessreads/books/covers/9468-1779304627384-mastering-endgame-strategy-fixed.jpg",
        "source_kind": "verified-cover-art",
    },
    "white-reti-delchev": {
        "source_page": "https://www.chess-stars.com/",
        "image_url": "https://www.chess-stars.com/resources/Reti.jpg",
        "source_kind": "official-publisher-art",
        "allow_small": True,
    },
    "black-e4-e5-bologan-open-games": {
        "source_page": "https://chessreads.com/review/bologans-black-weapons-in-the-open-games/",
        "image_url": "https://chessreads-s3.s3.us-east-1.amazonaws.com/chessreads/books/covers/9311-1779304585557-bologan-s-black-weapons-in-the-open-games-fixed.jpg",
        "source_kind": "verified-cover-art",
    },
    "black-d4-delchev-safest-gruenfeld": {
        "source_page": "https://www.bol.com/nl/nl/p/safest-grunfeld/9200000060937646/",
        "image_url": "https://media.s-bol.com/gJQ59WRnVZk3/550x810.jpg",
        "source_kind": "verified-retailer-art",
    },
    "sidelines-london": {
        "source_page": "https://www.chess-stars.com/",
        "image_url": "https://www.chess-stars.com/resources/London_Icon.jpg",
        "source_kind": "official-publisher-art",
        "allow_small": True,
    },
}


class ProductMetadataParser(HTMLParser):
    """Collect product-page social image metadata without an HTML dependency."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.images: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.casefold() != "meta":
            return
        values = {key.casefold(): value for key, value in attrs if value is not None}
        key = (values.get("property") or values.get("name") or "").casefold()
        content = values.get("content")
        if key in {"og:image", "og:image:secure_url", "twitter:image"} and content:
            self.images.append(content.strip())


@dataclass
class CoverResult:
    pdf_path: str
    cover_path: str
    title: str
    author: str
    source_kind: str
    product_url: str | None
    image_url: str | None
    width: int
    height: int
    bytes: int
    sha256: str
    error: str | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library", type=Path, default=DEFAULT_LIBRARY)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--skip-jellyfin", action="store_true")
    parser.add_argument("--jellyfin-url", default="http://127.0.0.1:8096")
    parser.add_argument("--jellyfin-db", type=Path, default=DEFAULT_JELLYFIN_DB)
    parser.add_argument("--jellyfin-library", default="Chess Books")
    return parser.parse_args()


def find_pdftoppm() -> Path:
    bundled = (
        Path.home()
        / ".cache"
        / "codex-runtimes"
        / "codex-primary-runtime"
        / "dependencies"
        / "native"
        / "poppler"
        / "Library"
        / "bin"
        / "pdftoppm.exe"
    )
    if bundled.exists():
        return bundled
    located = shutil.which("pdftoppm")
    if located:
        return Path(located)
    raise FileNotFoundError("pdftoppm is required for PDF cover fallbacks")


def request_bytes(url: str, *, attempts: int = 3, timeout: int = 30) -> tuple[bytes, str]:
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 Chrome/138 Safari/537.36"
                    ),
                    "Accept": "text/html,image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                },
            )
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read(), response.geturl()
        except (OSError, urllib.error.URLError, urllib.error.HTTPError) as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(0.75 * (attempt + 1))
    raise RuntimeError(f"Download failed for {url}: {last_error}")


def product_image_url(product_url: str) -> str:
    raw, final_url = request_bytes(product_url)
    parser = ProductMetadataParser()
    parser.feed(raw.decode("utf-8", "replace"))
    if not parser.images:
        raise RuntimeError(f"No official cover metadata found at {product_url}")
    return urllib.parse.urljoin(final_url, parser.images[0])


def normalize_image(raw: bytes, *, allow_small: bool = False) -> Image.Image:
    with Image.open(BytesIO(raw)) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGBA")
    canvas = Image.new("RGBA", image.size, "white")
    canvas.alpha_composite(image)
    image_rgb = canvas.convert("RGB")
    if image_rgb.width < 180 or image_rgb.height < 240:
        if allow_small and image_rgb.width >= 80 and image_rgb.height >= 120:
            target_width = 600
            target_height = round(image_rgb.height * target_width / image_rgb.width)
            image_rgb = image_rgb.resize((target_width, target_height), Image.Resampling.LANCZOS)
        else:
            raise RuntimeError(f"Cover is implausibly small: {image_rgb.size}")
    grayscale = image_rgb.convert("L").resize((64, 64))
    if ImageStat.Stat(grayscale).stddev[0] < 3:
        raise RuntimeError("Cover image is effectively blank")
    image_rgb.thumbnail((1200, 1800), Image.Resampling.LANCZOS)
    return image_rgb


def save_jpeg(image: Image.Image, output: Path) -> tuple[int, int, int, str]:
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.name + ".tmp")
    image.save(
        temporary,
        format="JPEG",
        quality=92,
        optimize=True,
        progressive=True,
        subsampling=0,
    )
    os.replace(temporary, output)
    raw = output.read_bytes()
    return image.width, image.height, len(raw), hashlib.sha256(raw).hexdigest()


def render_pdf_cover(pdf_path: Path, output: Path, pdftoppm: Path) -> tuple[int, int, int, str]:
    temporary_prefix = output.with_name(output.stem + ".rendering")
    temporary_jpg = Path(str(temporary_prefix) + ".jpg")
    environment = os.environ.copy()
    environment["PATH"] = str(pdftoppm.parent) + os.pathsep + environment.get("PATH", "")
    completed = subprocess.run(
        [
            str(pdftoppm),
            "-f",
            "1",
            "-l",
            "1",
            "-singlefile",
            "-jpeg",
            "-jpegopt",
            "quality=94",
            "-scale-to-x",
            "1200",
            "-scale-to-y",
            "-1",
            str(pdf_path),
            str(temporary_prefix),
        ],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
        env=environment,
    )
    if completed.returncode != 0 or not temporary_jpg.exists():
        raise RuntimeError(completed.stderr.strip() or f"Could not render {pdf_path}")
    try:
        image = normalize_image(temporary_jpg.read_bytes())
        return save_jpeg(image, output)
    finally:
        temporary_jpg.unlink(missing_ok=True)


def catalog_books(catalog_path: Path) -> dict[str, dict[str, Any]]:
    payload = json.loads(catalog_path.read_text(encoding="utf-8"))
    records: dict[str, dict[str, Any]] = {}
    for book in payload.get("books", []):
        local_path = book.get("local_path")
        if not book.get("installed_sample") or not local_path:
            continue
        records[str(Path(local_path).resolve()).casefold()] = book
    return records


def fallback_identity(pdf_path: Path, library_root: Path) -> tuple[str, str]:
    if " - " in pdf_path.stem:
        author, title = pdf_path.stem.split(" - ", 1)
        return title, author
    relative = pdf_path.relative_to(library_root)
    return pdf_path.stem, relative.parent.name


def build_one_cover(
    pdf_path: Path,
    library_root: Path,
    record: dict[str, Any] | None,
    pdftoppm: Path,
    force: bool,
) -> CoverResult:
    cover_path = pdf_path.with_suffix(".jpg")
    title, author = (
        (str(record.get("title") or pdf_path.stem), str(record.get("author") or ""))
        if record
        else fallback_identity(pdf_path, library_root)
    )
    product_url = str(record.get("product_url")) if record and record.get("product_url") else None
    image_url: str | None = None
    source_kind = "existing-sidecar"
    source_error: str | None = None
    if force or not cover_path.exists():
        override = COVER_OVERRIDES.get(str(record.get("id"))) if record else None
        if override:
            try:
                product_url = str(override["source_page"])
                image_url = str(override["image_url"])
                raw, image_url = request_bytes(image_url)
                image = normalize_image(raw, allow_small=bool(override.get("allow_small")))
                width, height, size, digest = save_jpeg(image, cover_path)
                source_kind = str(override["source_kind"])
                return CoverResult(
                    str(pdf_path), str(cover_path), title, author, source_kind,
                    product_url, image_url, width, height, size, digest,
                )
            except Exception as exc:
                source_error = f"Override failed: {exc}"
        if product_url:
            try:
                image_url = product_image_url(product_url)
                raw, image_url = request_bytes(image_url)
                image = normalize_image(raw)
                width, height, size, digest = save_jpeg(image, cover_path)
                source_kind = "official-product-art"
                return CoverResult(
                    str(pdf_path), str(cover_path), title, author, source_kind,
                    product_url, image_url, width, height, size, digest,
                )
            except Exception as exc:  # Fallback is intentional and recorded.
                detail = str(exc)
                source_error = f"{source_error}; {detail}" if source_error else detail
        width, height, size, digest = render_pdf_cover(pdf_path, cover_path, pdftoppm)
        source_kind = "pdf-first-page-fallback"
    else:
        with Image.open(cover_path) as existing:
            width, height = existing.size
        raw = cover_path.read_bytes()
        size = len(raw)
        digest = hashlib.sha256(raw).hexdigest()
    return CoverResult(
        str(pdf_path), str(cover_path), title, author, source_kind,
        product_url, image_url, width, height, size, digest, source_error,
    )


def jellyfin_request(
    base_url: str,
    token: str,
    method: str,
    path: str,
    parameters: dict[str, str] | None = None,
) -> Any:
    url = base_url.rstrip("/") + path
    if parameters:
        url += "?" + urllib.parse.urlencode(parameters)
    request = urllib.request.Request(url, method=method, headers={"X-Emby-Token": token})
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read()
        return json.loads(raw) if raw else None


def refresh_and_verify_jellyfin(
    base_url: str,
    database_path: Path,
    library_name: str,
    expected_paths: set[str],
) -> dict[str, Any]:
    connection = sqlite3.connect(f"file:{database_path.resolve().as_posix()}?mode=ro", uri=True)
    try:
        row = connection.execute(
            "SELECT AccessToken FROM Devices WHERE AccessToken IS NOT NULL "
            "ORDER BY DateLastActivity DESC LIMIT 1"
        ).fetchone()
    finally:
        connection.close()
    if row is None:
        raise RuntimeError("No existing Jellyfin device token is available")
    token = str(row[0])
    jellyfin_request(base_url, token, "POST", "/Library/Refresh")
    time.sleep(2)
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        tasks = jellyfin_request(base_url, token, "GET", "/ScheduledTasks")
        scan = next((task for task in tasks if task.get("Name") == "Scan Media Library"), None)
        if scan is None or scan.get("State") == "Idle":
            break
        time.sleep(1)
    folders = jellyfin_request(base_url, token, "GET", "/Library/VirtualFolders")
    folder = next((item for item in folders if item.get("Name") == library_name), None)
    if folder is None:
        raise RuntimeError(f"Jellyfin library not found: {library_name}")
    payload = jellyfin_request(
        base_url,
        token,
        "GET",
        "/Items",
        {
            "ParentId": str(folder["ItemId"]),
            "Recursive": "true",
            "IncludeItemTypes": "Book",
            "Limit": "500",
            "Fields": "Path",
        },
    )
    books = payload.get("Items", [])
    indexed = {str(Path(item["Path"]).resolve()).casefold(): item for item in books if item.get("Path")}
    missing_books = sorted(expected_paths - set(indexed))
    missing_images = sorted(
        path for path in expected_paths if path in indexed and not indexed[path].get("ImageTags", {}).get("Primary")
    )
    return {
        "library": library_name,
        "indexed_books": len(indexed),
        "expected_books": len(expected_paths),
        "missing_books": missing_books,
        "books_with_primary_image": len(expected_paths) - len(missing_images),
        "missing_primary_images": missing_images,
    }


def main() -> int:
    args = parse_args()
    library_root = args.library.resolve()
    if not library_root.is_dir():
        raise FileNotFoundError(library_root)
    if not args.catalog.exists():
        raise FileNotFoundError(args.catalog)
    if args.workers < 1 or args.workers > 12:
        raise ValueError("--workers must be between 1 and 12")
    pdftoppm = find_pdftoppm()
    records = catalog_books(args.catalog)
    pdf_paths = sorted(library_root.rglob("*.pdf"), key=lambda path: str(path).casefold())
    results: list[CoverResult] = []
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {
            executor.submit(
                build_one_cover,
                pdf_path,
                library_root,
                records.get(str(pdf_path.resolve()).casefold()),
                pdftoppm,
                args.force,
            ): pdf_path
            for pdf_path in pdf_paths
        }
        for future in as_completed(futures):
            pdf_path = futures[future]
            try:
                result = future.result()
            except Exception as exc:
                raise RuntimeError(f"Cover build failed for {pdf_path}: {exc}") from exc
            results.append(result)
            print(f"[{len(results):03d}/{len(pdf_paths):03d}] {result.source_kind}: {result.title}")
    results.sort(key=lambda result: result.pdf_path.casefold())
    expected_paths = {result.pdf_path.casefold() for result in results}
    jellyfin = None
    if not args.skip_jellyfin:
        jellyfin = refresh_and_verify_jellyfin(
            args.jellyfin_url,
            args.jellyfin_db,
            args.jellyfin_library,
            expected_paths,
        )
    counts: dict[str, int] = {}
    for result in results:
        counts[result.source_kind] = counts.get(result.source_kind, 0) + 1
    report = {
        "schema_version": 1,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "library_root": str(library_root),
        "pdf_count": len(pdf_paths),
        "cover_count": len(results),
        "source_counts": counts,
        "all_covers_valid": all(result.width >= 180 and result.height >= 240 for result in results),
        "jellyfin": jellyfin,
        "covers": [asdict(result) for result in results],
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    temporary_report = args.report.with_name(args.report.name + ".tmp")
    temporary_report.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(temporary_report, args.report)
    print(json.dumps({key: value for key, value in report.items() if key != "covers"}, indent=2))
    if jellyfin and (jellyfin["missing_books"] or jellyfin["missing_primary_images"]):
        return 1
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())

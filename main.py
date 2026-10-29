import json
import os
import re
import shutil
import time
from pathlib import Path

# Decky sets this for each plugin. The fallback lets the module run outside Decky for tests.
DATA_DIR = Path(
    os.environ.get("DECKY_PLUGIN_RUNTIME_DIR")
    or Path.home() / ".local/share/deckfaqs-offline"
)
GUIDES_DIR = DATA_DIR / "guides"

GUIDE_ID_RE = re.compile(r"^\d{1,12}$")
REL_PATH_RE = re.compile(r"^(pages|images)/[A-Za-z0-9_.-]{1,200}$")
# Responses travel over a websocket with a 4 MB message limit
MAX_READ = 256 * 1024  # characters; up to 4 bytes each in UTF-8


def _guide_dir(guide_id: str, partial: bool = False) -> Path:
    if not GUIDE_ID_RE.match(str(guide_id)):
        raise ValueError(f"invalid guide id: {guide_id!r}")
    return GUIDES_DIR / (f"{guide_id}.part" if partial else str(guide_id))


def _file(guide_id: str, rel_path: str, partial: bool) -> Path:
    if not REL_PATH_RE.match(rel_path) or ".." in rel_path:
        raise ValueError(f"invalid path: {rel_path!r}")
    return _guide_dir(guide_id, partial) / rel_path


def _read_meta(guide_dir: Path):
    try:
        with open(guide_dir / "meta.json", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _dir_size(path: Path) -> int:
    return sum(p.stat().st_size for p in path.rglob("*") if p.is_file())


def begin_guide(guide_id: str) -> bool:
    part = _guide_dir(guide_id, partial=True)
    shutil.rmtree(part, ignore_errors=True)
    (part / "pages").mkdir(parents=True)
    (part / "images").mkdir()
    return True


def write_file(guide_id: str, rel_path: str, data: str, append: bool) -> int:
    path = _file(guide_id, rel_path, partial=True)
    with open(path, "a" if append else "w", encoding="utf-8") as f:
        f.write(data)
    return len(data)


def finish_guide(guide_id: str, meta: dict) -> dict:
    part = _guide_dir(guide_id, partial=True)
    final = _guide_dir(guide_id)
    meta = dict(meta, id=str(guide_id), savedAt=int(time.time()))
    meta["size"] = _dir_size(part)
    with open(part / "meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False)
    shutil.rmtree(final, ignore_errors=True)
    part.rename(final)
    return meta


def abort_guide(guide_id: str) -> bool:
    shutil.rmtree(_guide_dir(guide_id, partial=True), ignore_errors=True)
    return True


def delete_guide(guide_id: str) -> bool:
    shutil.rmtree(_guide_dir(guide_id), ignore_errors=True)
    return True


def list_guides() -> list:
    if not GUIDES_DIR.is_dir():
        return []
    guides = []
    for entry in GUIDES_DIR.iterdir():
        if entry.is_dir() and GUIDE_ID_RE.match(entry.name):
            meta = _read_meta(entry)
            if meta:
                # The viewer loads the TOC and image map with get_meta when it opens a guide
                guides.append(
                    {k: v for k, v in meta.items() if k not in ("toc", "images", "pages")}
                )
    return sorted(guides, key=lambda g: (g.get("game", ""), g.get("title", "")))


def get_meta(guide_id: str):
    return _read_meta(_guide_dir(guide_id))


def read_file(guide_id: str, rel_path: str, offset: int = 0) -> dict:
    path = _file(guide_id, rel_path, partial=False)
    with open(path, encoding="utf-8") as f:
        text = f.read()
    end = offset + MAX_READ
    # The caller sends back "next" as is, because JS and Python count string length differently
    return {"data": text[offset:end], "next": end, "eof": end >= len(text)}


class Plugin:
    async def begin_guide(self, guide_id):
        return begin_guide(guide_id)

    async def write_file(self, guide_id, rel_path, data, append=False):
        return write_file(guide_id, rel_path, data, append)

    async def finish_guide(self, guide_id, meta):
        return finish_guide(guide_id, meta)

    async def abort_guide(self, guide_id):
        return abort_guide(guide_id)

    async def delete_guide(self, guide_id):
        return delete_guide(guide_id)

    async def list_guides(self):
        return list_guides()

    async def get_meta(self, guide_id):
        return get_meta(guide_id)

    async def read_file(self, guide_id, rel_path, offset=0):
        return read_file(guide_id, rel_path, offset)

    async def _main(self):
        GUIDES_DIR.mkdir(parents=True, exist_ok=True)
        # Remove downloads that a restart or crash interrupted
        for part in GUIDES_DIR.glob("*.part"):
            shutil.rmtree(part, ignore_errors=True)

    async def _unload(self):
        pass

#!/usr/bin/env python3
"""쿠키런HUB 보물 도감에서 보물 목록을 받아 data/treasures.js 와 images/treasures/ 를 갱신합니다.

사용법 (저장소 맨 위 폴더에서):
    python3 tools/update_data.py              # 데이터 + 새 이미지 받기
    python3 tools/update_data.py --no-images  # 데이터만 (새 보물 그림은 쿠키런HUB 주소로 표시)

- 새로 생긴 · 빠진 · 정보가 바뀐 보물을 보여 주고, 바뀐 게 없으면 파일을 건드리지 않아요.
- 이미 받은 이미지는 다시 받지 않고, 더 이상 안 쓰는 이미지는 지워요.
- GitHub Actions(.github/workflows/update-data.yml)가 매일 이 스크립트를 자동으로 돌려요.
- 표준 라이브러리만 써요 (파이썬 3.9 이상).
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import datetime as dt
import json
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# ── 설정 ──────────────────────────────────────────────────────────────
# 달리기(인게임)에 효과가 없는 보물을 뺍니다:
#   출석 보상(출석 시 크리스탈·코인·부스트 등) · 추출 시 마법가루 · 코인으로 판매 · 경험치 물약 · 능력 정보 없음
EXCLUDE_NON_INGAME = True
# 한국어 능력 설명이 없는 보물(영어 이름만 있는 중복 항목 등)도 뺍니다.
# 쿠키런HUB에 한국어 설명이 생기면 다음 갱신 때 자동으로 다시 들어와요.
EXCLUDE_NO_KOREAN = True
# 코인·경험치 보너스만 있는 보물(예: "코인 5% 보너스")까지 빼려면 True
EXCLUDE_BONUS_ONLY = False
# 종류째 빼고 싶을 때. 쿠키런HUB category 값: cookie · pet · gacha · limited · squirrel
# 예: EXCLUDE_CATEGORIES = {"limited"}
EXCLUDE_CATEGORIES: set[str] = set()
# 특정 보물만 빼고 싶을 때(EXCLUDE_IDS), 위 규칙에 걸려도 남기고 싶을 때(KEEP_IDS) id 를 적어요.
# id 는 data/treasures.js 에서 보물 이름으로 찾으면 줄 맨 앞에 있어요. 예: EXCLUDE_IDS = {101, 202}
EXCLUDE_IDS: set[int] = set()
KEEP_IDS: set[int] = set()
# ─────────────────────────────────────────────────────────────────────

SITE = "https://www.cookierunhub.com"
API = f"{SITE}/api/v1/game-data/treasures"
UA = "Mozilla/5.0 (compatible; treasure-roll-updater/1.0)"

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "data" / "treasures.js"
IMG_DIR = ROOT / "images" / "treasures"
UI_DIR = ROOT / "images" / "ui"

GRADES = ("S", "A", "B", "C")
SAFE_NAME = re.compile(r"[A-Za-z0-9._-]+")
KST = dt.timezone(dt.timedelta(hours=9))

# 능력 설명을 효과 하나하나로 나눠서 셋 중 하나로 봐요.
#   out   = 달리기 밖 효과 (출석 보상 · 추출 · 판매 · 경험치 물약)
#   bonus = 코인·경험치 보너스
#   game  = 그 밖의 달리기 효과 (점수 · 체력 · 부활 · 자석 …)
OUT_KO = re.compile(r"출석|로그인|접속\s*시|추출\s*시|판매\s*가능")
OUT_EN = re.compile(r"\blog-?in\b|attendance|check-?in|extraction|selling price|^use to gain", re.I)
BONUS_KO = re.compile(
    r"^(?:스페셜 에피소드[\d,\s]*에서\s*)?(?:코인/경험치|코인|경험치)\s*\+?\s*[\d.,]+%?(?:\s*~\s*[\d.,]+%?)?\s*(?:보너스|추가)?$"
    r"|^게임\s*종료\s*시"
)
BONUS_EN = re.compile(r"^with upgrades,?\s*\+?[\d.,]+%?\s*-\s*[\d.,]+%?\s*(?:coins|xp)$", re.I)
# "경험치 5% 보너스 코인 5% 보너스" 처럼 한 줄에 붙은 효과 나누기
SPLIT_KO = re.compile(r"(?<!에서)\s+(?=코인|경험치|스페셜 에피소드|게임\s*종료)")
SPLIT_EN = re.compile(r"\s+(?=with upgrades)", re.I)

FIELD_NAMES = {"name": "이름", "grade": "등급", "cat": "종류", "evo": "진화", "img": "그림", "src": "그림", "ability": "능력"}


class NotFound(Exception):
    pass


# ── 받기 ──────────────────────────────────────────────────────────────
def fetch(url: str, *, accept: str = "*/*", tries: int = 3) -> tuple[bytes, str]:
    url = urllib.parse.quote(url, safe=":/?&=%")  # 한글 파일 이름 대비
    last: Exception | None = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
            with urllib.request.urlopen(req, timeout=30) as res:
                return res.read(), res.headers.get("Content-Type", "")
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                raise NotFound(url) from exc
            last = exc
        except (urllib.error.URLError, TimeoutError) as exc:
            last = exc
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"{url} 받기 실패: {last}")


# ── 보물 목록 만들기 ──────────────────────────────────────────────────
def clean_ability(text: str | None) -> str:
    if not text:
        return ""
    lines = [ln.strip() for ln in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    out: list[str] = []
    for ln in lines:
        if ln or (out and out[-1]):
            out.append(ln)
    return "\n".join(out).strip()


def effect_kinds(text: str | None, lang: str) -> set[str]:
    """능력 설명에 들어 있는 효과 종류 (out / bonus / game)."""
    out_rx, bonus_rx, split_rx = (OUT_KO, BONUS_KO, SPLIT_KO) if lang == "ko" else (OUT_EN, BONUS_EN, SPLIT_EN)
    kinds: set[str] = set()
    for line in re.split(r"[\n•]", text or ""):
        line = line.strip(" -")
        if not line:
            continue
        if out_rx.search(line):
            kinds.add("out")
            continue
        for piece in split_rx.split(line):
            if piece.strip():
                kinds.add("bonus" if bonus_rx.search(piece.strip()) else "game")
    return kinds


def no_ingame_reason(t: dict) -> str | None:
    """달리기에 효과가 없는 보물이면 그 이유 (달리기 효과가 하나라도 있으면 남겨요)."""
    ko, en = effect_kinds(t.get("ability"), "ko"), effect_kinds(t.get("ability_en"), "en")
    if not ko and not en:
        return "능력 정보 없음"
    if (ko and ko <= {"out"}) or (en and en <= {"out"}):
        return "인게임 효과 없음 (출석 보상 · 추출 · 판매 · 경험치 물약)"
    if EXCLUDE_BONUS_ONLY and "game" not in (ko or en):  # 한국어 설명 기준 (없으면 영어)
        return "코인·경험치 보너스만 있음"
    return None


def excluded_reason(t: dict) -> str | None:
    if t["id"] in KEEP_IDS:
        return None
    if t["id"] in EXCLUDE_IDS:
        return "직접 뺀 보물"
    if (t.get("category") or "") in EXCLUDE_CATEGORIES:
        return f"종류 {t.get('category')}"
    if EXCLUDE_NON_INGAME and (reason := no_ingame_reason(t)):
        return reason
    if EXCLUDE_NO_KOREAN and not (t.get("ability") or "").strip():
        return "한국어 능력 설명 없음"
    return None


def image_paths(path: str | None) -> tuple[str, str]:
    """(원격 경로, 로컬 파일 이름) — 원격 경로는 SITE 기준 상대 경로."""
    if not path:
        return "", ""
    p = path.strip()
    if p.startswith("treasures/"):
        remote = f"images/{p}"
    elif p.startswith("/"):
        remote = p.lstrip("/")
    elif p.startswith("images/") or p.startswith("uploads/"):
        remote = p
    else:
        return "", ""
    return remote, remote.rsplit("/", 1)[-1]


def build(raw: list[dict]) -> tuple[list[dict], dict[str, int]]:
    items: list[dict] = []
    excluded: dict[str, int] = {}
    used_names: dict[str, str] = {}
    for t in sorted((t for t in raw if isinstance(t, dict) and isinstance(t.get("id"), int)), key=lambda x: x["id"]):
        reason = excluded_reason(t)
        if reason:
            excluded[reason] = excluded.get(reason, 0) + 1
            continue
        grade = (t.get("grade") or "").upper()
        if grade not in GRADES:
            print(f"  ! 알 수 없는 등급이라 건너뜀: {t['id']} {t.get('name')} ({grade})", file=sys.stderr)
            continue
        remote, local = image_paths(t.get("image_path"))
        if local:
            if not SAFE_NAME.fullmatch(local):  # 한글·공백 등은 id 로 저장
                local = f"{t['id']}{pathlib.PurePosixPath(local).suffix.lower() or '.png'}"
            if used_names.get(local, remote) != remote:  # 파일 이름 충돌 방지
                local = f"{t['id']}_{local}"
            used_names[local] = remote
        items.append({
            "id": t["id"],
            "name": (t.get("name") or t.get("english_name") or "").strip(),
            "grade": grade,
            "cat": t.get("category") or "",
            "evo": t.get("evolved_from_id"),  # null 이면 미진화, 숫자면 진화 (진화 전 보물 id)
            "img": local,
            "src": remote,
            # 한국어 설명이 없으면 영어 설명이라도
            "ability": clean_ability(t.get("ability")) or clean_ability(t.get("ability_en")),
        })
    return items, excluded


# ── 이미지 ────────────────────────────────────────────────────────────
def download_images(items: list[dict]) -> tuple[set[int], int]:
    """새 이미지를 받고 (원본 사이트에도 없는 보물 id, 받은 개수) 를 돌려줍니다."""
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    todo = [it for it in items if it["img"] and not (IMG_DIR / it["img"]).exists()]
    if todo:
        print(f"이미지: {len(todo)}개 새로 받는 중…")
    missing: set[int] = set()

    def one(it: dict) -> str | None:
        try:
            body, ctype = fetch(f"{SITE}/{it['src']}", accept="image/*")
            if not ctype.startswith("image/") or not body:
                return f"{it['name']}: 이미지가 아님 ({ctype})"
            tmp = IMG_DIR / (it["img"] + ".part")
            tmp.write_bytes(body)
            os.replace(tmp, IMG_DIR / it["img"])
            return None
        except NotFound:
            missing.add(it["id"])
            return None
        except Exception as exc:  # noqa: BLE001
            return f"{it['name']}: {exc}"

    failed = 0
    with cf.ThreadPoolExecutor(max_workers=4) as pool:
        for i, err in enumerate(pool.map(one, todo), 1):
            if err:
                failed += 1
                print("  !", err, file=sys.stderr)
            if i % 100 == 0:
                print(f"  {i}/{len(todo)}")
    if missing:
        print(f"  {len(missing)}개는 쿠키런HUB에도 그림이 없어서 '?' 로 표시돼요.")
    if failed:
        print(f"  {failed}개 실패 — 페이지에서는 쿠키런HUB 주소로 대신 표시돼요.", file=sys.stderr)
    return missing, len(todo) - len(missing) - failed


def prune_images(items: list[dict]) -> int:
    """목록에 없는 보물의 이미지를 지웁니다."""
    if not IMG_DIR.exists():
        return 0
    keep = {it["img"] for it in items if it["img"]}
    old = [p for p in IMG_DIR.iterdir() if p.is_file() and p.name not in keep]
    for p in old:
        p.unlink()
    if old:
        print(f"이미지: 안 쓰는 {len(old)}개 지움")
    return len(old)


def download_ui() -> None:
    """등급 배지(S/A/B/C) 이미지."""
    UI_DIR.mkdir(parents=True, exist_ok=True)
    for g in GRADES:
        dest = UI_DIR / f"grade-{g.lower()}.png"
        if dest.exists():
            continue
        body, ctype = fetch(f"{SITE}/images/ui/grade/{g.lower()}.png", accept="image/*")
        if ctype.startswith("image/"):
            dest.write_bytes(body)


# ── 데이터 파일 ───────────────────────────────────────────────────────
def load_previous() -> list[dict]:
    """지금 data/treasures.js 에 들어 있는 보물 목록 (없으면 빈 목록)."""
    if not DATA_FILE.exists():
        return []
    m = re.search(r"TREASURE_DATA\s*=\s*(\{.*\})\s*;?\s*$", DATA_FILE.read_text(encoding="utf-8"), re.S)
    try:
        return json.loads(m.group(1))["items"] if m else []
    except (ValueError, KeyError, TypeError):
        return []


def write_data(items: list[dict]) -> None:
    """보물 하나가 한 줄 — git 에서 무엇이 바뀌었는지 바로 보여요."""
    meta = {
        "updated": dt.datetime.now(KST).date().isoformat(),
        "source": f"{SITE}/encyclopedia?tab=treasures",
        "imageBase": f"{SITE}/",
    }

    def dump(v: object) -> str:
        return json.dumps(v, ensure_ascii=False, separators=(",", ":"))

    lines = [
        "/* 자동 생성 파일이에요. 직접 고치지 말고 `python3 tools/update_data.py` 로 갱신하세요. */",
        "window.TREASURE_DATA = {",
        *(f'  "{k}": {dump(v)},' for k, v in meta.items()),
        '  "items": [',
        ",\n".join(f"    {dump(it)}" for it in items),
        "  ]",
        "};",
        "",
    ]
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = DATA_FILE.with_name(DATA_FILE.name + ".part")
    tmp.write_text("\n".join(lines), encoding="utf-8")
    os.replace(tmp, DATA_FILE)
    print(f"저장: {DATA_FILE.relative_to(ROOT)} ({DATA_FILE.stat().st_size // 1024} KB)")


# ── 바뀐 점 정리 ──────────────────────────────────────────────────────
def compare(old: list[dict], new: list[dict]) -> tuple[list[dict], list[dict], list[tuple[dict, list[str]]]]:
    o = {it["id"]: it for it in old}
    n = {it["id"]: it for it in new}
    added = [n[i] for i in n if i not in o]
    removed = [o[i] for i in o if i not in n]
    changed = []
    for i in n:
        if i in o and n[i] != o[i]:
            fields = sorted({FIELD_NAMES.get(k, k) for k in n[i].keys() | o[i].keys() if n[i].get(k) != o[i].get(k)})
            changed.append((n[i], fields))
    return added, removed, changed


def report_lines(added: list[dict], removed: list[dict], changed: list[tuple[dict, list[str]]], limit: int = 20) -> list[str]:
    lines: list[str] = []

    def section(title: str, rows: list[str]) -> None:
        if not rows:
            return
        lines.append(f"{title} {len(rows)}개")
        lines.extend(f"  {r}" for r in rows[:limit])
        if len(rows) > limit:
            lines.append(f"  … 외 {len(rows) - limit}개")

    section("새 보물", [f"+ {it['name']} ({it['grade']})" for it in added])
    section("빠진 보물", [f"- {it['name']} ({it['grade']})" for it in removed])
    section("바뀐 보물", [f"~ {it['name']} ({', '.join(f)})" for it, f in changed])
    return lines


def github_output(changed: bool, summary: str, lines: list[str]) -> None:
    """GitHub Actions 에서 돌 때: 다음 단계(커밋)와 실행 요약 화면에 결과 전달."""
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"changed={'true' if changed else 'false'}\n")
            f.write(f"summary={summary}\n")
    step = os.environ.get("GITHUB_STEP_SUMMARY")
    if step:
        with open(step, "a", encoding="utf-8") as f:
            f.write("## 보물 데이터 갱신\n\n")
            f.write("```\n" + "\n".join(lines) + "\n```\n" if lines else "바뀐 보물이 없어요.\n")


# ── 실행 ──────────────────────────────────────────────────────────────
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--no-images", action="store_true", help="이미지는 받지 않고 데이터만 갱신")
    ap.add_argument("--force", action="store_true", help="보물 수가 크게 줄어도 그대로 저장")
    args = ap.parse_args()

    print("쿠키런HUB에서 보물 목록 받는 중…")
    body, _ = fetch(API, accept="application/json")
    raw = json.loads(body)
    if not isinstance(raw, list):
        sys.exit("응답이 보물 목록이 아니에요. 쿠키런HUB API 가 바뀌었을 수 있어요.")
    items, excluded = build(raw)
    if not items:
        sys.exit("보물이 하나도 없어요. 저장하지 않았어요.")

    by_grade = " · ".join(f"{g} {sum(1 for it in items if it['grade'] == g)}" for g in GRADES)
    evolved = sum(1 for it in items if it["evo"] is not None)
    print(f"보물 {len(items)}개 ({by_grade} · 진화 {evolved})")
    for reason, n in excluded.items():
        print(f"  뺀 보물: {reason} {n}개")

    previous = load_previous()
    if previous and len(items) < len(previous) * 0.5 and not args.force:
        sys.exit(
            f"보물이 {len(previous)}개 → {len(items)}개로 너무 많이 줄었어요. 쿠키런HUB 쪽 문제일 수 있어서 저장하지 않았어요.\n"
            "그래도 저장하려면 --force 를 붙여 주세요."
        )

    files_changed = 0
    if args.no_images:
        missing = {it["id"] for it in previous if not it.get("src")}  # 지난번에 원본에도 없던 그림
    else:
        download_ui()
        missing, got = download_images(items)
        files_changed = got
    for it in items:
        if it["id"] in missing:  # 원본에도 없는 그림
            it["img"] = it["src"] = ""
    if not args.no_images:
        files_changed += prune_images(items)
    for it in items:
        if it["img"] and not (IMG_DIR / it["img"]).exists():
            it["img"] = ""  # 로컬 파일이 없으면 쿠키런HUB 주소(src)로 바로 표시

    added, removed, changed = compare(previous, items)
    lines = report_lines(added, removed, changed)
    data_changed = not previous or bool(added or removed or changed)
    parts = [f"{t} {len(x)}개" for t, x in (("새 보물", added), ("빠진 보물", removed), ("바뀐 보물", changed)) if x]
    summary = " · ".join(parts) or ("처음 만듦" if not previous else "이미지 정리" if files_changed else "")

    if data_changed:
        print("\n".join(lines) if lines else "처음 만들었어요.")
        write_data(items)
    else:
        print("바뀐 보물이 없어요. data/treasures.js 는 그대로 둬요.")
    github_output(data_changed or files_changed > 0, summary, lines)
    print("완료!")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Generate static chapter audio from Cloud Shell using the signed-in gcloud user."""

import argparse
import base64
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from zipfile import ZipFile, ZIP_DEFLATED
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
PROJECT = "nihongo-education-tts"
STATE = Path.home() / ".local/state/nihongo-education-tts"
MONTHLY_MAX = 500_000
PILOT_MAX = 10_000
FREE_MAX = 1_000_000
CHAPTERS = {"reference": 10, "accreditation": 6}
ATTEMPTS = 3
BILLING_ZONE = ZoneInfo("America/Los_Angeles")


def run(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.PIPE).strip()


def canonical(data):
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def commit_file(path, data):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as file:
        temporary = Path(file.name)
        file.write(data)
        file.flush()
        os.fsync(file.fileno())
    temporary.replace(path)
    fd = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def mp3_duration(path):
    result = json.loads(run("ffprobe", "-v", "error", "-select_streams", "a:0",
                            "-show_entries", "stream=codec_name:format=duration",
                            "-of", "json", str(path)))
    duration = float(result["format"]["duration"])
    if result["streams"][0]["codec_name"] != "mp3" or not math.isfinite(duration) or duration <= 0:
        raise ValueError("MP3の形式または長さが不正です。")
    run("ffmpeg", "-nostdin", "-v", "error", "-xerror", "-i", str(path), "-f", "null", "-")
    return duration


def timestamp():
    return datetime.now(BILLING_ZONE)


def load_units(course, chapter_number):
    config = json.loads((ROOT / f"audio/{course}-{chapter_number:02}.narration.json").read_text())
    source = (ROOT / course / "chapters.js").read_text().split(" = ", 1)[1].strip()
    chapter = json.loads(source.removesuffix(";"))[chapter_number - 1]
    keys = ("title", "goal", "content") if course == "reference" else ("title", "lead", "html")
    config["title"] = chapter["title"]
    if digest(canonical([chapter[k] for k in keys])) != config["sourceHash"]:
        raise ValueError("教材本文が変更されています。読み上げ原稿と表示位置を照合してください。")
    if (config["course"], config["chapter"], config["voice"], config["audioConfig"]) != (
        course, f"{chapter_number:02}", {"languageCode": "ja-JP", "name": "ja-JP-Chirp3-HD-Aoede"},
        {"audioEncoding": "MP3"},
    ):
        raise ValueError("章IDまたは音声設定が不正です。")
    ids = set()
    for order, unit in enumerate(config["units"], 1):
        if unit["order"] != order or not re.fullmatch(r"[a-z0-9-]+", unit["id"]) or unit["id"] in ids:
            raise ValueError("読み上げ単位のIDまたは順序が不正です。")
        ids.add(unit["id"])
        unit["chapter"] = f"{course}:{chapter_number:02}"
        unit["payload"] = dict(input=dict(text=unit["text"]), voice=config["voice"],
                               audioConfig=config["audioConfig"])
        unit["hash"] = digest(canonical(unit["payload"]))
        unit["chars"] = len(unit["text"])
        if not unit["chars"] or len(unit["text"].encode()) > 5000:
            raise ValueError(f"API入力サイズが不正です: {unit['id']}")
    return config


def save_ledger(path, ledger):
    commit_file(path, canonical(ledger))


def read_ledger(path):
    ledger = json.loads(path.read_text())
    if ledger["project"] != PROJECT or not isinstance(ledger["charges"], list):
        raise ValueError("利用量台帳を確認できません。")
    for entry in ledger["charges"]:
        if (not re.fullmatch(r"\d{4}-\d{2}", entry["month"])
                or type(entry["chars"]) is not int or not 0 < entry["chars"] <= 5000
                or entry["status"] not in {"pending", "ok", "retryable", "uncertain", "reviewed"}):
            raise ValueError("利用量台帳に不明な記録があります。")
    return ledger


def totals(ledger, month):
    return sum(x["chars"] for x in ledger["charges"] if x["month"] == month)


def synthesize(unit, path, ledger_path, ledger, month, existing_usage, initial_reserved):
    for attempt in range(ATTEMPTS):
        if timestamp().strftime("%Y-%m") != month:
            raise RuntimeError("月が切り替わりました。利用量を確認して再実行してください。")
        chars = unit["chars"]
        reserved = totals(ledger, month)
        if (reserved + chars > MONTHLY_MAX
                or existing_usage + reserved - initial_reserved + chars > FREE_MAX
                or (unit["chapter"] == "reference:01" and pilot_total(ledger) + chars > PILOT_MAX)):
            raise RuntimeError("生成上限に達しました。")
        token = run("gcloud", "auth", "print-access-token", "--quiet")
        if not token:
            raise RuntimeError("Cloud Shellの認証を確認できません。")
        entry = dict(month=month, time=timestamp().isoformat(), chars=chars,
                     unit=unit["id"], chapter=unit["chapter"], hash=unit["hash"], status="pending")
        ledger["charges"].append(entry)
        save_ledger(ledger_path, ledger)
        req = Request("https://texttospeech.googleapis.com/v1/text:synthesize",
                      canonical(unit["payload"]),
                      {"Authorization": f"Bearer {token}", "x-goog-user-project": PROJECT,
                       "Content-Type": "application/json"})
        try:
            with urlopen(req, timeout=60) as response:
                data = base64.b64decode(json.load(response)["audioContent"], validate=True)
            with tempfile.TemporaryDirectory(dir=path.parent) as temp:
                audio = Path(temp) / "clip.mp3"
                audio.write_bytes(data)
                mp3_duration(audio)
                commit_file(path, data)
        except HTTPError as error:
            entry.update(status="retryable" if error.code in (429, 503) else "uncertain",
                         error=f"HTTP {error.code}")
            save_ledger(ledger_path, ledger)
            if error.code in (429, 503) and attempt + 1 < ATTEMPTS:
                time.sleep(2 ** (attempt + 1))
                continue
            raise RuntimeError(f"{unit['id']}: HTTP {error.code}。生成を停止しました。") from None
        except Exception as error:
            entry.update(status="uncertain", error=type(error).__name__)
            save_ledger(ledger_path, ledger)
            raise RuntimeError(f"{unit['id']}: 応答またはMP3の検証に失敗しました。") from None
        entry["status"] = "ok"
        save_ledger(ledger_path, ledger)
        return


def pilot_total(ledger):
    # Entries from the original single-chapter script belong to the pilot.
    return sum(x["chars"] for x in ledger["charges"] if x.get("chapter", "reference:01") == "reference:01")


def published_clips(config):
    folder = ROOT / "audio" / config["course"] / config["chapter"]
    path = folder / "manifest.json"
    if not path.exists():
        return {}
    manifest = json.loads(path.read_text())
    if any(manifest[k] != config[k] for k in ("course", "chapter", "voice", "audioConfig")):
        return {}
    return {unit["hash"]: folder / (unit["id"] + ".mp3") for unit in manifest["units"]
            if re.fullmatch(r"[a-z0-9-]+", unit["id"])}


def package(config, clips_by_hash, output):
    course, chapter = config["course"], config["chapter"]
    manifest = {k: config[k] for k in ("course", "chapter", "sourceHash", "voice", "audioConfig")}
    manifest.update(src="chapter.mp3", units=[])
    with tempfile.TemporaryDirectory() as temporary:
        temp = Path(temporary)
        start = 0.0
        clips = []
        for unit in config["units"]:
            filename = f"{unit['id']}.mp3"
            clip = temp / filename
            shutil.copyfile(clips_by_hash[unit["hash"]], clip)
            duration = mp3_duration(clip)
            manifest["units"].append(dict(
                **{k: unit[k] for k in ("id", "section", "order", "label", "targets", "hash")},
                src=filename, start=round(start, 6), end=round(start + duration, 6), duration=duration))
            clips.append(f"file '{filename}'\n")
            start += duration
        playlist = temp / "concat.txt"
        playlist.write_text("".join(clips))
        merged = temp / "chapter.mp3"
        run("ffmpeg", "-nostdin", "-v", "error", "-f", "concat", "-safe", "1",
            "-i", str(playlist), "-c:a", "copy", str(merged))
        manifest["duration"] = mp3_duration(merged)
        if abs(manifest["duration"] - start) > 0.12:
            raise ValueError("連結したMP3の時間と段落の合計時間が一致しません。")
        (temp / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        zip_path = output / f"nihongo-{course}-{chapter}-audio.zip"
        with tempfile.NamedTemporaryFile(dir=zip_path.parent, delete=False) as output:
            staging = Path(output.name)
        try:
            with ZipFile(staging, "w", ZIP_DEFLATED) as archive:
                for file in sorted(temp.iterdir()):
                    if file.name != "concat.txt":
                        archive.write(file, f"audio/{course}/{chapter}/{file.name}")
            staging.replace(zip_path)
        finally:
            staging.unlink(missing_ok=True)
    print(f"ZIP: {zip_path}（Cloud Shellのファイルダウンロードで取得）")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, choices=[PROJECT])
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument("--chapter", action="append", metavar="COURSE:NN")
    selection.add_argument("--all", action="store_true", help="全16章を計画の対象にする")
    parser.add_argument("--check", "--plan", action="store_true", help="APIも認証も使わず計画を表示")
    parser.add_argument("--existing-usage", type=int, help="当月の既存使用量の保守的な上限（他の利用を含む）")
    parser.add_argument("--output", type=Path, default=STATE / "exports", help="リポジトリ外のZIP出力先")
    parser.add_argument("--review-interrupted", action="store_true",
                        help="クラウド側の利用量を確認後、未確定の予約を消さずに再開可能にする")
    args = parser.parse_args()
    choices = [f"{course}:{i:02}" for course, length in CHAPTERS.items() for i in range(1, length + 1)]
    selected = choices if args.all else list(dict.fromkeys(args.chapter or ["reference:01"]))
    if any(key not in choices for key in selected):
        parser.error("章指定は reference:01〜10 または accreditation:01〜06 です。")
    configs = [load_units(course, int(number)) for course, number in (key.split(":") for key in selected)]
    cache = STATE / "mp3"
    ledger_path = STATE / "usage.json"
    month = timestamp().strftime("%Y-%m")
    if args.check:
        if not ledger_path.exists() and cache.exists():
            raise RuntimeError("音声キャッシュに対応する台帳が見つかりません。")
        ledger = read_ledger(ledger_path) if ledger_path.exists() else {"charges": []}
        planned = set()
        for config in configs:
            available = published_clips(config)
            units = config["units"]
            pending_chars = 0
            for unit in units:
                key = unit["hash"]
                if key not in planned and not (cache / f"{key}.mp3").is_file() and not available.get(key, cache).is_file():
                    pending_chars += unit["chars"]
                    planned.add(key)
            print(f"{config['course']}:{config['chapter']} {config['title']} | {len(units)}単位 | "
                  f"原稿{sum(u['chars'] for u in units)}文字 | 新規予定{pending_chars}文字 | "
                  f"最大{pending_chars * ATTEMPTS}文字")
        print(f"台帳当月: {totals(ledger, month):,}文字（送信前確保・再試行を含む）。"
              f" 不明な送信: {sum(x['status'] in {'pending', 'uncertain'} for x in ledger['charges'])}件。")
        return
    for binary in ("gcloud", "ffmpeg", "ffprobe"):
        if not shutil.which(binary):
            raise RuntimeError(f"{binary} が必要です。")
    os.umask(0o077)
    STATE.mkdir(parents=True, exist_ok=True)
    with (STATE / "lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        ledger_path = STATE / "usage.json"
        cache = STATE / "mp3"
        if not ledger_path.exists() and cache.exists():
            raise RuntimeError("利用量台帳がありません。復元するまで停止します。")
        ledger = read_ledger(ledger_path) if ledger_path.exists() else dict(project=PROJECT, charges=[])
        unsettled = [x for x in ledger["charges"] if x["status"] in {"pending", "uncertain"}]
        if args.review_interrupted:
            print(f"未確定: {len(unsettled)}件、{sum(x['chars'] for x in unsettled):,}文字。予約量は保持します。")
            if unsettled and input("Google Cloud側の利用量と原因を確認した場合は REVIEWED を入力: ") == "REVIEWED":
                for entry in unsettled:
                    entry["previousStatus"] = entry["status"]
                    entry["status"] = "reviewed"
                save_ledger(ledger_path, ledger)
            return
        if unsettled:
            raise RuntimeError(f"未確定の送信があります。{ledger_path} と利用量を確認してください。")
        output = args.output.expanduser().resolve()
        if output.is_relative_to(ROOT):
            raise ValueError("ZIPの出力先はチェックアウトの外を指定してください。")
        pending = {}
        available = {}
        for config in configs:
            available.update(published_clips(config))
        for config in configs:
            for unit in config["units"]:
                key = unit["hash"]
                path = cache / f"{key}.mp3"
                if path.is_file():
                    available[key] = path
                if key not in available:
                    pending.setdefault(key, unit)
        for path in available.values():
            mp3_duration(path)
        count = sum(unit["chars"] for unit in pending.values())
        initial_reserved = totals(ledger, month)
        worst = count * ATTEMPTS
        print(f"新規{len(pending)}単位、{count:,}文字、再試行込み最大{worst:,}文字。"
              f"台帳当月: {initial_reserved:,}文字。")
        if pending:
            if args.existing_usage is None or not 0 <= args.existing_usage <= FREE_MAX:
                raise RuntimeError("今月の総利用量の上限を確認し、--existing-usage で指定してください。")
            existing = max(args.existing_usage, initial_reserved)
            pilot = sum(u["chars"] for u in pending.values() if u["chapter"] == "reference:01")
            if (existing + worst > FREE_MAX or initial_reserved + worst > MONTHLY_MAX
                    or pilot_total(ledger) + pilot * ATTEMPTS > PILOT_MAX):
                raise RuntimeError("再試行込みの最大量が無料枠またはスクリプト上限を超えます。")
            if input("他の利用を含め無料枠を確認した場合は GENERATE を入力: ") != "GENERATE":
                print("中止しました。")
                return
            save_ledger(ledger_path, ledger)
            cache.mkdir(exist_ok=True)
            for key, unit in pending.items():
                print(f"生成中: {unit['chapter']} {unit['label']}（{unit['chars']}文字）", flush=True)
                path = cache / f"{key}.mp3"
                synthesize(unit, path, ledger_path, ledger, month, existing, initial_reserved)
                available[key] = path
        output.mkdir(parents=True, exist_ok=True)
        for config in configs:
            package(config, available, output)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, LookupError, EOFError, subprocess.CalledProcessError) as exc:
        print(f"停止: {exc}", file=sys.stderr)
        raise SystemExit(1) from None

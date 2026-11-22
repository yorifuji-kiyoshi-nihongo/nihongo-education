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


def load_units():
    config = json.loads((ROOT / "audio/reference-01.narration.json").read_text())
    source = (ROOT / "reference/chapters.js").read_text().split(" = ", 1)[1].strip()
    chapter = json.loads(source.removesuffix(";"))[0]
    if digest(canonical([chapter[k] for k in ("title", "goal", "content")])) != config["sourceHash"]:
        raise ValueError("教材本文が変更されています。読み上げ原稿と表示位置を照合してください。")
    for unit in config["units"]:
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


def synthesize(unit, path, ledger_path, ledger, month):
    for attempt in range(ATTEMPTS):
        if timestamp().strftime("%Y-%m") != month:
            raise RuntimeError("月が切り替わりました。利用量を確認して再実行してください。")
        chars = unit["chars"]
        if (totals(ledger, month) + chars > MONTHLY_MAX
                or sum(x["chars"] for x in ledger["charges"]) + chars > PILOT_MAX):
            raise RuntimeError("生成上限に達しました。")
        token = run("gcloud", "auth", "print-access-token", "--quiet")
        if not token:
            raise RuntimeError("Cloud Shellの認証を確認できません。")
        entry = dict(month=month, time=timestamp().isoformat(), chars=chars,
                     unit=unit["id"], hash=unit["hash"], status="pending")
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


def package(config, cache):
    folder = ROOT / "audio/reference/01"
    folder.mkdir(parents=True, exist_ok=True)
    manifest = {k: config[k] for k in ("course", "chapter", "sourceHash", "voice", "audioConfig")}
    manifest.update(src="chapter.mp3", units=[])
    with tempfile.TemporaryDirectory(dir=folder.parent) as temporary:
        temp = Path(temporary)
        start = 0.0
        clips = []
        for unit in config["units"]:
            filename = f"{unit['id']}.mp3"
            clip = temp / filename
            shutil.copyfile(cache / f"{unit['hash']}.mp3", clip)
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
        zip_path = Path.home() / "nihongo-reference-01-audio.zip"
        with tempfile.NamedTemporaryFile(dir=zip_path.parent, delete=False) as output:
            staging = Path(output.name)
        try:
            with ZipFile(staging, "w", ZIP_DEFLATED) as archive:
                for file in sorted(temp.iterdir()):
                    if file.name != "concat.txt":
                        archive.write(file, f"audio/reference/01/{file.name}")
                        commit_file(folder / file.name, file.read_bytes())
            staging.replace(zip_path)
        finally:
            staging.unlink(missing_ok=True)
    print(f"ZIP: {zip_path}（Cloud Shellのファイルダウンロードで取得）")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, choices=[PROJECT])
    parser.add_argument("--check", action="store_true", help="原稿検証のみ。APIを呼ばない")
    parser.add_argument("--review-interrupted", action="store_true",
                        help="クラウド側の利用量を確認後、未確定の予約を消さずに再開可能にする")
    args = parser.parse_args()
    config = load_units()
    units = config["units"]
    total = sum(unit["chars"] for unit in units)
    print(f"原稿: {len(units)}単位、合計{total:,}文字。最大{max(len(u['text'].encode()) for u in units):,}バイト/件。")
    if total > PILOT_MAX:
        raise ValueError("第1章の原稿が上限を超えています。")
    if args.check:
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
        pending = []
        for unit in units:
            path = cache / f"{unit['hash']}.mp3"
            if path.exists():
                mp3_duration(path)
            else:
                pending.append((unit, path))
        count = sum(unit["chars"] for unit, _ in pending)
        month = timestamp().strftime("%Y-%m")
        print(f"今回: 新規{len(pending)}単位、{count:,}文字（再試行除く）。"
              f"台帳の今月の予約済み量: {totals(ledger, month):,}文字。"
              f"試験の累計: {sum(x['chars'] for x in ledger['charges']):,}文字。")
        if pending:
            room = min(MONTHLY_MAX - totals(ledger, month),
                       PILOT_MAX - sum(x["chars"] for x in ledger["charges"]))
            if count > room:
                raise RuntimeError("残りの上限では全件を生成できません。")
            print("Google Cloud側の当月利用量を確認し、外部利用を含めて無料枠に"
                  f"最大{min(count * ATTEMPTS, room):,}文字の余裕がある場合だけ実行してください。"
                  "不明な場合は中止してください。")
            if input("利用量を確認して生成を許可する場合は GENERATE を入力: ") != "GENERATE":
                print("中止しました。")
                return
            save_ledger(ledger_path, ledger)
            cache.mkdir(exist_ok=True)
            for unit, path in pending:
                print(f"生成中: {unit['label']}（{unit['chars']}文字）", flush=True)
                synthesize(unit, path, ledger_path, ledger, month)
        package(config, cache)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, LookupError, EOFError, subprocess.CalledProcessError) as exc:
        print(f"停止: {exc}", file=sys.stderr)
        raise SystemExit(1) from None

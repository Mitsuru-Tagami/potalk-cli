#!/usr/bin/env python3
"""Simple BYOE bridge for VOICEVOX Engine and COEIROINK v2.

Run ``ptk-tts.py --setup`` once to discover running engines, choose a voice,
and save the selection. With no options, read text from stdin, synthesize it,
and play the returned WAV so the script can be used with ``ptk --tts``.
Only the Python standard library is required; the engines and SoX are external.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, TextIO

ENGINES = {
    "voicevox": {
        "title": "VOICEVOX",
        "default_url": "http://127.0.0.1:50021",
        "url_env": "VOICEVOX_URL",
        "list_path": "/speakers",
    },
    "coeiroink": {
        "title": "COEIROINK v2",
        "default_url": "http://127.0.0.1:50032",
        "url_env": "COEIROINK_API",
        "list_path": "/v1/speakers",
    },
}


class TtsError(Exception):
    """An actionable error safe to show to the user."""


def default_config_path() -> Path:
    config_home = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return config_home / "ptk" / "tts.json"


def _urlopen(request: urllib.request.Request, timeout: int = 10) -> bytes:
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read(300).decode("utf-8", errors="replace").strip()
        suffix = f": {detail}" if detail else ""
        raise TtsError(f"Engine APIがHTTP {exc.code}を返しました{suffix}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        reason = getattr(exc, "reason", exc)
        raise TtsError(f"Engine APIに接続できません: {reason}") from exc


def _get_json(url: str) -> Any:
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        return json.loads(_urlopen(request).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise TtsError("Engine APIの応答をJSONとして読み取れません") from exc


def _post_json(url: str, payload: Any, timeout: int = 120) -> Any:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Accept": "application/json", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        return json.loads(_urlopen(request, timeout=timeout).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise TtsError("Engine APIの応答をJSONとして読み取れません") from exc


def _post_bytes(url: str, payload: Any, timeout: int = 120) -> bytes:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Accept": "audio/wav", "Content-Type": "application/json"},
        method="POST",
    )
    return _urlopen(request, timeout=timeout)


def fetch_voices(engine: str, base_url: str) -> list[dict[str, Any]]:
    """Return a flat list of available speaker styles for either engine."""
    if engine not in ENGINES:
        raise TtsError(f"未対応のエンジンです: {engine}")
    base_url = base_url.rstrip("/")
    raw = _get_json(f"{base_url}{ENGINES[engine]['list_path']}")
    if not isinstance(raw, list):
        raise TtsError("話者一覧の形式が想定と異なります")

    voices: list[dict[str, Any]] = []
    try:
        for speaker in raw:
            if engine == "voicevox":
                for style in speaker.get("styles", []):
                    voices.append({
                        "engine": engine,
                        "label": f"{speaker['name']} / {style['name']}",
                        "speaker_id": int(style["id"]),
                        "style_id": None,
                    })
            else:
                for style in speaker.get("styles", []):
                    voices.append({
                        "engine": engine,
                        "label": f"{speaker['speakerName']} / {style['styleName']}",
                        "speaker_id": str(speaker["speakerUuid"]),
                        "style_id": int(style["styleId"]),
                    })
    except (KeyError, TypeError, ValueError) as exc:
        raise TtsError("話者一覧に必要な名前またはIDがありません") from exc
    if not voices:
        raise TtsError("利用できる話者・スタイルがありません。音声ライブラリを確認してください")
    return voices


def synthesize(engine: str, base_url: str, voice: dict[str, Any], text: str) -> bytes:
    """Synthesize one text and return WAV bytes."""
    base_url = base_url.rstrip("/")
    if engine == "voicevox":
        speaker_id = int(voice["speaker_id"])
        params = urllib.parse.urlencode({"text": text, "speaker": str(speaker_id)})
        query_url = f"{base_url}/audio_query?{params}"
        query_request = urllib.request.Request(query_url, data=b"", method="POST")
        try:
            query = json.loads(_urlopen(query_request, timeout=120).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise TtsError("VOICEVOXの音声クエリを読み取れません") from exc
        return _post_bytes(
            f"{base_url}/synthesis?{urllib.parse.urlencode({'speaker': str(speaker_id)})}",
            query,
        )
    if engine == "coeiroink":
        payload = {
            "volumeScale": 1.0,
            "pitchScale": 0.0,
            "intonationScale": 1.0,
            "prePhonemeLength": 0.0,
            "postPhonemeLength": 0.0,
            "outputSamplingRate": 44100,
            "sampledIntervalValue": 0,
            "adjustedF0": [],
            "processingAlgorithm": "coeiroink",
            "speakerUuid": str(voice["speaker_id"]),
            "styleId": int(voice["style_id"]),
            "text": text,
            "prosodyDetail": [],
            "speedScale": 1.0,
        }
        return _post_bytes(f"{base_url}/v1/synthesis", payload, timeout=120)
    raise TtsError(f"未対応のエンジンです: {engine}")


def play_wav(wav: bytes) -> None:
    try:
        subprocess.run(
            ["play", "-q", "-t", "wav", "-"],
            input=wav,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
        )
    except FileNotFoundError as exc:
        raise TtsError("音声再生コマンド 'play' がありません。Linux Mintでは sudo apt install sox を実行してください") from exc
    except subprocess.CalledProcessError as exc:
        raise TtsError("音声の再生に失敗しました。SoXと音声出力デバイスを確認してください") from exc


def _load_config(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as file:
            config = json.load(file)
    except FileNotFoundError as exc:
        raise TtsError("まだTTSの設定がありません。最初に --setup を実行してください") from exc
    except (OSError, json.JSONDecodeError) as exc:
        raise TtsError(f"設定ファイルを読み取れません: {path}: {exc}") from exc
    if (not isinstance(config, dict) or config.get("version") != 1
            or config.get("engine") not in ENGINES
            or not isinstance(config.get("base_url"), str)
            or not isinstance(config.get("voice"), dict)):
        raise TtsError(f"設定ファイルの形式が正しくありません: {path}。--setup をやり直してください")
    return config


def _save_config(path: Path, config: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path.parent, 0o700)
    except OSError:
        pass
    fd, temporary_name = tempfile.mkstemp(prefix=".tts-", dir=path.parent, text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            json.dump(config, file, ensure_ascii=False, indent=2)
            file.write("\n")
        os.chmod(temporary_name, 0o600)
        os.replace(temporary_name, path)
    finally:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass


def _read_choice(prompt: str, count: int, stream: TextIO, output: TextIO, default: int = 1) -> int:
    while True:
        print(f"{prompt} [{default}]: ", end="", file=output, flush=True)
        answer = stream.readline()
        if answer == "":
            raise TtsError("入力が終了しました。もう一度 --setup を実行してください")
        answer = answer.strip()
        if not answer:
            return default - 1
        try:
            selected = int(answer)
        except ValueError:
            selected = 0
        if 1 <= selected <= count:
            return selected - 1
        print(f"1〜{count}の番号を入力してください。", file=output)


def setup(config_path: Path, urls: dict[str, str], stream: TextIO | None = None,
          output: TextIO | None = None) -> int:
    stream = stream or sys.stdin
    output = output or sys.stdout
    print("\nTTSセットアップ：起動中のエンジンと使える声を調べます。", file=output)
    available: dict[str, list[dict[str, Any]]] = {}
    for engine, details in ENGINES.items():
        base_url = urls[engine].rstrip("/")
        try:
            voices = fetch_voices(engine, base_url)
        except TtsError as exc:
            print(f"[未接続] {details['title']} ({base_url}) — {exc}", file=output)
        else:
            available[engine] = voices
            print(f"[接続OK] {details['title']}：{len(voices)}種類の声が見つかりました", file=output)
    if not available:
        print("\nVOICEVOXまたはCOEIROINK v2を起動してから、もう一度 --setup を実行してください。", file=output)
        return 1

    engines = list(available)
    print("\n使うエンジンを選んでください。", file=output)
    for index, engine in enumerate(engines, start=1):
        print(f"  {index}. {ENGINES[engine]['title']}", file=output)
    selected_engine = engines[_read_choice("エンジン番号", len(engines), stream, output)]
    voices = available[selected_engine]
    print(f"\n{ENGINES[selected_engine]['title']}の声を選んでください。", file=output)
    for index, voice in enumerate(voices, start=1):
        print(f"  {index}. {voice['label']}", file=output)
    selected_voice = voices[_read_choice("声の番号", len(voices), stream, output)]
    config = {
        "version": 1,
        "engine": selected_engine,
        "base_url": urls[selected_engine].rstrip("/"),
        "voice": selected_voice,
    }
    _save_config(config_path, config)
    print(f"\n設定しました：{ENGINES[selected_engine]['title']} / {selected_voice['label']}", file=output)
    print(f"保存先：{config_path}", file=output)
    print("音が出るか試すときは: ptk-tts --test", file=output)
    return 0


def _list_all(urls: dict[str, str], output: TextIO | None = None) -> int:
    output = output or sys.stdout
    failures = 0
    for engine, details in ENGINES.items():
        base_url = urls[engine].rstrip("/")
        print(f"\n{details['title']} ({base_url})", file=output)
        try:
            voices = fetch_voices(engine, base_url)
        except TtsError as exc:
            print(f"  接続できません：{exc}", file=output)
            failures += 1
            continue
        for index, voice in enumerate(voices, start=1):
            print(f"  {index:>3}. {voice['label']}", file=output)
    return 1 if failures == len(ENGINES) else 0


def run_tts(config: dict[str, Any], text: str) -> None:
    text = text.strip()
    if not text:
        return
    voice = config["voice"]
    wav = synthesize(config["engine"], config["base_url"], voice, text)
    play_wav(wav)


def _api_urls(args: argparse.Namespace) -> dict[str, str]:
    return {
        "voicevox": args.voicevox_url or os.environ.get("VOICEVOX_URL", ENGINES["voicevox"]["default_url"]),
        "coeiroink": args.coeiroink_url or os.environ.get("COEIROINK_API", ENGINES["coeiroink"]["default_url"]),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="VOICEVOX / COEIROINK v2 のかんたん読み上げ（ptk --tts 用）",
        epilog="初回は --setup でエンジンと声を選びます。通常の利用時は標準入力の文章を読み上げます。",
    )
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--setup", action="store_true", help="エンジンと声を選んで設定を保存")
    action.add_argument("--list", action="store_true", help="接続中の両エンジンの話者一覧を表示")
    action.add_argument("--test", action="store_true", help="現在の設定で短いテスト音声を再生")
    parser.add_argument("--config", type=Path, default=default_config_path(), help=argparse.SUPPRESS)
    parser.add_argument("--voicevox-url", help=argparse.SUPPRESS)
    parser.add_argument("--coeiroink-url", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    urls = _api_urls(args)
    try:
        if args.setup:
            return setup(args.config, urls)
        if args.list:
            return _list_all(urls)
        if args.test:
            config = _load_config(args.config)
            run_tts(config, "読み上げテストです。")
            print("テスト音声を再生しました。")
            return 0
        config = _load_config(args.config)
        run_tts(config, sys.stdin.read())
        return 0
    except TtsError as exc:
        print(f"ptk-tts: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

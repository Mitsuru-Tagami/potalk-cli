#!/usr/bin/env python3
"""Read text from stdin, synthesize it with VOICEVOX Engine, and play the WAV."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

API_BASE = os.environ.get("VOICEVOX_URL", "http://127.0.0.1:50021").rstrip("/")


def request_json(path: str, params: dict[str, str] | None = None, payload: bytes | None = None) -> object:
    query = "" if not params else "?" + urllib.parse.urlencode(params)
    headers = {"Accept": "application/json"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(
        f"{API_BASE}{path}{query}",
        data=payload,
        headers=headers,
        method="POST" if payload is not None or path == "/audio_query" else "GET",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def list_speakers() -> None:
    speakers = request_json("/speakers")
    if not isinstance(speakers, list):
        raise ValueError("/speakers の応答がリストではありません")
    for speaker in speakers:
        for style in speaker.get("styles", []):
            print(f"{style['id']:>5}\t{speaker['name']} / {style['name']}")


def synthesize(text: str, speaker_id: int) -> bytes:
    query = request_json("/audio_query", {"text": text, "speaker": str(speaker_id)})
    query_bytes = json.dumps(query, ensure_ascii=False).encode("utf-8")
    url = f"{API_BASE}/synthesis?{urllib.parse.urlencode({'speaker': str(speaker_id)})}"
    request = urllib.request.Request(
        url,
        data=query_bytes,
        headers={"Accept": "audio/wav", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def main() -> int:
    if len(sys.argv) == 2 and sys.argv[1] == "--list":
        list_speakers()
        return 0
    if len(sys.argv) != 1:
        print("usage: ptk-voicevox-tts.py [--list]", file=sys.stderr)
        return 2

    text = sys.stdin.read().strip()
    if not text:
        return 0
    speaker_id = int(os.environ.get("VOICEVOX_SPEAKER", "3"))
    wav = synthesize(text, speaker_id)
    subprocess.run(
        ["play", "-q", "-t", "wav", "-"],
        input=wav,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=True,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (urllib.error.URLError, urllib.error.HTTPError, OSError, ValueError, KeyError, TypeError) as exc:
        print(f"ptk-voicevox: {exc}", file=sys.stderr)
        raise SystemExit(1)

#!/usr/bin/env python3
"""Read one comment from stdin, synthesize it via COEIROINK v2, and play WAV."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

API_BASE = os.environ.get("COEIROINK_API", "http://127.0.0.1:50032").rstrip("/")
# Official COEIROINK example: つくよみちゃん・れいせい.
SPEAKER_UUID = os.environ.get(
    "COEIROINK_UUID", "3c37646f-3881-5374-2a83-149267990abc"
)
STYLE_ID = int(os.environ.get("COEIROINK_STYLE_ID", "0"))


def request_json(url: str, payload: dict | None = None):
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=90) as response:
        return json.loads(response.read().decode("utf-8"))


def list_speakers() -> None:
    speakers = request_json(f"{API_BASE}/v1/speakers")
    for speaker in speakers:
        print(f"{speaker['speakerName']}\tuuid={speaker['speakerUuid']}")
        for style in speaker.get("styles", []):
            print(f"  {style['styleName']}\tstyleId={style['styleId']}")


def synthesize(text: str) -> bytes:
    body = {
        "volumeScale": 1.0,
        "pitchScale": 0.0,
        "intonationScale": 1.0,
        "prePhonemeLength": 0.0,
        "postPhonemeLength": 0.0,
        "outputSamplingRate": 44100,
        "sampledIntervalValue": 0,
        "adjustedF0": [],
        "processingAlgorithm": "coeiroink",
        "speakerUuid": SPEAKER_UUID,
        "styleId": STYLE_ID,
        "text": text,
        "prosodyDetail": [],
        "speedScale": 1.0,
    }
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        f"{API_BASE}/v1/synthesis",
        data=data,
        headers={"Accept": "audio/wav", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=90) as response:
        return response.read()


def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1] == "--list":
        list_speakers()
        return 0

    text = sys.stdin.read().strip()
    if not text:
        return 0

    wav_data = synthesize(text)
    subprocess.run(
        ["play", "-q", "-t", "wav", "-"],
        input=wav_data,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=True,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (urllib.error.URLError, urllib.error.HTTPError, OSError, ValueError, KeyError) as exc:
        print(f"COEIROINK TTS error: {exc}", file=sys.stderr)
        raise SystemExit(1)

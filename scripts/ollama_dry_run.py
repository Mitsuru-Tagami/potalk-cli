#!/usr/bin/env python3
"""Print reply candidates from local Ollama for received-chat JSONL events.

This is an opt-in, foreground dry run: it never joins a room or sends a chat.
"""

from __future__ import annotations

import argparse
import http.client
import ipaddress
import json
import sys
from urllib.parse import urlsplit

DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_MODEL = "llama3.2:latest"
REQUEST_TIMEOUT_SECONDS = 30

PROMPT_PREFIX = """あなたは受信した発言への短い返答候補を提案します。
基本方針：短い自然な日本語で、気持ちを受け止め、頼まれていない助言や説教を避け、人間と装わず、知らないことを知ったふりしない。
返答候補を一つだけ出してください。実際の送信はしません。

受信発言（JSON文字列）：
"""


def parse_loopback_url(value: str) -> tuple[str, int]:
    """Accept only plain HTTP URLs whose literal IP address is loopback."""
    try:
        parsed = urlsplit(value)
        if parsed.hostname is None:
            raise ValueError
        address = ipaddress.ip_address(parsed.hostname)
        port = parsed.port if parsed.port is not None else 11434
    except ValueError as exc:
        raise ValueError("Ollama URLはループバックIPのHTTP URLにしてください") from exc

    if (
        parsed.scheme != "http"
        or not address.is_loopback
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
        or not 1 <= port <= 65535
    ):
        raise ValueError("Ollama URLはループバックIPのHTTP URLにしてください")

    return address.compressed, port


def make_prompt(text: str) -> str:
    """Keep the received text as a single JSON-quoted value in the prompt."""
    return PROMPT_PREFIX + json.dumps(text, ensure_ascii=False)


def generate_candidate(
    text: str,
    *,
    ollama_url: str = DEFAULT_OLLAMA_URL,
    model: str = DEFAULT_MODEL,
    timeout: int = REQUEST_TIMEOUT_SECONDS,
) -> str:
    host, port = parse_loopback_url(ollama_url)
    body = json.dumps(
        {"model": model, "prompt": make_prompt(text), "stream": False},
        ensure_ascii=False,
    ).encode("utf-8")
    connection = http.client.HTTPConnection(host, port, timeout=timeout)
    try:
        connection.request(
            "POST",
            "/api/generate",
            body=body,
            headers={"Content-Type": "application/json"},
        )
        response = connection.getresponse()
        response_body = response.read()
        if not 200 <= response.status < 300:
            detail = response_body[:200].decode("utf-8", errors="replace")
            raise RuntimeError(f"Ollama APIがHTTP {response.status}を返しました: {detail}")
        try:
            result = json.loads(response_body)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise RuntimeError("Ollama APIの応答JSONを読み取れません") from exc
        candidate = result.get("response") if isinstance(result, dict) else None
        if not isinstance(candidate, str) or not candidate.strip():
            raise RuntimeError("Ollama APIの応答に生成文がありません")
        return candidate.strip()
    finally:
        connection.close()


def process_events(
    input_stream,
    output_stream,
    error_stream,
    *,
    ollama_url: str = DEFAULT_OLLAMA_URL,
    model: str = DEFAULT_MODEL,
) -> int:
    """Read JSONL events, print candidates for chat events, and return a status."""
    try:
        parse_loopback_url(ollama_url)
    except ValueError as exc:
        error_stream.write(f"設定エラー: {exc}\n")
        return 2

    had_error = False
    for line_number, line in enumerate(input_stream, start=1):
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError as exc:
            error_stream.write(f"{line_number}行目: JSONLを読み取れません: {exc.msg}\n")
            had_error = True
            continue

        if not isinstance(event, dict):
            error_stream.write(f"{line_number}行目: JSONオブジェクトではありません\n")
            had_error = True
            continue
        if event.get("type") != "chat":
            continue
        if not isinstance(event.get("from"), str) or not isinstance(event.get("text"), str):
            error_stream.write(f"{line_number}行目: chatイベントにはfromとtextの文字列が必要です\n")
            had_error = True
            continue

        try:
            candidate = generate_candidate(event["text"], ollama_url=ollama_url, model=model)
        except (OSError, http.client.HTTPException, RuntimeError, ValueError) as exc:
            error_stream.write(f"{line_number}行目: 候補を生成できませんでした: {exc}\n")
            had_error = True
            continue
        output_stream.write(f"候補: {candidate}\n")
        output_stream.flush()

    return 1 if had_error else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="受信チャットJSONLからローカルOllamaで返答候補を表示するドライラン"
    )
    parser.add_argument(
        "--ollama-url",
        default=DEFAULT_OLLAMA_URL,
        help=f"OllamaのループバックURL (既定: {DEFAULT_OLLAMA_URL})",
    )
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"Ollamaモデル名 (既定: {DEFAULT_MODEL})",
    )
    args = parser.parse_args(argv)
    return process_events(sys.stdin, sys.stdout, sys.stderr, ollama_url=args.ollama_url, model=args.model)


if __name__ == "__main__":
    raise SystemExit(main())

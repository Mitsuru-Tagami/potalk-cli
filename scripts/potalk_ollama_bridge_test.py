#!/usr/bin/env python3
"""Manual-approval test bridge for potalk-cli; no LLM and no automatic replies."""

from __future__ import annotations

import argparse
import json
import shlex
import subprocess
import sys
from typing import Any

TEST_REPLY = "Python仲介テスト返信"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "ptkの受信JSONLを表示し、人が y を入力したときだけ "
            f"固定文「{TEST_REPLY}」を送るテスト用仲介です。"
        )
    )
    parser.add_argument("invite_url", help="テスト部屋の招待URL（&を含む場合もURL全体を引用符で囲む）")
    parser.add_argument(
        "--cli",
        default="ptk",
        help='ptkコマンド。未インストール時は例: --cli "node ptk.mjs"（既定: ptk）',
    )
    return parser.parse_args()


def send_quit(proc: subprocess.Popen[str]) -> None:
    if proc.poll() is not None or proc.stdin is None:
        return
    try:
        proc.stdin.write("/q\n")
        proc.stdin.flush()
        proc.stdin.close()
    except (BrokenPipeError, OSError):
        pass


def main() -> int:
    args = parse_args()
    command = shlex.split(args.cli)
    if not command:
        print("エラー: --cli に実行コマンドを指定してください。", file=sys.stderr)
        return 2

    argv = [*command, "join", args.invite_url, "--events-jsonl"]
    print("手動承認テストです。Ollamaは使わず、自動返信もしません。")
    print(f"受信したチャットごとに確認し、y の場合だけ固定文「{TEST_REPLY}」を送ります。")
    print("終了するには確認待ちで q を入力するか、Ctrl+C を押してください。")
    print("起動コマンド:", shlex.join(argv), file=sys.stderr)

    try:
        proc = subprocess.Popen(
            argv,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            # CLIの人間向け状態表示は端末へそのまま出す。
            stderr=None,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
    except FileNotFoundError:
        print(
            f"エラー: コマンドが見つかりません: {command[0]}。"
            "potalk-cliのディレクトリで実行するか、--cli \"node ptk.mjs\" を指定してください。",
            file=sys.stderr,
        )
        return 127
    except OSError as exc:
        print(f"ptkを起動できません: {exc}", file=sys.stderr)
        return 1

    assert proc.stdout is not None
    assert proc.stdin is not None
    try:
        for raw_line in proc.stdout:
            line = raw_line.strip()
            if not line:
                continue
            try:
                event: Any = json.loads(line)
            except json.JSONDecodeError:
                print(f"JSONLとして読めない行を無視しました: {line}", file=sys.stderr)
                continue
            if not isinstance(event, dict) or event.get("type") != "chat":
                continue
            text = event.get("text")
            if not isinstance(text, str):
                continue
            sender = event.get("from")
            print(f"\n受信 {sender if isinstance(sender, str) else '（名前なし）'}: {text}")
            try:
                choice = input(f"固定テスト文を送る場合だけ y を入力（それ以外は送信しない）: ").strip().lower()
            except EOFError:
                print("入力が閉じられたため終了します。", file=sys.stderr)
                break
            if choice == "q":
                break
            if choice == "y":
                if proc.poll() is None:
                    proc.stdin.write(TEST_REPLY + "\n")
                    proc.stdin.flush()
                    print(f"送信しました: {TEST_REPLY}")
                else:
                    print("ptkが終了しているため送信できません。", file=sys.stderr)
                    break
            else:
                print("今回は送信しませんでした。")
    except KeyboardInterrupt:
        print("\n終了します。")
    finally:
        send_quit(proc)
        if proc.poll() is None:
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.terminate()
                try:
                    proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
        if proc.stdout is not None:
            proc.stdout.close()

    return proc.returncode if proc.returncode is not None else 0


if __name__ == "__main__":
    raise SystemExit(main())

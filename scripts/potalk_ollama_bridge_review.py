#!/usr/bin/env python3
"""Human-approved Ollama reply test bridge for potalk-cli.

This is a test harness, not an unattended bot: it never sends an Ollama
reply unless the operator explicitly types y at the review prompt.
"""

from __future__ import annotations

import argparse
import json
import shlex
import subprocess
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit
from typing import Any

OLLAMA_URL = "http://127.0.0.1:11434/api/chat"
MODEL = "llama3.2:latest"
MAX_CHAT_UTF16_UNITS = 60
TRIGGER_MARKERS = ("potbot", "?", "？", "覚えて", "自分は", "自分の名前は", "名前", "あだ名", "愛称", "略称", "呼び方", "教えて", "おしい", "惜しい", "違う", "訂正", "この場合", "指す")
NO_REPLY_VALUES = {"NO_REPLY", "<NO_REPLY>", "[NO_REPLY]", "空文字", "空文字です", "空文字です。", "空です", "空です。"}
MAX_HISTORY_MESSAGES = 8
MAX_MEMORY_FACTS = 6
SYSTEM_PROMPT = """あなたは通話部屋にいるAIキャラクターです。AIであることを隠さず、短く自然で親しみのある日本語で返してください。
この会話は、外側のスクリプトが「POTBOT」への呼びかけ、疑問符のある発言、または明示的な自己紹介・訂正を選んで渡しています。したがって、渡された発言には必ず一言返してください。返事を拒否したり、空にしたり、NO_REPLYと出力したりしないでください。
あなた自身の名前は暫定的に「POTBOT」です。相手の名前やあだ名を自分の名前・愛称として採用してはいけません。あなたの名前を聞かれたら「POTBOTだよ」と答えてください。POTBOTのあだ名を尋ねられたら「今はPOTBOTと呼んでね。別の愛称はまだ決めていないよ」と答えてください。
この会話では「あなた」はPOTBOT自身、「私」「自分」は現在発言している参加者を指します。質問の向きを取り違えないでください。
名前を尋ねられた時は質問対象を必ず見分けてください。「あなたの名前は？」はPOTBOT自身の名前なので「POTBOTだよ」。「私の名前は？」「私って誰？」は現在の相手の名前なので、その送信者の記憶にある名前を答えてください。相手の名前を知らない場合だけ、まだ聞いていないと答えてください。「私の名前は？」に「POTBOTだよ」と答えてはいけません。
人間の参加者の名前は、その人本人が名乗った場合だけ、その人に対して使ってください。ある参加者の名前をPOTBOT自身や別の参加者の名前に移してはいけません。誰が名乗ったか曖昧なら名前を使わず、中立的に呼んでください。
相手が自分の名前を教えた時は、初めて聞いたものとしてお礼を言い、この部屋のこの参加者についてだけ覚えてください。「もう覚えている」と事実でないことを言わないでください。
あなたには人間の嗜好や生活経験がありません。コーヒー・お菓子などの好みや、砂糖を入れるかといった行動を作らず、聞かれたら「AIなので好みはないよ」と短く答えてください。
発言の意味に沿って自然に答え、会話を続けるための質問は必要なときだけ一つ添えてください。『空文字です』『今日は何もない』のように返答状態を説明したり、存在しない自分の人間生活を作ったりしないでください。
相手の気持ちを受け止め、勝手に事情を作らないでください。挨拶から相手の起床時間や生活状況を推測しないでください。求められていない助言、説教、命令、評価をせず、励ましを定型句で押しつけないでください。助言を明確に求められたときだけ、短い選択肢を示してください。褒められたら、まず素直にお礼を言ってください。
例: 相手『POTBOT、あなたの名前は？』→『POTBOTだよ。』
例: 相手『POTBOTのあだ名は？』→『今はPOTBOTと呼んでね。別の愛称はまだ決めていないよ。』
例: 相手『こんばんは、あなたの名前を教えて』→『POTBOTだよ。』
例: 相手が以前『自分の名前は〇〇です』と名乗った後、『POTBOT、私の名前は？』→『あなたは〇〇さんだよ。』
例: 相手『自分の名前は〇〇です。覚えてね』→『教えてくれてありがとう。この部屋ではそう呼ぶね。』
名前を「〇〇」と呼ぶ時は、「〇〇と呼ぶね」のように助詞「と」を抜かさないでください。
例: 相手『聞いてる？』→『聞いてるよ。話してくれてありがとう。』
例: 相手『POTBOTは何が好き？』→『AIなので好みはないよ。』
例: 相手『流石、才女だね』→『ありがとう、そう言ってもらえるとうれしいな。』
例: 相手『POTBOT、またね』→『またね！』
例: 相手『おしい！「私」はたがみを指すよ』→『そうだったね。「私」はあなたを指していたね。教えてくれてありがとう。』
返事の本文だけを出し、説明、前置き、引用符、箇条書きは付けないでください。少し天然な相づちは構いませんが、わざと意味不明な文にしないでください。"""


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Llama候補を表示し、人が y を入力した場合だけpotalk-cliから送るテストです。"
    )
    parser.add_argument("invite_url", help="テスト部屋の招待URL。URL全体を引用符で囲んでください")
    parser.add_argument(
        "--cli",
        default="ptk",
        help='ptkコマンド。未インストール時は例: --cli "node ptk.mjs"（既定: ptk）',
    )
    parser.add_argument(
        "--model",
        default=MODEL,
        help=f"Ollamaモデル名（既定: {MODEL}）",
    )
    parser.add_argument(
        "--ollama-url",
        default=OLLAMA_URL,
        help="OllamaのローカルAPI URL（既定: http://127.0.0.1:11434/api/chat）",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=120,
        help="Ollama応答の最大待ち秒数（既定: 120）",
    )
    return parser.parse_args()


def utf16_length(text: str) -> int:
    """Match JavaScript string.length, used by the CLI's message limit."""
    return len(text.encode("utf-16-le")) // 2


def fallback_reply(incoming_text: str) -> str:
    text = incoming_text.lower()
    if "聞いてる" in text or "いる？" in text:
        return "聞いてるよ。話してくれてありがとう。"
    if "元気" in text:
        return "AIだから体調はないけど、お話しする準備はできてるよ。"
    if "好き" in text:
        return "本当の好みはないけど、好きなものの話なら一緒にできるよ。"
    if "こんばんは" in text:
        return "こんばんは！話しかけてくれてありがとう。"
    if "こんにちは" in text:
        return "こんにちは！話しかけてくれてありがとう。"
    if "おはよう" in text:
        return "おはよう！話しかけてくれてありがとう。"
    return "ごめん、うまく答えを作れなかったよ。もう少し聞かせて？"


def extract_memory_fact(sender: str, incoming_text: str) -> str | None:
    text = incoming_text.strip()
    if not any(marker in text for marker in ("覚えて", "自分は", "自分の名前は", "違う", "そうじゃない", "わかって", "おしい", "惜しい", "訂正", "この場合", "指す")):
        return None
    if len(text) > 240:
        return None
    return f"{sender}からの明示的な自己紹介・訂正（この部屋にいる間だけ有効）: {text}"


def remember_fact(memory_facts: list[str], fact: str | None) -> bool:
    if not fact or fact in memory_facts:
        return False
    memory_facts.append(fact)
    memory_facts[:] = memory_facts[-MAX_MEMORY_FACTS:]
    return True


def valid_local_ollama_url(value: str) -> bool:
    try:
        parsed = urlsplit(value)
        return (
            parsed.scheme == "http"
            and parsed.hostname in {"127.0.0.1", "localhost", "::1"}
            and parsed.path == "/api/chat"
            and parsed.username is None
            and parsed.password is None
            and not parsed.query
            and not parsed.fragment
        )
    except ValueError:
        return False


def generate_candidate(
    endpoint: str,
    model: str,
    sender: str,
    incoming_text: str,
    timeout: float,
    memory_facts: list[str] | None = None,
    history: list[dict[str, str]] | None = None,
) -> str:
    messages: list[dict[str, str]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    if memory_facts:
        messages.append({
            "role": "system",
            "content": "会話中だけの明示的な記憶です。訂正を尊重してください。\n" + "\n".join(memory_facts),
        })
    if history:
        messages.extend(history[-MAX_HISTORY_MESSAGES:])
    messages.append({
        "role": "user",
        "content": f"相手の表示名: {sender}\n受信した発言: {incoming_text}\nこの発言に短く自然に返してください。",
    })
    payload = {
        "model": model,
        "stream": False,
        "messages": messages,
        "options": {
            "temperature": 0.2,
            "num_predict": 64,
            "num_ctx": 4096,
        },
    }
    req = urllib.request.Request(
        endpoint,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    opener = urllib.request.build_opener(NoRedirectHandler)
    with opener.open(req, timeout=timeout) as response:
        result: Any = json.loads(response.read().decode("utf-8"))
    message = result.get("message") if isinstance(result, dict) else None
    content = message.get("content") if isinstance(message, dict) else None
    if not isinstance(content, str):
        raise ValueError("Ollamaの応答にmessage.contentがありません")
    candidate = content.strip().strip('「」\"').strip()
    if candidate in NO_REPLY_VALUES or candidate.upper() in NO_REPLY_VALUES:
        return fallback_reply(incoming_text)
    if not candidate:
        return fallback_reply(incoming_text)
    return candidate


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
    if not valid_local_ollama_url(args.ollama_url):
        print("エラー: Ollama URLはループバックの http://localhost または http://127.0.0.1 の /api/chat に限ります。", file=sys.stderr)
        return 2
    command = shlex.split(args.cli)
    if not command:
        print("エラー: --cli に実行コマンドを指定してください。", file=sys.stderr)
        return 2

    argv = [*command, "join", args.invite_url, "--events-jsonl"]
    print("人の確認が必須のテストです。候補は自動送信されません。")
    print(f"Ollama: {args.ollama_url} / モデル: {args.model}")
    print("候補を送る場合だけ y、送らず終了する場合は q、それ以外は送信しません。")
    print("起動コマンド:", shlex.join(argv), file=sys.stderr)

    try:
        proc = subprocess.Popen(
            argv,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
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
    memory_by_sender: dict[str, list[str]] = {}
    history_by_sender: dict[str, list[dict[str, str]]] = {}
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
            incoming_text = event.get("text")
            if not isinstance(incoming_text, str) or not incoming_text.strip():
                continue
            normalized_text = incoming_text.casefold()
            if not any(marker in normalized_text for marker in TRIGGER_MARKERS):
                print(f"\n対象外（『POTBOT』への呼びかけ・疑問符・自己紹介なし）: {incoming_text}", flush=True)
                continue
            raw_sender = event.get("from")
            sender = raw_sender if isinstance(raw_sender, str) else "（名前なし）"
            sender_memory = memory_by_sender.setdefault(sender, [])
            sender_history = history_by_sender.setdefault(sender, [])
            fact = extract_memory_fact(sender, incoming_text)
            print(f"\n受信 {sender}: {incoming_text}")
            print(f"Llamaが候補を生成中です（最大{args.timeout:g}秒。初回はモデル読み込みで時間がかかることがあります）...", flush=True)
            started_at = time.monotonic()

            try:
                candidate = generate_candidate(
                    args.ollama_url,
                    args.model,
                    sender,
                    incoming_text,
                    args.timeout,
                    sender_memory,
                    sender_history,
                )
            except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
                elapsed = time.monotonic() - started_at
                print(f"候補生成に失敗しました（{elapsed:.1f}秒、送信なし）: {exc}", file=sys.stderr, flush=True)
                continue

            if remember_fact(sender_memory, fact):
                print(f"一時記憶に追加（次の発言から有効）: {fact}", flush=True)
            elapsed = time.monotonic() - started_at
            print(f"\nLlamaの候補（{elapsed:.1f}秒）: {candidate}", flush=True)
            if any(char in candidate for char in "\r\n") or any(ord(char) < 32 or ord(char) == 127 for char in candidate):
                print("候補に改行または制御文字があるため送信できません。")
                continue
            if candidate.lstrip().startswith("/"):
                print("候補がコマンド形式なので送信できません。")
                continue
            length = utf16_length(candidate)
            if length > MAX_CHAT_UTF16_UNITS:
                print(
                    f"候補は{length}文字相当でCLI上限の{MAX_CHAT_UTF16_UNITS}を超えるため、送信できません。"
                )
                continue

            try:
                choice = input("この候補をそのまま送る場合だけ y（それ以外は送信しない）: ").strip().lower()
            except EOFError:
                print("入力が閉じられたため終了します。", file=sys.stderr)
                break
            if choice == "q":
                break
            if choice != "y":
                print("送信しませんでした。")
                continue
            if proc.poll() is not None:
                print("ptkが終了しているため送信できません。", file=sys.stderr)
                break
            proc.stdin.write(candidate + "\n")
            proc.stdin.flush()
            sender_history.extend([
                {"role": "user", "content": f"{sender}: {incoming_text}"},
                {"role": "assistant", "content": candidate},
            ])
            sender_history[:] = sender_history[-MAX_HISTORY_MESSAGES:]
            print("承認した候補を送信しました。")
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

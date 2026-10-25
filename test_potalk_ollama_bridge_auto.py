#!/usr/bin/env python3
"""Offline simulations for the bridge's post-session automatic review."""

from __future__ import annotations

import contextlib
import io
import json
import os
import queue
import stat
import sys
import tempfile
import threading
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import potalk_ollama_bridge_review_logged as bridge  # noqa: E402


class FakeStdin:
    def __init__(self) -> None:
        self.writes: list[str] = []
        self.write_times: list[float] = []
        self.closed = False

    def write(self, value: str) -> int:
        self.writes.append(value)
        self.write_times.append(time.monotonic())
        return len(value)

    def flush(self) -> None:
        pass

    def close(self) -> None:
        self.closed = True


class FakeProcess:
    def __init__(self) -> None:
        event = {"type": "chat", "from": "Tester", "text": "POTBOT、今日は元気？"}
        self.stdout = io.StringIO(json.dumps(event, ensure_ascii=False) + "\n")
        self.stdin = FakeStdin()
        self.returncode: int | None = None
        self.terminated = False
        self.killed = False

    def poll(self) -> int | None:
        return self.returncode

    def wait(self, timeout: float | None = None) -> int:
        self.returncode = 0
        return 0

    def terminate(self) -> None:
        self.terminated = True
        self.returncode = -15

    def kill(self) -> None:
        self.killed = True
        self.returncode = -9


class QuietStdout:
    """A CLI stream that stays open but emits nothing until the test closes it."""

    def __init__(self) -> None:
        self.lines: queue.Queue[str | None] = queue.Queue()

    def __iter__(self):
        return self

    def __next__(self) -> str:
        line = self.lines.get()
        if line is None:
            raise StopIteration
        return line

    def close(self) -> None:
        self.lines.put(None)


class CliCommandResolutionTests(unittest.TestCase):
    def test_omitted_cli_uses_local_ptk_mjs(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            working_directory = Path(temp_dir)
            (working_directory / "ptk.mjs").write_text("", encoding="utf-8")
            with mock.patch.object(sys, "argv", ["potalk_ollama_bridge_review_logged.py"]):
                cli = bridge.parse_args().cli
            self.assertIsNone(cli)
            self.assertEqual(
                bridge.resolve_cli_command(cli, working_directory),
                ["node", "ptk.mjs"],
            )

    def test_omitted_cli_falls_back_to_path_ptk_without_local_script(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            self.assertEqual(
                bridge.resolve_cli_command(None, Path(temp_dir)),
                ["ptk"],
            )

    def test_explicit_cli_takes_precedence_over_local_ptk_mjs(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            working_directory = Path(temp_dir)
            (working_directory / "ptk.mjs").write_text("", encoding="utf-8")
            self.assertEqual(
                bridge.resolve_cli_command("node custom-ptk.mjs --verbose", working_directory),
                ["node", "custom-ptk.mjs", "--verbose"],
            )


class AutoAnalysisSimulationTests(unittest.TestCase):
    def self_test_args(self) -> tuple[list[str], Path]:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        log_dir = Path(temp_dir.name)
        return [
            "potalk_ollama_bridge_review_logged.py", "--self-test",
            "--log-dir", str(log_dir),
        ], log_dir

    def run_session(
        self,
        choice: str,
        *extra_args: str,
        stdout=None,
        candidate: str = "模擬候補",
        approval_side_effect=None,
        generation_side_effect=None,
        incoming_text: str | None = None,
    ):
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        fake_proc = FakeProcess()
        if incoming_text is not None:
            event = {"type": "chat", "from": "Tester", "text": incoming_text}
            fake_proc.stdout = io.StringIO(json.dumps(event, ensure_ascii=False) + "\n")
        argv = [
            "potalk_ollama_bridge_review_logged.py",
            "--log-dir",
            temp_dir.name,
            *extra_args,
        ]
        if stdout is not None:
            fake_proc.stdout = stdout
        output = io.StringIO()
        with mock.patch.object(sys, "argv", argv), \
             mock.patch.object(bridge.subprocess, "Popen", return_value=fake_proc) as popen, \
             mock.patch.object(bridge, "generate_candidate", return_value=candidate, side_effect=generation_side_effect), \
             mock.patch.object(bridge, "generate_log_analysis", return_value="模擬の改善提案") as analysis:
            with mock.patch.object(bridge, "read_approval", return_value=choice, side_effect=approval_side_effect) as approval, contextlib.redirect_stdout(output):
                return_code = bridge.main()
            popen.assert_called_once()  # 終了理由によらず自動再起動しない
            parsed = bridge.parse_args()
            command = bridge.resolve_cli_command(parsed.cli)
            self.assertEqual(bridge.TEST_ROOM_NAME, "🤖POTBOT 自動返答テスト部屋")
            self.assertEqual(
                popen.call_args.args[0],
                [*command, "create", bridge.TEST_ROOM_NAME, "--events-jsonl"],
            )
            self.assertNotIn("join", popen.call_args.args[0])
        return return_code, fake_proc, analysis, output.getvalue(), Path(temp_dir.name), approval

    def test_default_run_auto_reviews_completed_log_and_keeps_y_gate(self) -> None:
        return_code, proc, analysis, output, log_dir, approval = self.run_session("y")
        self.assertEqual(return_code, 0)
        approval.assert_called_once()
        analysis.assert_called_once()
        self.assertEqual(analysis.call_args.args[3], bridge.DEFAULT_REVIEW_TIMEOUT_SECONDS)
        self.assertIn("模擬の改善提案", output)
        self.assertTrue(any(line == "模擬候補\n" for line in proc.stdin.writes))
        self.assertTrue(any(line == "/q\n" for line in proc.stdin.writes))
        self.assertFalse(proc.terminated)
        logs = list(log_dir.glob("session-*.jsonl"))
        self.assertEqual(len(logs), 1)
        content = logs[0].read_text(encoding="utf-8")
        self.assertIn('"event":"session_end"', content)
        self.assertNotIn("private.example", content)
        self.assertNotIn("do-not-log", content)

    def test_explicit_cli_and_repeated_launches_always_create_fixed_room(self) -> None:
        first = self.run_session("unused", "--cli", "node custom-ptk.mjs", "--no-auto-analyze")
        second = self.run_session("unused", "--cli", "node custom-ptk.mjs", "--no-auto-analyze")
        self.assertEqual(first[0], 0)
        self.assertEqual(second[0], 0)

    def test_non_triggered_messages_are_anonymized_logged_and_included_in_review(self) -> None:
        events = [
            {"type": "chat", "from": "Private Display Name", "text": "システムメッセージがほしいかも。user@example.com 090-1234-5678 https://example.invalid/path"},
            {"type": "chat", "from": "Private Display Name", "text": "POTBOT、今日は元気？"},
        ]
        stdout = io.StringIO("".join(json.dumps(event, ensure_ascii=False) + "\n" for event in events))
        return_code, _proc, analysis, _output, log_dir, approval = self.run_session(
            "y", "--log-all-messages", stdout=stdout
        )
        self.assertEqual(return_code, 0)
        approval.assert_called_once()
        records = [
            json.loads(line)
            for line in next(log_dir.glob("session-*.jsonl")).read_text(encoding="utf-8").splitlines()
        ]
        received = next(record for record in records if record["event"] == "received_message")
        triggered = next(record for record in records if record["event"] == "turn")
        self.assertEqual(received["trigger_reasons"], [])
        self.assertIn("システムメッセージがほしいかも", received["incoming_text"])
        self.assertEqual(received["participant"], triggered["participant"])
        self.assertTrue(received["participant"].startswith("p-"))
        content = json.dumps(records, ensure_ascii=False)
        for private_value in ("Private Display Name", "user@example.com", "090-1234-5678", "example.invalid"):
            self.assertNotIn(private_value, content)
        self.assertIn("[メールアドレス省略]", content)
        self.assertIn("[電話番号省略]", content)
        self.assertIn("[URL省略]", content)
        self.assertEqual(analysis.call_count, 1)
        analyzed_records = analysis.call_args.args[2]
        self.assertEqual([record["event"] for record in analyzed_records], ["received_message", "turn"])
        self.assertIn("システムメッセージがほしいかも", analyzed_records[0]["incoming_text"])

    def test_non_triggered_messages_are_not_logged_without_explicit_flag(self) -> None:
        event = {"type": "chat", "from": "Tester", "text": "システムメッセージがほしいかも。"}
        stdout = io.StringIO(json.dumps(event, ensure_ascii=False) + "\n")
        return_code, _proc, analysis, _output, log_dir, approval = self.run_session(
            "unused", "--no-auto-analyze", stdout=stdout
        )
        self.assertEqual(return_code, 0)
        approval.assert_not_called()
        analysis.assert_not_called()
        records = [
            json.loads(line)
            for line in next(log_dir.glob("session-*.jsonl")).read_text(encoding="utf-8").splitlines()
        ]
        self.assertFalse(any(record["event"] == "received_message" for record in records))

    def test_declining_candidate_still_reviews_but_does_not_send_it(self) -> None:
        _, proc, analysis, output, _, _ = self.run_session("n")
        analysis.assert_called_once()
        self.assertIn("模擬の改善提案", output)
        self.assertNotIn("模擬候補\n", proc.stdin.writes)

    def test_no_auto_analyze_flag_skips_review(self) -> None:
        _, proc, analysis, output, _, _ = self.run_session("n", "--no-auto-analyze")
        analysis.assert_not_called()
        self.assertNotIn("自動壁打ちを開始します", output)
        self.assertNotIn("模擬の改善提案", output)
        self.assertNotIn("模擬候補\n", proc.stdin.writes)

    def test_auto_send_requires_flag_and_does_not_wait_for_y(self) -> None:
        return_code, proc, _analysis, output, log_dir, approval = self.run_session(
            "unused", "--auto-send", "--no-auto-analyze"
        )
        self.assertEqual(return_code, 0)
        approval.assert_not_called()
        self.assertIn("模擬候補\n", proc.stdin.writes)
        self.assertIn("自動送信モード", output)
        self.assertNotIn("この候補をそのまま送る場合だけ y", output)
        logs = list(log_dir.glob("session-*.jsonl"))
        records = [json.loads(line) for line in logs[0].read_text(encoding="utf-8").splitlines()]
        self.assertEqual(records[-2]["decision"], "auto_sent")

    def test_presence_is_silent_without_opt_in_and_leaves_are_never_greeted(self) -> None:
        events = [
            {"type": "presence", "action": "join", "name": "Private Display Name"},
            {"type": "presence", "action": "leave", "name": "Private Display Name", "clean": True},
        ]
        stdout = io.StringIO("".join(json.dumps(event, ensure_ascii=False) + "\n" for event in events))
        return_code, proc, _analysis, output, _log_dir, approval = self.run_session(
            "unused", "--no-auto-analyze", stdout=stdout,
            generation_side_effect=AssertionError("presence must not call Ollama"),
        )
        self.assertEqual(return_code, 0)
        approval.assert_not_called()
        self.assertNotIn("presence", output)
        self.assertFalse(any("いらっしゃい" in line for line in proc.stdin.writes))

    def test_opt_in_join_greeting_requires_y_and_logs_only_anonymous_presence_source(self) -> None:
        name = "🦊Private Display Name"
        events = [
            {"type": "presence", "action": "leave", "name": name, "clean": False},
            {"type": "presence", "action": "join", "name": name},
            {"type": "presence", "action": "join", "name": name},
        ]
        stdout = io.StringIO("".join(json.dumps(event, ensure_ascii=False) + "\n" for event in events))
        return_code, proc, _analysis, output, log_dir, approval = self.run_session(
            "y", "--announce-joins", "--no-auto-analyze", stdout=stdout,
            generation_side_effect=AssertionError("fixed presence greeting must not call Ollama"),
        )
        self.assertEqual(return_code, 0)
        approval.assert_called_once()
        greeting = bridge.presence_greeting(name)
        self.assertEqual(proc.stdin.writes.count(greeting + "\n"), 1)
        self.assertIn("candidate_source: presence", output)
        self.assertIn("Ollama不使用", output)
        records = [
            json.loads(line)
            for line in next(log_dir.glob("session-*.jsonl")).read_text(encoding="utf-8").splitlines()
        ]
        announcements = [record for record in records if record["event"] == "presence_announcement"]
        self.assertEqual([record["decision"] for record in announcements], ["approved", "presence_cooldown"])
        self.assertTrue(all(record["candidate_source"] == "presence" for record in announcements))
        self.assertNotIn(name, json.dumps(records, ensure_ascii=False))

    def test_opt_in_greeting_can_be_declined_without_sending(self) -> None:
        name = "Guest"
        event = {"type": "presence", "action": "join", "name": name}
        stdout = io.StringIO(json.dumps(event, ensure_ascii=False) + "\n")
        return_code, proc, _analysis, _output, log_dir, approval = self.run_session(
            "n", "--announce-joins", "--no-auto-analyze", stdout=stdout,
            generation_side_effect=AssertionError("fixed presence greeting must not call Ollama"),
        )
        self.assertEqual(return_code, 0)
        approval.assert_called_once()
        self.assertNotIn(bridge.presence_greeting(name) + "\n", proc.stdin.writes)
        records = [
            json.loads(line)
            for line in next(log_dir.glob("session-*.jsonl")).read_text(encoding="utf-8").splitlines()
        ]
        announcement = next(record for record in records if record["event"] == "presence_announcement")
        self.assertEqual(announcement["candidate_source"], "presence")
        self.assertEqual(announcement["decision"], "declined")

    def test_auto_send_presence_uses_existing_global_five_second_guard(self) -> None:
        events = [
            {"type": "presence", "action": "join", "name": "Guest"},
            {"type": "chat", "from": "Other", "text": "POTBOT、今日は元気？"},
        ]
        stdout = io.StringIO("".join(json.dumps(event, ensure_ascii=False) + "\n" for event in events))
        return_code, proc, _analysis, output, log_dir, approval = self.run_session(
            "unused", "--announce-joins", "--auto-send", "--no-auto-analyze", stdout=stdout,
            candidate="通常の返信候補",
        )
        self.assertEqual(return_code, 0)
        approval.assert_not_called()
        self.assertIn(bridge.presence_greeting("Guest") + "\n", proc.stdin.writes)
        self.assertNotIn("通常の返信候補\n", proc.stdin.writes)
        self.assertIn("最短送信間隔", output)
        records = [
            json.loads(line)
            for line in next(log_dir.glob("session-*.jsonl")).read_text(encoding="utf-8").splitlines()
        ]
        presence_record = next(record for record in records if record["event"] == "presence_announcement")
        chat_record = next(record for record in records if record["event"] == "turn")
        self.assertEqual(presence_record["candidate_source"], "presence")
        self.assertEqual(presence_record["decision"], "auto_sent")
        self.assertEqual(chat_record["decision"], "auto_rate_limited")

    def test_auto_send_queues_consecutive_join_greetings_in_fifo_order(self) -> None:
        events = [
            {"type": "presence", "action": "join", "name": "First"},
            {"type": "presence", "action": "join", "name": "Second"},
        ]
        stdout = QuietStdout()
        for event in events:
            stdout.lines.put(json.dumps(event, ensure_ascii=False) + "\n")
        close_timer = threading.Timer(0.12, stdout.close)
        close_timer.daemon = True
        close_timer.start()
        try:
            with mock.patch.object(bridge, "AUTO_SEND_MIN_INTERVAL_SECONDS", 0.03):
                return_code, proc, _analysis, _output, log_dir, approval = self.run_session(
                    "unused", "--announce-joins", "--auto-send", "--no-auto-analyze",
                    stdout=stdout,
                    generation_side_effect=AssertionError("fixed presence greeting must not call Ollama"),
                )
        finally:
            close_timer.join(timeout=1)
        self.assertEqual(return_code, 0)
        approval.assert_not_called()
        expected = [bridge.presence_greeting("First") + "\n", bridge.presence_greeting("Second") + "\n"]
        self.assertEqual(proc.stdin.writes[:2], expected)
        self.assertGreaterEqual(proc.stdin.write_times[1] - proc.stdin.write_times[0], 0.029)
        records = [
            json.loads(line)
            for line in next(log_dir.glob("session-*.jsonl")).read_text(encoding="utf-8").splitlines()
        ]
        announcements = [record for record in records if record["event"] == "presence_announcement"]
        self.assertEqual(
            [record["decision"] for record in announcements],
            ["auto_sent", "queued", "auto_sent"],
        )
        self.assertNotIn("First", json.dumps(records, ensure_ascii=False))
        self.assertNotIn("Second", json.dumps(records, ensure_ascii=False))

    def test_pending_greetings_are_discarded_when_cli_exits(self) -> None:
        events = [
            {"type": "presence", "action": "join", "name": "First"},
            {"type": "presence", "action": "join", "name": "Second"},
        ]
        stdout = io.StringIO("".join(json.dumps(event, ensure_ascii=False) + "\n" for event in events))
        return_code, proc, _analysis, output, log_dir, approval = self.run_session(
            "unused", "--announce-joins", "--auto-send", "--no-auto-analyze", stdout=stdout,
        )
        self.assertEqual(return_code, 0)
        approval.assert_not_called()
        self.assertIn(bridge.presence_greeting("First") + "\n", proc.stdin.writes)
        self.assertNotIn(bridge.presence_greeting("Second") + "\n", proc.stdin.writes)
        self.assertIn("未送信の歓迎文を破棄しました", output)
        records = [
            json.loads(line)
            for line in next(log_dir.glob("session-*.jsonl")).read_text(encoding="utf-8").splitlines()
        ]
        announcements = [record for record in records if record["event"] == "presence_announcement"]
        self.assertEqual(
            [record["decision"] for record in announcements],
            ["auto_sent", "queued", "discarded_on_session_end"],
        )

    def test_auto_send_never_sends_empty_no_reply_or_unsafe_candidates(self) -> None:
        rejected = ["", "NO_REPLY", "/q", "/waka", "/haiku", "/seiza", "/uranai", "/dice 20", "改行\n候補", "😀" * 31]
        for candidate in rejected:
            with self.subTest(candidate=candidate):
                return_code, proc, _analysis, _output, log_dir, _approval = self.run_session(
                    "unused", "--auto-send", "--no-auto-analyze", candidate=candidate
                )
                self.assertEqual(return_code, 0)
                if candidate == "/q":
                    self.assertEqual(proc.stdin.writes, ["/q\n"])  # ptk終了用のみ
                else:
                    self.assertNotIn(candidate + "\n", proc.stdin.writes)
                    self.assertEqual(proc.stdin.writes, ["/q\n"])
                logs = list(log_dir.glob("session-*.jsonl"))
                records = [json.loads(line) for line in logs[0].read_text(encoding="utf-8").splitlines()]
                self.assertEqual(records[-2]["decision"], "invalid_candidate")

    def test_only_explicit_supported_command_requests_are_parsed(self) -> None:
        self.assertEqual(bridge.MAX_DICE_SIDES, 1000)
        accepted = {
            "/waka": "/waka",
            "POTBOT、/wakaを実行して": "/waka",
            "POTBOT、/haikuをやって": "/haiku",
            "/seiza": "/seiza",
            "POTBOT、/seizaを実行して": "/seiza",
            "/uranai": "/uranai",
            "POTBOT、/uranaiをやって": "/uranai",
            "/dice": "/dice",
            "POTBOT、/dice 20を振って": "/dice 20",
            "/dice 1000": "/dice 1000",
            "/dice 001": "/dice 1",
        }
        for text, expected in accepted.items():
            with self.subTest(text=text):
                self.assertEqual(bridge.requested_cli_command(text), expected)
        rejected = [
            "/q", "/tag 話題", "/waka extra", "/haiku 2", "/dice 0",
            "/dice 1001", "/dice 2 3", "/dice 999999999999999999999999999999999999999999999999",
            "POTBOT、/wakaの意味は？", "/seiza オリオン座", "/uranai 牡羊座",
            "POTBOT、/seiza オリオン座を実行して", "POTBOT、/uranai 牡羊座をやって",
        ]
        for text in rejected:
            with self.subTest(text=text):
                self.assertIsNone(bridge.requested_cli_command(text))

    def test_supported_commands_are_forwarded_only_for_matching_explicit_requests(self) -> None:
        cases = [
            ("/waka", "/waka"),
            ("POTBOT、/haikuを実行して", "/haiku"),
            ("POTBOT、/seizaを実行して", "/seiza"),
            ("POTBOT、/uranaiをやって", "/uranai"),
            ("POTBOT、/dice 20を振って", "/dice 20"),
        ]
        for incoming_text, expected_command in cases:
            with self.subTest(command=expected_command):
                return_code, proc, _analysis, output, _log_dir, approval = self.run_session(
                    "y", "--no-auto-analyze", incoming_text=incoming_text,
                    candidate="この返答は使われない",
                    generation_side_effect=AssertionError("deterministic command must skip Ollama"),
                )
                self.assertEqual(return_code, 0)
                self.assertIn(expected_command + "\n", proc.stdin.writes)
                self.assertIn("明示された許可コマンド", output)
                self.assertIn("CLIへ渡す候補", output)
                approval.assert_called_once()

    def test_live_search_request_uses_fixed_refusal_without_calling_mocked_model(self) -> None:
        return_code, proc, _analysis, _output, log_dir, approval = self.run_session(
            "y", "--no-auto-analyze",
            incoming_text="POTBOT、Web検索して最新のニュースを教えて",
            candidate="https://fake.example/news",
            generation_side_effect=AssertionError("search refusal must skip Ollama"),
        )
        self.assertEqual(return_code, 0)
        self.assertIn(bridge.OFFLINE_SEARCH_REPLY + "\n", proc.stdin.writes)
        self.assertNotIn("https://fake.example/news\n", proc.stdin.writes)
        approval.assert_called_once()
        records = [
            json.loads(line)
            for line in next(log_dir.glob("session-*.jsonl")).read_text(encoding="utf-8").splitlines()
        ]
        self.assertEqual(records[-2]["candidate_source"], "offline_search")
        self.assertEqual(records[-2]["candidate"], bridge.OFFLINE_SEARCH_REPLY)

    def test_auto_send_executes_only_an_explicitly_requested_supported_command(self) -> None:
        return_code, proc, _analysis, output, log_dir, approval = self.run_session(
            "unused", "--auto-send", "--no-auto-analyze",
            incoming_text="POTBOT、/dice 20を振って",
        )
        self.assertEqual(return_code, 0)
        approval.assert_not_called()
        self.assertIn("/dice 20\n", proc.stdin.writes)
        records = [
            json.loads(line)
            for line in next(log_dir.glob("session-*.jsonl")).read_text(encoding="utf-8").splitlines()
        ]
        self.assertEqual(records[-2]["candidate_source"], "command")
        self.assertEqual(records[-2]["decision"], "auto_sent")
        self.assertIn("明示された許可コマンド", output)

    def test_auto_send_executes_explicit_random_constellation_commands(self) -> None:
        cases = [
            ("POTBOT、/seizaを実行して", "/seiza"),
            ("POTBOT、/uranaiをやって", "/uranai"),
        ]
        for incoming_text, expected_command in cases:
            with self.subTest(command=expected_command):
                return_code, proc, _analysis, _output, log_dir, approval = self.run_session(
                    "unused", "--auto-send", "--no-auto-analyze",
                    incoming_text=incoming_text,
                    generation_side_effect=AssertionError("explicit command must skip Ollama"),
                )
                self.assertEqual(return_code, 0)
                approval.assert_not_called()
                self.assertIn(expected_command + "\n", proc.stdin.writes)
                records = [
                    json.loads(line)
                    for line in next(log_dir.glob("session-*.jsonl")).read_text(encoding="utf-8").splitlines()
                ]
                self.assertEqual(records[-2]["candidate_source"], "command")
                self.assertEqual(records[-2]["decision"], "auto_sent")

    def test_session_deadline_stops_even_when_cli_is_silent(self) -> None:
        return_code, proc, _analysis, output, log_dir, _approval = self.run_session(
            "unused", "--session-timeout", "0.02", "--no-auto-analyze",
            "--announce-tag", stdout=QuietStdout()
        )
        self.assertEqual(return_code, 0)
        self.assertFalse(proc.terminated)  # /tag後に正常退出を試みる
        self.assertTrue(proc.stdin.writes[0].startswith("/tag 検証中・手動承認・終了予定"))
        self.assertEqual(proc.stdin.writes[-2:], ["/tag テスト休止・ログ確認待ち\n", "/q\n"])
        self.assertIn("セッション時間上限に達しました", output)
        logs = list(log_dir.glob("session-*.jsonl"))
        records = [json.loads(line) for line in logs[0].read_text(encoding="utf-8").splitlines()]
        self.assertEqual(records[-1]["event"], "session_end")
        self.assertEqual(records[-1]["end_reason"], "session_timeout")

    def test_session_deadline_while_waiting_for_manual_approval_does_not_send(self) -> None:
        return_code, proc, _analysis, _output, log_dir, approval = self.run_session(
            "y", "--no-auto-analyze", approval_side_effect=bridge.SessionDeadlineExpired
        )
        self.assertEqual(return_code, 0)
        approval.assert_called_once()
        self.assertNotIn("模擬候補\n", proc.stdin.writes)
        logs = list(log_dir.glob("session-*.jsonl"))
        records = [json.loads(line) for line in logs[0].read_text(encoding="utf-8").splitlines()]
        self.assertEqual(records[-1]["end_reason"], "session_timeout")

    def test_keyboard_interrupt_before_eight_hours_stops_without_sending_or_restart(self) -> None:
        return_code, proc, analysis, output, log_dir, _approval = self.run_session(
            "unused", "--auto-send", "--session-timeout", "28800",
            "--announce-tag", "--no-auto-analyze",
            generation_side_effect=KeyboardInterrupt,
        )
        self.assertEqual(return_code, 0)
        self.assertNotIn("模擬候補\n", proc.stdin.writes)
        self.assertEqual(proc.stdin.writes[-2:], ["/tag テスト休止・ログ確認待ち\n", "/q\n"])
        self.assertFalse(proc.terminated)
        analysis.assert_not_called()
        self.assertIn("Ctrl-Cで途中終了できます", output)
        records = [
            json.loads(line)
            for line in next(log_dir.glob("session-*.jsonl")).read_text(encoding="utf-8").splitlines()
        ]
        self.assertEqual(records[-1]["end_reason"], "keyboard_interrupt")

    def test_session_timeout_defaults_to_one_hour_and_allows_eight_hour_maximum(self) -> None:
        with mock.patch.object(sys, "argv", ["potalk_ollama_bridge_review_logged.py"]):
            args = bridge.parse_args()
        self.assertEqual(args.session_timeout, 3600)
        self.assertEqual(bridge.MAX_SESSION_TIMEOUT_SECONDS, 28800)
        self.assertEqual(args.review_timeout, bridge.DEFAULT_REVIEW_TIMEOUT_SECONDS)
        self.assertFalse(args.auto_send)
        self.assertFalse(args.announce_tag)
        self.assertFalse(args.announce_thinking)
        self.assertEqual(args.thinking_delay, bridge.DEFAULT_THINKING_NOTICE_DELAY_SECONDS)
        self.assertEqual(args.thinking_idle, bridge.DEFAULT_THINKING_IDLE_SECONDS)
        valid_code, valid_proc, _analysis, output, _log_dir, _approval = self.run_session(
            "n", "--session-timeout", "28800", "--no-auto-analyze"
        )
        self.assertEqual(valid_code, 0)
        self.assertFalse(valid_proc.terminated)
        self.assertIn("28800秒（最大8時間）", output)
        self.assertIn("終了後に再起動はしません", output)
        for invalid in ("28800.001", "28801", "32400", "0", "-1", "nan", "inf", "-inf"):
            with self.subTest(session_timeout=invalid), mock.patch.object(sys, "argv", [
                "potalk_ollama_bridge_review_logged.py", f"--session-timeout={invalid}"
            ]), mock.patch.object(bridge.subprocess, "Popen") as popen, contextlib.redirect_stderr(io.StringIO()) as error:
                self.assertEqual(bridge.main(), 2)
            popen.assert_not_called()
            self.assertIn("28800秒（8時間）以下", error.getvalue())
        with mock.patch.object(sys, "argv", [
            "potalk_ollama_bridge_review_logged.py", "--review-timeout", "1801"
        ]), mock.patch.object(bridge.subprocess, "Popen") as popen, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(bridge.main(), 2)
        popen.assert_not_called()

    def test_thinking_notice_is_opt_in_and_rearmed_only_after_long_ollama_idle(self) -> None:
        self.assertTrue(bridge.thinking_notice_eligible(True, None, 10.0, 300.0))
        self.assertFalse(bridge.thinking_notice_eligible(False, None, 10.0, 300.0))
        self.assertFalse(bridge.thinking_notice_eligible(True, 10.0, 309.9, 300.0))
        self.assertTrue(bridge.thinking_notice_eligible(True, 10.0, 310.0, 300.0))

    def test_auto_thinking_notice_is_deterministic_and_reply_waits_for_rate_limit(self) -> None:
        self.assertEqual(bridge.THINKING_NOTICE_TEXT, "ちょっと待ってね…")

        def slow_candidate(*_args, **_kwargs):
            time.sleep(0.06)
            return "模擬候補"

        with mock.patch.object(bridge, "AUTO_SEND_MIN_INTERVAL_SECONDS", 0.10):
            return_code, proc, _analysis, output, log_dir, approval = self.run_session(
                "unused", "--auto-send", "--announce-thinking", "--thinking-delay", "0.005",
                "--no-auto-analyze", generation_side_effect=slow_candidate,
            )
        self.assertEqual(return_code, 0)
        approval.assert_not_called()
        self.assertEqual(proc.stdin.writes[:2], ["ちょっと待ってね…\n", "模擬候補\n"])
        self.assertGreaterEqual(proc.stdin.write_times[1] - proc.stdin.write_times[0], 0.099)
        self.assertIn("通知後の最短5秒間隔", output)
        records = [
            json.loads(line)
            for line in next(log_dir.glob("session-*.jsonl")).read_text(encoding="utf-8").splitlines()
        ]
        notice = next(record for record in records if record["event"] == "thinking_announcement")
        turn = next(record for record in records if record["event"] == "turn")
        self.assertEqual(notice["decision"], "auto_sent")
        self.assertEqual(turn["decision"], "auto_sent")
        self.assertTrue(notice["participant"].startswith("p-"))
        self.assertNotIn("Tester", json.dumps(records, ensure_ascii=False))

    def test_auto_thinking_notice_obeys_global_minimum_interval_guard(self) -> None:
        events = [
            {"type": "presence", "action": "join", "name": "Guest"},
            {"type": "chat", "from": "Tester", "text": "POTBOT、今日は元気？"},
        ]
        stdout = io.StringIO("".join(json.dumps(event, ensure_ascii=False) + "\n" for event in events))

        def slow_candidate(*_args, **_kwargs):
            time.sleep(0.08)
            return "模擬候補"

        with mock.patch.object(bridge, "AUTO_SEND_MIN_INTERVAL_SECONDS", 0.04):
            return_code, proc, _analysis, _output, log_dir, _approval = self.run_session(
                "unused", "--auto-send", "--announce-joins", "--announce-thinking",
                "--thinking-delay", "0.005", "--no-auto-analyze", stdout=stdout,
                generation_side_effect=slow_candidate,
            )
        self.assertEqual(return_code, 0)
        self.assertIn(bridge.presence_greeting("Guest") + "\n", proc.stdin.writes)
        self.assertIn("模擬候補\n", proc.stdin.writes)
        self.assertNotIn(bridge.THINKING_NOTICE_TEXT + "\n", proc.stdin.writes)
        records = [
            json.loads(line)
            for line in next(log_dir.glob("session-*.jsonl")).read_text(encoding="utf-8").splitlines()
        ]
        notice = next(record for record in records if record["event"] == "thinking_announcement")
        self.assertEqual(notice["decision"], "auto_rate_limited")

    def test_auto_thinking_notice_obeys_duplicate_guard(self) -> None:
        event = {"type": "chat", "from": "Tester", "text": "POTBOT、今日は元気？"}
        stdout = io.StringIO(json.dumps(event, ensure_ascii=False) + "\n" + json.dumps(event, ensure_ascii=False) + "\n")
        call_count = 0

        def candidates(*_args, **_kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 2:
                time.sleep(0.06)
            return f"候補{call_count}"

        with mock.patch.object(bridge, "thinking_notice_eligible", side_effect=[True, True]), \
             mock.patch.object(bridge, "AUTO_SEND_MIN_INTERVAL_SECONDS", 0.0):
            return_code, proc, _analysis, _output, log_dir, _approval = self.run_session(
                "unused", "--auto-send", "--announce-thinking", "--thinking-delay", "0.005",
                "--no-auto-analyze", stdout=stdout, generation_side_effect=candidates,
            )
        self.assertEqual(return_code, 0)
        self.assertIn("候補1\n", proc.stdin.writes)
        self.assertNotIn("候補2\n", proc.stdin.writes)
        self.assertLessEqual(proc.stdin.writes.count(bridge.THINKING_NOTICE_TEXT + "\n"), 1)
        records = [
            json.loads(line)
            for line in next(log_dir.glob("session-*.jsonl")).read_text(encoding="utf-8").splitlines()
        ]
        notices = [record for record in records if record["event"] == "thinking_announcement"]
        self.assertEqual(len(notices), 2)
        self.assertEqual(notices[1]["decision"], "auto_duplicate")

    def test_fast_generation_never_sends_thinking_notice(self) -> None:
        return_code, proc, _analysis, _output, log_dir, _approval = self.run_session(
            "y", "--announce-thinking", "--thinking-delay", "0.05", "--no-auto-analyze",
        )
        self.assertEqual(return_code, 0)
        self.assertNotIn(bridge.THINKING_NOTICE_TEXT + "\n", proc.stdin.writes)
        records = [
            json.loads(line)
            for line in next(log_dir.glob("session-*.jsonl")).read_text(encoding="utf-8").splitlines()
        ]
        notice = next(record for record in records if record["event"] == "thinking_announcement")
        self.assertEqual(notice["decision"], "generation_finished_before_threshold")

    def test_manual_thinking_notice_fails_closed_and_answer_keeps_its_y_gate(self) -> None:
        def slow_candidate(*_args, **_kwargs):
            time.sleep(0.06)
            return "模擬候補"

        return_code, proc, _analysis, _output, log_dir, approval = self.run_session(
            "y", "--announce-thinking", "--thinking-delay", "0.005", "--no-auto-analyze",
            generation_side_effect=slow_candidate,
        )
        self.assertEqual(return_code, 0)
        approval.assert_called_once()
        self.assertNotIn(bridge.THINKING_NOTICE_TEXT + "\n", proc.stdin.writes)
        self.assertIn("模擬候補\n", proc.stdin.writes)
        records = [
            json.loads(line)
            for line in next(log_dir.glob("session-*.jsonl")).read_text(encoding="utf-8").splitlines()
        ]
        notice = next(record for record in records if record["event"] == "thinking_announcement")
        turn = next(record for record in records if record["event"] == "turn")
        self.assertEqual(notice["decision"], "manual_approval_required_not_sent")
        self.assertEqual(turn["decision"], "approved")

    def test_opt_in_tag_announces_start_pause_and_one_hour_without_waiting(self) -> None:
        proc = FakeProcess()
        start = 1000.0
        duration = 28800.0
        deadline = start + duration
        scheduled_end = datetime(2026, 10, 17, 2, 0, tzinfo=timezone.utc)
        announcer = bridge.SessionTagAnnouncer(
            proc, True, False, start, deadline, scheduled_end
        )
        announcer.start()
        self.assertEqual(len(proc.stdin.writes), 1)
        self.assertTrue(proc.stdin.writes[0].startswith("/tag 検証中・手動承認・終了予定"))
        self.assertLessEqual(len(proc.stdin.writes[0].split(" ", 1)[1].strip()), 30)
        self.assertFalse(announcer.maybe_announce_one_hour(start + duration - 3601))
        self.assertEqual(len(proc.stdin.writes), 1)
        # Synthetic monotonic clock: jump to exactly one hour remaining; no sleep or real session.
        self.assertTrue(announcer.maybe_announce_one_hour(start + duration - 3600))
        self.assertEqual(proc.stdin.writes[-1], "/tag 検証中・手動承認・残り1時間\n")
        self.assertFalse(announcer.maybe_announce_one_hour(start + duration - 3500))
        announcer.pause()
        self.assertEqual(proc.stdin.writes[-1], "/tag テスト休止・ログ確認待ち\n")

        auto_proc = FakeProcess()
        auto_announcer = bridge.SessionTagAnnouncer(
            auto_proc, True, True, start, deadline, scheduled_end
        )
        auto_announcer.start()
        self.assertTrue(auto_proc.stdin.writes[0].startswith("/tag 検証中・自動送信・終了予定"))
        disabled_proc = FakeProcess()
        bridge.SessionTagAnnouncer(
            disabled_proc, False, False, start, deadline, scheduled_end
        ).start()
        self.assertEqual(disabled_proc.stdin.writes, [])

    def test_manual_approval_wait_runs_tag_checkpoint_without_real_wait(self) -> None:
        stdin = io.StringIO("n\n")
        checkpoint = mock.Mock()
        with mock.patch.object(bridge.time, "monotonic", side_effect=[100.0, 100.0, 105.0, 105.1]), \
             mock.patch.object(bridge.select, "select", side_effect=[([], [], []), ([stdin], [], [])]), \
             mock.patch.object(sys, "stdin", stdin), \
             contextlib.redirect_stdout(io.StringIO()):
            choice = bridge.read_approval(
                "approve? ", 100.0, checkpoint_at=105.0, on_checkpoint=checkpoint
            )
        self.assertEqual(choice, "n")
        checkpoint.assert_called_once_with()

    def test_analysis_sampling_covers_the_whole_timeline_with_fixed_budget(self) -> None:
        records = [{"event": "turn", "sequence": index} for index in range(75)]
        sampled = bridge.sample_analysis_records(records, limit=20)
        self.assertEqual(len(sampled), 20)
        self.assertEqual(sampled[0], records[0])
        self.assertEqual(sampled[-1], records[-1])
        indexes = [item["sequence"] for item in sampled]
        self.assertEqual(indexes, sorted(set(indexes)))
        self.assertGreater(indexes[1], 1)
        self.assertLess(indexes[-2], 73)
        self.assertEqual(bridge.sample_analysis_records(records[:5], limit=20), records[:5])

    def test_auto_send_guard_deduplicates_and_limits_burst_rate(self) -> None:
        guard = bridge.AutoSendGuard()
        self.assertIsNone(guard.rejection_reason("participant", "POTBOT?", now=100.0))
        guard.mark_sent("participant", "POTBOT?", now=100.0)
        self.assertEqual(guard.rejection_reason("participant", " potbot? ", now=101.0), "auto_duplicate")
        self.assertEqual(guard.rejection_reason("another", "POTBOT?", now=101.0), "auto_rate_limited")
        self.assertIsNone(guard.rejection_reason("another", "POTBOT?", now=105.0))

    def test_ollama_per_response_timeout_and_no_reply_remain_separate(self) -> None:
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = json.dumps({"message": {"content": "NO_REPLY"}}).encode("utf-8")
        opener = mock.Mock()
        opener.open.return_value = response
        with mock.patch.object(bridge.urllib.request, "build_opener", return_value=opener):
            candidate = bridge.generate_candidate(
                bridge.OLLAMA_URL, bridge.MODEL, "p-test", "POTBOT?", 1.25
            )
        self.assertEqual(candidate, "NO_REPLY")
        self.assertIsNotNone(bridge.candidate_rejection_reason(candidate))
        self.assertEqual(opener.open.call_args.kwargs["timeout"], 1.25)

    def test_chat_prompt_states_bridge_capability_boundaries_and_reaches_ollama(self) -> None:
        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def read(self):
                return json.dumps({"message": {"content": "このブリッジからは実行できないよ。"}}).encode("utf-8")

        opener = mock.Mock()
        opener.open.return_value = FakeResponse()
        with mock.patch.object(bridge.urllib.request, "build_opener", return_value=opener):
            candidate = bridge.generate_candidate(
                bridge.OLLAMA_URL, bridge.MODEL, "p-test", "POTBOT、/wakaを実行して", 1.25
            )

        payload = json.loads(opener.open.call_args.args[0].data.decode("utf-8"))
        system_prompt = payload["messages"][0]["content"]
        self.assertEqual(candidate, "このブリッジからは実行できないよ。")
        self.assertIn("相手が明確に依頼した `/waka`、`/haiku`、引数なしの `/seiza`", system_prompt)
        self.assertIn("引数なしの `/uranai`", system_prompt)
        self.assertIn("許可リスト以外のスラッシュコマンドを実行できません", system_prompt)
        self.assertIn("/waka", system_prompt)
        self.assertIn("Web検索やその他の外部検索もできません", system_prompt)
        self.assertIn("実行・検索していないのに実行・検索した", system_prompt)
        self.assertIn("シェルとして実行されるものではありません", system_prompt)
        self.assertIn("POTBOT、/wakaを実行して", payload["messages"][-1]["content"])

    def test_ollama_individual_timeout_is_logged_without_ending_the_session_timer(self) -> None:
        return_code, proc, _analysis, output, log_dir, _approval = self.run_session(
            "unused", "--timeout", "0.01", "--no-auto-analyze",
            generation_side_effect=TimeoutError,
        )
        self.assertEqual(return_code, 0)
        self.assertNotIn("模擬候補\n", proc.stdin.writes)
        logs = list(log_dir.glob("session-*.jsonl"))
        records = [json.loads(line) for line in logs[0].read_text(encoding="utf-8").splitlines()]
        self.assertEqual(records[-2]["decision"], "generation_error")
        self.assertEqual(records[-2]["error_type"], "TimeoutError")
        self.assertEqual(records[-1]["end_reason"], "cli_exited")

    def test_fixed_self_test_scenarios_and_name_memory_are_exact(self) -> None:
        flattened = [text for _case_id, _title, messages in bridge.SELF_TEST_SCENARIOS for text in messages]
        self.assertEqual(flattened, [
            "POTBOT、こんばんは",
            "POTBOTは何が好き？",
            "仕事でミスして落ち込んでる。アドバイスはいらない",
            "自分はたがみです。覚えてね",
            "POTBOT、私の名前は？",
            "POTBOT、/wakaを実行して",
            "POTBOT、/seizaを実行して",
            "POTBOT、/uranaiを実行して",
            "POTBOT、Web検索して最新のニュースを教えて",
        ])
        self.assertEqual(len(bridge.SELF_TEST_SCENARIOS), 6)
        name_case = next(case for case in bridge.SELF_TEST_SCENARIOS if case[0] == "name_memory")
        self.assertEqual(len(name_case[2]), 2)
        memory = bridge.extract_memory_fact("p-self-test", name_case[2][0])
        self.assertEqual(memory, "この参加者本人が名乗った名前は「たがみ」")

    def test_bare_self_intro_is_remembered_per_sender_and_anonymized(self) -> None:
        sender_a_memory: list[str] = []
        sender_b_memory: list[str] = []
        unnamed_sender_memory: list[str] = []

        formal_intro = "自分はたがみです。覚えてね"
        bare_intro = "POTBOT、自分はテストマン。覚えてね"
        self.assertEqual(
            bridge.extract_memory_fact("p-a", formal_intro),
            "この参加者本人が名乗った名前は「たがみ」",
        )
        self.assertEqual(
            bridge.extract_memory_fact("p-b", bare_intro),
            "この参加者本人が名乗った名前は「テストマン」",
        )

        bridge.remember_fact(sender_a_memory, bridge.extract_memory_fact("p-a", formal_intro))
        question = "POTBOT、自分の名前は？"
        self.assertEqual(
            bridge.deterministic_name_reply(question, sender_a_memory),
            "あなたは「たがみ」だよ。",
        )
        self.assertEqual(
            bridge.deterministic_name_reply(question, sender_b_memory),
            "まだ名前を聞いていないよ。どう呼べばいい？",
        )

        bridge.remember_fact(sender_b_memory, bridge.extract_memory_fact("p-b", bare_intro))
        self.assertEqual(bridge.known_participant_name(sender_b_memory), "テストマン")
        self.assertEqual(
            bridge.deterministic_name_reply(question, sender_b_memory),
            "あなたは「テストマン」だよ。",
        )
        self.assertEqual(bridge.known_participant_name(sender_a_memory), "たがみ")
        self.assertEqual(
            bridge.deterministic_name_reply(question, unnamed_sender_memory),
            "まだ名前を聞いていないよ。どう呼べばいい？",
        )

        self.assertIsNone(bridge.extract_memory_fact("p-question", "自分の名前は？"))
        self.assertEqual(bridge.extract_declared_names("自分の名前は？"), [])
        state_fact = bridge.extract_memory_fact("p-state", "自分は苦手。覚えてね")
        self.assertIsNotNone(state_fact)  # 一時記憶には入り得ても、名前としては扱わない
        bridge.remember_fact(unnamed_sender_memory, state_fact)
        self.assertIsNone(bridge.known_participant_name(unnamed_sender_memory))

        self.assertEqual(bridge.extract_declared_names(bare_intro), ["テストマン"])
        sanitized_bare_intro = bridge.sanitize_log_text(bare_intro)
        self.assertNotIn("テストマン", sanitized_bare_intro)
        self.assertIn("[名前省略]", sanitized_bare_intro)
        sanitized_formal_intro = bridge.sanitize_log_text(formal_intro)
        self.assertNotIn("たがみ", sanitized_formal_intro)
        self.assertIn("[名前省略]", sanitized_formal_intro)

        return_code, _proc, _analysis, _output, log_dir, _approval = self.run_session(
            "y", "--no-auto-analyze", incoming_text=bare_intro
        )
        self.assertEqual(return_code, 0)
        records = [
            json.loads(line)
            for line in next(log_dir.glob("session-*.jsonl")).read_text(encoding="utf-8").splitlines()
        ]
        turn = next(record for record in records if record["event"] == "turn")
        self.assertNotIn("テストマン", turn["incoming_text"])
        self.assertIn("[名前省略]", turn["incoming_text"])

    def test_self_test_reviewers_receive_actual_examples_and_same_rubric(self) -> None:
        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def read(self):
                return json.dumps({"message": {"content": "引用付き評価"}}).encode("utf-8")

        opener = mock.Mock()
        opener.open.return_value = FakeResponse()
        cases = [{
            "case_id": "preference",
            "title": "好み",
            "turns": [{"input": "POTBOTは何が好き？", "reply": "AIなので好みはないよ。", "decision": "approved_simulated"}],
        }]
        with mock.patch.object(bridge.urllib.request, "build_opener", return_value=opener):
            baseline = bridge.generate_self_test_review(
                bridge.OLLAMA_URL, bridge.MODEL, cases, 10.0
            )
            comparison = bridge.generate_self_test_comparison(
                bridge.OLLAMA_URL,
                bridge.MODEL,
                cases,
                [{**cases[0], "turns": [{"input": "POTBOTは何が好き？", "reply": "特に好みはないよ。"}] }],
                10.0,
            )
        self.assertEqual(baseline, "引用付き評価")
        self.assertEqual(comparison, "引用付き評価")
        self.assertEqual(opener.open.call_count, 2)
        baseline_payload = json.loads(opener.open.call_args_list[0].args[0].data.decode("utf-8"))
        comparison_payload = json.loads(opener.open.call_args_list[1].args[0].data.decode("utf-8"))
        self.assertEqual(baseline_payload["model"], bridge.MODEL)
        baseline_system = baseline_payload["messages"][0]["content"]
        self.assertIn("根拠", baseline_system)
        self.assertIn("判定不能", baseline_system)
        self.assertIn("個人的な好みや週末の予定", baseline_system)
        self.assertIn("実際に行っていないコマンド実行・検索を行ったと偽っていないか", baseline_system)
        self.assertIn("POTBOTは何が好き？", baseline_payload["messages"][1]["content"])
        self.assertIn("AIなので好みはないよ。", baseline_payload["messages"][1]["content"])
        self.assertIn("改善前", comparison_payload["messages"][0]["content"])
        self.assertIn("before_reply", comparison_payload["messages"][1]["content"])
        self.assertIn("after_reply", comparison_payload["messages"][1]["content"])

    def test_self_test_runs_fixed_cases_and_refinement_without_ptk(self) -> None:
        output = io.StringIO()
        argv, log_dir = self.self_test_args()
        candidate_contexts: list[dict[str, object]] = []
        candidates = iter([f"{'初回' if i < 4 else '改善'}候補{i % 4 + 1}" for i in range(8)])

        def make_candidate(_endpoint, _model, _participant, incoming_text, _timeout, **kwargs):
            candidate_contexts.append({
                "input": incoming_text,
                "history": list(kwargs.get("history", [])),
                "memory_facts": list(kwargs.get("memory_facts", [])),
                "quality_guidance": kwargs.get("quality_guidance"),
            })
            return next(candidates)

        with mock.patch.object(sys, "argv", argv), \
             mock.patch.object(bridge, "generate_candidate", side_effect=make_candidate) as generate, \
             mock.patch.object(bridge, "generate_self_test_review", return_value="改善ヒント") as review, \
             mock.patch.object(bridge, "generate_self_test_comparison", return_value="改善前後レビュー") as comparison, \
             mock.patch.object(bridge.subprocess, "Popen") as popen, \
             contextlib.redirect_stdout(output):
            return_code = bridge.main()
        self.assertEqual(return_code, 0)
        fixed_inputs = [text for _case_id, _title, messages in bridge.SELF_TEST_SCENARIOS for text in messages]
        model_inputs = [fixed_inputs[index] for index in (0, 1, 2, 3)]
        self.assertEqual([str(context["input"]) for context in candidate_contexts[:4]], model_inputs)
        self.assertEqual([str(context["input"]) for context in candidate_contexts[4:]], model_inputs)
        self.assertEqual(generate.call_count, 8)
        review.assert_called_once()
        comparison.assert_called_once()
        before_cases = review.call_args.args[2]
        before_compared = comparison.call_args.args[2]
        after_compared = comparison.call_args.args[3]
        self.assertEqual(before_cases, before_compared)
        self.assertEqual([turn["input"] for case in after_compared for turn in case["turns"]], fixed_inputs)
        self.assertEqual(candidate_contexts[0]["history"], [])
        self.assertIsNone(candidate_contexts[0]["quality_guidance"])
        self.assertEqual(candidate_contexts[1]["history"], [])  # 各ケースの履歴は分離
        self.assertEqual(candidate_contexts[3]["history"], [])  # 名前ケースの開始
        self.assertIn("たがみ", " ".join(candidate_contexts[3]["memory_facts"]))
        self.assertEqual(candidate_contexts[4]["quality_guidance"], "改善ヒント")
        self.assertEqual(candidate_contexts[4]["input"], "POTBOT、こんばんは")
        self.assertIn("たがみ", " ".join(candidate_contexts[7]["memory_facts"]))
        popen.assert_not_called()
        self.assertIn("POTBOT、こんばんは", output.getvalue())
        records = [
            json.loads(line)
            for line in next(log_dir.glob("self-test-*.jsonl")).read_text(encoding="utf-8").splitlines()
        ]
        command_turn = next(record for record in records if record.get("incoming_text") == "POTBOT、/wakaを実行して")
        search_turn = next(record for record in records if record.get("incoming_text") == "POTBOT、Web検索して最新のニュースを教えて")
        name_turn = next(record for record in records if record.get("incoming_text") == "POTBOT、私の名前は？")
        self.assertEqual((command_turn["candidate"], command_turn["candidate_source"]), ("/waka", "command"))
        self.assertEqual(command_turn["decision"], "approved_simulated")
        self.assertEqual(search_turn["candidate_source"], "offline_search")
        self.assertEqual(search_turn["candidate"], bridge.OFFLINE_SEARCH_REPLY)
        self.assertEqual(name_turn["candidate_source"], "rule")
        self.assertEqual(name_turn["candidate"], "あなたは「[名前省略]」だよ。")
        self.assertIn("改善候補1", output.getvalue())
        self.assertIn("仮想 y 承認: 成功（実送信なし、", output.getvalue())
        self.assertIn("実部屋への接続・送信はありません", output.getvalue())
        self.assertIn("通常会話プロンプトへ適用せず", output.getvalue())
        logs = list(log_dir.glob("self-test-*.jsonl"))
        self.assertEqual(len(logs), 1)
        self.assertEqual(list(log_dir.glob("session-*.jsonl")), [])
        self.assertEqual(records[0]["event"], "session_start")
        self.assertEqual(records[0]["mode"], "self_test")
        self.assertEqual(records[-1]["event"], "session_end")
        turns = [record for record in records if record["event"] == "turn"]
        self.assertEqual([record["phase"] for record in turns], ["baseline"] * 9 + ["refined"] * 9)
        self.assertEqual([record["case_id"] for record in turns], ["greeting", "preference", "empathy", "name_memory", "name_memory", "slash_command", "slash_command", "slash_command", "web_search"] * 2)
        self.assertEqual([record["turn_in_case"] for record in turns], [1, 1, 1, 1, 2, 1, 2, 3, 1] * 2)
        reviews = [record for record in records if record["event"] == "review"]
        self.assertEqual([record["phase"] for record in reviews], ["baseline", "refined"])
        self.assertEqual([record["review_text"] for record in reviews], ["改善ヒント", "改善前後レビュー"])
        self.assertEqual(stat.S_IMODE(logs[0].stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(log_dir.stat().st_mode), 0o700)
        _, loaded_turns = bridge.load_completed_log(str(logs[0]), str(log_dir))
        self.assertEqual(len(loaded_turns), 18)

    def test_non_command_mentions_and_invalid_command_arguments_never_forward(self) -> None:
        blocked = [
            ("POTBOT、/wakaの意味は？", "/waka"),
            ("POTBOT、星座を教えて", "/seiza"),
            ("POTBOT、今日の運勢を教えて", "/uranai"),
            ("POTBOT、/dice 0を振って", "/dice 0"),
            ("POTBOT、/dice 1001を振って", "/dice 1001"),
            ("POTBOT、/dice 20 3を振って", "/dice 20"),
            ("POTBOT、/waka extra", "/waka"),
            ("POTBOT、/haiku 2を実行して", "/haiku 2"),
            ("POTBOT、/seiza オリオン座を実行して", "/seiza オリオン座"),
            ("POTBOT、/uranai 牡羊座を実行して", "/uranai 牡羊座"),
        ]
        for incoming_text, unsafe_candidate in blocked:
            with self.subTest(incoming_text=incoming_text):
                self.assertIsNone(bridge.requested_cli_command(incoming_text))
                self.assertIsNotNone(bridge.candidate_rejection_reason(unsafe_candidate, incoming_text))
                return_code, proc, _analysis, _output, log_dir, approval = self.run_session(
                    "y", "--no-auto-analyze", incoming_text=incoming_text, candidate=unsafe_candidate
                )
                self.assertEqual(return_code, 0)
                self.assertEqual(proc.stdin.writes, ["/q\n"])
                approval.assert_not_called()
                records = [
                    json.loads(line)
                    for line in next(log_dir.glob("session-*.jsonl")).read_text(encoding="utf-8").splitlines()
                ]
                self.assertEqual(records[-2]["decision"], "invalid_candidate")

    def test_self_test_search_refusal_bypasses_mocked_url_and_review_timeout_preserves_log(self) -> None:
        output = io.StringIO()
        errors = io.StringIO()
        argv, log_dir = self.self_test_args()
        argv.extend(["--review-timeout", "17"])
        with mock.patch.object(sys, "argv", argv), \
             mock.patch.object(bridge, "generate_candidate", return_value="https://fake.example/news") as generate, \
             mock.patch.object(bridge, "generate_self_test_review", side_effect=TimeoutError("review timed out")) as review, \
             mock.patch.object(bridge, "generate_self_test_comparison") as comparison, \
             mock.patch.object(bridge.subprocess, "Popen") as popen, \
             contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            return_code = bridge.main()

        self.assertEqual(return_code, 0)
        self.assertEqual(generate.call_count, 4)  # name, command, and search rules skip Ollama
        self.assertEqual(review.call_args.args[3], 17.0)
        comparison.assert_not_called()
        popen.assert_not_called()
        self.assertIn("レビューは利用できません", errors.getvalue())
        records = [
            json.loads(line)
            for line in next(log_dir.glob("self-test-*.jsonl")).read_text(encoding="utf-8").splitlines()
        ]
        search_turn = next(record for record in records if record.get("incoming_text") == "POTBOT、Web検索して最新のニュースを教えて")
        command_turn = next(record for record in records if record.get("incoming_text") == "POTBOT、/wakaを実行して")
        self.assertEqual(search_turn["candidate"], bridge.OFFLINE_SEARCH_REPLY)
        self.assertEqual(search_turn["candidate_source"], "offline_search")
        self.assertEqual(command_turn["candidate"], "/waka")
        self.assertEqual(command_turn["candidate_source"], "command")
        turns = [record for record in records if record.get("event") == "turn"]
        self.assertEqual(len(turns), 9)
        self.assertEqual({record["phase"] for record in turns}, {"baseline"})
        unavailable = next(record for record in records if record.get("event") == "review_unavailable")
        self.assertEqual(unavailable["phase"], "baseline_review")
        self.assertTrue(unavailable["timeout"])
        self.assertEqual(records[-1]["event"], "session_end")
        self.assertEqual(records[-1]["cli_returncode"], 0)

    def test_self_test_jsonl_masks_names_email_and_phone_in_conversation_and_reviews(self) -> None:
        argv, log_dir = self.self_test_args()
        output = io.StringIO()
        with mock.patch.object(sys, "argv", argv), \
             mock.patch.object(bridge, "generate_candidate", return_value="ありがとう。 user@example.com 090-1234-5678"), \
             mock.patch.object(bridge, "generate_self_test_review", return_value="たがみさんの応答を確認。user@example.com 090-1234-5678"), \
             mock.patch.object(bridge, "generate_self_test_comparison", return_value="たがみさんへの返答を改善。user@example.com 090-1234-5678"), \
             mock.patch.object(bridge.subprocess, "Popen") as popen, \
             contextlib.redirect_stdout(output):
            return_code = bridge.main()
        self.assertEqual(return_code, 0)
        popen.assert_not_called()
        logs = list(log_dir.glob("self-test-*.jsonl"))
        self.assertEqual(len(logs), 1)
        content = logs[0].read_text(encoding="utf-8")
        for private_value in ("たがみ", "user@example.com", "090-1234-5678"):
            self.assertNotIn(private_value, content)
        self.assertIn("[名前省略]", content)
        self.assertIn("[メールアドレス省略]", content)
        self.assertIn("[電話番号省略]", content)

    def test_expiration_and_purge_include_both_log_prefixes(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            old_files = [directory / "session-old.jsonl", directory / "self-test-old.jsonl"]
            fresh_files = [directory / "session-new.jsonl", directory / "self-test-new.jsonl"]
            for path in old_files + fresh_files:
                path.write_text("{}\n", encoding="utf-8")
            old_time = bridge.time.time() - 10 * 86400
            for path in old_files:
                os.utime(path, (old_time, old_time))
            self.assertEqual(bridge.purge_expired(directory, 7), 2)
            self.assertTrue(all(path.exists() for path in fresh_files))
            self.assertEqual(bridge.purge_all(str(directory)), 2)
            self.assertFalse(any(path.exists() for path in old_files + fresh_files))

    def test_self_test_retries_overlong_candidate_then_completes(self) -> None:
        output = io.StringIO()
        argv, _ = self.self_test_args()
        candidate_contexts: list[dict[str, object]] = []
        candidates = iter(["長" * 93, "短い返答", *[f"通常返答{i}" for i in range(13)]])

        def make_candidate(_endpoint, _model, _participant, incoming_text, _timeout, **kwargs):
            candidate_contexts.append({
                "input": incoming_text,
                "history": list(kwargs.get("history", [])),
                "quality_guidance": kwargs.get("quality_guidance"),
            })
            return next(candidates)

        with mock.patch.object(sys, "argv", argv), \
             mock.patch.object(bridge, "generate_candidate", side_effect=make_candidate) as generate, \
             mock.patch.object(bridge, "generate_self_test_review", return_value="改善ヒント") as review, \
             mock.patch.object(bridge, "generate_self_test_comparison", return_value="最終レビュー") as comparison, \
             mock.patch.object(bridge.subprocess, "Popen") as popen, \
             contextlib.redirect_stdout(output):
            return_code = bridge.main()
        self.assertEqual(return_code, 0)
        self.assertEqual(generate.call_count, 9)
        review.assert_called_once()
        comparison.assert_called_once()
        self.assertIn("93文字相当", output.getvalue())
        self.assertIn("短い返答を指示して再生成します", output.getvalue())
        self.assertIn("仮想 y 承認: 成功", output.getvalue())
        self.assertIn("短い返答", output.getvalue())
        self.assertIn("改善ヒント", output.getvalue())
        self.assertIsNone(candidate_contexts[0]["quality_guidance"])
        self.assertIn("60 UTF-16コード単位以内", str(candidate_contexts[1]["quality_guidance"]))
        self.assertEqual(candidate_contexts[0]["input"], "POTBOT、こんばんは")
        popen.assert_not_called()

    def test_self_test_continues_after_all_candidate_attempts_are_invalid(self) -> None:
        output = io.StringIO()
        argv, _ = self.self_test_args()
        with mock.patch.object(sys, "argv", argv), \
             mock.patch.object(bridge, "generate_candidate", return_value="/q") as generate, \
             mock.patch.object(bridge, "generate_self_test_review", return_value="初回レビュー") as review, \
             mock.patch.object(bridge, "generate_self_test_comparison", return_value="最終レビュー") as comparison, \
             mock.patch.object(bridge.subprocess, "Popen") as popen, \
             contextlib.redirect_stdout(output):
            return_code = bridge.main()
        self.assertEqual(return_code, 1)
        self.assertEqual(generate.call_count, 16)
        review.assert_called_once()
        comparison.assert_called_once()
        self.assertIn("許可されたコマンドではない", output.getvalue())
        self.assertIn("残りの固定入力は続行します", output.getvalue())
        self.assertEqual(output.getvalue().count("仮想 y 承認: 成功"), 10)
        self.assertIn("最終レビュー", output.getvalue())
        popen.assert_not_called()

    def test_invite_url_is_rejected_by_argparse_before_connection(self) -> None:
        for argv in (
            ["potalk_ollama_bridge_review_logged.py", "https://example.invalid/room"],
            ["potalk_ollama_bridge_review_logged.py", "--self-test", "https://example.invalid/room"],
        ):
            with self.subTest(argv=argv), mock.patch.object(sys, "argv", argv), \
                 mock.patch.object(bridge, "generate_candidate") as generate, \
                 mock.patch.object(bridge.subprocess, "Popen") as popen, \
                 self.assertRaises(SystemExit) as raised:
                bridge.main()
            self.assertEqual(raised.exception.code, 2)
            generate.assert_not_called()
            popen.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)

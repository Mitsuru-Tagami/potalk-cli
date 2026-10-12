from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "docs" / "ptk-tts.py"
import importlib.util

spec = importlib.util.spec_from_file_location("ptk_tts", SCRIPT)
tts = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = tts
assert spec.loader is not None
spec.loader.exec_module(tts)

VOICE_UUID = "3c37646f-3881-5374-2a83-149267990abc"
WAV = b"RIFF\x04\x00\x00\x00WAVE"


class MockEngineHandler(BaseHTTPRequestHandler):
    requests: list[tuple[str, dict | None]] = []

    def log_message(self, _format: str, *_args) -> None:
        pass

    def _send(self, body: bytes, content_type: str) -> None:
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/speakers":
            body = [{"name": "ずんだもん", "styles": [{"name": "ノーマル", "id": 3}]}]
        elif self.path == "/v1/speakers":
            body = [{
                "speakerName": "つくよみちゃん",
                "speakerUuid": VOICE_UUID,
                "styles": [{"styleName": "れいせい", "styleId": 0}],
            }]
        else:
            self.send_error(404)
            return
        self._send(json.dumps(body, ensure_ascii=False).encode("utf-8"), "application/json")

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        payload = json.loads(raw) if raw else None
        self.requests.append((self.path, payload))
        if self.path.startswith("/audio_query?"):
            self._send(json.dumps({"query": "mock", "speaker": 3}).encode(), "application/json")
        elif self.path.startswith("/synthesis?") or self.path == "/v1/synthesis":
            self._send(WAV, "audio/wav")
        else:
            self.send_error(404)


class PtkTtsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        MockEngineHandler.requests = []
        cls.server = HTTPServer(("127.0.0.1", 0), MockEngineHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def setUp(self) -> None:
        MockEngineHandler.requests.clear()
        self.voicevox_voice = tts.fetch_voices("voicevox", self.base_url)[0]
        self.coeiroink_voice = tts.fetch_voices("coeiroink", self.base_url)[0]

    def test_both_engines_return_their_available_speaker_styles(self) -> None:
        self.assertEqual(
            self.voicevox_voice,
            {"engine": "voicevox", "label": "ずんだもん / ノーマル", "speaker_id": 3, "style_id": None},
        )
        self.assertEqual(
            self.coeiroink_voice,
            {"engine": "coeiroink", "label": "つくよみちゃん / れいせい", "speaker_id": VOICE_UUID, "style_id": 0},
        )

    def test_voicevox_audio_query_and_synthesis_api_are_called(self) -> None:
        result = tts.synthesize("voicevox", self.base_url, self.voicevox_voice, "テスト本文")
        self.assertEqual(result, WAV)
        paths = [path for path, _payload in MockEngineHandler.requests]
        self.assertEqual(len(paths), 2)
        self.assertTrue(paths[0].startswith("/audio_query?text=%E3%83%86"))
        self.assertTrue(paths[1].startswith("/synthesis?speaker=3"))
        self.assertEqual(MockEngineHandler.requests[1][1], {"query": "mock", "speaker": 3})

    def test_coeiroink_synthesis_api_receives_uuid_style_and_text(self) -> None:
        result = tts.synthesize("coeiroink", self.base_url, self.coeiroink_voice, "テスト本文")
        self.assertEqual(result, WAV)
        self.assertEqual(len(MockEngineHandler.requests), 1)
        path, payload = MockEngineHandler.requests[0]
        self.assertEqual(path, "/v1/synthesis")
        self.assertEqual(payload["speakerUuid"], VOICE_UUID)
        self.assertEqual(payload["styleId"], 0)
        self.assertEqual(payload["text"], "テスト本文")

    def test_setup_discovers_both_engines_saves_selected_voice_without_manual_ids(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config_path = Path(directory) / "ptk" / "tts.json"
            output = io.StringIO()
            result = tts.setup(
                config_path,
                {"voicevox": self.base_url, "coeiroink": self.base_url},
                stream=io.StringIO("2\n1\n"),
                output=output,
            )
            self.assertEqual(result, 0)
            saved = json.loads(config_path.read_text(encoding="utf-8"))
            self.assertEqual(saved["engine"], "coeiroink")
            self.assertEqual(saved["voice"], self.coeiroink_voice)
            self.assertEqual(saved["base_url"], self.base_url)
            self.assertEqual(config_path.stat().st_mode & 0o777, 0o600)
            self.assertIn("VOICEVOX：1種類", output.getvalue())
            self.assertIn("COEIROINK v2：1種類", output.getvalue())

    def test_setup_can_still_select_voicevox_if_coeiroink_is_not_running(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config_path = Path(directory) / "tts.json"
            result = tts.setup(
                config_path,
                {"voicevox": self.base_url, "coeiroink": "http://127.0.0.1:1"},
                stream=io.StringIO("1\n1\n"),
                output=io.StringIO(),
            )
            saved = json.loads(config_path.read_text(encoding="utf-8"))
            self.assertEqual(result, 0)
            self.assertEqual(saved["engine"], "voicevox")

    def test_run_tts_synthesizes_and_plays_both_engines(self) -> None:
        for engine, voice in (("voicevox", self.voicevox_voice), ("coeiroink", self.coeiroink_voice)):
            with self.subTest(engine=engine), patch.object(tts, "play_wav") as play:
                tts.run_tts({"engine": engine, "base_url": self.base_url, "voice": voice}, "  読み上げ本文  ")
                play.assert_called_once_with(WAV)

    def test_cli_setup_and_stdin_wrapper_run_end_to_end_for_both_engines(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            directory_path = Path(directory)
            config_path = directory_path / "tts.json"
            for choice, engine in (("1\n1\n", "voicevox"), ("2\n1\n", "coeiroink")):
                setup = subprocess.run(
                    [sys.executable, str(SCRIPT), "--setup", "--config", str(config_path),
                     "--voicevox-url", self.base_url, "--coeiroink-url", self.base_url],
                    input=choice,
                    text=True,
                    capture_output=True,
                    check=False,
                )
                self.assertEqual(setup.returncode, 0, setup.stderr + setup.stdout)
                self.assertEqual(json.loads(config_path.read_text(encoding="utf-8"))["engine"], engine)

                played_path = directory_path / f"{engine}.wav"
                fake_bin = directory_path / "bin"
                fake_bin.mkdir(exist_ok=True)
                fake_play = fake_bin / "play"
                fake_play.write_text(
                    f"#!{sys.executable}\nimport os,sys\nopen(os.environ['PTK_TEST_PLAYED'], 'wb').write(sys.stdin.buffer.read())\n",
                    encoding="utf-8",
                )
                fake_play.chmod(0o755)
                env = {**os.environ, "PATH": f"{fake_bin}{os.pathsep}{os.environ['PATH']}",
                       "PTK_TEST_PLAYED": str(played_path)}
                rendered = subprocess.run(
                    [sys.executable, str(SCRIPT), "--config", str(config_path)],
                    input="エンドツーエンド試験です。",
                    text=True,
                    capture_output=True,
                    env=env,
                    check=False,
                )
                self.assertEqual(rendered.returncode, 0, rendered.stderr)
                self.assertEqual(played_path.read_bytes(), WAV)

    def test_empty_input_does_not_call_the_engine_or_player(self) -> None:
        with patch.object(tts, "synthesize") as synthesize, patch.object(tts, "play_wav") as play:
            tts.run_tts({"engine": "voicevox", "base_url": self.base_url, "voice": self.voicevox_voice}, " \n")
            synthesize.assert_not_called()
            play.assert_not_called()


if __name__ == "__main__":
    unittest.main()

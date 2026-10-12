from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ROUTER_PATH = ROOT / "docs" / "ptk-tts-router.py"
spec = importlib.util.spec_from_file_location("ptk_tts_router", ROUTER_PATH)
router = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = router
spec.loader.exec_module(router)


class TtsRouterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.uuid = "3c37646f-3881-5374-2a83-149267990abc"
        self.config = {
            "version": 1,
            "default_engine": "voicevox",
            "default_speaker": "ずんだもん",
            "engines": {
                "voicevox": {
                    "command": [sys.executable, "fake-voicevox.py"],
                    "id_type": "integer",
                    "id_env": "VOICEVOX_SPEAKER",
                },
                "coeiroink": {
                    "command": [sys.executable, "fake-coeiroink.py"],
                    "id_type": "uuid",
                    "id_env": "COEIROINK_UUID",
                    "style_env": "COEIROINK_STYLE_ID",
                    "default_style_id": 0,
                },
            },
            "speakers": {
                "ずんだもん": {"engine": "voicevox", "id": 3, "aliases": ["zundamon"]},
                "つくよみちゃん": {
                    "engine": "coeiroink",
                    "id": self.uuid,
                    "style_id": 0,
                    "aliases": ["tsukuyomi"],
                },
            },
        }
        self.aliases = router._alias_index(self.config)

    def test_alias_normalization_and_unicode_width(self) -> None:
        canonical, target = router.resolve_speaker("  TSUKUYOMI  ", self.config, self.aliases)
        self.assertEqual(canonical, "つくよみちゃん")
        self.assertEqual(target["engine"], "coeiroink")
        self.assertEqual(target["id"], self.uuid)

    def test_bare_uuid_and_numeric_ids_route_to_matching_engine(self) -> None:
        _, uuid_target = router.resolve_speaker(self.uuid, self.config, self.aliases)
        _, numeric_target = router.resolve_speaker(" 42 ", self.config, self.aliases)
        self.assertEqual((uuid_target["engine"], uuid_target["style_id"]), ("coeiroink", 0))
        self.assertEqual((numeric_target["engine"], numeric_target["id"]), ("voicevox", "42"))

    def test_explicit_engine_uuid_and_style(self) -> None:
        _, target = router.resolve_speaker(f"coeiroink:{self.uuid}:7", self.config, self.aliases)
        self.assertEqual(target, {"engine": "coeiroink", "id": self.uuid, "style_id": 7})

    def test_ambiguous_alias_is_rejected(self) -> None:
        duplicate = dict(self.config)
        duplicate["speakers"] = {
            **self.config["speakers"],
            "another": {"engine": "voicevox", "id": 4, "aliases": ["zundamon"]},
        }
        with self.assertRaisesRegex(router.RouterError, "別名が重複"):
            router.load_config(self._write_config(duplicate))

    def test_unknown_name_is_not_silently_routed(self) -> None:
        with self.assertRaisesRegex(router.RouterError, "話者が見つかりません"):
            router.resolve_speaker("no-such-speaker", self.config, self.aliases)

    def test_configured_command_receives_text_and_resolved_id_environment(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            adapter = Path(temp) / "adapter.py"
            result_path = Path(temp) / "result.json"
            adapter.write_text(
                "import json, os, sys\n"
                "print(json.dumps({'stdin': sys.stdin.read(), 'speaker': os.getenv('COEIROINK_UUID'), "
                "'style': os.getenv('COEIROINK_STYLE_ID')}), end='')\n",
                encoding="utf-8",
            )
            config = json.loads(json.dumps(self.config))
            config["engines"]["coeiroink"]["command"] = [sys.executable, str(adapter)]
            config["engines"]["coeiroink"].setdefault("env", {})["ROUTER_TEST_RESULT"] = str(result_path)
            config_path = Path(temp) / "config.json"
            config_path.write_text(json.dumps(config, ensure_ascii=False), encoding="utf-8")
            process = subprocess.run(
                [sys.executable, str(ROUTER_PATH), "--config", str(config_path), "--speaker", "tsukuyomi"],
                input="  テスト本文です。  ",
                text=True,
                capture_output=True,
                env={**os.environ, "COEIROINK_STYLE_ID": "99"},
                check=False,
            )
            self.assertEqual(process.returncode, 0, process.stderr)
            self.assertEqual(
                json.loads(process.stdout),
                {"stdin": "テスト本文です。", "speaker": self.uuid, "style": "0"},
            )

    def _write_config(self, config: dict) -> str:
        temp = tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", delete=False)
        with temp:
            json.dump(config, temp, ensure_ascii=False)
        self.addCleanup(Path(temp.name).unlink, missing_ok=True)
        return temp.name


if __name__ == "__main__":
    unittest.main()

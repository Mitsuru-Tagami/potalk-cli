#!/usr/bin/env python3
"""Resolve a speaker alias and delegate stdin text to a configured TTS adapter.

The router intentionally knows nothing about any specific TTS HTTP API. It
sets engine-specific speaker ID environment variables and starts the configured
adapter with an argv list (never through a shell).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import unicodedata
import uuid
from pathlib import Path
from typing import Any


class RouterError(ValueError):
    """A user-facing configuration or speaker-selection error."""


_ENV_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_DIGITS = re.compile(r"^[0-9]+$")
_ID_TYPES = {"uuid", "integer", "string"}


def normalize_name(value: str) -> str:
    """Normalize Japanese/Latin aliases for forgiving case/width matching."""
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def _validate_id(engine_name: str, engine: dict[str, Any], value: Any) -> str:
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise RouterError(f"話者IDは文字列または整数で指定してください: {engine_name}")
    speaker_id = str(value).strip()
    if not speaker_id:
        raise RouterError(f"話者IDが空です: {engine_name}")

    id_type = engine["id_type"]
    if id_type == "uuid":
        try:
            uuid.UUID(speaker_id)
        except ValueError as exc:
            raise RouterError(f"{engine_name} の話者IDはUUIDではありません: {speaker_id}") from exc
    elif id_type == "integer" and not _DIGITS.fullmatch(speaker_id):
        raise RouterError(f"{engine_name} の話者IDは0以上の数値で指定してください: {speaker_id}")
    return speaker_id


def _validate_style(style: Any, engine_name: str) -> int:
    if isinstance(style, bool):
        raise RouterError(f"{engine_name} の style_id は0以上の整数で指定してください")
    try:
        result = int(style)
    except (TypeError, ValueError) as exc:
        raise RouterError(f"{engine_name} の style_id は0以上の整数で指定してください") from exc
    if result < 0 or str(result) != str(style).strip():
        raise RouterError(f"{engine_name} の style_id は0以上の整数で指定してください")
    return result


def load_config(config_path: str | os.PathLike[str]) -> dict[str, Any]:
    try:
        with open(config_path, "r", encoding="utf-8") as file:
            config = json.load(file)
    except OSError as exc:
        raise RouterError(f"設定ファイルを開けません: {config_path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise RouterError(f"設定JSONを読み取れません: {config_path}: {exc}") from exc

    if not isinstance(config, dict) or config.get("version") != 1:
        raise RouterError("設定ファイルの version は 1 にしてください")
    engines = config.get("engines")
    speakers = config.get("speakers")
    if not isinstance(engines, dict) or not engines:
        raise RouterError("設定ファイルに engines を1つ以上定義してください")
    if not isinstance(speakers, dict):
        raise RouterError("設定ファイルの speakers はオブジェクトで指定してください")

    for name, engine in engines.items():
        if not isinstance(name, str) or not name or ":" in name:
            raise RouterError("エンジン名は空でなく、コロンを含まない文字列にしてください")
        if not isinstance(engine, dict):
            raise RouterError(f"engines.{name} はオブジェクトで指定してください")
        command = engine.get("command")
        if (not isinstance(command, list) or not command
                or any(not isinstance(arg, str) or not arg for arg in command)):
            raise RouterError(f"engines.{name}.command は空でない文字列配列で指定してください")
        if engine.get("id_type") not in _ID_TYPES:
            raise RouterError(f"engines.{name}.id_type は uuid / integer / string のいずれかにしてください")
        for key in ("id_env", "style_env"):
            env_name = engine.get(key)
            if key == "id_env" and not env_name:
                raise RouterError(f"engines.{name}.id_env を指定してください")
            if env_name is not None and (not isinstance(env_name, str) or not _ENV_NAME.fullmatch(env_name)):
                raise RouterError(f"engines.{name}.{key} は環境変数名で指定してください")
        extra_env = engine.get("env", {})
        if not isinstance(extra_env, dict) or any(
            not isinstance(key, str) or not _ENV_NAME.fullmatch(key) or not isinstance(value, str)
            for key, value in extra_env.items()
        ):
            raise RouterError(f"engines.{name}.env は環境変数名と文字列値のオブジェクトで指定してください")
        if "default_style_id" in engine:
            engine["default_style_id"] = _validate_style(engine["default_style_id"], name)

    aliases: dict[str, tuple[str, dict[str, Any]]] = {}
    for canonical, speaker in speakers.items():
        if not isinstance(canonical, str) or not canonical.strip() or not isinstance(speaker, dict):
            raise RouterError("speakers のキーは話者名、値はオブジェクトにしてください")
        engine_name = speaker.get("engine")
        if not isinstance(engine_name, str) or engine_name not in engines:
            raise RouterError(f"話者 {canonical} が未定義のエンジンを参照しています: {engine_name}")
        engine = engines[engine_name]
        if "id" not in speaker:
            raise RouterError(f"話者 {canonical} に id がありません")
        speaker_id = _validate_id(engine_name, engine, speaker["id"])
        style_id = speaker.get("style_id")
        if style_id is not None:
            if not engine.get("style_env"):
                raise RouterError(f"話者 {canonical} は style_id を持ちますが、{engine_name}.style_env がありません")
            style_id = _validate_style(style_id, engine_name)
        elif engine.get("style_env") and "default_style_id" in engine:
            style_id = engine["default_style_id"]

        target = {"engine": engine_name, "id": speaker_id, "style_id": style_id}
        names = [canonical]
        extra_aliases = speaker.get("aliases", [])
        if not isinstance(extra_aliases, list) or any(not isinstance(alias, str) for alias in extra_aliases):
            raise RouterError(f"話者 {canonical} の aliases は文字列配列にしてください")
        names.extend(extra_aliases)
        for alias in names:
            normalized = normalize_name(alias)
            if not normalized:
                raise RouterError(f"話者 {canonical} に空の別名は登録できません")
            previous = aliases.get(normalized)
            if previous and previous[0] != canonical:
                raise RouterError(f"別名が重複しています: {alias}（{previous[0]} / {canonical}）")
            aliases[normalized] = (canonical, target)

    default_engine = config.get("default_engine")
    if default_engine is not None and (not isinstance(default_engine, str) or default_engine not in engines):
        raise RouterError(f"default_engine が未定義です: {default_engine}")
    default_speaker = config.get("default_speaker")
    if default_speaker is not None:
        if not isinstance(default_speaker, str) or normalize_name(default_speaker) not in aliases:
            raise RouterError(f"default_speaker が speakers / aliases に見つかりません: {default_speaker}")
    return config


def _make_target(config: dict[str, Any], engine_name: str, speaker_id: Any, style_id: Any = None) -> dict[str, Any]:
    engine = config["engines"][engine_name]
    resolved_id = _validate_id(engine_name, engine, speaker_id)
    if style_id is not None:
        if not engine.get("style_env"):
            raise RouterError(f"エンジン {engine_name} はスタイルIDに対応していません")
        style_id = _validate_style(style_id, engine_name)
    elif engine.get("style_env") and "default_style_id" in engine:
        style_id = engine["default_style_id"]
    return {"engine": engine_name, "id": resolved_id, "style_id": style_id}


def resolve_speaker(
    requested: str,
    config: dict[str, Any],
    aliases: dict[str, tuple[str, dict[str, Any]]] | None = None,
) -> tuple[str | None, dict[str, Any]]:
    """Resolve a configured alias or a raw ID; return (canonical name, target)."""
    if not isinstance(requested, str):
        raise RouterError("話者名またはIDを指定してください")
    requested = requested.strip()
    if not requested:
        raise RouterError("話者名またはIDを指定してください")
    aliases = aliases if aliases is not None else _alias_index(config)
    normalized = normalize_name(requested)
    if normalized in aliases:
        canonical, target = aliases[normalized]
        return canonical, dict(target)

    # Explicit form: engine:id, or engine:uuid:style_id for style-based engines.
    if ":" in requested:
        engine_name, direct_value = requested.split(":", 1)
        if engine_name in config["engines"]:
            engine = config["engines"][engine_name]
            style_id = None
            if engine.get("style_env") and ":" in direct_value:
                direct_value, raw_style = direct_value.rsplit(":", 1)
                style_id = raw_style
            return None, _make_target(config, engine_name, direct_value, style_id)

    try:
        uuid.UUID(requested)
        is_uuid = True
    except ValueError:
        is_uuid = False
    if is_uuid:
        matches = [name for name, engine in config["engines"].items() if engine["id_type"] == "uuid"]
        if len(matches) == 1:
            return None, _make_target(config, matches[0], requested)
        if len(matches) > 1:
            raise RouterError("UUIDを受け取るエンジンが複数あります。engine:UUID 形式で指定してください")
        raise RouterError("UUIDを受け取るエンジンが設定されていません")

    if _DIGITS.fullmatch(requested):
        default_engine = config.get("default_engine")
        if default_engine and config["engines"][default_engine]["id_type"] == "integer":
            return None, _make_target(config, default_engine, requested)
        matches = [name for name, engine in config["engines"].items() if engine["id_type"] == "integer"]
        if len(matches) == 1:
            return None, _make_target(config, matches[0], requested)
        if len(matches) > 1:
            raise RouterError("数値IDを受け取るエンジンが複数あります。engine:ID 形式で指定してください")
        raise RouterError("数値IDを受け取るエンジンが設定されていません")

    raise RouterError(f"話者が見つかりません: {requested}。--list で設定済みの別名を確認してください")


def _alias_index(config: dict[str, Any]) -> dict[str, tuple[str, dict[str, Any]]]:
    aliases: dict[str, tuple[str, dict[str, Any]]] = {}
    for canonical, speaker in config["speakers"].items():
        target = {
            "engine": speaker["engine"],
            "id": str(speaker["id"]),
            "style_id": speaker.get("style_id"),
        }
        names = [canonical, *speaker.get("aliases", [])]
        for alias in names:
            normalized = normalize_name(alias)
            previous = aliases.get(normalized)
            if previous and previous[0] != canonical:
                raise RouterError(f"別名が重複しています: {alias}（{previous[0]} / {canonical}）")
            aliases[normalized] = (canonical, target)
    return aliases


def _default_config_path() -> Path:
    config_home = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return config_home / "ptk" / "tts-router.json"


def _list_speakers(config: dict[str, Any]) -> None:
    aliases = _alias_index(config)
    for canonical, speaker in config["speakers"].items():
        names = [canonical, *speaker.get("aliases", [])]
        engine = config["engines"][speaker["engine"]]
        target = f"{speaker['engine']}:{speaker['id']}"
        style_id = speaker.get("style_id", engine.get("default_style_id"))
        if style_id is not None:
            target += f":{style_id}"
        print(f"{', '.join(names)} -> {target}")
    if not aliases:
        print("（名前の別名は未登録です。engine:ID 形式で直接指定できます）")


def run(config: dict[str, Any], requested: str, text: str) -> int:
    canonical, target = resolve_speaker(requested, config)
    engine = config["engines"][target["engine"]]
    child_env = os.environ.copy()
    child_env.update(engine.get("env", {}))
    child_env[engine["id_env"]] = str(target["id"])
    style_env = engine.get("style_env")
    if style_env:
        if target["style_id"] is None:
            child_env.pop(style_env, None)
        else:
            child_env[style_env] = str(target["style_id"])

    try:
        completed = subprocess.run(
            engine["command"],
            input=text,
            text=True,
            env=child_env,
            check=False,
        )
    except OSError as exc:
        label = canonical or requested
        print(f"ptk-tts-router: {label} のエンジンコマンドを起動できません: {exc}", file=sys.stderr)
        return 127
    return completed.returncode


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="話者名・IDをTTSエンジン用コマンドへ振り分けます")
    parser.add_argument("--config", default=str(_default_config_path()), help="JSON設定ファイル（既定: ~/.config/ptk/tts-router.json）")
    parser.add_argument("--speaker", "-s", help="話者名・別名・生ID（省略時は環境変数または設定のdefault_speaker）")
    parser.add_argument("--list", action="store_true", help="設定済みの話者名・IDを表示")
    args = parser.parse_args(argv)

    try:
        config = load_config(args.config)
        if args.list:
            _list_speakers(config)
            return 0
        requested = args.speaker or os.environ.get("PTK_TTS_SPEAKER") or config.get("default_speaker")
        if not requested:
            raise RouterError("話者が未指定です。--speaker、PTK_TTS_SPEAKER、または default_speaker を設定してください")
        text = sys.stdin.read().strip()
        if not text:
            return 0
        return run(config, requested, text)
    except RouterError as exc:
        print(f"ptk-tts-router: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

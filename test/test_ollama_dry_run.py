import contextlib
import http.server
import io
import json
import threading
import unittest

from scripts.ollama_dry_run import DEFAULT_MODEL, process_events


class OllamaMockHandler(http.server.BaseHTTPRequestHandler):
    calls = []
    status = 200
    response_body = {"response": "そうだったんですね。", "done": True}

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length))
        type(self).calls.append((self.path, payload))
        body = json.dumps(type(self).response_body).encode("utf-8")
        self.send_response(type(self).status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format, *_args):
        pass


class OllamaDryRunTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        OllamaMockHandler.calls = []
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), OllamaMockHandler)
        cls.server_thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.server_thread.join(timeout=2)

    def setUp(self):
        OllamaMockHandler.calls = []
        OllamaMockHandler.status = 200
        OllamaMockHandler.response_body = {"response": "そうだったんですね。", "done": True}

    def run_events(self, *events, url=None):
        input_text = "".join(f"{json.dumps(event, ensure_ascii=False)}\n" for event in events)
        output = io.StringIO()
        errors = io.StringIO()
        status = process_events(
            io.StringIO(input_text),
            output,
            errors,
            ollama_url=url or self.url,
            model=DEFAULT_MODEL,
        )
        return status, output.getvalue(), errors.getvalue()

    def test_chat_jsonl_calls_local_ollama_and_prints_candidate(self):
        event = {"type": "chat", "from": "🦊あき", "text": "今日は少し疲れた\nね"}
        status, output, errors = self.run_events(event)

        self.assertEqual(status, 0)
        self.assertEqual(output, "候補: そうだったんですね。\n")
        self.assertEqual(errors, "")
        self.assertEqual(len(OllamaMockHandler.calls), 1)
        path, payload = OllamaMockHandler.calls[0]
        self.assertEqual(path, "/api/generate")
        self.assertEqual(payload["model"], "llama3.2:latest")
        self.assertFalse(payload["stream"])
        self.assertIn(json.dumps(event["text"], ensure_ascii=False), payload["prompt"])
        self.assertIn("気持ちを受け止め", payload["prompt"])
        self.assertIn("頼まれていない助言や説教を避け", payload["prompt"])
        self.assertIn("人間と装わず", payload["prompt"])
        self.assertIn("知らないことを知ったふりしない", payload["prompt"])

    def test_skips_non_chat_event_and_continues_after_bad_jsonl(self):
        input_text = "".join(
            [
                json.dumps({"type": "presence", "from": "🦊あき"}, ensure_ascii=False),
                "\nnot-json\n",
                json.dumps({"type": "chat", "from": "🦊あき", "text": "こんにちは"}, ensure_ascii=False),
                "\n",
            ]
        )
        output = io.StringIO()
        errors = io.StringIO()
        status = process_events(io.StringIO(input_text), output, errors, ollama_url=self.url)

        self.assertEqual(status, 1)
        self.assertEqual(output.getvalue(), "候補: そうだったんですね。\n")
        self.assertIn("2行目: JSONLを読み取れません", errors.getvalue())
        self.assertEqual(len(OllamaMockHandler.calls), 1)

    def test_rejects_external_endpoint_without_network_access(self):
        status, output, errors = self.run_events(
            {"type": "chat", "from": "相手", "text": "こんにちは"},
            url="http://example.com:11434",
        )

        self.assertEqual(status, 2)
        self.assertEqual(output, "")
        self.assertIn("ループバックIP", errors)
        self.assertEqual(OllamaMockHandler.calls, [])

    def test_does_not_follow_redirects(self):
        OllamaMockHandler.status = 302
        OllamaMockHandler.response_body = {"location": "http://example.com/"}
        status, output, errors = self.run_events(
            {"type": "chat", "from": "相手", "text": "こんにちは"}
        )

        self.assertEqual(status, 1)
        self.assertEqual(output, "")
        self.assertIn("HTTP 302", errors)
        self.assertEqual(len(OllamaMockHandler.calls), 1)


if __name__ == "__main__":
    unittest.main()

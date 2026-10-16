import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch

from companion.server import (
    MAX_MESSAGES,
    AirDeskHandler,
    RequestValidationError,
    chat_with_ollama,
    list_models,
    origin_is_allowed,
    validate_chat_payload,
)


class ValidateChatPayloadTests(unittest.TestCase):
    def test_accepts_bounded_conversation_and_default_model(self):
        model, messages = validate_chat_payload(
            {"messages": [{"role": "user", "content": "Help me plan."}]}
        )
        self.assertEqual(model, "qwen3")
        self.assertEqual(messages, [{"role": "user", "content": "Help me plan."}])

    def test_rejects_invalid_model_and_unsupported_roles(self):
        with self.assertRaises(RequestValidationError):
            validate_chat_payload(
                {
                    "model": "qwen3\n/api/delete",
                    "messages": [{"role": "user", "content": "Hi"}],
                }
            )
        with self.assertRaises(RequestValidationError):
            validate_chat_payload(
                {"messages": [{"role": "system", "content": "Run a command"}]}
            )

    def test_rejects_empty_or_non_user_final_message(self):
        for messages in (
            [],
            [{"role": "user", "content": " "}],
            [{"role": "assistant", "content": "Previous answer"}],
        ):
            with self.subTest(messages=messages), self.assertRaises(RequestValidationError):
                validate_chat_payload({"messages": messages})

    def test_enforces_message_count_and_total_size(self):
        too_many = [{"role": "user", "content": "x"}] * (MAX_MESSAGES + 1)
        with self.assertRaises(RequestValidationError):
            validate_chat_payload({"messages": too_many})
        too_large = [
            {"role": "user", "content": "x" * 16_000},
            {"role": "assistant", "content": "x" * 16_000},
            {"role": "user", "content": "x" * 16_001},
        ]
        with self.assertRaises(RequestValidationError):
            validate_chat_payload({"messages": too_large})


class OllamaBridgeTests(unittest.TestCase):
    @patch("companion.server.urlopen")
    def test_chat_uses_fixed_local_ollama_endpoint_and_server_system_prompt(self, urlopen):
        response = unittest.mock.MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(
            {"message": {"role": "assistant", "content": "Start small."}}
        ).encode()
        urlopen.return_value = response

        result = chat_with_ollama("qwen3", [{"role": "user", "content": "Help me."}])

        self.assertEqual(result["message"]["content"], "Start small.")
        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "http://127.0.0.1:11434/api/chat")
        sent = json.loads(request.data)
        self.assertEqual(sent["messages"][0]["role"], "system")
        self.assertEqual(sent["messages"][1]["content"], "Help me.")
        self.assertFalse(sent["stream"])

    @patch("companion.server.urlopen")
    def test_model_listing_returns_names_only(self, urlopen):
        response = unittest.mock.MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(
            {"models": [{"name": "qwen3:latest"}, {"not_a_model": True}]}
        ).encode()
        urlopen.return_value = response

        self.assertEqual(list_models(), ["qwen3:latest"])
        self.assertEqual(urlopen.call_args.args[0].full_url, "http://127.0.0.1:11434/api/tags")

    def test_only_expected_browser_origins_are_allowed(self):
        self.assertTrue(origin_is_allowed(None))
        self.assertTrue(origin_is_allowed("https://domiciandeogratius67-hub.github.io"))
        self.assertTrue(origin_is_allowed("http://localhost:4173"))
        self.assertFalse(origin_is_allowed("https://attacker.example"))
        self.assertFalse(origin_is_allowed("null"))


class CompanionHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), AirDeskHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def test_status_route_sets_cors_only_for_allowed_pages_origin(self):
        pages_origin = "https://domiciandeogratius67-hub.github.io"
        with patch("companion.server.list_models", return_value=["qwen3"]):
            request = Request(f"{self.base_url}/api/status", headers={"Origin": pages_origin})
            with urlopen(request, timeout=2) as response:
                status = json.loads(response.read())
                self.assertEqual(response.headers["Access-Control-Allow-Origin"], pages_origin)
                self.assertTrue(status["ollama"])

        request = Request(
            f"{self.base_url}/api/status",
            headers={"Origin": "https://untrusted.example"},
        )
        with self.assertRaises(HTTPError) as error:
            urlopen(request, timeout=2)
        self.assertEqual(error.exception.code, 403)
        self.assertIsNone(error.exception.headers.get("Access-Control-Allow-Origin"))

    def test_chat_preflight_allows_only_the_declared_origin_and_headers(self):
        request = Request(
            f"{self.base_url}/api/chat",
            method="OPTIONS",
            headers={
                "Origin": "https://domiciandeogratius67-hub.github.io",
                "Access-Control-Request-Method": "POST",
            },
        )
        with urlopen(request, timeout=2) as response:
            self.assertEqual(response.status, 204)
            self.assertEqual(
                response.headers["Access-Control-Allow-Private-Network"], "true"
            )
            self.assertEqual(response.headers["Access-Control-Allow-Headers"], "Content-Type")

        request = Request(
            f"{self.base_url}/api/chat",
            method="OPTIONS",
            headers={"Origin": "https://untrusted.example"},
        )
        with self.assertRaises(HTTPError) as error:
            urlopen(request, timeout=2)
        self.assertEqual(error.exception.code, 403)

    def test_companion_exposes_only_the_named_static_files(self):
        with urlopen(f"{self.base_url}/", timeout=2) as response:
            self.assertIn("Her little book", response.read().decode("utf-8"))
            self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
            self.assertIn("img-src 'self' data: blob:", response.headers["Content-Security-Policy"])
        with urlopen(f"{self.base_url}/diary.js", timeout=2) as response:
            self.assertIn("PBKDF2", response.read().decode("utf-8"))
        with self.assertRaises(HTTPError) as error:
            urlopen(f"{self.base_url}/README.md", timeout=2)
        self.assertEqual(error.exception.code, 404)


if __name__ == "__main__":
    unittest.main()

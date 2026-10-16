#!/usr/bin/env python3
"""Loopback-only bridge between the AirDesk browser app and Ollama."""

from __future__ import annotations

import argparse
import json
import logging
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

APP_ROOT = Path(__file__).resolve().parent.parent
OLLAMA_URL = "http://127.0.0.1:11434"
MAX_BODY_BYTES = 64 * 1024
MAX_MESSAGES = 40
MAX_MESSAGE_CHARS = 16_000
MAX_TOTAL_CHARS = 48_000
MODEL_PATTERN = re.compile(r"^[\w./:-]{1,120}$", re.UNICODE)
SYSTEM_PROMPT = (
    "You are AirDesk AI, a thoughtful and practical thinking partner. "
    "Be warm, clear, and concise. Help the user explore ideas and find useful next steps."
)
ALLOWED_ORIGINS = {
    "https://domiciandeogratius67-hub.github.io",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8765",
    "http://127.0.0.1:8765",
}
STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/diary.js": ("diary.js", "text/javascript; charset=utf-8"),
    "/LICENSE": ("LICENSE", "text/plain; charset=utf-8"),
}


class RequestValidationError(ValueError):
    """A request is structurally valid JSON but not a supported AirDesk action."""


def validate_chat_payload(payload: object) -> tuple[str, list[dict[str, str]]]:
    """Validate a bounded conversation; only user/assistant messages are accepted."""
    if not isinstance(payload, dict):
        raise RequestValidationError("Request body must be a JSON object.")

    model = payload.get("model", "qwen3")
    if not isinstance(model, str) or not MODEL_PATTERN.fullmatch(model):
        raise RequestValidationError("Model must be a valid Ollama model name.")

    raw_messages = payload.get("messages")
    if not isinstance(raw_messages, list) or not 1 <= len(raw_messages) <= MAX_MESSAGES:
        raise RequestValidationError(f"Send between 1 and {MAX_MESSAGES} messages.")

    messages: list[dict[str, str]] = []
    total_chars = 0
    for item in raw_messages:
        if not isinstance(item, dict) or item.get("role") not in {"user", "assistant"}:
            raise RequestValidationError("Messages may only have user or assistant roles.")
        content = item.get("content")
        if not isinstance(content, str) or not content.strip() or "\x00" in content:
            raise RequestValidationError("Each message must contain text.")
        if len(content) > MAX_MESSAGE_CHARS:
            raise RequestValidationError("A message is too long.")
        total_chars += len(content)
        if total_chars > MAX_TOTAL_CHARS:
            raise RequestValidationError("The conversation is too long. Start a new chat.")
        messages.append({"role": item["role"], "content": content})

    if messages[-1]["role"] != "user":
        raise RequestValidationError("The last message must be from the user.")
    return model, messages


def ollama_request(path: str, payload: dict | None = None, timeout: int = 8) -> dict:
    """Call only the Ollama service on this machine."""
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(
        f"{OLLAMA_URL}{path}",
        data=data,
        headers={"Content-Type": "application/json"} if data is not None else {},
        method="POST" if data is not None else "GET",
    )
    with urlopen(request, timeout=timeout) as response:
        result = json.loads(response.read().decode("utf-8"))
    if not isinstance(result, dict):
        raise RuntimeError("Ollama returned an unexpected response.")
    return result


def list_models() -> list[str]:
    result = ollama_request("/api/tags")
    models = result.get("models", [])
    if not isinstance(models, list):
        raise RuntimeError("Ollama returned an invalid model list.")
    return [
        model["name"]
        for model in models
        if isinstance(model, dict) and isinstance(model.get("name"), str)
    ]


def chat_with_ollama(model: str, messages: list[dict[str, str]]) -> dict:
    conversation = [{"role": "system", "content": SYSTEM_PROMPT}, *messages]
    result = ollama_request(
        "/api/chat",
        {"model": model, "messages": conversation, "stream": False},
        timeout=180,
    )
    answer = result.get("message")
    if not isinstance(answer, dict) or not isinstance(answer.get("content"), str):
        raise RuntimeError("Ollama returned an invalid chat response.")
    return {"message": {"role": "assistant", "content": answer["content"]}}


def origin_is_allowed(origin: str | None) -> bool:
    return origin is None or origin in ALLOWED_ORIGINS


class AirDeskHandler(BaseHTTPRequestHandler):
    server_version = "AirDeskCompanion/1.0"
    sys_version = ""

    def log_message(self, message: str, *args: object) -> None:
        logging.info("%s - %s", self.address_string(), message % args)

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._add_security_headers()
        self.end_headers()
        self.wfile.write(body)

    def _add_security_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        if self.path in STATIC_FILES or self.path == "/":
            self.send_header(
                "Content-Security-Policy",
                "default-src 'self'; connect-src 'self' http://127.0.0.1:8765 "
                "http://localhost:8765; img-src 'self' data:; style-src 'self'; "
                "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
            )

    def _begin_api_response(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        origin = self.headers.get("Origin")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        origin = self.headers.get("Origin")
        if not origin_is_allowed(origin):
            self._send_json(403, {"error": "This browser origin is not allowed to use AirDesk."})
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Vary", "Origin")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:
        if self.path in {"/api/status", "/api/models"}:
            origin = self.headers.get("Origin")
            if not origin_is_allowed(origin):
                self._send_json(403, {"error": "This browser origin is not allowed to use AirDesk."})
                return
            if self.path == "/api/models":
                self._get_models()
            else:
                self._get_status()
            return

        file_info = STATIC_FILES.get(self.path)
        if file_info is None:
            self._send_json(404, {"error": "Not found."})
            return
        filename, content_type = file_info
        try:
            body = (APP_ROOT / filename).read_bytes()
        except OSError:
            self._send_json(500, {"error": "AirDesk static files could not be read."})
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self._add_security_headers()
        self.end_headers()
        self.wfile.write(body)

    def _get_status(self) -> None:
        try:
            models = list_models()
            self._begin_api_response(200, {"ok": True, "ollama": True, "models": models})
        except (HTTPError, URLError, OSError, TimeoutError, ValueError, RuntimeError) as error:
            self._begin_api_response(
                200,
                {"ok": True, "ollama": False, "models": [], "detail": str(error)[:240]},
            )

    def _get_models(self) -> None:
        try:
            self._begin_api_response(200, {"models": list_models()})
        except (HTTPError, URLError, OSError, TimeoutError, ValueError, RuntimeError) as error:
            self._begin_api_response(
                502, {"error": f"Could not read Ollama models: {str(error)[:240]}"}
            )

    def do_POST(self) -> None:
        if self.path != "/api/chat":
            self._send_json(404, {"error": "Not found."})
            return
        origin = self.headers.get("Origin")
        if not origin_is_allowed(origin):
            self._send_json(403, {"error": "This browser origin is not allowed to use AirDesk."})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send_json(400, {"error": "Content-Length must be a number."})
            return
        if length < 1 or length > MAX_BODY_BYTES:
            self._send_json(413, {"error": "Request must be between 1 byte and 64 KB."})
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            model, messages = validate_chat_payload(payload)
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send_json(400, {"error": "Request body must be valid UTF-8 JSON."})
            return
        except RequestValidationError as error:
            self._send_json(400, {"error": str(error)})
            return

        try:
            self._begin_api_response(200, chat_with_ollama(model, messages))
        except HTTPError as error:
            try:
                detail = error.read(500).decode("utf-8", errors="replace")
            except OSError:
                detail = str(error)
            self._begin_api_response(502, {"error": f"Ollama rejected the request: {detail[:240]}"})
        except (URLError, OSError, TimeoutError, ValueError, RuntimeError) as error:
            self._begin_api_response(
                502, {"error": f"Could not get a reply from Ollama: {str(error)[:240]}"}
            )


def serve(port: int) -> None:
    if not 1 <= port <= 65535:
        raise ValueError("Port must be between 1 and 65535.")
    server = ThreadingHTTPServer(("127.0.0.1", port), AirDeskHandler)
    logging.info("Traford AirDesk companion is listening on http://127.0.0.1:%s", port)
    logging.info("Press Ctrl+C to stop. This service is bound to this computer only.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logging.info("Stopping AirDesk companion.")
    finally:
        server.server_close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the local Traford AirDesk companion.")
    parser.add_argument("--port", type=int, default=8765, help="loopback port (default: 8765)")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    serve(args.port)


if __name__ == "__main__":
    main()

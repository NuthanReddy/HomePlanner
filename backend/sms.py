from typing import Protocol
import secrets
import threading
import time

from azure.communication.sms import SmsClient
from azure.core.exceptions import AzureError
from azure.identity import DefaultAzureCredential

from .config import Settings


class SmsUnavailable(Exception):
    pass


class SmsSender(Protocol):
    def send_code(self, phone: str, code: str) -> str | None: ...

    def close(self) -> None: ...


class AzureSmsSender:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.credential = None
        self.client = None
        if settings.sms_enabled:
            self.credential = DefaultAzureCredential()
            self.client = SmsClient(
                settings.sms_endpoint,
                self.credential,
                retry_total=0,
                connection_timeout=5,
                read_timeout=10,
            )

    def send_code(self, phone: str, code: str) -> None:
        if not self.client:
            raise SmsUnavailable("SMS delivery is not configured.")
        try:
            results = self.client.send(
                from_=self.settings.sms_sender,
                to=[phone],
                message=f"HomePlanner verification code: {code}. Do not share this code.",
                enable_delivery_report=True,
            )
        except AzureError as error:
            # Provider exceptions can contain recipient/message data; do not log them.
            raise SmsUnavailable("SMS provider rejected the request.") from error
        if len(results) != 1 or not results[0].successful:
            raise SmsUnavailable("SMS provider did not accept the message.")

    def close(self) -> None:
        if self.client:
            self.client.close()
        if self.credential:
            self.credential.close()


class LocalOtpInbox:
    """Ephemeral simulated delivery, gated by the API's loopback boundary."""

    def __init__(self, ttl_seconds: int, clock=time.time):
        self.ttl_seconds = ttl_seconds
        self.clock = clock
        self.entries: dict[str, tuple[str, float]] = {}
        self.lock = threading.Lock()

    def _prune(self):
        now = self.clock()
        self.entries = {
            ticket: entry for ticket, entry in self.entries.items() if entry[1] > now
        }

    def send_code(self, phone: str, code: str) -> str:
        with self.lock:
            self._prune()
            if len(self.entries) >= 100:
                raise SmsUnavailable("Local inbox capacity reached.")
            ticket = secrets.token_urlsafe(32)
            self.entries[ticket] = (code, self.clock() + self.ttl_seconds)
            return ticket

    def read(self, ticket: str) -> str | None:
        with self.lock:
            self._prune()
            entry = self.entries.get(ticket)
            return entry[0] if entry else None

    def close(self):
        with self.lock:
            self.entries.clear()

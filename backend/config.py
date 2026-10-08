from typing import Literal
from urllib.parse import urlsplit

from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="HOMEPLANNER_", env_file=".env.platform", extra="ignore",
        hide_input_in_errors=True,
    )

    environment: Literal["development", "production"] = "production"
    database_url: str
    auth_secret: SecretStr
    allowed_origins: list[str] = ["http://localhost:5173"]
    sms_endpoint: str | None = None
    sms_sender: str | None = None
    sms_enabled: bool = False
    local_otp_inbox: bool = False
    otp_ttl_seconds: int = 300
    session_ttl_seconds: int = 86400

    @model_validator(mode="after")
    def validate_runtime(self):
        if len(self.auth_secret.get_secret_value()) < 32:
            raise ValueError("Use an independent random auth secret of at least 32 characters.")
        if not 60 <= self.otp_ttl_seconds <= 600:
            raise ValueError("OTP lifetime must be between 60 and 600 seconds.")
        if not 300 <= self.session_ttl_seconds <= 86400:
            raise ValueError("Session lifetime must be between 300 and 86400 seconds.")
        if self.environment == "production":
            if not self.database_url.startswith("postgresql+psycopg://"):
                raise ValueError("Production requires PostgreSQL with the psycopg driver.")
            if not self.allowed_origins or any(
                urlsplit(origin).scheme != "https" for origin in self.allowed_origins
            ):
                raise ValueError("Production requires explicit HTTPS origins.")
        if not self.database_url.startswith(("postgresql+psycopg://", "sqlite:///")):
            raise ValueError("Use PostgreSQL, or SQLite for isolated development only.")
        for origin in self.allowed_origins:
            parsed = urlsplit(origin)
            if not parsed.netloc or parsed.path or parsed.query or parsed.fragment:
                raise ValueError("Allowed origins must be exact scheme/host/port origins.")
        if self.sms_enabled and (not self.sms_endpoint or not self.sms_sender):
            raise ValueError("Enabled SMS requires an ACS endpoint and approved sender.")
        if self.local_otp_inbox:
            if self.environment != "development" or self.sms_enabled:
                raise ValueError("Local OTP inbox requires development with live SMS disabled.")
            if not self.allowed_origins or any(
                urlsplit(origin).scheme != "http"
                or urlsplit(origin).hostname not in {"localhost", "127.0.0.1", "::1"}
                for origin in self.allowed_origins
            ):
                raise ValueError("Local OTP inbox requires explicit loopback HTTP origins.")
        return self

    @property
    def cookie_name(self) -> str:
        return "__Host-homeplanner" if self.environment == "production" else "homeplanner"

"""Explicit loopback-only startup for the development metadata platform."""

import argparse
import secrets
from pathlib import Path

from alembic import command
from alembic.config import Config
import uvicorn

from .api import create_app
from .config import Settings


ROOT = Path(__file__).resolve().parents[1]


def local_settings(directory: Path) -> Settings:
    directory.mkdir(parents=True, exist_ok=True)
    secret_path = directory / "auth-secret"
    try:
        with secret_path.open("x", encoding="ascii") as stream:
            stream.write(secrets.token_urlsafe(48))
    except FileExistsError:
        pass
    secret = secret_path.read_text(encoding="ascii").strip()
    return Settings(
        _env_file=None,
        environment="development",
        database_url=f"sqlite:///{(directory / 'platform.db').resolve().as_posix()}",
        auth_secret=secret,
        allowed_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        sms_enabled=False,
        local_otp_inbox=True,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--init-only", action="store_true", help="Initialize the dedicated local database, then exit.")
    parser.add_argument("--data-dir", type=Path, default=ROOT / ".local-platform",
                        help="Dedicated local platform data directory; defaults to ignored .local-platform.")
    args = parser.parse_args()
    settings = local_settings(args.data_dir.resolve())
    app = create_app(settings)
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "backend" / "migrations"))
    with app.state.engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
    if args.init_only:
        app.state.engine.dispose()
        return
    print("Local development: simulated OTP inbox; no SMS or phone ownership verification.")
    print("Open http://localhost:5173/platform.html after starting npm run dev:platform.")
    uvicorn.run(app, host="127.0.0.1", port=8001, proxy_headers=False, access_log=False)


if __name__ == "__main__":
    main()

"""Disposable loopback-only browser fixture; never sends SMS or uses cloud data."""
import sys
import argparse
import tempfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from alembic import command
from alembic.config import Config
import uvicorn

from backend.api import create_app
from backend.config import Settings
from test_platform_api import RecordingSms


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, choices=[8001, 8002, 8003], default=8001)
    parser.add_argument("--origin", choices=["http://localhost:5173", "http://127.0.0.1:5174", "http://127.0.0.1:5175"],
                        default="http://localhost:5173")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="homeplanner-browser-fixture-") as directory:
        settings = Settings(
            environment="development",
            database_url=f"sqlite:///{Path(directory) / 'fixture.db'}",
            auth_secret="synthetic-browser-fixture-only-" + "x" * 32,
            allowed_origins=[args.origin],
            sms_enabled=False,
        )
        app = create_app(settings, RecordingSms())
        config = Config("alembic.ini")
        with app.state.engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
        with patch("backend.api.secrets.randbelow", return_value=123456):
            print(f"Disposable fixture: {directory}", flush=True)
            uvicorn.run(app, host="127.0.0.1", port=args.port, proxy_headers=False, log_level="warning")

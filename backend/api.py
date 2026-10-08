import hashlib
import hmac
import logging
import secrets
import time
from contextlib import asynccontextmanager
from typing import Annotated
from uuid import UUID

import phonenumbers
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy import create_engine, event, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from .config import Settings
from .models import AuthLimit, Challenge, LoginSession, Project, ProjectRevision, User, new_id
from .sms import AzureSmsSender, LocalOtpInbox, SmsSender, SmsUnavailable
import python_analysis
from .workspace import WorkspaceCommand, Site, Costs, execute_workspace, read_workspace, time_zones, time_zone_labels
from .site import feasibility, cost_estimate, utilization, plot_options, SOURCES
from .solar import SolarInput, calculate_site_solar
from .wind import WindInput, WeatherError, calculate_wind
from .materials import Materials, MaterialsRequest, PRESETS as MATERIAL_PRESETS, calculate_materials
from .design import DesignSave, read_design, save_design

logger = logging.getLogger("homeplanner.platform")


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PhoneInput(Input):
    phone: str = Field(max_length=32)

    @field_validator("phone")
    @classmethod
    def valid_phone(cls, value: str) -> str:
        if not value.startswith("+"):
            raise ValueError("Include the international country code.")
        try:
            parsed = phonenumbers.parse(value, None)
        except phonenumbers.NumberParseException as error:
            raise ValueError("Enter a valid international phone number.") from error
        if not phonenumbers.is_valid_number(parsed):
            raise ValueError("Enter a valid international phone number.")
        return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)


class VerifyInput(Input):
    challenge_id: UUID
    code: str = Field(pattern=r"^[0-9]{6}$")


class InboxInput(Input):
    ticket: str = Field(min_length=40, max_length=64)


class AnalysisInput(Input):
    inputs: dict


class ProjectInput(Input):
    name: str = Field(default="Untitled project", min_length=1, max_length=150)

    @field_validator("name")
    @classmethod
    def trimmed_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Project name cannot be blank.")
        return value


class RenameInput(ProjectInput):
    expected_version: StrictInt = Field(ge=0, le=2147483646)


def create_app(
    settings: Settings | None = None,
    sms_sender: SmsSender | None = None,
    clock=time.time,
) -> FastAPI:
    settings = settings or Settings()
    engine = create_engine(
        settings.database_url,
        pool_pre_ping=True,
        hide_parameters=True,
        **({"connect_args": {"check_same_thread": False, "timeout": 30}} if settings.database_url.startswith("sqlite") else {}),
    )
    if engine.dialect.name == "sqlite":
        @event.listens_for(engine, "connect")
        def sqlite_foreign_keys(connection, _record):
            cursor = connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()
    sessions = sessionmaker(engine, expire_on_commit=False)
    sender = sms_sender or (
        LocalOtpInbox(settings.otp_ttl_seconds, clock)
        if settings.local_otp_inbox else AzureSmsSender(settings)
    )

    @asynccontextmanager
    async def lifespan(_app):
        yield
        sender.close()
        engine.dispose()

    app = FastAPI(title="HomePlanner Platform", version="0.1.0", lifespan=lifespan)
    app.state.engine = engine

    def digest(value: str) -> str:
        return hmac.new(
            settings.auth_secret.get_secret_value().encode(), value.encode(), hashlib.sha256
        ).hexdigest()

    def db():
        with sessions() as session:
            yield session

    DB = Annotated[Session, Depends(db)]

    @app.middleware("http")
    async def request_boundary(request: Request, call_next):
        if settings.local_otp_inbox and (
            not request.client or request.client.host not in {"127.0.0.1", "::1"}
            or request.url.hostname not in {"localhost", "127.0.0.1", "::1"}
        ):
            return JSONResponse({"detail": "Local development access requires loopback."}, status_code=403)
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            if request.headers.get("origin") not in settings.allowed_origins:
                return JSONResponse({"detail": "Untrusted request origin."}, status_code=403)
            if request.headers.get("content-type", "").split(";")[0] != "application/json":
                return JSONResponse({"detail": "JSON requests are required."}, status_code=415)
        # Read an enforced small body budget rather than trusting Content-Length.
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            body_limit = (8 * 1024 * 1024 if request.url.path.endswith(("/workspace/wind", "/design"))
                          else 131072 if request.url.path.endswith("/workspace/commands") else 16384)
            if len(body) > body_limit:
                return JSONResponse({"detail": "Request is too large."}, status_code=413)
        request._body = bytes(body)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.exception_handler(RequestValidationError)
    async def invalid_input(_request, error):
        # FastAPI's default includes input values; omit phone numbers and OTP codes.
        return JSONResponse(
            {"detail": [
                {"loc": entry["loc"], "msg": entry["msg"], "type": entry["type"]}
                for entry in error.errors()
            ]},
            status_code=422,
        )

    @app.exception_handler(SQLAlchemyError)
    async def database_error(_request, error):
        logger.error("Platform database operation failed (%s).", type(error).__name__)
        return JSONResponse({"detail": "Storage is unavailable. Please retry."}, status_code=503)

    def authenticated(request: Request, session: DB) -> LoginSession:
        token = request.cookies.get(settings.cookie_name, "")
        login = session.get(LoginSession, digest("session:" + token)) if token else None
        if not login or login.expires_at <= int(clock()):
            raise HTTPException(401, "Sign in to continue.")
        if request.method not in {"GET", "HEAD"} and not hmac.compare_digest(
            login.csrf_digest, digest("csrf:" + request.headers.get("x-csrf-token", ""))
        ):
            raise HTTPException(403, "Invalid request verification token.")
        return login

    AUTH = Annotated[LoginSession, Depends(authenticated)]

    def throttle(session: Session, key: str, now: int, limit: int, cooldown: int = 0):
        hashed = digest("rate:" + key)
        dialect = session.bind.dialect.name
        if dialect not in {"postgresql", "sqlite"}:
            raise RuntimeError("Unsupported platform database.")
        insert = pg_insert if dialect == "postgresql" else sqlite_insert
        session.execute(
            insert(AuthLimit).values(
                key=hashed, window_start=now, count=0, last_request=0
            ).on_conflict_do_nothing(index_elements=["key"])
        )
        row = session.scalar(select(AuthLimit).where(AuthLimit.key == hashed).with_for_update())
        if now - row.window_start >= 3600:
            row.window_start = now
            row.count = 0
        if row.count >= limit or (row.last_request and now - row.last_request < cooldown):
            raise HTTPException(429, "Too many requests. Try again later.")
        row.count += 1
        row.last_request = now

    @app.get("/api/v1/health/live")
    def live():
        return {"status": "live"}

    @app.get("/api/v1/health/ready")
    def ready(session: DB):
        session.execute(select(User.id).limit(1))
        return {"status": "ready"}

    @app.get("/api/v1/auth/delivery")
    def delivery():
        return {"mode": "local-inbox" if settings.local_otp_inbox else "sms"}

    @app.post("/api/v1/auth/local-inbox")
    def local_inbox(value: InboxInput):
        if not settings.local_otp_inbox or not isinstance(sender, LocalOtpInbox):
            raise HTTPException(404, "Local inbox is not enabled.")
        code = sender.read(value.ticket)
        if code is None:
            raise HTTPException(404, "Local code is unavailable or expired. Request a new code.")
        return {"code": code, "delivery": "simulated-local-only"}

    @app.post("/api/v1/auth/challenges", status_code=202)
    def request_code(value: PhoneInput, request: Request, session: DB):
        now = int(clock())
        with session.begin():
            throttle(session, "sms-total", now, 100)
            throttle(session, "ip:" + request.client.host, now, 20)
            throttle(session, "phone:" + value.phone, now, 5, 60)
            session.execute(
                update(Challenge).where(
                    Challenge.phone == value.phone, Challenge.status.in_(["pending", "sent"])
                ).values(status="superseded")
            )
            identifier = new_id()
            code = f"{secrets.randbelow(1000000):06d}"
            challenge = Challenge(
                id=identifier, phone=value.phone,
                code_digest=digest(f"otp:{identifier}:{code}"),
                expires_at=now + settings.otp_ttl_seconds,
            )
            session.add(challenge)
        try:
            ticket = sender.send_code(value.phone, code)
        except SmsUnavailable:
            with session.begin():
                session.execute(
                    update(Challenge).where(
                        Challenge.id == identifier, Challenge.status == "pending"
                    ).values(status="failed")
                )
            logger.warning("SMS submission failed; challenge invalidated.")
            raise HTTPException(503, "SMS is unavailable. No usable code was issued.")
        with session.begin():
            session.execute(
                update(Challenge).where(
                    Challenge.id == identifier, Challenge.status == "pending"
                ).values(status="sent")
            )
        result = {"challenge_id": identifier, "expires_in": settings.otp_ttl_seconds, "resend_after": 60}
        if settings.local_otp_inbox and isinstance(sender, LocalOtpInbox):
            result["local_inbox_ticket"] = ticket
        return result

    @app.post("/api/v1/auth/verify")
    def verify(value: VerifyInput, request: Request, response: Response, session: DB):
        now = int(clock())
        failure = False
        with session.begin():
            throttle(session, "verify-ip:" + request.client.host, now, 100)
            challenge = session.scalar(
                select(Challenge).where(Challenge.id == str(value.challenge_id)).with_for_update()
            )
            if (
                not challenge or challenge.status != "sent"
                or challenge.expires_at <= now or challenge.attempts >= 5
            ):
                failure = True
            else:
                challenge.attempts += 1
                if not hmac.compare_digest(
                    challenge.code_digest, digest(f"otp:{challenge.id}:{value.code}")
                ):
                    failure = True
                else:
                    challenge.status = "consumed"
                    user = session.scalar(select(User).where(User.phone == challenge.phone))
                    if not user:
                        user = User(phone=challenge.phone, created_at=now)
                        session.add(user)
                        session.flush()
                    token = secrets.token_urlsafe(32)
                    token_digest = digest("session:" + token)
                    csrf = digest("csrf-value:" + token_digest)
                    login = LoginSession(
                        token_digest=token_digest, user_id=user.id,
                        csrf_digest=digest("csrf:" + csrf),
                        expires_at=now + settings.session_ttl_seconds,
                    )
                    session.add(login)
        if failure:
            raise HTTPException(400, "Code is invalid, expired or already used.")
        response.set_cookie(
            settings.cookie_name, token, httponly=True, samesite="strict",
            secure=settings.environment == "production", path="/",
            max_age=settings.session_ttl_seconds,
        )
        return {"user_id": login.user_id, "csrf_token": csrf}

    @app.get("/api/v1/auth/session")
    def current_session(login: AUTH):
        csrf = digest("csrf-value:" + login.token_digest)
        return {"user_id": login.user_id, "csrf_token": csrf}

    @app.post("/api/v1/auth/logout", status_code=204)
    def logout(login: AUTH, session: DB, response: Response):
        session.delete(login)
        session.commit()
        response.delete_cookie(settings.cookie_name, path="/", secure=settings.environment == "production",
                               httponly=True, samesite="strict")

    def project_data(project: Project):
        return {key: getattr(project, key) for key in
                ("id", "name", "version", "created_at", "updated_at")}

    @app.get("/api/v1/projects")
    def list_projects(login: AUTH, session: DB, offset: int = 0):
        if offset < 0 or offset > 1000000:
            raise HTTPException(422, "Invalid pagination offset.")
        records = session.scalars(
            select(Project).where(Project.owner_id == login.user_id)
            .order_by(Project.updated_at.desc(), Project.id).offset(offset).limit(50)
        )
        return {"items": [project_data(project) for project in records]}

    @app.post("/api/v1/projects", status_code=201)
    def create_project(value: ProjectInput, login: AUTH, session: DB):
        now = int(clock())
        project = Project(owner_id=login.user_id, name=value.name, created_at=now, updated_at=now)
        session.add(project)
        session.flush()
        session.add(ProjectRevision(
            project_id=project.id, version=0, metadata_snapshot={"name": project.name}, created_at=now
        ))
        session.commit()
        return project_data(project)

    def owned_project(identifier: UUID, login: LoginSession, session: Session) -> Project:
        project = session.scalar(
            select(Project).where(Project.id == str(identifier), Project.owner_id == login.user_id)
        )
        if not project:
            raise HTTPException(404, "Project not found.")
        return project

    @app.post("/api/v1/projects/{identifier}/analysis/{kind}")
    def python_calculation(identifier: UUID, kind: str, value: AnalysisInput, login: AUTH, session: DB):
        project = owned_project(identifier, login, session)
        engines = {
            "solar-position": python_analysis.calculate_solar,
            "air-density": python_analysis.calculate_density,
        }
        calculate = engines.get(kind)
        if calculate is None:
            raise HTTPException(422, "This Python engine adapter is not implemented.")
        try:
            result = calculate(value.inputs)
        except python_analysis.AnalysisError as error:
            raise HTTPException(error.status, str(error)) from None
        return {
            "project_id": project.id, "metadata_version": project.version,
            "scope": "supplied-input-utility-not-plan-study", "result": result,
        }

    @app.get("/api/v1/site/options")
    def site_options(login: AUTH):
        return {"time_zones": time_zones(), "time_zone_labels": time_zone_labels(), "sources": SOURCES}

    @app.get("/api/v1/projects/{identifier}/workspace")
    def workspace(identifier: UUID, login: AUTH, session: DB):
        owned_project(identifier, login, session)
        return read_workspace(session, str(identifier))

    @app.get("/api/v1/projects/{identifier}/design")
    def design_snapshot(identifier: UUID, login: AUTH, session: DB):
        owned_project(identifier, login, session)
        return read_design(session, str(identifier))

    @app.post("/api/v1/projects/{identifier}/design")
    def design_save(identifier: UUID, value: DesignSave, login: AUTH, session: DB):
        owned_project(identifier, login, session)
        try:
            return save_design(session, str(identifier), value)
        except IntegrityError:
            session.rollback()
            raise HTTPException(409, "Saved Design changed elsewhere. Your working copy is retained.") from None

    @app.post("/api/v1/projects/{identifier}/workspace/commands")
    def workspace_command(identifier: UUID, value: WorkspaceCommand, login: AUTH, session: DB):
        owned_project(identifier, login, session)
        try:
            return execute_workspace(session, str(identifier), value)
        except ValidationError as error:
            raise HTTPException(422, "; ".join(entry["msg"] for entry in error.errors())) from None
        except IntegrityError:
            session.rollback()
            raise HTTPException(409, "Workspace changed elsewhere. Reload; your draft is retained.") from None

    @app.get("/api/v1/projects/{identifier}/workspace/evaluation")
    def site_evaluation(identifier: UUID, login: AUTH, session: DB):
        owned_project(identifier, login, session)
        record = read_workspace(session, str(identifier))
        site = Site.model_validate(record["document"]["site"])
        costs = Costs.model_validate(record["document"]["costs"])
        return {"project_id": str(identifier), "version": record["version"],
                "feasibility": feasibility(site), "costs": cost_estimate(site, costs),
                "utilization": utilization(site, costs)}

    @app.post("/api/v1/projects/{identifier}/workspace/plot-options")
    def native_plot_options(identifier: UUID, value: AnalysisInput, login: AUTH, session: DB):
        owned_project(identifier, login, session)
        try:
            site = Site.model_validate(value.inputs)
        except ValidationError as error:
            raise HTTPException(422, "; ".join(entry["msg"] for entry in error.errors())) from None
        return plot_options(site)

    @app.post("/api/v1/projects/{identifier}/workspace/weather")
    def site_weather(identifier: UUID, value: AnalysisInput, login: AUTH, session: DB):
        owned_project(identifier, login, session)
        record = read_workspace(session, str(identifier))
        if set(value.inputs) != {"expected_version", "acknowledgeOpenMeteo"}:
            raise HTTPException(422, "Supply expected_version and acknowledgeOpenMeteo only.")
        if value.inputs["expected_version"] != record["version"]:
            raise HTTPException(409, "The saved site changed. Reload before requesting weather.")
        site = record["document"]["site"]
        if site["weather_source"] != "location":
            raise HTTPException(422, "Select and apply location-based weather first.")
        try:
            result = python_analysis.calculate_current_weather_density({
                "latitude": site["latitude"], "longitude": site["longitude"],
                "acknowledgeOpenMeteo": value.inputs["acknowledgeOpenMeteo"]})
        except python_analysis.AnalysisError as error:
            raise HTTPException(error.status, str(error)) from None
        return {"project_id": str(identifier), "version": record["version"], "result": result}

    @app.post("/api/v1/projects/{identifier}/workspace/solar")
    def site_solar(identifier: UUID, value: SolarInput, login: AUTH, session: DB):
        owned_project(identifier, login, session)
        record = read_workspace(session, str(identifier))
        if value.expected_version != record["version"]:
            raise HTTPException(409, "The saved site changed. Reload before calculating Solar.")
        try:
            result = calculate_site_solar(Site.model_validate(record["document"]["site"]), value)
        except python_analysis.AnalysisError as error:
            raise HTTPException(error.status, str(error)) from None
        session.expire_all()
        if read_workspace(session, str(identifier))["version"] != record["version"]:
            raise HTTPException(409, "The saved site changed during calculation. Reload and calculate again.")
        return {"project_id": str(identifier), "version": record["version"],
                "scope": "site-solar-position-not-shading", "result": result}

    @app.post("/api/v1/projects/{identifier}/workspace/materials")
    def materials_study(identifier: UUID, value: MaterialsRequest, login: AUTH, session: DB):
        owned_project(identifier, login, session)
        record = read_workspace(session, str(identifier))
        if value.expected_version != record["version"]:
            raise HTTPException(409, "Workspace changed. Reload before evaluating applied materials.")
        result = calculate_materials(Materials.model_validate(record["document"]["materials"]))
        session.expire_all()
        if read_workspace(session, str(identifier))["version"] != record["version"]:
            raise HTTPException(409, "Workspace changed during calculation. Reload and evaluate again.")
        return {"project_id": str(identifier), "version": record["version"],
                "scope": "assembly-descriptors-not-zone-simulation", "result": result,
                "presets": MATERIAL_PRESETS}

    @app.get("/api/v1/projects/{identifier}/workspace/materials-options")
    def materials_options(identifier: UUID, login: AUTH, session: DB):
        owned_project(identifier, login, session)
        return {"presets": MATERIAL_PRESETS}

    @app.post("/api/v1/projects/{identifier}/workspace/wind")
    def site_wind(identifier: UUID, value: WindInput, login: AUTH, session: DB):
        owned_project(identifier, login, session)
        record = read_workspace(session, str(identifier))
        if value.expected_version != record["version"]:
            raise HTTPException(409, "The workspace changed. Reload before calculating Wind.")
        try:
            result = calculate_wind(Site.model_validate(record["document"]["site"]), value)
        except WeatherError as error:
            raise HTTPException(422, str(error)) from None
        session.expire_all()
        if read_workspace(session, str(identifier))["version"] != record["version"]:
            raise HTTPException(409, "The workspace changed during calculation. Reload and calculate again.")
        return {"project_id": str(identifier), "version": record["version"],
                "scope": "imported-weather-not-ventilation", "result": result}

    @app.get("/api/v1/projects/{identifier}")
    def get_project(identifier: UUID, login: AUTH, session: DB):
        return project_data(owned_project(identifier, login, session))

    @app.patch("/api/v1/projects/{identifier}")
    def rename_project(identifier: UUID, value: RenameInput, login: AUTH, session: DB):
        owned_project(identifier, login, session)
        now = int(clock())
        result = session.execute(
            update(Project).where(
                Project.id == str(identifier), Project.owner_id == login.user_id,
                Project.version == value.expected_version,
            ).values(name=value.name, version=value.expected_version + 1, updated_at=now)
        )
        if result.rowcount != 1:
            session.rollback()
            raise HTTPException(409, "Project changed elsewhere. Reload before saving; your draft is retained.")
        session.add(ProjectRevision(
            project_id=str(identifier), version=value.expected_version + 1,
            metadata_snapshot={"name": value.name}, created_at=now,
        ))
        session.commit()
        session.expire_all()
        return project_data(owned_project(identifier, login, session))

    @app.get("/api/v1/projects/{identifier}/jobs")
    def jobs(identifier: UUID, login: AUTH, session: DB):
        owned_project(identifier, login, session)
        return {"items": [], "availability": "unavailable", "reason": "Worker migration is not implemented yet."}

    @app.get("/api/v1/capabilities")
    def capabilities(login: AUTH):
        return {
            "project_metadata": True, "sms_configured": settings.sms_enabled,
            "geometry_editing": False, "simulations": False, "alternate_plans": False,
            "exports": False,
        }

    return app

import json
import shutil
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.api import create_app
from backend.config import Settings
from backend.wind import FIELDS, WindInput, WeatherError, calculate_wind, parse_epw, parse_json
from backend.workspace import Site
from test_platform_api import RecordingSms


def row(timestamp="2024-01-01T01:00:00Z", speed=2, direction=0, duration=3600):
    return {"timestamp": timestamp, "durationSeconds": duration, "windSpeedMps": speed, "windFromDeg": direction}


def data(records=None, **kwargs):
    return {"kind": "scenario", "source": {"label": "Synthetic test only"}, "timeZoneOffsetHours": 0,
            "records": records if records is not None else [row()], **kwargs}


def inputs(payload=None, **kwargs):
    return WindInput(expected_version=0, format="json", text=json.dumps(payload or data()), **kwargs)


def epw(per_hour=1):
    headers = ['LOCATION,"Synthetic, test",State,Country,TMY,123,17,78,5.5,10',
               "DESIGN CONDITIONS,0", "TYPICAL/EXTREME PERIODS,0", "GROUND TEMPERATURES,0",
               "HOLIDAYS/DAYLIGHT SAVINGS,No,0,0,0", "COMMENTS 1,test", "COMMENTS 2,test",
               f"DATA PERIODS,1,{per_hour},Data,Monday,1/1,12/31"]
    record = ["0"] * 35
    record[:5] = ["2024", "2", "29", "1", "60"]
    for index, value in {6: 25, 8: 60, 9: 101325, 13: 300, 14: 100, 15: 200, 20: 360, 21: 3.6}.items():
        record[index] = str(value)
    return "\n".join(headers + [",".join(record)])


class WindTests(unittest.TestCase):
    def test_epw_hour_end_leap_day_units_and_provenance(self):
        result = parse_epw(epw(2))
        record = result["records"][0]
        self.assertEqual(record["timestamp"], "2024-02-28T19:30:00.000Z")
        self.assertEqual(record["sourceTime"]["minute"], 60)
        self.assertEqual(record["durationSeconds"], 1800)
        self.assertEqual(record["ghiWm2"], 600)
        self.assertEqual(record["windFromDeg"], 0)
        self.assertEqual(result["kind"], "tmy")
        self.assertEqual(result["source"]["city"], "Synthetic, test")
        self.assertIsNone(result["source"]["windReferenceHeightM"])
        with self.assertRaises(WeatherError):
            parse_epw(epw().replace("LOCATION", "BAD", 1))
        with self.assertRaises(WeatherError):
            parse_epw(epw().replace("2024,2,29", "2023,2,29"))

    def test_json_unknown_flags_units_duplicates_gaps_and_bad_dates(self):
        payload = data([
            row(speed=36, direction=360), row(speed=72),
            {**row("2024-01-01T03:00:00Z", speed=36), "missing": ["windSpeedMps"]},
            row("2024-02-30T01:00:00Z"), row("2024-01-01T04:00:00"),
            row("2024-01-01T04:00:00+00:99"),
            row("2024-01-01T05:00:00Z", speed=True),
        ], units={"windSpeedMps": "km/h"})
        result = parse_json(json.dumps(payload))
        self.assertEqual(result["coverage"]["recordCount"], 3)
        self.assertEqual(result["coverage"]["duplicates"], 1)
        self.assertEqual(result["coverage"]["gaps"], 2)
        self.assertEqual(result["records"][0]["windSpeedMps"], 10)
        self.assertEqual(result["records"][0]["windFromDeg"], 0)
        self.assertIsNone(result["records"][1]["windSpeedMps"])
        self.assertIsNone(result["records"][2]["windSpeedMps"])
        self.assertTrue(any("malformed" in warning for warning in result["warnings"]))
        with self.assertRaises(WeatherError):
            parse_json('{"records": [], "temperatureC": NaN}')
        bad = data([row(speed=999, direction=999)], units={"windSpeedMps": "knots"})
        self.assertIsNone(parse_json(json.dumps(bad))["records"][0]["windSpeedMps"])

    def test_open_meteo_units_time_and_no_assumed_local_offset(self):
        provider = {"timezone": "UTC", "latitude": 17, "longitude": 78,
                    "hourly": {"time": ["2024-01-01T01:00"], "wind_speed_10m": [36], "wind_direction_10m": [90]},
                    "hourly_units": {"wind_speed_10m": "km/h", "wind_direction_10m": "°"}}
        result = parse_json(json.dumps(provider))
        self.assertEqual(result["records"][0]["windSpeedMps"], 10)
        self.assertEqual(result["records"][0]["windFromDeg"], 90)
        self.assertEqual(result["source"]["windReferenceHeightM"], 10)
        self.assertEqual(result["kind"], "unclassified")
        self.assertIsNone(result["records"][0]["temperatureC"])
        provider["timezone"] = "Asia/Kolkata"
        with self.assertRaises(WeatherError):
            parse_json(json.dumps(provider))

    def test_retained_js_numerical_parity(self):
        records = [row(speed=0, direction=None), row(speed=.2, direction=None), row(speed=1, direction=11.25),
                   row(speed=4, direction=348.75), row(speed=2, direction=360),
                   row(speed=5, direction=None), row(speed=None)]
        for index, record in enumerate(records):
            record["timestamp"] = f"2024-01-01T0{index+1}:00:00Z"
        payload = data(records)
        js = """const fs=require('node:fs'),vm=require('node:vm');const context={module:{exports:{}},console};
vm.runInNewContext(fs.readFileSync('environment-data.js','utf8'),context);const e=context.module.exports;let text='';
process.stdin.on('data',d=>text+=d);process.stdin.on('end',()=>{const d=e.parseWeatherJSON(text);
console.log(JSON.stringify(e.windRose(d.records,{timeZoneOffsetHours:0})));});"""
        reference = json.loads(subprocess.run(["node", "-e", js], input=json.dumps(payload),
                               text=True, capture_output=True, check=True).stdout)
        result = calculate_wind(Site(), inputs(payload))
        for key in ("bins", "calmCount", "missingCount", "total", "excludedCount", "unknownTimeCount", "calmThresholdMps"):
            self.assertEqual(result["rose"][key], reference[key], key)
        self.assertEqual(result["rose"]["speedStatistics"]["validSpeedCount"], 6)
        self.assertEqual(result["rose"]["calmCount"], 2)

    def test_retained_js_parser_parity_epw_json_and_provider(self):
        fixtures = [
            ("epw", epw(2)),
            ("json", json.dumps(data([
                {**row(speed=10, direction=360), "temperatureC": 300, "pressurePa": 1013.25,
                 "ghiWm2": 300, "rhPct": 50},
                row("2024-01-01T02:00:00Z", speed=999, direction=999),
            ], units={"temperatureC":"K", "pressurePa":"hPa", "windSpeedMps":"knots", "ghiWm2":"Wh/m2"}))),
            ("json", json.dumps({"timezone":"UTC", "hourly":{"time":[1704070800], "wind_speed_10m":[36], "wind_direction_10m":[90]},
                                  "hourly_units":{"time":"unixtime", "wind_speed_10m":"km/h", "wind_direction_10m":"°"}})),
        ]
        js = """const fs=require('node:fs'),vm=require('node:vm'),c={module:{exports:{}}};
vm.runInNewContext(fs.readFileSync('environment-data.js','utf8'),c);let text='';
process.stdin.on('data',d=>text+=d);process.stdin.on('end',()=>{const input=JSON.parse(text);
console.log(JSON.stringify(c.module.exports[input[0]==='epw'?'parseEPW':'parseWeatherJSON'](input[1])));});"""
        for format_name, text in fixtures:
            with self.subTest(format=format_name):
                reference = json.loads(subprocess.run(["node","-e",js], input=json.dumps([format_name,text]),
                                                      text=True,capture_output=True,check=True).stdout)
                result = parse_epw(text) if format_name == "epw" else parse_json(text)
                self.assertEqual(result["coverage"], reference["coverage"])
                self.assertEqual(result["kind"], reference["kind"])
                for actual, expected in zip(result["records"], reference["records"]):
                    for key in ("timestamp", "durationSeconds", "missing", *FIELDS):
                        if isinstance(actual[key], float):
                            self.assertAlmostEqual(actual[key], expected[key], places=10, msg=key)
                        else:
                            self.assertEqual(actual[key], expected[key], key)

    def test_filter_clocks_dst_wrap_months_empty_missing_and_zero(self):
        payload = data([row("2024-01-31T23:00:00Z"), row("2024-02-01T01:00:00Z")], timeZoneOffsetHours=5.5)
        result = calculate_wind(Site(time_zone="America/New_York"), inputs(payload, months=[2]))
        self.assertEqual(result["rose"]["total"], 2)
        self.assertEqual(calculate_wind(Site(time_zone="America/New_York"), inputs(payload, months=[2], clock="site"))["status"], "empty-filter")
        night = calculate_wind(Site(), inputs(data([row("2024-01-01T23:00:00Z"), row("2024-01-01T12:00:00Z")]),
                                             daytime="day", day_start_hour=22, day_end_hour=6))
        self.assertEqual(night["rose"]["total"], 1)
        dst = data([row("2026-11-01T05:30:00Z"), row("2026-11-01T06:30:00Z")])
        self.assertEqual(calculate_wind(Site(time_zone="America/New_York"), inputs(dst, clock="site", daytime="day",
                              day_start_hour=1, day_end_hour=2))["rose"]["total"], 2)
        self.assertEqual(calculate_wind(Site(), inputs(data([row(speed=None)])))["status"], "missing-wind")
        zero = calculate_wind(Site(), inputs(data([row(speed=0, direction=None)]), calm_threshold_mps=0))
        self.assertEqual(zero["status"], "ok")
        self.assertEqual(zero["rose"]["calmCount"], 1)
        no_clock = data()
        no_clock.pop("timeZoneOffsetHours")
        with self.assertRaises(WeatherError):
            calculate_wind(Site(), inputs(no_clock))
        with self.assertRaises(WeatherError):
            calculate_wind(Site(time_zone=None), inputs(clock="site"))
        with self.assertRaises(WeatherError):
            calculate_wind(Site(), inputs(months=[13]))
        with self.assertRaises(ValidationError):
            inputs(calm_threshold_mps=True)

    def test_mixed_intervals_partial_year_fingerprint_and_preview_budget(self):
        records = [row(f"2024-01-{index//24+1:02d}T{index%24:02d}:00:00Z", duration=1800 if index%2 else 3600) for index in range(120)]
        result = calculate_wind(Site(), inputs(data(records)))
        self.assertEqual(result["previewCount"], 100)
        self.assertEqual(result["selectedRecordCount"], 120)
        self.assertTrue(any("mixed lengths" in warning for warning in result["weather"]["warnings"]))
        self.assertTrue(any("partial record" in warning for warning in result["weather"]["warnings"]))
        again = calculate_wind(Site(), inputs(data(records)))
        self.assertEqual(result["inputFingerprint"], again["inputFingerprint"])
        changed = calculate_wind(Site(), inputs(data(records), calm_threshold_mps=3))
        self.assertNotEqual(result["inputFingerprint"], changed["inputFingerprint"])


class WindApiTests(unittest.TestCase):
    def setUp(self):
        self.directory = Path("tests") / (".wind-fixture-" + str(uuid4()))
        self.directory.mkdir()
        self.addCleanup(shutil.rmtree, self.directory)
        self.sender = RecordingSms()
        settings = Settings(environment="development", database_url=f"sqlite:///{self.directory / 'platform.db'}",
                            auth_secret="synthetic-wind-only-secret-" + "x"*32,
                            allowed_origins=["http://localhost:5173"], sms_enabled=False)
        self.app = create_app(settings, self.sender, lambda: 1800000000)
        config = Config("alembic.ini")
        with self.app.state.engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)
        self.login(self.client, "+12025550123")
        project = self.client.post("/api/v1/projects", json={"name": "Synthetic wind fixture"}).json()
        self.path = f"/api/v1/projects/{project['id']}/workspace"

    def login(self, client, phone):
        client.headers["origin"] = "http://localhost:5173"
        challenge = client.post("/api/v1/auth/challenges", json={"phone": phone}).json()
        verified = client.post("/api/v1/auth/verify", json={"challenge_id": challenge["challenge_id"], "code": self.sender.messages[-1][1]})
        client.headers["x-csrf-token"] = verified.json()["csrf_token"]

    def test_owned_authenticated_csrf_draft_only_and_large_epw_budget(self):
        before = self.client.get(self.path).json()
        payload = inputs().model_dump()
        with patch("requests.sessions.Session.request", side_effect=AssertionError("No weather network access")):
            response = self.client.post(self.path + "/wind", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["scope"], "imported-weather-not-ventilation")
        self.assertEqual(self.client.get(self.path).json(), before)
        self.assertEqual(self.client.post(self.path + "/wind", json={**payload, "expected_version": 1}).status_code, 409)
        self.assertEqual(self.client.post(self.path + "/wind", json={**payload, "expected_version": True}).status_code, 422)
        self.assertEqual(self.client.post(self.path + "/wind", json={**payload, "text": "bad"}).status_code, 422)
        self.assertEqual(self.client.post(self.path + "/wind", json=payload, headers={"x-csrf-token":"wrong"}).status_code, 403)
        # Annual-file route budget is deliberately separate from the small generic API budget.
        self.assertEqual(self.client.post(self.path + "/wind", json={**payload, "text": " "*20000+payload["text"]}).status_code, 200)
        self.assertEqual(self.client.post(self.path + "/wind", content=" "*(8*1024*1024+1),
                                          headers={"content-type":"application/json"}).status_code, 413)
        other = TestClient(self.app)
        self.addCleanup(other.close)
        self.assertEqual(other.post(self.path + "/wind", json=payload, headers={"origin":"http://localhost:5173"}).status_code, 401)
        self.login(other, "+12025550124")
        self.assertEqual(other.post(self.path + "/wind", json=payload).status_code, 404)

    def test_completion_after_workspace_change_rejected(self):
        def changed_site(*_args):
            self.client.post(self.path + "/commands", json={"expected_version":0,"action":"site","value":{"width":12}})
            return {"status":"ok"}
        with patch("backend.api.calculate_wind", side_effect=changed_site):
            response = self.client.post(self.path + "/wind", json=inputs().model_dump())
        self.assertEqual(response.status_code, 409)


if __name__ == "__main__":
    unittest.main()

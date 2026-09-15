#!/usr/bin/env python3
"""Export Telangana prohibited-property lookup values and download reports."""

from __future__ import annotations

import argparse
import csv
import json
import logging
import re
import time
from dataclasses import asdict, dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterable

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


BASE_URL = "https://registration.telangana.gov.in"

# The portal currently returns an empty district <select> intermittently. These
# are the district values accepted by MandalDetails.htm.
DISTRICTS = {
    "14_1": "MAHABUBNAGAR",
    "14_2": "JOGULAMBA GADWAL",
    "14_3": "NAGARKURNOOL",
    "14_4": "WANAPARTHY",
    "14_5": "NARAYANPET",
    "15_1": "RANGAREDDY",
    "15_2": "MEDCHAL-MALKAJGIRI",
    "15_3": "VIKARABAD",
    "16_1": "HYDERABAD",
    "17_1": "MEDAK",
    "17_2": "SANGAREDDY",
    "17_3": "SIDDIPET",
    "18_1": "NIZAMABAD",
    "18_2": "KAMAREDDY",
    "19_1": "ADILABAD",
    "19_2": "NIRMAL",
    "19_3": "MANCHERIAL",
    "19_4": "KOMARAM BHEEM ASIFABAD",
    "20_1": "KARIMNAGAR",
    "20_2": "JAGTIAL",
    "20_3": "RAJANNA SIRCILLA",
    "20_4": "PEDDAPALLI",
    "21_1": "HANUMAKONDA",
    "21_2": "WARANGAL",
    "21_3": "JANGAON",
    "21_4": "JAYASHANKAR BHOOPALPALLY",
    "21_5": "MAHABUBABAD",
    "21_6": "MULUGU",
    "22_1": "KHAMMAM",
    "22_2": "BHADRADRI KOTHAGUDEM",
    "23_1": "NALGONDA",
    "23_2": "SURYAPET",
    "23_3": "YADADRI BHUVANAGIRI",
}

PROPERTY_TYPES = {
    "AGRI": "Agriculture",
    "NONAGRI": "Non-Agriculture",
}

# The portal buttons expose only these PDF form numbers. Section 22A(1)(c)
# Waqf and Endowment buttons deliberately submit blank values.
FORM_TYPES = {
    "1": "22A(1)(a)",
    "2": "22A(1)(b)",
    "5": "22A(1)(d)",
    "6": "22A(1)(e)",
}

UNAVAILABLE_FORM_TYPES = {
    "waqf": "22A(1)(c) - Waqf (not exposed by this portal)",
    "endowment": "22A(1)(c) - Endowment (not exposed by this portal)",
}


@dataclass(frozen=True)
class Location:
    district_code: str
    district_name: str
    mandal_code: str
    mandal_name: str
    village_code: str
    village_name: str
    sro_code: str = ""
    sro_name: str = ""


class ReportTableParser(HTMLParser):
    """Extract cells from the court-cases table whose id is 'report'."""

    def __init__(self) -> None:
        super().__init__()
        self.in_report = False
        self.in_cell = False
        self.current_cell: list[str] = []
        self.current_row: list[str] = []
        self.rows: list[list[str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "table" and attributes.get("id") == "report":
            self.in_report = True
        elif self.in_report and tag == "tr":
            self.current_row = []
        elif self.in_report and tag in {"th", "td"}:
            self.in_cell = True
            self.current_cell = []
        elif self.in_cell and tag == "br":
            self.current_cell.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if self.in_report and tag in {"th", "td"} and self.in_cell:
            value = re.sub(r"\s+", " ", "".join(self.current_cell)).strip()
            self.current_row.append(value)
            self.in_cell = False
        elif self.in_report and tag == "tr":
            if any(self.current_row):
                self.rows.append(self.current_row)
            self.current_row = []
        elif self.in_report and tag == "table":
            self.in_report = False

    def handle_data(self, data: str) -> None:
        if self.in_cell:
            self.current_cell.append(data)


class TelanganaPortal:
    def __init__(self, timeout: float, delay: float, retries: int) -> None:
        self.timeout = timeout
        self.delay = delay
        self.session = requests.Session()
        retry = Retry(
            total=retries,
            connect=retries,
            read=retries,
            status=retries,
            backoff_factor=0.8,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=frozenset({"GET", "POST"}),
        )
        self.session.mount("https://", HTTPAdapter(max_retries=retry))
        self.session.headers.update(
            {
                "Accept": "application/json, text/plain, */*",
                "Referer": f"{BASE_URL}/prohibitionPublicList.htm",
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 Chrome/128.0 Safari/537.36"
                ),
                "X-Requested-With": "XMLHttpRequest",
            }
        )

    def start(self) -> None:
        self._request("GET", "/prohibitionPublicList.htm")

    def close(self) -> None:
        self.session.close()

    def _request(self, method: str, path: str, **kwargs: Any) -> requests.Response:
        response = self.session.request(
            method, f"{BASE_URL}{path}", timeout=self.timeout, **kwargs
        )
        response.raise_for_status()
        if self.delay:
            time.sleep(self.delay)
        return response

    def _json(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        response = self._request(method, path, **kwargs)
        try:
            data = response.json()
        except requests.JSONDecodeError as exc:
            raise RuntimeError(f"{path} returned non-JSON content") from exc
        if not isinstance(data, dict):
            raise RuntimeError(f"{path} returned an unexpected JSON shape")
        return data

    def mandals(self, district_code: str) -> list[dict[str, Any]]:
        data = self._json(
            "POST", "/MandalDetails.htm", data={"dist_code": district_code}
        )
        return data.get("mandalDetails") or []

    def villages(self, district_code: str, mandal_code: str) -> list[dict[str, Any]]:
        data = self._json(
            "POST",
            "/VillageDetails.htm",
            params={"dist_code": district_code, "mand_code": mandal_code},
        )
        return data.get("villageDetails") or []

    def sros(
        self, district_code: str, mandal_code: str, village_code: str
    ) -> list[dict[str, Any]]:
        if mandal_code != "00":
            return []
        data = self._json(
            "GET",
            "/getSRODetailsPDF.htm",
            params={
                "dist_code": district_code,
                "mand_code": mandal_code,
                "vill_code": village_code,
            },
        )
        return data.get("SRODetails") or []

    def pdf_exists(
        self, location: Location, property_type: str, form_type: str
    ) -> bool:
        data = self._json(
            "POST",
            "/checkPDFFile.htm",
            params={
                "dist_code": location.district_code,
                "mand_code": location.mandal_code,
                "vill_code": location.village_code,
                "prohib_type": property_type,
                "formtype": form_type,
                "sroCode": location.sro_code,
            },
        )
        if data.get("message") == "success" and data.get("pdf") == "valid":
            return True
        if not data or (data.get("message") == "success" and data.get("pdf") == "invalid"):
            return False
        raise RuntimeError("checkPDFFile.htm returned an unrecognized availability response")

    def download_pdf(
        self, location: Location, property_type: str, form_type: str
    ) -> bytes:
        response = self._request(
            "POST",
            "/viewProhibitedDataPDF.htm",
            data={
                "dist_code": location.district_code,
                "mand_code": location.mandal_code,
                "vill_code": location.village_code,
                "prohib_type": property_type,
                "formtype": form_type,
                "sro_code": location.sro_code,
            },
        )
        if not response.content.startswith(b"%PDF-"):
            raise RuntimeError("PDF endpoint did not return a PDF")
        return response.content

    def download_court_cases(self, location: Location, property_type: str) -> str:
        response = self._request(
            "POST",
            "/prohibitedPropertyDetails_New.htm",
            data={
                "dist_code": location.district_code,
                "sro_code": location.sro_code,
                "mand_code": location.mandal_code,
                "selectcriteria": "SNA",
                "vill_code": location.village_code,
                "distName": location.district_name,
                "mandalName": location.mandal_name,
                "villName": location.village_name,
                "prohib_type": property_type,
            },
        )
        return response.text


def safe_name(value: str) -> str:
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value.strip())
    return re.sub(r"\s+", "_", value).strip("._") or "unknown"


def write_csv(path: Path, rows: Iterable[dict[str, Any]], fields: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def collect_locations(
    portal: TelanganaPortal,
    district_filters: set[str],
    mandal_filters: set[str],
    village_filters: set[str],
) -> tuple[list[dict[str, str]], list[dict[str, str]], list[Location]]:
    district_rows: list[dict[str, str]] = []
    mandal_rows: list[dict[str, str]] = []
    locations: list[Location] = []

    for district_code, district_name in DISTRICTS.items():
        if district_filters and district_code not in district_filters:
            continue
        logging.info("Fetching mandals for %s (%s)", district_name, district_code)
        mandals = portal.mandals(district_code)
        if not mandals:
            logging.warning("No mandals returned for %s", district_code)
            continue
        district_rows.append(
            {"district_code": district_code, "district_name": district_name}
        )

        for mandal in mandals:
            mandal_code = str(mandal["code"])
            mandal_name = str(mandal["name"]).strip()
            if mandal_filters and mandal_code not in mandal_filters:
                continue
            mandal_rows.append(
                {
                    "district_code": district_code,
                    "district_name": district_name,
                    "mandal_code": mandal_code,
                    "mandal_name": mandal_name,
                }
            )
            logging.info("Fetching villages for %s / %s", district_name, mandal_name)
            for village in portal.villages(district_code, mandal_code):
                village_code = str(village["code"])
                village_name = str(village["name"]).strip()
                if village_filters and village_code not in village_filters:
                    continue
                sros = portal.sros(district_code, mandal_code, village_code)
                if sros:
                    for sro in sros:
                        locations.append(
                            Location(
                                district_code,
                                district_name,
                                mandal_code,
                                mandal_name,
                                village_code,
                                village_name,
                                str(sro["sro_code"]),
                                str(sro["sro_name"]).strip(),
                            )
                        )
                else:
                    locations.append(
                        Location(
                            district_code,
                            district_name,
                            mandal_code,
                            mandal_name,
                            village_code,
                            village_name,
                        )
                    )
    return district_rows, mandal_rows, locations


def export_metadata(
    output: Path,
    districts: list[dict[str, str]],
    mandals: list[dict[str, str]],
    locations: list[Location],
) -> None:
    metadata_dir = output / "metadata"
    write_csv(
        metadata_dir / "districts.csv",
        districts,
        ["district_code", "district_name"],
    )
    write_csv(
        metadata_dir / "mandals.csv",
        mandals,
        ["district_code", "district_name", "mandal_code", "mandal_name"],
    )
    write_csv(
        metadata_dir / "villages-and-sros.csv",
        (asdict(location) for location in locations),
        list(Location.__dataclass_fields__),
    )
    write_csv(
        metadata_dir / "property-types.csv",
        (
            {"prohib_type": code, "property_type": name}
            for code, name in PROPERTY_TYPES.items()
        ),
        ["prohib_type", "property_type"],
    )
    write_csv(
        metadata_dir / "form-types.csv",
        (
            {
                "formtype": code,
                "category": name,
                "available_via_pdf_api": "yes",
            }
            for code, name in FORM_TYPES.items()
        ),
        ["formtype", "category", "available_via_pdf_api"],
    )
    write_csv(
        metadata_dir / "unavailable-form-types.csv",
        (
            {
                "category_key": code,
                "formtype": "",
                "category": name,
                "available_via_pdf_api": "no",
            }
            for code, name in UNAVAILABLE_FORM_TYPES.items()
        ),
        ["category_key", "formtype", "category", "available_via_pdf_api"],
    )
    with (metadata_dir / "all-values.json").open("w", encoding="utf-8") as handle:
        json.dump(
            {
                "districts": districts,
                "mandals": mandals,
                "locations": [asdict(location) for location in locations],
                "property_types": PROPERTY_TYPES,
                "form_types": FORM_TYPES,
                "unavailable_form_types": UNAVAILABLE_FORM_TYPES,
            },
            handle,
            ensure_ascii=False,
            indent=2,
        )


def report_path(output: Path, location: Location, property_type: str) -> Path:
    parts = [
        f"{location.district_code}_{safe_name(location.district_name)}",
        f"{location.mandal_code}_{safe_name(location.mandal_name)}",
        f"{location.village_code}_{safe_name(location.village_name)}",
    ]
    if location.sro_code:
        parts.append(f"{location.sro_code}_{safe_name(location.sro_name)}")
    return output.joinpath("reports", *parts, property_type)


def append_manifest(output: Path, record: dict[str, Any]) -> None:
    path = output / "download-manifest.jsonl"
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def save_court_report(path: Path, html: str) -> int:
    path.mkdir(parents=True, exist_ok=True)
    (path / "court-cases.html").write_text(html, encoding="utf-8")
    parser = ReportTableParser()
    parser.feed(html)
    if parser.rows:
        width = max(len(row) for row in parser.rows)
        with (path / "court-cases.csv").open(
            "w", newline="", encoding="utf-8-sig"
        ) as handle:
            writer = csv.writer(handle)
            writer.writerows(row + [""] * (width - len(row)) for row in parser.rows)
    return len(parser.rows)


def download_reports(
    portal: TelanganaPortal,
    output: Path,
    locations: list[Location],
    property_types: list[str],
    form_types: list[str],
    include_court: bool,
) -> None:
    for location in locations:
        for property_type in property_types:
            target_dir = report_path(output, location, property_type)
            target_dir.mkdir(parents=True, exist_ok=True)
            for form_type in form_types:
                target = target_dir / f"{form_type}_{safe_name(FORM_TYPES[form_type])}.pdf"
                base_record = {
                    **asdict(location),
                    "prohib_type": property_type,
                    "formtype": form_type,
                    "category": FORM_TYPES[form_type],
                    "path": str(target),
                }
                if target.exists() and target.read_bytes()[:5] == b"%PDF-":
                    logging.info("Already downloaded: %s", target)
                    continue
                try:
                    if not portal.pdf_exists(location, property_type, form_type):
                        append_manifest(output, {**base_record, "status": "not_available"})
                        continue
                    target.write_bytes(
                        portal.download_pdf(location, property_type, form_type)
                    )
                    append_manifest(output, {**base_record, "status": "downloaded"})
                    logging.info("Downloaded: %s", target)
                except Exception as exc:
                    logging.error("Failed %s: %s", target, exc)
                    append_manifest(
                        output, {**base_record, "status": "error", "error": str(exc)}
                    )

            if include_court:
                court_file = target_dir / "court-cases.html"
                if court_file.exists():
                    logging.info("Already downloaded: %s", court_file)
                    continue
                try:
                    html = portal.download_court_cases(location, property_type)
                    rows = save_court_report(target_dir, html)
                    append_manifest(
                        output,
                        {
                            **asdict(location),
                            "prohib_type": property_type,
                            "category": "Court cases & Others",
                            "status": "downloaded",
                            "rows_extracted": rows,
                            "path": str(court_file),
                        },
                    )
                except Exception as exc:
                    logging.error("Court report failed for %s: %s", location, exc)
                    append_manifest(
                        output,
                        {
                            **asdict(location),
                            "prohib_type": property_type,
                            "category": "Court cases & Others",
                            "status": "error",
                            "error": str(exc),
                        },
                    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Export Telangana prohibited-property API values and optionally "
            "download every available report."
        )
    )
    parser.add_argument(
        "command",
        choices=("metadata", "download", "all"),
        nargs="?",
        default="metadata",
        help="metadata only, reports only, or both (default: metadata)",
    )
    parser.add_argument("--output", type=Path, default=Path("prohibited-properties"))
    parser.add_argument("--district", action="append", default=[], metavar="CODE")
    parser.add_argument("--mandal", action="append", default=[], metavar="CODE")
    parser.add_argument("--village", action="append", default=[], metavar="CODE")
    parser.add_argument(
        "--property-type",
        action="append",
        choices=tuple(PROPERTY_TYPES),
        default=[],
        metavar="TYPE",
    )
    parser.add_argument(
        "--form-type",
        action="append",
        choices=tuple(FORM_TYPES),
        default=[],
        metavar="NUMBER",
    )
    parser.add_argument(
        "--include-court",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="also save Court cases & Others HTML/CSV (default: enabled)",
    )
    parser.add_argument("--delay", type=float, default=0.35)
    parser.add_argument("--timeout", type=float, default=60)
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    unknown = set(args.district) - set(DISTRICTS)
    if unknown:
        raise SystemExit(f"Unknown district code(s): {', '.join(sorted(unknown))}")

    args.output.mkdir(parents=True, exist_ok=True)
    portal = TelanganaPortal(args.timeout, args.delay, args.retries)
    portal.start()
    districts, mandals, locations = collect_locations(
        portal, set(args.district), set(args.mandal), set(args.village)
    )
    export_metadata(args.output, districts, mandals, locations)
    logging.info(
        "Exported %d districts, %d mandals and %d village/SRO combinations",
        len(districts),
        len(mandals),
        len(locations),
    )

    if args.command in {"download", "all"}:
        download_reports(
            portal,
            args.output,
            locations,
            args.property_type or list(PROPERTY_TYPES),
            args.form_type or list(FORM_TYPES),
            args.include_court,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

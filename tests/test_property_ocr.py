import csv
import io
import math
import os
import shutil
import subprocess
import unittest
from dataclasses import FrozenInstanceError
from pathlib import Path
from unittest.mock import Mock, patch
from uuid import uuid4

import cv2
import numpy as np
import pymupdf
from bs4 import BeautifulSoup
from PIL import Image, ImageDraw, ImageFont

from prohibited_properties import ocr
from prohibited_properties.ocr import OCRError, OCRPage, TesseractOCR


XS = [60, 420, 790, 1140]
YS = [170, 290, 410, 530, 650]
VALUES = [
    ["Survey", "Extent", "Type"],
    ["001/02", "0.05", "AGRI"],
    ["0007", "", "GOVT"],
    ["012/3", "0.00", ""],
]


def tsv(words, width=1200, height=800):
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter="\t", quoting=csv.QUOTE_NONE, lineterminator="\n")
    writer.writerow(ocr._TSV_FIELDS)
    writer.writerow([1, 1, 0, 0, 0, 0, 0, 0, width, height, -1, ""])
    for index, word in enumerate(words, 1):
        text, left, top, word_width, word_height, line, confidence = word
        writer.writerow([5, 1, 1, 1, line, index, left, top, word_width, word_height, confidence, text])
    return buffer.getvalue().encode("utf-8")


def table_words(merged=False):
    result = [("PROPERTY REPORT", 65, 80, 430, 40, 1, 96.5)]
    for row, values in enumerate(VALUES):
        for column, text in enumerate(values):
            if merged and row == 0:
                if column == 1:
                    continue
                text = "Land particulars" if column == 0 else text
            if text:
                result.append((text, XS[column] + 25, YS[row] + 35,
                               280 if merged and row == 0 and column == 0 else 200,
                               38, row + 2, 95.5))
    return result


def scan_image(grid=True, merged=False, blank=False, broken_rule=False):
    image = Image.new("RGB", (1200, 800), "white")
    if blank:
        return image
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype("arial.ttf", 38)
    draw.text((65, 70), "PROPERTY REPORT", fill="black", font=font)
    if not grid:
        draw.text((65, 210), "SURVEY 001/02 EXTENT 0.05", fill="black", font=font)
        return image
    for y in YS:
        draw.line((XS[0], y, XS[-1], y), fill="black", width=4)
    for index, x in enumerate(XS):
        start = YS[1] if merged and index == 1 else YS[0]
        draw.line((x, start, x, YS[-1]), fill="black", width=4)
    if broken_rule:
        draw.rectangle((XS[1] - 3, YS[1] + 50, XS[1] + 3, YS[1] + 53), fill="white")
    for row, values in enumerate(VALUES):
        for column, text in enumerate(values):
            if merged and row == 0:
                if column == 1:
                    continue
                text = "Land particulars" if column == 0 else text
            if text:
                draw.text((XS[column] + 25, YS[row] + 30), text, fill="black", font=font)
    return image


def tilted_thin_header_grid():
    gray = np.full((1400, 2000), 255, dtype=np.uint8)
    xs = [140 + column * 172 for column in range(11)]
    ys = [150, 174, 198, 328, 354] + [354 + row * 60 for row in range(1, 13)]
    for y in ys:
        cv2.line(gray, (xs[0], y), (xs[-1], y), 0, 2)
    for index, x in enumerate(xs):
        cv2.line(gray, (x, ys[0] if index in (0, 10) else ys[2]), (x, ys[-1]), 0, 2)
    cv2.line(gray, (1000, ys[-1]), (1000, 1200), 0, 2)
    for x, y in ((8, 8), (1970, 8), (8, 1370), (1970, 1370)):
        cv2.rectangle(gray, (x, y), (x + 16, y + 16), 0, -1)
    matrix = cv2.getRotationMatrix2D((1000, 700), 1.6, 1)
    cosine, sine = abs(matrix[0, 0]), abs(matrix[0, 1])
    width = math.ceil(2000 * cosine + 1400 * sine) + 4
    height = math.ceil(1400 * cosine + 2000 * sine) + 4
    matrix[0, 2] += (width - 2000) / 2
    matrix[1, 2] += (height - 1400) / 2
    return cv2.warpAffine(gray, matrix, (width, height), flags=cv2.INTER_CUBIC, borderValue=255)


class Fixtures(unittest.TestCase):
    def setUp(self):
        base = Path(os.environ.get("HOMEPLANNER_OCR_TEST_ROOT", Path(__file__).resolve().parent))
        self.root = base / f".property-ocr-test-{uuid4().hex}"
        self.root.mkdir()
        self.addCleanup(shutil.rmtree, self.root)
        cv2.setNumThreads(2)
        cv2.ocl.setUseOpenCL(False)

    def native_pdf(self, pages=1, grid=True, merged=False, encrypted=False):
        path = self.root / f"native-{uuid4().hex}.pdf"
        with pymupdf.open() as document:
            for number in range(1, pages + 1):
                page = document.new_page(width=360, height=260)
                page.insert_text((20, 25), f"PROPERTY REPORT {number:04d}", fontsize=11)
                if not grid:
                    page.insert_text((20, 80), "Survey 001/02, extent 0.05. Source text, not inferred rows.", fontsize=10)
                    continue
                xs = [20, 130, 235, 340]
                ys = [45, 90, 135, 180, 225]
                for y in ys:
                    page.draw_line((xs[0], y), (xs[-1], y))
                for index, x in enumerate(xs):
                    start = ys[1] if merged and index == 1 else ys[0]
                    page.draw_line((x, start), (x, ys[-1]))
                for row, values in enumerate(VALUES):
                    for column, text in enumerate(values):
                        if merged and row == 0:
                            if column == 1:
                                continue
                            text = "Land particulars" if column == 0 else text
                        if text:
                            page.insert_text((xs[column] + 7, ys[row] + 27), text, fontsize=11)
                page.insert_text((20, 247), f"Page {number}", fontsize=9)
            options = {}
            if encrypted:
                options.update(
                    encryption=pymupdf.PDF_ENCRYPT_AES_256,
                    owner_pw="owner-test-password",
                    user_pw="reader-test-password",
                )
            document.save(path, **options)
        return path

    def scanned_pdf(
        self, pages=1, grid=True, merged=False, blank=False, native_header=False,
        faint_ink=False, skewed=False, broken_rule=False,
    ):
        path = self.root / f"scan-{uuid4().hex}.pdf"
        image = scan_image(grid=grid, merged=merged, blank=blank, broken_rule=broken_rule)
        try:
            if skewed:
                transformed = cv2.warpAffine(
                    np.asarray(image), np.array([[1, 0.02, 0], [-0.015, 1, 20]], dtype=np.float32),
                    image.size, borderMode=cv2.BORDER_CONSTANT, borderValue=(255, 255, 255),
                )
                image.close()
                image = Image.fromarray(transformed)
            if faint_ink:
                image.putpixel((200, 200), (254, 255, 255))
            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
        finally:
            image.close()
        with pymupdf.open() as document:
            for _ in range(pages):
                page = document.new_page(width=288, height=192)
                page.insert_image(page.rect, stream=buffer.getvalue())
                if native_header:
                    page.insert_text((5, 8), "Native header only", fontsize=5)
            document.save(path)
        return path

    def table_rows(self, markdown):
        soup = BeautifulSoup(markdown, "html.parser")
        return [
            [cell.get_text("\n") for cell in row.find_all(["td", "th"], recursive=False)]
            for row in soup.select("table tr")
        ]


class PropertyOCRTests(Fixtures):
    def setUp(self):
        super().setUp()
        self.client = TesseractOCR(command="fake-tesseract")
        resolver = patch.object(self.client, "_resolve_command", return_value="fake-tesseract")
        resolver.start()
        self.addCleanup(resolver.stop)
        self.version = b"tesseract v5.5.0.20241111\n"
        self.languages = b"List of available languages (3):\neng\ntel\nosd\n"
        self.ocr_output = tsv(table_words())
        self.ocr_error = None

        def run(arguments, **kwargs):
            if arguments[1:] == ["--version"]:
                return subprocess.CompletedProcess(arguments, 0, self.version, b"")
            if arguments[1:] == ["--list-langs"]:
                return subprocess.CompletedProcess(arguments, 0, self.languages, b"")
            self.assertEqual(arguments[1:3], ["stdin", "stdout"])
            if self.ocr_error is not None:
                raise self.ocr_error
            return subprocess.CompletedProcess(arguments, 0, self.ocr_output, b"")

        process = patch.object(ocr.subprocess, "run", side_effect=run)
        self.process = process.start()
        self.addCleanup(process.stop)

    def ocr_calls(self):
        return [call for call in self.process.call_args_list if call.args[0][1:3] == ["stdin", "stdout"]]

    def test_public_contract_and_optional_method_are_backwards_compatible(self):
        self.assertEqual(self.client.name, "Local PDF extraction + Tesseract")
        self.assertEqual(self.client.model, "Tesseract (eng+tel)")
        self.assertEqual((self.client.dpi, self.client.timeout), (300, 120))
        self.assertEqual(OCRPage(1, "001").method, "")
        with self.assertRaises(FrozenInstanceError):
            OCRPage(1, "001").number = 2
        self.process.assert_not_called()
        self.assertIsNone(self.client.close())
        self.assertIsNone(self.client.close())

    def test_health_checks_binary_languages_and_limits_subprocess_threads(self):
        with patch.dict(os.environ, {"OMP_THREAD_LIMIT": "64", "OMP_NUM_THREADS": "64"}):
            self.client.check_health()
            self.assertEqual(os.environ["OMP_THREAD_LIMIT"], "64")
        self.assertEqual(self.process.call_count, 2)
        for call in self.process.call_args_list:
            self.assertEqual(call.kwargs["timeout"], 10)
            self.assertEqual(call.kwargs["env"]["OMP_THREAD_LIMIT"], "2")
            self.assertEqual(call.kwargs["env"]["OMP_NUM_THREADS"], "2")
            self.assertEqual(call.kwargs["stdin"], subprocess.DEVNULL)
            self.assertNotIn("input", call.kwargs)

    def test_missing_language_data_is_an_actionable_failure(self):
        self.languages = b"List of available languages (2):\neng\nosd\n"
        with self.assertRaisesRegex(OCRError, "language data is missing: tel.*traineddata"):
            self.client.check_health()
        self.assertFalse(self.client._ready)
        self.assertEqual(self.ocr_calls(), [])

    def test_wrong_or_old_binary_is_rejected(self):
        for version in (b"not-tesseract\n", b"tesseract 3.05\n", b"\xff"):
            with self.subTest(version=version):
                self.version = version
                with self.assertRaises(OCRError):
                    self.client.check_health()
        self.assertEqual(self.ocr_calls(), [])

    def test_missing_executable_and_permissions_have_helpful_errors(self):
        missing = TesseractOCR(command=self.root / "missing-tesseract.exe")
        with self.assertRaisesRegex(OCRError, "executable was not found"):
            missing.check_health()
        self.process.side_effect = PermissionError("private-local-path")
        with self.assertRaisesRegex(OCRError, "Cannot launch local Tesseract") as caught:
            self.client.check_health()
        self.assertNotIn("private-local-path", str(caught.exception))

    def test_native_table_preserves_zeroes_empty_cells_and_provenance(self):
        result = self.client.parse_pdf(self.native_pdf())
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].method, "native")
        self.assertEqual(self.table_rows(result[0].markdown), VALUES)
        self.assertIn("native PDF text (no OCR)", result[0].markdown)
        self.assertIn("not independently verified", result[0].markdown)
        self.assertIn("PROPERTY REPORT 0001", result[0].markdown)
        self.assertIn("Page 1", result[0].markdown)
        self.process.assert_not_called()

    def test_native_merged_cells_use_source_geometry_not_filled_values(self):
        result = self.client.parse_pdf(self.native_pdf(merged=True))
        soup = BeautifulSoup(result[0].markdown, "html.parser")
        self.assertEqual(soup.select_one("table td").get("colspan"), "2")
        self.assertEqual(self.table_rows(result[0].markdown)[0], ["Land particulars", "Type"])
        self.assertEqual(self.table_rows(result[0].markdown)[1:], VALUES[1:])
        self.process.assert_not_called()

    def test_native_prose_does_not_become_invented_property_rows(self):
        page = self.client.parse_pdf(self.native_pdf(grid=False))[0]
        self.assertIn("No structured table was recognized", page.markdown)
        self.assertIn("001/02", page.markdown)
        self.assertNotIn("<table>", page.markdown)
        self.assertEqual(page.method, "native")
        self.process.assert_not_called()

    def test_every_native_page_is_visited_without_a_page_count_cap(self):
        progress = Mock()
        result = self.client.parse_pdf(self.native_pdf(pages=65, grid=False), progress)
        self.assertEqual([page.number for page in result], list(range(1, 66)))
        self.assertEqual(len(result), 65)
        self.assertTrue(all(page.method == "native" for page in result))
        self.assertIn("0065", result[-1].markdown)
        self.assertEqual([call.args for call in progress.call_args_list], [(number, 65) for number in range(1, 66)])
        self.process.assert_not_called()

    def test_scanned_grid_uses_one_whole_page_tsv_call_and_preserves_cells(self):
        self.client.check_health()
        self.process.reset_mock()
        progress = Mock()
        result = self.client.parse_pdf(self.scanned_pdf(), progress)
        self.assertEqual(result[0].method, "tesseract")
        self.assertEqual(self.table_rows(result[0].markdown), VALUES)
        self.assertIn("local Tesseract OCR", result[0].markdown)
        self.assertIn("word confidence", result[0].markdown)
        self.assertIn("PROPERTY REPORT", result[0].markdown)
        self.assertEqual(self.process.call_count, 1)
        call = self.ocr_calls()[0]
        self.assertEqual(call.args[0], [
            "fake-tesseract", "stdin", "stdout", "-l", "eng+tel",
            "--oem", "1", "--psm", "11", "--dpi", "300", "-c", "tessedit_create_tsv=1",
        ])
        self.assertEqual(call.kwargs["timeout"], 120)
        self.assertEqual(call.kwargs["env"]["OMP_THREAD_LIMIT"], "2")
        self.assertNotIn("stdin", call.kwargs)
        with Image.open(io.BytesIO(call.kwargs["input"])) as image:
            self.assertEqual(image.size, (1200, 800))
            self.assertEqual(image.mode, "L")
        progress.assert_called_once_with(1, 1)

    def test_scanned_merged_cells_preserve_span_and_blank_cells(self):
        self.ocr_output = tsv(table_words(merged=True))
        result = self.client.parse_pdf(self.scanned_pdf(merged=True))
        soup = BeautifulSoup(result[0].markdown, "html.parser")
        self.assertEqual(soup.select_one("table td").get("colspan"), "2")
        self.assertEqual(self.table_rows(result[0].markdown)[0], ["Land particulars", "Type"])
        self.assertEqual(self.table_rows(result[0].markdown)[1:], VALUES[1:])
        self.assertEqual(len(self.ocr_calls()), 1)

    def test_skewed_scan_preserves_every_cell_and_original_values(self):
        transformed = []
        for text, left, top, width, height, line, confidence in table_words():
            corners = [(x + 0.02 * y, y - 0.015 * x + 20) for x, y in (
                (left, top), (left + width, top), (left + width, top + height), (left, top + height),
            )]
            x0, y0 = (int(min(point[axis] for point in corners)) for axis in (0, 1))
            x1, y1 = (int(max(point[axis] for point in corners)) for axis in (0, 1))
            transformed.append((text, x0, y0, x1 - x0, y1 - y0, line, confidence))
        self.ocr_output = tsv(transformed)
        result = self.client.parse_pdf(self.scanned_pdf(skewed=True))[0]
        self.assertEqual(self.table_rows(result.markdown), VALUES)
        self.assertIn("ruling-line pixels", result.markdown)
        self.assertEqual(len(self.ocr_calls()), 1)

    def test_small_ruling_gaps_do_not_merge_source_cells(self):
        result = self.client.parse_pdf(self.scanned_pdf(broken_rule=True))[0]
        self.assertEqual(self.table_rows(result.markdown), VALUES)
        self.assertEqual(len(self.ocr_calls()), 1)

    def test_existing_scan_grids_do_not_enter_the_deskew_path(self):
        with patch.object(ocr, "_deskew_ruled_page", side_effect=AssertionError("Unexpected deskew")) as deskew:
            result = self.client.parse_pdf(self.scanned_pdf())[0]
        deskew.assert_not_called()
        self.assertEqual(self.table_rows(result.markdown), VALUES)
        self.assertEqual(len(self.ocr_calls()), 1)

    def test_deskewed_grid_still_uses_one_ocr_call_and_keeps_provenance(self):
        image = scan_image()
        try:
            aligned = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2GRAY)
        finally:
            image.close()
        with patch.object(ocr, "_deskew_ruled_page", return_value=(aligned, -1.3)):
            result = self.client.parse_pdf(self.scanned_pdf(grid=False))[0]
        self.assertEqual(self.table_rows(result.markdown), VALUES)
        self.assertIn("Page alignment: -1.30 degrees", result.markdown)
        self.assertIn("full page was retained", result.markdown)
        self.assertEqual(len(self.ocr_calls()), 1)

    def test_native_header_does_not_hide_a_scanned_body(self):
        result = self.client.parse_pdf(self.scanned_pdf(native_header=True))
        self.assertEqual(result[0].method, "tesseract")
        self.assertEqual(len(self.ocr_calls()), 1)
        self.assertIn("001/02", result[0].markdown)

    def test_scanned_prose_is_retained_with_an_explicit_no_table_notice(self):
        self.ocr_output = tsv([
            ("Survey", 70, 200, 150, 40, 1, 95),
            ("001/02", 240, 200, 180, 40, 1, 95),
            ("భూమి", 450, 200, 160, 40, 1, 75),
            ("< 010", 640, 200, 140, 40, 1, 30),
        ])
        result = self.client.parse_pdf(self.scanned_pdf(grid=False))[0]
        self.assertNotIn("<table>", result.markdown)
        self.assertIn("No structured table was recognized", result.markdown)
        self.assertIn("001/02 భూమి &lt; 010", result.markdown)
        self.assertIn("1 of 4 words below 60", result.markdown)
        arguments = self.ocr_calls()[0].args[0]
        self.assertEqual(arguments[arguments.index("--psm") + 1], "3")

    def test_ambiguous_cell_assignment_falls_back_without_losing_text(self):
        words = table_words()
        words.append(("000099", 395, 330, 90, 35, 8, 80))
        self.ocr_output = tsv(words)
        result = self.client.parse_pdf(self.scanned_pdf())[0]
        self.assertNotIn("<table>", result.markdown)
        self.assertIn("No structured table was recognized", result.markdown)
        for value in ("001/02", "000099", "0.05", "0007"):
            self.assertIn(value, result.markdown)

    def test_low_confidence_text_is_never_corrected_or_dropped(self):
        words = table_words()
        words[4] = ("O01/02", XS[0] + 25, YS[1] + 35, 200, 38, 3, 0)
        self.ocr_output = tsv(words)
        result = self.client.parse_pdf(self.scanned_pdf())[0]
        self.assertIn("O01/02", result.markdown)
        self.assertIn("1 of", result.markdown)
        self.assertIn("below 60", result.markdown)

    def test_white_page_is_labeled_blank_only_without_ink(self):
        progress = Mock()
        result = self.client.parse_pdf(self.scanned_pdf(blank=True), progress)[0]
        self.assertEqual(result.method, "blank")
        self.assertIn("entirely white", result.markdown)
        self.assertIn("No property rows", result.markdown)
        self.process.assert_not_called()
        progress.assert_called_once_with(1, 1)

    def test_empty_ocr_on_an_inked_page_is_not_blank_or_success(self):
        self.ocr_output = tsv([])
        progress = Mock()
        with self.assertRaisesRegex(OCRError, "Page 1 of 1:.*contains ink") as caught:
            self.client.parse_pdf(self.scanned_pdf(grid=False), progress)
        self.assertIn("not labeled blank", str(caught.exception))
        progress.assert_not_called()

    def test_faint_color_ink_is_not_mistaken_for_a_white_page(self):
        self.ocr_output = tsv([])
        with self.assertRaisesRegex(OCRError, "contains ink"):
            self.client.parse_pdf(self.scanned_pdf(blank=True, faint_ink=True))
        self.assertEqual(len(self.ocr_calls()), 1)

    def test_full_page_timeout_rejects_partial_output(self):
        self.ocr_error = subprocess.TimeoutExpired("tesseract", 120, output=b"partial-private-text")
        progress = Mock()
        with self.assertRaisesRegex(OCRError, "Page 1 of 1:.*timed out") as caught:
            self.client.parse_pdf(self.scanned_pdf(), progress)
        self.assertIn("no partial output", str(caught.exception))
        self.assertNotIn("partial-private-text", str(caught.exception))
        self.assertEqual(len(self.ocr_calls()), 1)
        progress.assert_not_called()

    def test_nonzero_ocr_exit_is_an_explicit_redacted_failure(self):
        self.client.check_health()
        self.process.return_value = subprocess.CompletedProcess([], 1, b"partial", b"private-details")
        self.process.side_effect = None
        with self.assertRaisesRegex(OCRError, "Local Tesseract failed") as caught:
            self.client.parse_pdf(self.scanned_pdf())
        self.assertNotIn("private-details", str(caught.exception))
        self.assertNotIn("partial", str(caught.exception))

    def test_malformed_tsv_is_never_a_successful_page(self):
        cases = [
            b"", b"<html>not TSV</html>", b"\xff",
            tsv([("001", -1, 30, 40, 20, 1, 90)]),
            tsv([("001", 30, 30, 4000, 20, 1, 90)]),
            tsv([("001", 30, 30, 40, 20, 1, float("nan"))]),
            tsv([("001", 30, 30, 40, 20, 1, -1)]),
        ]
        path = self.scanned_pdf()
        for output in cases:
            with self.subTest(output=output[:20]):
                self.ocr_output = output
                with self.assertRaisesRegex(OCRError, "Page 1 of 1"):
                    self.client.parse_pdf(path)

    def test_later_page_failure_never_returns_an_apparently_complete_report(self):
        path = self.scanned_pdf(pages=3)
        document = pymupdf.open(path)
        self.client.check_health()
        self.process.reset_mock()
        self.process.side_effect = [
            subprocess.CompletedProcess([], 0, self.ocr_output, b""),
            subprocess.TimeoutExpired("tesseract", 120),
        ]
        progress = Mock()
        returned = None
        with patch.object(pymupdf, "open", return_value=document):
            with self.assertRaisesRegex(OCRError, "Page 2 of 3:.*timed out"):
                returned = self.client.parse_pdf(path, progress)
        self.assertIsNone(returned)
        self.assertEqual(len(self.ocr_calls()), 2)
        progress.assert_called_once_with(1, 3)
        self.assertTrue(document.is_closed)

    def test_native_and_scanned_page_order_and_progress_are_preserved(self):
        native = self.native_pdf()
        scanned = self.scanned_pdf()
        blank = self.scanned_pdf(blank=True)
        path = self.root / "mixed.pdf"
        with pymupdf.open() as merged:
            for source in (native, scanned, blank, native):
                with pymupdf.open(source) as document:
                    merged.insert_pdf(document)
            merged.save(path)
        progress = Mock()
        result = self.client.parse_pdf(path, progress)
        self.assertEqual([page.number for page in result], [1, 2, 3, 4])
        self.assertEqual([page.method for page in result], ["native", "tesseract", "blank", "native"])
        self.assertEqual([call.args for call in progress.call_args_list], [(1, 4), (2, 4), (3, 4), (4, 4)])
        self.assertEqual(len(self.ocr_calls()), 1)

    def test_invalid_empty_non_pdf_and_missing_files_fail_before_ocr(self):
        missing = self.root / "missing.pdf"
        empty = self.root / "empty.pdf"
        empty.write_bytes(b"")
        html_file = self.root / "html.pdf"
        html_file.write_text("<html>not PDF</html>", encoding="utf-8")
        png = self.root / "image.png"
        image = scan_image()
        try:
            image.save(png)
        finally:
            image.close()
        for path in (missing, empty, html_file, png):
            with self.subTest(path=path.name):
                with self.assertRaisesRegex(OCRError, "PDF"):
                    self.client.parse_pdf(path)
        self.process.assert_not_called()

    def test_encrypted_pdf_is_rejected_and_closed(self):
        path = self.native_pdf(encrypted=True)
        document = pymupdf.open(path)
        with patch.object(pymupdf, "open", return_value=document):
            with self.assertRaisesRegex(OCRError, "encrypted or password-protected"):
                self.client.parse_pdf(path)
        self.assertTrue(document.is_closed)
        self.process.assert_not_called()

    def test_zero_page_pdf_is_rejected(self):
        path = self.root / "zero-pages.pdf"
        contents = bytearray(b"%PDF-1.4\n")
        offsets = []
        for item in (
            b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
            b"2 0 obj\n<< /Type /Pages /Count 0 /Kids [] >>\nendobj\n",
        ):
            offsets.append(len(contents))
            contents.extend(item)
        xref = len(contents)
        contents.extend(b"xref\n0 3\n0000000000 65535 f \n")
        for offset in offsets:
            contents.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
        contents.extend(f"trailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode("ascii"))
        path.write_bytes(contents)
        with self.assertRaisesRegex(OCRError, "PDF has no pages"):
            self.client.parse_pdf(path)
        self.process.assert_not_called()

    def test_native_backend_error_is_wrapped_with_page_number(self):
        path = self.native_pdf()
        with patch.object(pymupdf.Page, "find_tables", side_effect=pymupdf.mupdf.FzErrorFormat("private-details")):
            with self.assertRaisesRegex(OCRError, "Page 1 of 1: PDF text/table extraction failed") as caught:
                self.client.parse_pdf(path)
        self.assertNotIn("private-details", str(caught.exception))
        self.process.assert_not_called()

    def test_render_memory_limit_fails_before_allocating_a_huge_pixmap(self):
        path = self.root / "huge.pdf"
        with pymupdf.open() as document:
            document.new_page(width=10000, height=10000)
            document.save(path)
        with patch.object(pymupdf.Page, "get_pixmap") as render:
            with self.assertRaisesRegex(OCRError, "memory budget.*Lower DPI"):
                self.client.parse_pdf(path)
            render.assert_not_called()
        self.process.assert_not_called()

    def test_progress_callback_error_does_not_leak_an_open_pdf(self):
        path = self.native_pdf()
        document = pymupdf.open(path)
        with patch.object(pymupdf, "open", return_value=document):
            with self.assertRaisesRegex(ValueError, "caller cancellation"):
                self.client.parse_pdf(path, Mock(side_effect=ValueError("caller cancellation")))
        self.assertTrue(document.is_closed)

    def test_close_is_a_noop_and_does_not_disable_extraction(self):
        self.client.close()
        self.assertEqual(self.client.parse_pdf(self.native_pdf())[0].method, "native")
        self.client.close()
        self.process.assert_not_called()


class GeometryTests(unittest.TestCase):
    def test_thin_skewed_grid_keeps_all_cells_and_merged_title_rows(self):
        gray = tilted_thin_header_grid()
        self.assertEqual(ocr._scan_grids(gray, cv2), [])
        deskewed = ocr._deskew_ruled_page(gray, cv2)
        self.assertIsNotNone(deskewed)
        aligned, angle = deskewed
        self.assertAlmostEqual(angle, -1.6, delta=0.15)
        self.assertGreater(aligned.shape[0], gray.shape[0])
        self.assertGreater(aligned.shape[1], gray.shape[1])
        grids = ocr._scan_grids(aligned, cv2, preserve_thin_lines=True)
        self.assertEqual(len(grids), 1)
        grid = grids[0]
        self.assertEqual((len(grid.ys) - 1, len(grid.xs) - 1, len(grid.cells)), (16, 10, 142))
        self.assertEqual(sorted((cell.row, cell.colspan) for cell in grid.cells if cell.colspan > 1), [(0, 10), (1, 10)])
        words = []
        for row, column, text in ((4, 4, "001/02"), (4, 8, "0.03")):
            cell = next(cell for cell in grid.cells if (cell.row, cell.column) == (row, column))
            x = (cell.box[0] + cell.box[2]) / 2
            y = (cell.box[1] + cell.box[3]) / 2
            words.append(ocr._Word((x - 10, y - 5, x + 10, y + 5), text, (row, column), 95))
        self.assertEqual(ocr._assign_words(grid, words, fill_cells=True), {0, 1})
        self.assertEqual([cell.text for cell in grid.cells].count("001/02"), 1)
        self.assertEqual([cell.text for cell in grid.cells].count("0.03"), 1)
        self.assertEqual(sum(not cell.text for cell in grid.cells), 140)
        for y, x in ((0, 0), (0, -150), (-150, 0), (-150, -150)):
            self.assertTrue(np.any(aligned[y:y + 150 if y == 0 else None, x:x + 150 if x == 0 else None] < 128))

    def test_deskew_requires_multiple_enclosed_cells_not_a_prose_frame(self):
        gray = np.full((400, 600), 255, dtype=np.uint8)
        cv2.rectangle(gray, (30, 30), (570, 370), 0, 2)
        self.assertIsNone(ocr._deskew_ruled_page(gray, cv2))

    def test_deskew_checks_expanded_canvas_budget_before_allocating(self):
        gray = tilted_thin_header_grid()
        with (
            patch.object(ocr, "_MAX_RENDER_PIXELS", gray.size),
            patch.object(cv2, "warpAffine", side_effect=AssertionError("Oversized allocation")) as warp,
        ):
            self.assertIsNone(ocr._deskew_ruled_page(gray, cv2))
        warp.assert_not_called()

    def test_thin_line_tolerance_never_adds_foreground_ink(self):
        gray = tilted_thin_header_grid()
        lines, scale = ocr._ruling_mask(gray, cv2, preserve_thin_lines=True)
        small = gray if scale == 1 else cv2.resize(
            gray, (round(gray.shape[1] * scale), round(gray.shape[0] * scale)),
            interpolation=cv2.INTER_AREA,
        )
        foreground = cv2.adaptiveThreshold(
            small, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 31, 15,
        )
        self.assertFalse(np.any((lines > 0) & (foreground == 0)))

    def test_holes_overlaps_and_single_frames_are_not_inferred_as_tables(self):
        for entries in (
            [((0, 0, 100, 100), "frame")],
            [((0, 0, 50, 50), "a"), ((50, 0, 100, 50), "b"), ((0, 50, 50, 100), "c")],
            [((0, 0, 100, 100), "whole"), ((0, 0, 50, 50), "overlap")],
        ):
            with self.subTest(entries=entries):
                self.assertIsNone(ocr._grid_from_boxes(entries, 0.1))
                self.assertIsNone(ocr._fit_scan_grid(entries, 1.0))

    def test_scan_fitting_preserves_physical_boxes_without_extra_row_bands(self):
        entries = [
            ((column * 100, row * 45 + column * 5,
              (column + 1) * 100, (row + 1) * 45 + column * 5), "")
            for row in range(3) for column in range(2)
        ]
        grid = ocr._fit_scan_grid(entries, 1.0)
        self.assertIsNotNone(grid)
        self.assertEqual((len(grid.ys) - 1, len(grid.xs) - 1, len(grid.cells)), (3, 2, 6))
        self.assertEqual({cell.box for cell in grid.cells}, {box for box, _ in entries})
        word = ocr._Word((120, 92, 130, 94), "001", (1, 1, 1), 95)
        self.assertEqual(ocr._assign_words(grid, [word], fill_cells=True), {0})
        occupied = [cell for cell in grid.cells if cell.text]
        self.assertEqual([(cell.row, cell.column, cell.text) for cell in occupied], [(1, 1, "001")])

    def test_words_outside_a_skewed_grid_cell_union_remain_prose(self):
        entries = [
            ((column * 100, row * 45 + column * 5,
              (column + 1) * 100, (row + 1) * 45 + column * 5), "")
            for row in range(3) for column in range(2)
        ]
        grid = ocr._fit_scan_grid(entries, 1.0)
        words = [
            ocr._Word((120, 1, 130, 3), "margin-note", (1, 1, 1), 90),
            ocr._Word((120, 20, 130, 30), "001", (1, 1, 2), 90),
        ]
        self.assertEqual(ocr._assign_words(grid, words, fill_cells=True), {1})
        self.assertNotIn("margin-note", ocr._table_html(grid))
        markdown = ocr._page_markdown(1, "tesseract", words, [grid])
        self.assertIn("margin-note", markdown)
        self.assertIn("<table>", markdown)

    def test_scan_fitting_uses_fine_tolerances_without_inventing_row_bands(self):
        entries = [
            ((column * 100, row * 22 + column * 1.9,
              (column + 1) * 100, (row + 1) * 22 + (column + 1) * 1.9), "")
            for row in range(3) for column in range(10)
        ]
        grid = ocr._fit_scan_grid(entries, 1.0)
        self.assertIsNotNone(grid)
        self.assertEqual((len(grid.ys) - 1, len(grid.xs) - 1, len(grid.cells)), (3, 10, 30))
        self.assertTrue(all(cell.rowspan == cell.colspan == 1 for cell in grid.cells))
        self.assertEqual({cell.box for cell in grid.cells}, {box for box, _ in entries})

    def test_scan_fitting_stops_at_its_geometric_work_budget(self):
        entries = [((0, 0, 20, 20), ""), ((20, 0, 40, 20), ""), ((0, 20, 20, 40), "")]
        with (
            patch.object(ocr, "_MAX_SCAN_FITS", 2),
            patch.object(ocr, "_scan_axis_options", return_value=[(2, 3), (3, 6), (4, 12)]),
            patch.object(ocr, "_grid_from_boxes", return_value=None) as fit,
        ):
            self.assertIsNone(ocr._fit_scan_grid(entries, 1.0))
        self.assertEqual(fit.call_count, 2)

    def test_ruling_suppression_leaves_text_interiors_and_page_heading_unchanged(self):
        image = scan_image()
        try:
            gray = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2GRAY)
        finally:
            image.close()
        grids = ocr._scan_grids(gray, cv2)
        self.assertEqual(len(grids), 1)
        cleaned, applied = ocr._suppress_grid_rulings(gray, grids, cv2, np)
        self.assertTrue(applied)
        self.assertTrue(np.array_equal(cleaned[:140], gray[:140]))
        self.assertTrue(np.array_equal(cleaned[320:365, 85:285], gray[320:365, 85:285]))

    def test_rowspan_and_empty_cells_follow_geometry(self):
        grid = ocr._grid_from_boxes([
            ((0, 0, 50, 100), "001/02"),
            ((50, 0, 100, 50), "0.05"),
            ((50, 50, 100, 100), ""),
        ], 0.1)
        self.assertIsNotNone(grid)
        table = BeautifulSoup(ocr._table_html(grid), "html.parser")
        self.assertEqual(table.select_one("td").get("rowspan"), "2")
        self.assertEqual([cell.get_text() for cell in table.select("td")], ["001/02", "0.05", ""])

    def test_grid_analysis_size_is_bounded(self):
        gray = np.full((2400, 3200), 255, dtype=np.uint8)
        with patch.object(cv2, "adaptiveThreshold", wraps=cv2.adaptiveThreshold) as threshold:
            self.assertEqual(ocr._scan_grids(gray, cv2), [])
        self.assertLessEqual(max(threshold.call_args.args[0].shape), 2000)


class ConfigurationTests(unittest.TestCase):
    def test_invalid_configuration_is_rejected(self):
        invalid = [
            {"languages": ""}, {"languages": None}, {"languages": "eng;tel"},
            {"languages": "eng --psm 0"}, {"languages": "eng\n"},
            {"dpi": 0}, {"dpi": -1}, {"dpi": True}, {"dpi": 300.5},
            {"timeout": 0}, {"timeout": float("nan")}, {"timeout": float("inf")},
            {"timeout": True}, {"timeout": "invalid"},
            {"command": ""}, {"command": ["tesseract"]}, {"command": "private-path\n--flag"},
        ]
        with patch.object(ocr.subprocess, "run") as run:
            for kwargs in invalid:
                with self.subTest(kwargs=kwargs):
                    with self.assertRaises(OCRError) as caught:
                        TesseractOCR(**kwargs)
                    self.assertNotIn("private-path", str(caught.exception))
            run.assert_not_called()


_LOCAL_BINARY = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Tesseract-OCR" / "tesseract.exe"


@unittest.skipUnless(_LOCAL_BINARY.is_file(), "Local Tesseract binary is not installed")
class LiveLocalOCRTests(Fixtures):
    def test_installed_binary_reads_a_generated_scanned_grid_locally(self):
        client = TesseractOCR(command=_LOCAL_BINARY)
        client.check_health()
        progress = Mock()
        result = client.parse_pdf(self.scanned_pdf(), progress)
        self.assertEqual(result[0].method, "tesseract")
        self.assertEqual(self.table_rows(result[0].markdown), VALUES)
        progress.assert_called_once_with(1, 1)
        client.close()


if __name__ == "__main__":
    unittest.main()

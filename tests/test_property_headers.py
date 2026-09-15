import unittest

from prohibited_properties.documents import normalize_markdown_tables, render_document


HEADERS = [
    "SI.No", "Name of the<br>District", "Name of the<br>Mandal", "Name of the<br>Village / Town",
    "Sy. No. &amp;<br>Sub-Division No. (if any)", "Plot No", "Town Survey No",
    "House No", "Name of the Assignee / Owner", "Extent", "Act under which prohibited",
]
GUIDE = ["", "2", "3 |", "4", "5", "6", "", "", "9", "10", "11"]
PROPERTY = ["", "RANGAREDDY", "MAHESHWARAM", "PENDYAL", "078/1/aa", "", "", "", "Owner name", "1.00", "Assigned Laws"]


def row(values, tag="td"):
    return "<tr>" + "".join(f"<{tag}>{value}</{tag}>" for value in values) + "</tr>"


def grid(values):
    return "<table><tbody>\n" + "\n".join(row(value) for value in values) + "\n</tbody></table>"


class PropertyHeaderTests(unittest.TestCase):
    def test_scanned_header_and_printed_column_numbers_are_not_records(self):
        result = render_document(grid([HEADERS, GUIDE, PROPERTY]))
        table = result["tables"][0]
        self.assertEqual(table["columns"][0], "SI.No")
        self.assertEqual(table["columns"][1], "Name of the District")
        self.assertEqual(table["columns"][4], "Sy. No. & Sub-Division No. (if any)")
        self.assertEqual(table["rows"], [PROPERTY])
        self.assertEqual(result["row_count"], 1)
        self.assertIn("<thead>", result["html"])
        self.assertIn("<th>", result["html"])
        self.assertNotIn("Column 1", result["html"])

    def test_named_rows_replace_only_synthetic_column_headers(self):
        html = (
            "<table><thead>" + row([f"Column {i}" for i in range(1, 12)], "th")
            + "</thead><tbody>" + row(HEADERS) + row(GUIDE) + row(PROPERTY) + "</tbody></table>"
        )
        table = render_document(html)["tables"][0]
        self.assertEqual(table["columns"][1], "Name of the District")
        self.assertEqual(table["rows"], [PROPERTY])

    def test_all_pages_get_headers_without_losing_leading_zeroes(self):
        markdown = "\n\n".join(
            f"## Page {number}\n\n" + grid([HEADERS, GUIDE, PROPERTY]) for number in range(2, 6)
        )
        result = render_document(markdown)
        self.assertEqual(result["row_count"], 4)
        self.assertEqual([table["page"] for table in result["tables"]], [2, 3, 4, 5])
        self.assertTrue(all(table["rows"][0][4] == "078/1/aa" for table in result["tables"]))

    def test_no_header_is_invented_from_property_values(self):
        table = render_document(grid([PROPERTY, PROPERTY]))["tables"][0]
        self.assertEqual(table["columns"][0], "Column 1")
        self.assertEqual(len(table["rows"]), 2)

    def test_real_numbers_are_not_dropped_as_column_guides(self):
        numeric_property = ["0001", "23", "45", "67", "0", "", "", "", "", "1.00", ""]
        table = render_document(grid([HEADERS, numeric_property, PROPERTY]))["tables"][0]
        self.assertEqual(table["rows"], [numeric_property, PROPERTY])
        small = "<table>" + row(["Survey", "Plot", "Extent"], "th") + row(["1", "2", "3"]) + "</table>"
        self.assertEqual(render_document(small)["tables"][0]["rows"], [["1", "2", "3"]])

    def test_ordinary_named_headers_are_preserved(self):
        html = "<table>" + row(["Parcel", "Area"], "th") + row(["001", "0"]) + "</table>"
        table = render_document(html)["tables"][0]
        self.assertEqual(table["columns"], ["Parcel", "Area"])
        self.assertEqual(table["rows"], [["001", "0"]])
        numeric_table = "<table>" + row(list("ABCDEF"), "th") + row(["1", "2", "3", "4", "5", "6"]) + "</table>"
        self.assertEqual(render_document(numeric_table)["row_count"], 1)

    def test_persisted_markdown_normalization_is_idempotent_and_preserves_text(self):
        markdown = "# Village report\n\nA source letter, not a property.\n\n## Page 2\n\n" + grid([HEADERS, GUIDE, PROPERTY]) + "\n\nFooter.\n"
        result = normalize_markdown_tables(markdown)
        self.assertIn("# Village report\n", result)
        self.assertIn("A source letter, not a property.", result)
        self.assertIn("Footer.", result)
        self.assertIn("<thead>", result)
        self.assertEqual(normalize_markdown_tables(result), result)
        self.assertEqual(render_document(result)["row_count"], 1)

    def test_detected_grouped_headers_preserve_spans_and_exclude_number_guide(self):
        html = (
            '<table><tbody><tr><td rowspan="2">S.No</td><td colspan="3">Location</td>'
            '<td rowspan="2">Survey No</td><td rowspan="2">Extent</td></tr>'
            + row(["District", "Mandal", "Village"])
            + row(["1", "2", "3", "4", "5", "6"])
            + row(["001", "Rangareddy", "Maheshwaram", "Pendy al", "078/1", "1.00"])
            + "</tbody></table>"
        )
        table = render_document(html)["tables"][0]
        self.assertEqual(
            table["columns"],
            ["S.No", "Location / District", "Location / Mandal", "Location / Village", "Survey No", "Extent"],
        )
        self.assertEqual(len(table["rows"]), 1)
        self.assertEqual(table["rows"][0][0], "001")

    def test_urban_property_headers_do_not_depend_on_district_columns(self):
        labels = ["Sl.No", "SRO", "Local body", "Survey No", "Area", "Remarks"]
        record = ["001", "HYDERABAD", "GHMC", "073", "0.50", "See source"]
        table = render_document(grid([labels, ["1", "2", "3", "4", "5", "6"], record]))["tables"][0]
        self.assertEqual(table["columns"], labels)
        self.assertEqual(table["rows"], [record])

    def test_merged_titles_become_a_caption_before_the_real_header(self):
        labels = ["Sl.No", "District", "Mandal", "Village", "Survey No", "Extent"]
        record = ["001", "Rangareddy", "Maheshwaram", "Pendy al", "018", "2.09"]
        html = (
            '<table><tbody><tr><td colspan="6">Form-II (Agriculture)</td></tr>'
            '<tr><td colspan="6">Properties under Section 22-A(1)(b)</td></tr>'
            + row(labels) + row(["", "2", "3", "", "5", "6"]) + row(record)
            + "</tbody></table>"
        )
        result = render_document(html)
        table = result["tables"][0]
        self.assertEqual(table["columns"], labels)
        self.assertEqual(table["rows"], [record])
        self.assertIn("Form-II", table["caption"])
        self.assertIn("Section 22-A", table["caption"])
        self.assertIn("<caption>", result["html"])
        self.assertEqual(result["row_count"], 1)
        formatted = normalize_markdown_tables(html)
        self.assertEqual(normalize_markdown_tables(formatted), formatted)

    def test_merged_rows_without_a_recognizable_header_are_not_removed(self):
        html = '<table><tr><td colspan="6">An observed merged value</td></tr>' + row(["1", "2", "3", "4", "5", "6"]) + "</table>"
        table = render_document(html)["tables"][0]
        self.assertEqual(len(table["rows"]), 2)
        self.assertEqual(table["columns"][0], "Column 1")


if __name__ == "__main__":
    unittest.main()

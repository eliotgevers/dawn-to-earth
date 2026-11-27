import unittest

from archives import projection_lines
from measurements import DISPLAY_ORIGIN, TAGS, registered_series


class RecordedMeasurementsTest(unittest.TestCase):
    def setUp(self):
        self.series = {
            "editionId": "edition-A", "source": "Register R", "quantity": "Completed cells", "unit": "fields",
            "points": [{"id": "P2", "elapsedMs": 90, "value": 2.5, "locator": "Row B"},
                       {"id": "P1", "elapsedMs": 90, "value": 2.5, "locator": "Row A"}],
        }
        self.record = {"test": "thermal", "id": "receipt", "unit": {"serial": "U-2", "revisionId": "rev-a"},
                       "numericSeries": [self.series]}
        self.workspace = {
            "units": [{"serial": "U-2", "configurations": [{"revisionId": "rev-a"}]}],
            "archivedUnits": [], "sources": [self.record],
        }

    def test_hash_matches_javascript_and_coincident_samples_keep_their_identity(self):
        (edition, rows), = registered_series(self.workspace).items()
        lines = list(projection_lines("evidence_sample", TAGS, {edition: rows}))
        # Independently computed using JSON.stringify + DataView.setFloat64(0, value, false).
        self.assertEqual(edition, "edition-A~297cabeccda2881d23699c40fc0a4f77366ef646207455aa64ce4e63849c860a")
        self.assertEqual([row["sample_id"] for row in rows], ["P2", "P1"])
        self.assertTrue(all(line.endswith(str(DISPLAY_ORIGIN + 90)) for line in lines))
        self.assertNotEqual(lines[0].split()[0], lines[1].split()[0])

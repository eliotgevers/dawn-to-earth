from copy import deepcopy
import unittest

from exchange_events import event_series, registered_editions


class ArchiveDiscoveryTest(unittest.TestCase):
    def setUp(self):
        self.unit = {"serial": "DOC-11", "revisionId": "design-a"}
        self.record = {"test": "communication", "id": "archive-11", "unit": self.unit, "exchangeArchive": {
            "id": "pair", "prior": {"id": "old-copy", "events": [
                {"id": "A", "key": "front", "document": "Cover", "atMs": 12, "kind": "request", "expected": "Filed"}]},
            "current": {"id": "revised-copy", "events": [
                {"id": "B", "key": "front", "document": "Cover", "atMs": 9, "kind": "reply", "value": "Filed"}]}}}
        self.fixture = {"units": [
            {"serial": "DOC-11", "revisionId": "design-b", "configurations": [{"revisionId": "design-a"}, {"revisionId": "design-b"}]},
            {"serial": "DOC-12", "revisionId": "design-b", "configurations": [{"revisionId": "design-b"}]}],
            "archivedUnits": [], "sources": [self.record], "activity": []}


    def test_frozen_earlier_editions_remain_exact_after_source_correction_or_archive(self):
        current = self.record["exchangeArchive"]
        original = deepcopy(current)
        original["current"]["events"][0]["value"] = "Earlier cover"
        action = {"type": "note", "parentId": self.record["id"], "unit": self.unit}
        basis = {"archiveId": "pair", "priorLogId": "old-copy", "currentLogId": "revised-copy", "correlation": "front",
                 "priorEventIds": ["A"], "currentEventIds": ["B"]}
        note = {"kind": "evidence", "test": "communication", "action": action, "matchesSource": True, "eventFinding": {"archive": original, "basis": basis}}
        self.fixture["activity"] = [note, deepcopy(note)]
        runs = registered_editions(self.fixture)
        self.assertEqual(len(runs), 3)
        removal = {"kind": "evidence", "test": "communication", "action": {**action, "type": "remove"}}
        self.fixture["activity"].append(removal)
        frozen_runs = registered_editions(self.fixture)
        self.assertEqual(len(frozen_runs), 2)
        self.assertIn(event_series(self.record, original, original["current"])[0], frozen_runs)
        self.assertNotIn(event_series(self.record, current, current["current"])[0], frozen_runs)
        self.fixture["activity"] = [removal]
        self.assertEqual(registered_editions(self.fixture), {})
        self.fixture["archivedUnits"] = [self.unit["serial"]]
        self.fixture["activity"] = []
        self.assertEqual(registered_editions(self.fixture), {})
        self.fixture["activity"] = [note]
        self.assertEqual(registered_editions(self.fixture), frozen_runs)


if __name__ == "__main__":
    unittest.main()

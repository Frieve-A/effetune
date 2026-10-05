"""Verify that public target-table provenance contains only aggregate data."""

import json
import unittest

import learn_targets


class ProvenanceTests(unittest.TestCase):
    def test_public_provenance_aggregates_licenses_without_track_identifiers(self):
        selection = {
            123456: ("Classical", "Attribution"),
            654321: ("Classical", "Attribution"),
            789123: ("Rock", "CC0 1.0 Universal"),
        }
        source = learn_targets.render_provenance(
            ["All", "Classical", "Rock"],
            list(selection),
            selection,
            [{"ok": True} for _ in selection],
            {},
        )
        provenance = json.loads(source)
        self.assertEqual(
            provenance["tracks_per_licence"],
            {"Attribution": 2, "CC0 1.0 Universal": 1},
        )
        self.assertEqual(provenance["tracks_per_style"], {"Classical": 2, "Rock": 1})
        self.assertIn("Free Music Archive", provenance["corpus"]["name"])
        self.assertNotIn("tracks_by_licence", provenance)
        self.assertNotIn("archive", provenance["corpus"])
        self.assertNotIn("archive_sha1", provenance["corpus"])
        for track_id in selection:
            self.assertNotIn(str(track_id), source)


if __name__ == "__main__":
    unittest.main()

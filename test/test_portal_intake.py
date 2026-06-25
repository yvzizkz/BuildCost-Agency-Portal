#!/usr/bin/env python3
"""test_portal_intake.py — edge-case unit tests for bridge/portal_intake.py.

Each test runs portal_intake.py as a subprocess against a fresh temp sandbox, so
nothing in the live engine is touched. brandlib is imported (read-only) by the
script from --engine-root.

    python3 -m unittest test.test_portal_intake      # from the repo root
    python3 test/test_portal_intake.py
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
PORTAL_INTAKE = os.path.join(HERE, "..", "bridge", "portal_intake.py")
ENGINE_ROOT = os.environ.get("ENTERPRISE_ROOT", "/Users/landos/Documents/Enterprise")
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9"


class IntakeCase(unittest.TestCase):
    def setUp(self):
        self.sandbox = tempfile.mkdtemp(prefix="portal-intake-ut-")
        self.images_dir = os.path.join(self.sandbox, "uploads")
        os.makedirs(self.images_dir)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.sandbox, ignore_errors=True)

    # -- helpers ------------------------------------------------------------
    def write_images(self, *names):
        for n in names:
            with open(os.path.join(self.images_dir, n), "wb") as f:
                f.write(JPEG)

    def _ingest(self, submission, expect_ok=True):
        sp = os.path.join(self.sandbox, "submission.json")
        with open(sp, "w") as f:
            json.dump(submission, f)
        argv = [
            sys.executable, PORTAL_INTAKE,
            "--slug", submission.get("slug", "saddlewood"),
            "--submission", sp,
            "--images-dir", self.images_dir,
            "--engine-root", ENGINE_ROOT,
            "--reference-dir", os.path.join(self.sandbox, "reference"),
            "--queue-path", os.path.join(self.sandbox, "review-queue.json"),
            "--state-path", os.path.join(self.sandbox, "state.json"),
            "--default-city", "Scottsdale, AZ",
            "--json",
        ]
        p = subprocess.run(argv, capture_output=True, text=True)
        out = (p.stdout.strip().splitlines() or [""])[-1]
        try:
            res = json.loads(out)
        except json.JSONDecodeError:
            res = {"ok": False, "error": p.stdout + p.stderr}
        if expect_ok:
            self.assertEqual(p.returncode, 0, msg=p.stdout + p.stderr)
        return p.returncode, res

    def projects(self):
        path = os.path.join(self.sandbox, "reference", "projects.json")
        with open(path) as fh:
            return json.load(fh)["projects"]

    # -- cases --------------------------------------------------------------
    def test_missing_title_errors(self):
        self.write_images("a.jpg")
        code, res = self._ingest({"submissionId": "s1", "images": [{"file": "a.jpg"}]}, expect_ok=False)
        self.assertNotEqual(code, 0)
        self.assertFalse(res["ok"])
        self.assertIn("title", res["error"])

    def test_no_images_errors(self):
        code, res = self._ingest({"submissionId": "s2", "title": "T", "images": []}, expect_ok=False)
        self.assertNotEqual(code, 0)
        self.assertIn("image", res["error"].lower())

    def test_neighborhood_fallback_to_default_city(self):
        self.write_images("a.jpg")
        _, res = self._ingest({"submissionId": "s3", "title": "No Hood Job", "images": [{"file": "a.jpg"}]})
        self.assertEqual(res["status"], "ingested")
        self.assertEqual(self.projects()[0]["neighborhood"], "Scottsdale, AZ")

    def test_all_process_images_keep_a_hero_and_gallery(self):
        self.write_images("d1.jpg", "d2.jpg")
        _, res = self._ingest({
            "submissionId": "s4", "title": "Teardown Week", "neighborhood": "Mesa, AZ",
            "images": [{"file": "d1.jpg", "process": True}, {"file": "d2.jpg", "process": True}],
        })
        rec = self.projects()[0]
        self.assertTrue(rec["heroImage"])                       # hero still set
        self.assertEqual(rec["galleryImages"], [rec["heroImage"]])  # gallery never empty
        self.assertEqual(len(rec["processImages"]), 2)

    def test_id_dedup_against_existing_title(self):
        self.write_images("a.jpg")
        self._ingest({"submissionId": "s5a", "title": "Scottsdale Remodel", "images": [{"file": "a.jpg"}]})
        self._ingest({"submissionId": "s5b", "title": "Scottsdale Remodel", "images": [{"file": "a.jpg"}]})
        ids = sorted(p["id"] for p in self.projects())
        self.assertEqual(ids, ["scottsdale-remodel", "scottsdale-remodel-1"])

    def test_hero_index_selects_gallery_order(self):
        self.write_images("a.jpg", "b.jpg", "c.jpg")
        _, res = self._ingest({
            "submissionId": "s6", "title": "Hero Pick", "neighborhood": "Tempe, AZ", "heroIndex": 2,
            "images": [{"file": "a.jpg"}, {"file": "b.jpg"}, {"file": "c.jpg"}],
        })
        rec = self.projects()[0]
        self.assertTrue(rec["heroImage"].endswith("-2.jpg"))
        self.assertEqual(rec["galleryImages"][0], rec["heroImage"])  # hero first

    def test_enrich_fields_pass_through_when_provided(self):
        self.write_images("a.jpg")
        _, res = self._ingest({
            "submissionId": "s7", "title": "Rich Submit", "neighborhood": "Paradise Valley, AZ",
            "images": [{"file": "a.jpg"}],
            "scope": ["kitchen", "primary bath"], "materials": ["white oak", "marble"],
            "signatureDetails": ["waterfall island"], "heroDetail": "honed-stone island",
        })
        rec = self.projects()[0]
        self.assertEqual(rec["scope"], ["kitchen", "primary bath"])
        self.assertEqual(rec["materials"], ["white oak", "marble"])
        self.assertEqual(rec["heroDetail"], "honed-stone island")


if __name__ == "__main__":
    unittest.main(verbosity=2)

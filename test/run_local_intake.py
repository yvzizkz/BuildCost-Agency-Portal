#!/usr/bin/env python3
"""run_local_intake.py — end-to-end intake smoke test WITHOUT Firebase.

Proves the full contract: feeds fixture images + a submission straight into
bridge/portal_intake.py against a THROWAWAY sandbox, then asserts the
projects.json record, copied images, and review-queue item match the contract —
and that a re-run is idempotent. The live reference library is never touched
(all destinations point into a temp dir; brandlib is imported read-only).

    python3 test/run_local_intake.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PORTAL_INTAKE = os.path.join(HERE, "..", "bridge", "portal_intake.py")
ENGINE_ROOT = os.environ.get("ENTERPRISE_ROOT", "/Users/landos/Documents/Enterprise")

# minimal JPEG shell (SOI … EOI) — portal_intake only copies bytes + checks ext
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9"


def run_intake(sandbox, images_dir, submission_path):
    argv = [
        sys.executable, PORTAL_INTAKE,
        "--slug", "saddlewood",
        "--submission", submission_path,
        "--images-dir", images_dir,
        "--engine-root", ENGINE_ROOT,
        "--reference-dir", os.path.join(sandbox, "reference"),
        "--queue-path", os.path.join(sandbox, "review-queue.json"),
        "--state-path", os.path.join(sandbox, "portal-intake-state-saddlewood.json"),
        "--default-city", "Scottsdale, AZ",
        "--json",
    ]
    p = subprocess.run(argv, capture_output=True, text=True)
    if p.returncode != 0:
        print(p.stdout); print(p.stderr, file=sys.stderr)
        raise SystemExit("portal_intake.py exited %d" % p.returncode)
    return json.loads(p.stdout.strip().splitlines()[-1])


def check(cond, label):
    print(("  ok  " if cond else "  FAIL") + "  " + label)
    if not cond:
        raise SystemExit("assertion failed: " + label)


def main():
    sandbox = tempfile.mkdtemp(prefix="portal-intake-e2e-")
    try:
        images_dir = os.path.join(sandbox, "uploads")
        os.makedirs(images_dir)
        for name in ("finished-kitchen.jpg", "finished-greatroom.jpg", "week1-demo.jpg"):
            with open(os.path.join(images_dir, name), "wb") as f:
                f.write(JPEG)

        submission = {
            "submissionId": "sub_demo_0001",
            "slug": "saddlewood",
            "title": "Arcadia Kitchen & Great Room",
            "neighborhood": "Arcadia, Phoenix, AZ",
            "story": "Island set; white oak next week. Demo shots from week one.",
            "submittedAt": "2026-06-24T15:30:00+00:00",
            "heroIndex": 0,
            "images": [
                {"file": "finished-kitchen.jpg", "process": False},
                {"file": "finished-greatroom.jpg", "process": False},
                {"file": "week1-demo.jpg", "process": True},
            ],
        }
        submission_path = os.path.join(sandbox, "submission.json")
        with open(submission_path, "w") as f:
            json.dump(submission, f)

        print("\n== first ingest ==")
        r = run_intake(sandbox, images_dir, submission_path)
        check(r["ok"] and r["status"] == "ingested", "result ok + status=ingested")

        projects = json.load(open(os.path.join(sandbox, "reference", "projects.json")))["projects"]
        check(len(projects) == 1, "exactly one project written")
        rec = projects[0]
        for field in ("id", "title", "neighborhood", "scope", "materials", "signatureDetails",
                      "story", "heroImage", "galleryImages", "source", "portalSubmissionId",
                      "submittedAt", "status"):
            check(field in rec, "record has field '%s'" % field)
        check(rec["status"] == "pending", "status == pending (enrich on confirm)")
        check(rec["source"] == "portal-intake", "source == portal-intake")
        check(rec["scope"] == [] and rec["materials"] == [] and rec["signatureDetails"] == [],
              "structured fields empty (dead-simple model)")
        check(rec["heroImage"] == "images/saddlewood-sub-demo-0001-0.jpg",
              "heroImage path correct (submission id slugified for the filename)")
        check(rec["portalSubmissionId"] == "sub_demo_0001", "portalSubmissionId keeps the original id (dedup key)")
        check(rec["heroImage"] in rec["galleryImages"], "hero is in gallery")
        check(len(rec["galleryImages"]) == 2, "gallery has the 2 finished shots (process excluded)")
        check(rec.get("processImages") == ["images/saddlewood-sub-demo-0001-2.jpg"],
              "processImages has the 1 flagged in-progress shot")
        check(rec["neighborhood"] == "Arcadia, Phoenix, AZ", "neighborhood from submission")

        ref_images = sorted(os.listdir(os.path.join(sandbox, "reference", "images")))
        check(len(ref_images) == 3, "all 3 images copied into reference/images/")

        queue = json.load(open(os.path.join(sandbox, "review-queue.json")))["items"]
        check(len(queue) == 1 and queue[0]["type"] == "intake" and queue[0]["business"] == "saddlewood",
              "one intake review-queue item appended")
        check(queue[0]["status"] == "pending" and queue[0]["projectId"] == rec["id"],
              "queue item pending + linked to the project")

        print("\n== second ingest (idempotency) ==")
        r2 = run_intake(sandbox, images_dir, submission_path)
        check(r2["ok"] and r2["status"] == "already-ingested", "re-run is a no-op (already-ingested)")
        projects2 = json.load(open(os.path.join(sandbox, "reference", "projects.json")))["projects"]
        check(len(projects2) == 1, "no duplicate project on re-run")
        queue2 = json.load(open(os.path.join(sandbox, "review-queue.json")))["items"]
        check(len(queue2) == 1, "no duplicate queue item on re-run")

        print("\nALL CHECKS PASSED — intake contract verified end-to-end; live library untouched.")
        return 0
    finally:
        shutil.rmtree(sandbox, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())

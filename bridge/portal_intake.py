#!/usr/bin/env python3
"""portal_intake.py — the ONLY engine-touching file in the agency-portal track.

It ingests one owner submission from the BuildCost owner portal into a brand's
reference library, producing exactly the shape the Enterprise producer skills
already consume (brands/<slug>/reference/projects.json + reference/images/).

HARD BOUNDARY (see README): this file lives in the agency-portal repo, NOT in
the Enterprise repo's .claude/skills/. It does NOT modify any producer skill, the
brand registry schema, or the review-queue schema. It only:
  - imports brandlib READ-ONLY (shared infra) for the engine's own atomic
    write_state / read_state / state_lock primitives, and
  - appends DATA (one project record + image files + one review-queue item) in
    the EXISTING schemas.
It mirrors source_intake.py's contract intentionally; it does not import or alter
it (the ~30 lines of record-building are duplicated on purpose to keep the
tracks fully decoupled).

The Node bridge (bridge.mjs) downloads the owner's photos from Firebase Storage
to a temp dir, writes a submission JSON, and invokes this script via execFile
(argv array, never a shell). This script never touches Firebase.

Destinations are fully parametrized so a test harness can target a throwaway
sandbox and never mutate the live reference library:
  --engine-root   locate brandlib (<engine-root>/brands) — READ-ONLY import only
  --reference-dir where images + projects.json are written (default derived)
  --queue-path    the shared review-queue.json (default derived)
  --state-path    the portal-intake dedup ledger (default derived)
"""
from __future__ import annotations
import argparse
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone

ALLOWED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"}


def _slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9-]", "-", (text or "").lower())
    s = re.sub(r"-+", "-", s).strip("-")
    return s


def _safe_ext(filename: str) -> str:
    ext = os.path.splitext(filename or "")[1].lower()
    return ext if ext in ALLOWED_IMAGE_EXTS else ".jpg"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_brandlib(engine_root: str):
    """Import the engine's brandlib READ-ONLY for its atomic state primitives."""
    brands_dir = os.path.join(engine_root, "brands")
    if not os.path.isfile(os.path.join(brands_dir, "brandlib.py")):
        sys.exit("portal-intake: brandlib not found under %s (set --engine-root)" % brands_dir)
    sys.path.insert(0, brands_dir)
    import brandlib  # noqa: E402
    return brandlib


def _fail(msg: str, as_json: bool) -> int:
    if as_json:
        print(json.dumps({"ok": False, "error": msg}))
    else:
        print("portal-intake: " + msg, file=sys.stderr)
    return 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Ingest one portal submission into a brand's reference library.")
    ap.add_argument("--slug", required=True, help="brand slug, e.g. saddlewood")
    ap.add_argument("--submission", required=True, help="path to the submission JSON the bridge wrote")
    ap.add_argument("--images-dir", required=True, help="dir holding the downloaded image files named in the submission")
    ap.add_argument("--engine-root", default="/Users/landos/Documents/Enterprise",
                    help="Enterprise repo root — used ONLY to import brandlib (read-only)")
    ap.add_argument("--reference-dir", default=None, help="override reference dir (default <engine-root>/brands/<slug>/reference)")
    ap.add_argument("--queue-path", default=None, help="override review-queue.json (default <engine-root>/growth-assets/review-queue.json)")
    ap.add_argument("--state-path", default=None, help="override dedup ledger (default <engine-root>/growth-assets/portal-intake-state-<slug>.json)")
    ap.add_argument("--default-city", default="", help="neighborhood fallback (brand.geo.primaryCity), passed by the bridge")
    ap.add_argument("--json", action="store_true", help="emit a machine-readable result on stdout")
    args = ap.parse_args(argv)

    asj = args.json
    brandlib = _load_brandlib(args.engine_root)

    slug = args.slug.lower()
    if not brandlib.SLUG_RE.match(slug):
        return _fail("invalid brand slug %r" % slug, asj)

    # Resolve destinations (parametrized so tests never touch the live library).
    reference_dir = args.reference_dir or os.path.join(args.engine_root, "brands", slug, "reference")
    queue_path = args.queue_path or os.path.join(args.engine_root, "growth-assets", "review-queue.json")
    state_path = args.state_path or os.path.join(args.engine_root, "growth-assets", "portal-intake-state-%s.json" % slug)
    projects_path = os.path.join(reference_dir, "projects.json")
    images_dir = os.path.join(reference_dir, "images")

    # --- read + validate the submission ---
    sub = brandlib.read_state(args.submission, default=None)
    if not isinstance(sub, dict):
        return _fail("submission JSON missing or unreadable: %s" % args.submission, asj)

    submission_id = (sub.get("submissionId") or "").strip()
    title = (sub.get("title") or "").strip()
    if not submission_id:
        return _fail("submission missing 'submissionId'", asj)
    if not title:
        return _fail("submission missing 'title'", asj)

    images_in = sub.get("images") or []
    images_in = [im for im in images_in if isinstance(im, dict) and im.get("file")]
    # Keep only real image files (defense-in-depth; the bridge already filters).
    images_in = [im for im in images_in if os.path.splitext(im["file"])[1].lower() in ALLOWED_IMAGE_EXTS]
    if not images_in:
        return _fail("submission %s has no image files" % submission_id, asj)

    neighborhood = (sub.get("neighborhood") or "").strip() or (args.default_city or "").strip()
    story = (sub.get("story") or "").strip()
    hero_index = sub.get("heroIndex", 0)
    if not isinstance(hero_index, int) or not (0 <= hero_index < len(images_in)):
        hero_index = 0
    # Optional enrich-later structured fields (empty in the dead-simple model).
    scope = [s for s in (sub.get("scope") or []) if isinstance(s, str) and s.strip()]
    materials = [m for m in (sub.get("materials") or []) if isinstance(m, str) and m.strip()]
    signature = [d for d in (sub.get("signatureDetails") or []) if isinstance(d, str) and d.strip()]
    hero_detail = (sub.get("heroDetail") or "").strip() or (signature[0] if signature else "")
    submitted_at = (sub.get("submittedAt") or "").strip() or _now_iso()

    # --- idempotency: skip if this submission was already ingested ---
    state = brandlib.read_state(state_path, default={}) or {}
    ingested_ids = set(state.get("ingestedSubmissionIds", []))
    projects_data = brandlib.read_state(projects_path, default=None)
    if not isinstance(projects_data, dict) or "projects" not in projects_data:
        projects_data = {
            "schemaVersion": 1,
            "brand": slug,
            "source": "Portal owner submissions (BuildCost agency portal). Photos in reference/images/.",
            "projects": [],
        }
    projects = projects_data.setdefault("projects", [])
    existing_portal_ids = {p.get("portalSubmissionId") for p in projects if p.get("portalSubmissionId")}

    if submission_id in ingested_ids or submission_id in existing_portal_ids:
        result = {"ok": True, "status": "already-ingested", "submissionId": submission_id, "slug": slug}
        print(json.dumps(result) if asj else "portal-intake: submission %s already ingested (no-op)" % submission_id)
        return 0

    # --- derive a unique project id ---
    base_id = _slugify(title) or _slugify(submission_id) or "project"
    existing_ids = {p.get("id") for p in projects}
    project_id = base_id
    counter = 1
    while project_id in existing_ids:
        project_id = "%s-%s" % (base_id, counter)
        counter += 1

    # --- copy images into reference/images/ (mirrors source_intake naming) ---
    os.makedirs(images_dir, exist_ok=True)
    rels = []           # parallel to images_in: relative "images/<file>" path
    process_flags = []  # parallel: bool
    for idx, im in enumerate(images_in):
        src = im["file"]
        if not os.path.isabs(src):
            src = os.path.join(args.images_dir, src)
        if not os.path.isfile(src):
            return _fail("image not found for submission %s: %s" % (submission_id, src), asj)
        name_base = _slugify("%s-%s-%s" % (slug, submission_id, idx)) or ("img-%d" % idx)
        dest_name = name_base + _safe_ext(os.path.basename(im["file"]))
        shutil.copyfile(src, os.path.join(images_dir, dest_name))
        rels.append("images/%s" % dest_name)
        process_flags.append(bool(im.get("process")))

    hero_rel = rels[hero_index]
    # gallery = finished/showcase set, hero first; process shots excluded.
    gallery = [hero_rel] + [r for r, proc in zip(rels, process_flags) if not proc and r != hero_rel]
    # de-dup while preserving order; guarantee >= 1
    seen = set()
    gallery = [r for r in gallery if not (r in seen or seen.add(r))] or [hero_rel]
    process_images = [r for r, proc in zip(rels, process_flags) if proc]

    # --- build the producer-ready record (status: pending → enrich on confirm) ---
    record = {
        "id": project_id,
        "title": title,
        "neighborhood": neighborhood,
        "scope": scope,
        "materials": materials,
        "signatureDetails": signature,
        "story": story,
        "heroImage": hero_rel,
        "heroDetail": hero_detail,
        "galleryImages": gallery,
        "source": "portal-intake",
        "portalSubmissionId": submission_id,
        "submittedAt": submitted_at,
        "status": "pending",
    }
    if process_images:
        record["processImages"] = process_images

    # --- write projects.json under a lock (read-modify-write of a shared file) ---
    with brandlib.state_lock(projects_path):
        fresh = brandlib.read_state(projects_path, default=None)
        if isinstance(fresh, dict) and "projects" in fresh:
            projects_data = fresh
        projects = projects_data.setdefault("projects", [])
        # final dedup inside the lock
        if any(p.get("portalSubmissionId") == submission_id for p in projects):
            print(json.dumps({"ok": True, "status": "already-ingested", "submissionId": submission_id})
                  if asj else "portal-intake: submission %s already ingested (no-op)" % submission_id)
            return 0
        existing_ids = {p.get("id") for p in projects}
        if record["id"] in existing_ids:  # re-resolve in case of concurrent add
            counter = 1
            while ("%s-%s" % (base_id, counter)) in existing_ids:
                counter += 1
            record["id"] = "%s-%s" % (base_id, counter)
        projects.append(record)
        brandlib.write_state(projects_path, projects_data)

    # --- update the dedup ledger ---
    state["ingestedSubmissionIds"] = sorted(ingested_ids | {submission_id})
    state["lastIngestAt"] = _now_iso()
    brandlib.write_state(state_path, state)

    # --- append exactly ONE review-queue item under state_lock (shared writer) ---
    queue_id = "%s-portal-%s" % (slug, _slugify(submission_id) or submission_id)
    with brandlib.state_lock(queue_path):
        q = brandlib.read_state(queue_path, default={"schemaVersion": 1, "items": []})
        q.setdefault("items", [])
        q["items"] = [it for it in q["items"] if it.get("queueId") != queue_id]
        q["items"].append({
            "queueId": queue_id,
            "business": slug,
            "type": "intake",
            "summary": "[intake] portal submission '%s' for %s — confirm title/neighborhood + add scope/materials/details"
                       % (title, slug),
            "action": "Confirm + enrich the new reference project (scope/materials/signatureDetails) so producers can feature it",
            "link": os.path.abspath(projects_path),
            "publishCommand": None,
            "estMinutes": 4,
            "status": "pending",
            "createdAt": _now_iso(),
            "source": "portal-intake",
            "projectId": record["id"],
        })
        brandlib.write_state(queue_path, q)

    result = {
        "ok": True,
        "status": "ingested",
        "slug": slug,
        "submissionId": submission_id,
        "projectId": record["id"],
        "heroImage": record["heroImage"],
        "galleryCount": len(record["galleryImages"]),
        "processCount": len(process_images),
        "queueId": queue_id,
        "projectsPath": os.path.abspath(projects_path),
    }
    if asj:
        print(json.dumps(result))
    else:
        print("portal-intake: ingested submission %s as project '%s' "
              "(%d gallery, %d process); queued '%s' for confirm/enrich"
              % (submission_id, record["id"], result["galleryCount"], result["processCount"], queue_id))
    return 0


if __name__ == "__main__":
    sys.exit(main())

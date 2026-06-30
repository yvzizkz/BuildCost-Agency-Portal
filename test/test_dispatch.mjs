/**
 * test_dispatch.mjs — unit tests for bridge/dispatch.mjs (the command-dispatch
 * security boundary). Pure: no Firebase, no engine execution, no live-queue
 * mutation. Run: node --test test/test_dispatch.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDispatch, buildSubmissionPipeline, cleanEditCopy, cleanIngestLink, isDropboxHost, cleanScheduleDate } from "../bridge/dispatch.mjs";

const TENANT = { repoRoot: "/repo", env: "/repo/.env", slug: "saddlewood" };
const REPO = "/repo";
const APPROVAL = REPO + "/.claude/skills/approval-flow/approval_flow.py";
const STUDIO = REPO + "/.claude/skills/studio/studio.py";
const REEL = REPO + "/.claude/skills/asset-studio/reel.py";
const TRIAGE = REPO + "/.claude/skills/submission-triage/triage.py";

// ---- approve ----------------------------------------------------------------
test("approve builds the exact approval_flow argv", () => {
  const r = buildDispatch(TENANT, "approve", { queueId: "saddlewood-2026-W26-post-1" });
  assert.ok(r.ok);
  assert.deepEqual(r.exec.argv,
    [APPROVAL, "--brand", "saddlewood", "--mode", "approve", "--id", "saddlewood-2026-W26-post-1"]);
  assert.equal(r.exec.file, "python3");
  assert.equal(r.exec.cwd, REPO);
});

test("approve without queueId is rejected", () => {
  const r = buildDispatch(TENANT, "approve", {});
  assert.equal(r.ok, false);
  assert.match(r.error, /queueId/);
});

test("approve with an injection-y queueId is rejected (not passed through)", () => {
  for (const bad of ["../../etc/passwd", "id; rm -rf /", "a b", "$(whoami)"]) {
    const r = buildDispatch(TENANT, "approve", { queueId: bad });
    assert.equal(r.ok, false, `should reject ${bad}`);
  }
});

test("approve.parse extracts the Publish/Send path line", () => {
  const { exec } = buildDispatch(TENANT, "approve", { queueId: "saddlewood-x" });
  assert.equal(exec.parse("APPROVED saddlewood-x.\nPublish path: ghl-saddlewood social create-post").publishPath,
    "ghl-saddlewood social create-post");
  assert.equal(exec.parse("APPROVED y.\nSend path: review_request send").publishPath, "review_request send");
  assert.equal(exec.parse("APPROVED z.\nNote: no publishCommand").publishPath, undefined);
});

// ---- reject -----------------------------------------------------------------
test("reject builds argv with sanitized notes", () => {
  const r = buildDispatch(TENANT, "reject", { queueId: "saddlewood-x", notes: "  tighter   hook\n\tlead w/ wine wall " });
  assert.ok(r.ok);
  assert.deepEqual(r.exec.argv,
    [APPROVAL, "--brand", "saddlewood", "--mode", "reject", "--id", "saddlewood-x", "--notes", "tighter hook lead w/ wine wall"]);
});

test("reject without notes is rejected", () => {
  const r = buildDispatch(TENANT, "reject", { queueId: "saddlewood-x", notes: "   " });
  assert.equal(r.ok, false);
  assert.match(r.error, /notes/);
});

test("reject notes are length-capped", () => {
  const r = buildDispatch(TENANT, "reject", { queueId: "saddlewood-x", notes: "a".repeat(900) });
  assert.ok(r.ok);
  assert.equal(r.exec.argv.at(-1).length, 500);
});

// ---- deleteItem (hard reject/discard) ---------------------------------------
test("deleteItem builds argv with --mode delete", () => {
  const r = buildDispatch(TENANT, "deleteItem", { queueId: "saddlewood-2026-W27-reel-x" });
  assert.ok(r.ok);
  assert.deepEqual(r.exec.argv,
    [APPROVAL, "--brand", "saddlewood", "--mode", "delete", "--id", "saddlewood-2026-W27-reel-x", "--json"]);
});

test("deleteItem without queueId is rejected", () => {
  const r = buildDispatch(TENANT, "deleteItem", {});
  assert.equal(r.ok, false);
  assert.match(r.error, /queueId/);
});

test("deleteItem with an injection-y queueId is rejected (no raw string reaches a flag)", () => {
  for (const bad of ["a b", "--notes", "x;rm -rf /", "../../etc"]) {
    const r = buildDispatch(TENANT, "deleteItem", { queueId: bad });
    assert.equal(r.ok, false, `should reject ${bad}`);
  }
});

// ---- editCaption ------------------------------------------------------------
test("editCaption builds argv with --mode edit-caption + --copy-file path", () => {
  const r = buildDispatch(TENANT, "editCaption",
    { queueId: "saddlewood-2026-W26-post-1", copyFile: "/tmp/portal-editcopy-abc.json" });
  assert.ok(r.ok);
  assert.deepEqual(r.exec.argv,
    [APPROVAL, "--brand", "saddlewood", "--mode", "edit-caption", "--id", "saddlewood-2026-W26-post-1",
     "--copy-file", "/tmp/portal-editcopy-abc.json"]);
});

test("editCaption with an injection-y queueId is rejected", () => {
  for (const bad of ["../../etc/passwd", "a b", "$(whoami)", ""]) {
    const r = buildDispatch(TENANT, "editCaption", { queueId: bad, copyFile: "/tmp/x.json" });
    assert.equal(r.ok, false, `should reject ${bad}`);
  }
});

test("editCaption without a copyFile path is rejected (internal contract)", () => {
  const r = buildDispatch(TENANT, "editCaption", { queueId: "saddlewood-x" });
  assert.equal(r.ok, false);
  assert.match(r.error, /copyFile/i);
});

// ---- editSchedule -----------------------------------------------------------
test("editSchedule builds argv with --mode set-schedule + the ISO date", () => {
  const r = buildDispatch(TENANT, "editSchedule",
    { queueId: "saddlewood-2026-W26-post-1", scheduleDate: "2026-06-30T17:00:00.000Z" });
  assert.ok(r.ok);
  assert.deepEqual(r.exec.argv,
    [APPROVAL, "--brand", "saddlewood", "--mode", "set-schedule", "--id", "saddlewood-2026-W26-post-1",
     "--schedule-date", "2026-06-30T17:00:00.000Z"]);
});

test("editSchedule zeroes seconds/ms to the canonical minute", () => {
  const r = buildDispatch(TENANT, "editSchedule",
    { queueId: "saddlewood-2026-W26-post-1", scheduleDate: "2026-06-30T17:05:45.123Z" });
  assert.ok(r.ok);
  assert.equal(r.exec.argv.at(-1), "2026-06-30T17:05:00.000Z");
});

test("editSchedule with an invalid queueId is rejected", () => {
  const r = buildDispatch(TENANT, "editSchedule", { queueId: "../../x", scheduleDate: "2026-06-30T17:00:00.000Z" });
  assert.equal(r.ok, false);
  assert.match(r.error, /queueId/);
});

test("editSchedule with a non-ISO date is rejected (no raw string reaches a flag)", () => {
  for (const bad of ["notadate", "2026-06-30", "2026-06-30 17:00", "06/30/2026", ""]) {
    const r = buildDispatch(TENANT, "editSchedule", { queueId: "saddlewood-2026-W26-post-1", scheduleDate: bad });
    assert.equal(r.ok, false, `expected reject for ${JSON.stringify(bad)}`);
    assert.match(r.error, /scheduleDate/);
  }
});

test("cleanScheduleDate normalizes valid ISO and rejects junk", () => {
  assert.equal(cleanScheduleDate("2026-06-30T17:00:00.000Z"), "2026-06-30T17:00:00.000Z");
  assert.equal(cleanScheduleDate("2026-06-30T17:05:30Z"), "2026-06-30T17:05:00.000Z");
  assert.equal(cleanScheduleDate("notadate"), null);
  assert.equal(cleanScheduleDate(""), null);
});

test("cleanEditCopy normalizes body (keeps blank lines), hashtags->array, cta", () => {
  const c = cleanEditCopy({ body: "Line one\n\n\n\nLine two   with   spaces", hashtags: "#a   #b\t#c", cta: "  Book now  " });
  assert.equal(c.body, "Line one\n\nLine two with spaces");
  assert.deepEqual(c.hashtags, ["#a", "#b", "#c"]);
  assert.equal(c.cta, "Book now");
});

test("cleanEditCopy returns null when nothing meaningful is supplied", () => {
  assert.equal(cleanEditCopy({ body: "   ", hashtags: "  ", cta: "" }), null);
  assert.equal(cleanEditCopy({}), null);
  assert.equal(cleanEditCopy(null), null);
});

test("cleanEditCopy strips control chars and caps body length", () => {
  const c = cleanEditCopy({ body: "a".repeat(4000) + "\x00\x07bad", hashtags: "#x", cta: "" });
  assert.ok(c.body.length <= 3000);
  assert.ok(!c.body.includes("\x00"));
});

// ---- ingestLink (Dropbox -> Drive) -----------------------------------------
test("isDropboxHost accepts dropbox.com + its download CDN, rejects look-alikes", () => {
  for (const ok of ["www.dropbox.com", "dropbox.com", "dl.dropboxusercontent.com",
    "uc123.dl.dropboxusercontent.com", "DROPBOX.COM"]) {
    assert.equal(isDropboxHost(ok), true, `should accept ${ok}`);
  }
  for (const bad of ["dropbox.com.evil.com", "notdropbox.com", "evil.com", "dropboxusercontent.com.attacker.net",
    "169.254.169.254", "localhost", ""]) {
    assert.equal(isDropboxHost(bad), false, `should reject ${bad}`);
  }
});

test("cleanIngestLink normalizes a share link to dl=1 and a safe name", () => {
  const r = cleanIngestLink({ source: "dropbox", url: "https://www.dropbox.com/s/abc123/My%20Project%20Video.mp4?dl=0" });
  assert.ok(r.ok);
  assert.equal(r.value.source, "dropbox");
  assert.match(r.value.url, /dl=1/);
  assert.ok(!/dl=0/.test(r.value.url));
  assert.equal(r.value.name, "My_Project_Video.mp4");
});

test("cleanIngestLink passes through the CDN host (already direct) and derives a name", () => {
  const r = cleanIngestLink({ source: "dropbox", url: "https://uc1.dl.dropboxusercontent.com/cd/0/get/file.zip" });
  assert.ok(r.ok);
  assert.equal(r.value.name, "file.zip");
});

test("cleanIngestLink rejects non-dropbox hosts, http, and bad sources (SSRF guard)", () => {
  assert.equal(cleanIngestLink({ source: "dropbox", url: "https://evil.com/x" }).ok, false);
  assert.equal(cleanIngestLink({ source: "dropbox", url: "http://www.dropbox.com/s/x?dl=1" }).ok, false); // not https
  assert.equal(cleanIngestLink({ source: "dropbox", url: "https://dropbox.com.attacker.net/x" }).ok, false);
  assert.equal(cleanIngestLink({ source: "dropbox", url: "not a url" }).ok, false);
  assert.equal(cleanIngestLink({ source: "gdrive", url: "https://www.dropbox.com/s/x" }).ok, false); // wrong source
  assert.equal(cleanIngestLink({ source: "dropbox", url: "file:///etc/passwd" }).ok, false);
});

test("cleanIngestLink falls back to a default name when the path has no filename", () => {
  const r = cleanIngestLink({ source: "dropbox", url: "https://www.dropbox.com/" });
  assert.ok(r.ok);
  assert.equal(r.value.name, "dropbox-file");
});

// ---- requestGeneration: social ---------------------------------------------
test("social generation defaults to --max 1", () => {
  const r = buildDispatch(TENANT, "requestGeneration", { producer: "social" });
  assert.deepEqual(r.exec.argv, [STUDIO, "--brand", "saddlewood", "--mode", "draft", "--max", "1"]);
});

test("social max is clamped to [1,3]", () => {
  assert.equal(buildDispatch(TENANT, "requestGeneration", { producer: "social", max: 9 }).exec.argv.at(-1), "3");
  assert.equal(buildDispatch(TENANT, "requestGeneration", { producer: "social", max: 0 }).exec.argv.at(-1), "1");
  assert.equal(buildDispatch(TENANT, "requestGeneration", { producer: "social", max: "garbage" }).exec.argv.at(-1), "1");
});

test("social with project + media targets one draft with a per-format slot", () => {
  const r = buildDispatch(TENANT, "requestGeneration",
    { producer: "social", project: "paradise-valley-whole-home", media: "collage:before-after" });
  assert.ok(r.ok);
  assert.deepEqual(r.exec.argv,
    [STUDIO, "--brand", "saddlewood", "--mode", "draft",
     "--project", "paradise-valley-whole-home", "--media", "collage:before-after", "--slot", "before-after"]);
});

test("social with media but no project still targets one draft (no --max)", () => {
  const r = buildDispatch(TENANT, "requestGeneration", { producer: "social", media: "carousel" });
  assert.ok(r.ok);
  assert.deepEqual(r.exec.argv,
    [STUDIO, "--brand", "saddlewood", "--mode", "draft", "--media", "carousel", "--slot", "carousel"]);
});

test("social rejects a media value outside the studio vocabulary (injection guard)", () => {
  for (const bad of ["links", "single; rm -rf /", "--mode=links", "collage:evil", "send", "activate", "card"]) {
    const r = buildDispatch(TENANT, "requestGeneration", { producer: "social", media: bad });
    assert.equal(r.ok, false, `should reject media ${bad}`);
  }
});

test("social rejects a non-slug project (no injection)", () => {
  for (const bad of ["--premium", "a; ls", "../x", "Foo Bar"]) {
    const r = buildDispatch(TENANT, "requestGeneration", { producer: "social", project: bad });
    assert.equal(r.ok, false, `should reject project ${bad}`);
  }
});

// ---- requestGeneration: reel ------------------------------------------------
test("reel minimal is draft-only", () => {
  const r = buildDispatch(TENANT, "requestGeneration", { producer: "reel" });
  assert.deepEqual(r.exec.argv, [REEL, "--brand", "saddlewood", "--mode", "draft"]);
});

test("reel with valid project + slot + premium", () => {
  const r = buildDispatch(TENANT, "requestGeneration",
    { producer: "reel", project: "mccormick-ranch-kitchen-bath", slot: "reel", premium: true });
  assert.deepEqual(r.exec.argv,
    [REEL, "--brand", "saddlewood", "--mode", "draft", "--project", "mccormick-ranch-kitchen-bath", "--slot", "reel", "--premium"]);
});

test("reel with a non-slug project is rejected (no injection)", () => {
  for (const bad of ["--premium", "a; ls", "../x", "Foo Bar"]) {
    const r = buildDispatch(TENANT, "requestGeneration", { producer: "reel", project: bad });
    assert.equal(r.ok, false, `should reject ${bad}`);
  }
});

test("premium only flips on strict true (not truthy strings)", () => {
  const r = buildDispatch(TENANT, "requestGeneration", { producer: "reel", premium: "yes" });
  assert.ok(r.ok);
  assert.ok(!r.exec.argv.includes("--premium"));
});

// ---- allow-list / scoping ---------------------------------------------------
test("unknown producer is rejected", () => {
  assert.equal(buildDispatch(TENANT, "requestGeneration", { producer: "meta-ads" }).ok, false);
});

test("unknown command type is rejected", () => {
  assert.equal(buildDispatch(TENANT, "launch", {}).ok, false);
});

test("submitContent via command is refused (use the submissions path)", () => {
  const r = buildDispatch(TENANT, "submitContent", {});
  assert.equal(r.ok, false);
  assert.match(r.error, /submissions path/);
});

test("an unresolved/invalid tenant is rejected", () => {
  assert.equal(buildDispatch(null, "approve", { queueId: "x" }).ok, false);
  assert.equal(buildDispatch({ slug: "Not A Slug" }, "approve", { queueId: "x" }).ok, false);
});

// ---- the hard guarantee: no spend path is reachable -------------------------
test("NO valid dispatch can emit a send/publish/spend path", () => {
  const valid = [
    ["approve", { queueId: "saddlewood-x" }],
    ["reject", { queueId: "saddlewood-x", notes: "n" }],
    ["requestGeneration", { producer: "social", max: 3 }],
    ["requestGeneration", { producer: "social", project: "great-room-remodel", media: "collage:process-journey" }],
    ["requestGeneration", { producer: "reel", project: "great-room-remodel", premium: true }],
    ["editCaption", { queueId: "saddlewood-x", copyFile: "/tmp/copy.json" }],
  ];
  const forbidden = ["activate", "--confirm", "--i-understand-this-spends", "meta_ads.py", "meta-ads", "--yes", "links", "send"];
  for (const [type, payload] of valid) {
    const r = buildDispatch(TENANT, type, payload);
    assert.ok(r.ok);
    const joined = r.exec.argv.join(" ");
    for (const f of forbidden) assert.ok(!joined.includes(f), `${type} argv must not contain "${f}": ${joined}`);
    // every template is draft-only or a read/approve/edit op — never a producer publish mode
    if (joined.includes("--mode")) {
      assert.ok(
        joined.includes("--mode draft") || joined.includes("--mode approve") ||
        joined.includes("--mode reject") || joined.includes("--mode edit-caption")
      );
    }
  }
});

// ---- buildSubmissionPipeline (post-intake triage -> strategy) ----------------
test("submission pipeline targets triage --from-project + strategy, draft-only", () => {
  const r = buildSubmissionPipeline(TENANT, "sub-123", "steel-frame-job", {});
  assert.ok(r.ok);
  assert.equal(r.triage.argv[0], TRIAGE);
  assert.ok(r.triage.argv.includes("--from-project") && r.triage.argv.includes("steel-frame-job"));
  assert.ok(r.triage.argv.includes("--mode") && r.triage.argv.includes("triage"));
  // no spend/publish path: triage runs without --enhance, strategy without --enrich
  const joined = r.triage.argv.concat(r.strategy.argv).join(" ");
  for (const f of ["--enhance", "--enrich", "--confirm", "activate", "publish", "send", "--yes"]) {
    assert.ok(!joined.includes(f), `pipeline argv must not contain "${f}": ${joined}`);
  }
});

test("submission pipeline forwards mediaRights as --own-footage / --people flags", () => {
  const r = buildSubmissionPipeline(TENANT, "sub-9", "job-x", {
    mediaRights: { ownFootage: true, peopleInIt: true },
  });
  assert.ok(r.ok);
  assert.ok(r.triage.argv.includes("--own-footage"), "ownFootage true -> --own-footage");
  assert.ok(r.triage.argv.includes("--people"), "peopleInIt true -> --people");
});

test("submission pipeline omits rights flags when false / absent", () => {
  const off = buildSubmissionPipeline(TENANT, "sub-9", "job-x", { mediaRights: { ownFootage: false, peopleInIt: false } });
  assert.ok(off.ok);
  assert.ok(!off.triage.argv.includes("--own-footage") && !off.triage.argv.includes("--people"));
  const none = buildSubmissionPipeline(TENANT, "sub-9", "job-x", {});
  assert.ok(!none.triage.argv.includes("--own-footage") && !none.triage.argv.includes("--people"));
});

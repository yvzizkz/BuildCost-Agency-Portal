/**
 * test_dispatch.mjs — unit tests for bridge/dispatch.mjs (the command-dispatch
 * security boundary). Pure: no Firebase, no engine execution, no live-queue
 * mutation. Run: node --test test/test_dispatch.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDispatch } from "../bridge/dispatch.mjs";

const TENANT = { repoRoot: "/repo", env: "/repo/.env", slug: "saddlewood" };
const REPO = "/repo";
const APPROVAL = REPO + "/.claude/skills/approval-flow/approval_flow.py";
const STUDIO = REPO + "/.claude/skills/studio/studio.py";
const REEL = REPO + "/.claude/skills/asset-studio/reel.py";

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
  ];
  const forbidden = ["activate", "--confirm", "--i-understand-this-spends", "meta_ads.py", "meta-ads", "--yes", "links", "send"];
  for (const [type, payload] of valid) {
    const r = buildDispatch(TENANT, type, payload);
    assert.ok(r.ok);
    const joined = r.exec.argv.join(" ");
    for (const f of forbidden) assert.ok(!joined.includes(f), `${type} argv must not contain "${f}": ${joined}`);
    // every template is draft-only or a read/approve op — never a producer publish mode
    if (joined.includes("--mode")) assert.ok(joined.includes("--mode draft") || joined.includes("--mode approve") || joined.includes("--mode reject"));
  }
});

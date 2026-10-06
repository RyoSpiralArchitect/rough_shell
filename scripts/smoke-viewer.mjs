import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { RoughShellRuntime, SchemaRegistry } from "../packages/core/dist/index.js";
import { buildDemo, DesertMermaidDemoProvider } from "../apps/viewer/dist/demo.js";
import { loadSession } from "../apps/viewer/dist/load-session.js";
import { renderViewer, selectSession, serializeData } from "../apps/viewer/dist/render.js";

const exec = promisify(execFile);
const schema = new SchemaRegistry();
const session = await buildDemo();
assert.equal(session.turns.length, 5);
assert.match(session.description, /fixture/);
assert.match(session.source, /Gemini/);
assert.deepEqual(await buildDemo(), session, "The offline fixture must be deterministic");
for (const [index, turn] of session.turns.entries()) {
  schema.validateShellState(turn.stateBefore);
  schema.validateShellState(turn.stateAfter);
  assert.equal(turn.audit, "pass", `Fixture turn ${index + 1} failed its actual runtime audit`);
  assert.equal(turn.stateAfter.turn, turn.stateBefore.turn + 1);
  if (index) assert.deepEqual(turn.stateBefore, session.turns[index - 1].stateAfter);
}
const first = session.turns[0].stateAfter;
assert.ok(first.interpretation_openings.filter((entry) => entry.status === "open").length >= 2);
const corrected = session.turns[2].stateAfter;
const carried = session.turns[3].stateAfter;
const returned = session.turns[4];
const last = returned.stateAfter;
assert.ok(corrected.rejected_variants.some((entry) => entry.rejected_by === "user"));
for (const state of [carried, returned.stateBefore, last]) {
  assert.deepEqual(state.rejected_variants, corrected.rejected_variants, "The rejection must survive both the next story and the symbolic return");
  assert.deepEqual(state.anchors, corrected.anchors, "The user's no-assumed-thirst constraint must stay active and unchanged");
}
assert.equal(last.rejected_variants[0].id, "R1");
assert.equal(last.rejected_variants[0].turn, 3, "Switching readings must not rewrite when the premise was rejected");
assert.equal(last.anchors.find((entry) => entry.id === "A1").status, "active");
for (const turn of session.turns.slice(1, 4)) {
  assert.equal(turn.stateAfter.interpretation_openings.find((entry) => entry.id === "I2").status, "collapsed", "Do not reactivate the symbolic reading before the explicit request");
  assert.equal(turn.stateAfter.sections.find((entry) => entry.id === "S2").status, "latent");
}
assert.equal(carried.interpretation_openings.find((entry) => entry.id === "I1").status, "selected");
assert.equal(carried.sections.find((entry) => entry.id === "S1").status, "active");
assert.deepEqual(last.interpretation_openings.map((entry) => entry.id), first.interpretation_openings.map((entry) => entry.id), "Reactivate the original opening instead of adding a duplicate");
assert.deepEqual(last.sections.map((entry) => entry.id), first.sections.map((entry) => entry.id));
assert.deepEqual(last.interpretation_openings.filter((entry) => entry.status === "selected").map((entry) => entry.id), ["I2"]);
assert.equal(last.interpretation_openings.find((entry) => entry.id === "I1").status, "collapsed");
const symbolic = last.sections.find((entry) => entry.id === "S2");
assert.equal(symbolic.status, "active");
assert.equal(symbolic.domain_mode, "symbolic");
assert.deepEqual(symbolic.projection_signature.anchor_touch, ["A1"]);
assert.deepEqual(symbolic.projection_signature.clarification_needs, []);
assert.deepEqual(symbolic.revive_when, []);
const fiction = last.sections.find((entry) => entry.id === "S1");
assert.equal(fiction.status, "latent", "The earlier fictional reading remains available, not rejected or erased");
assert.equal(fiction.domain_mode, "fictional");
assert.ok(fiction.revive_when.length > 0);
assert.deepEqual(fiction.variants, carried.sections.find((entry) => entry.id === "S1").variants);
assert.ok(last.voids.every((entry) => entry.status !== "open"));
assert.deepEqual(last.traces.filter((entry) => entry.turn === 5 && entry.action === "revive").flatMap((entry) => entry.targets), ["S2", "I2"], "Revival targets the symbolic reading, never the rejected premise");
assert.match(returned.user, /象徴としての読み方に戻ろう/);
assert.match(returned.answer, /^象徴として読むなら/);
assert.match(returned.answer, /渇望を背負わせず/);

// Inspect actual runtime artifacts as well as viewer state: selecting I2 must
// reach the negotiator and compiler, rather than just relabeling the UI.
const runtime = new RoughShellRuntime();
const provider = new DesertMermaidDemoProvider();
let replayState = structuredClone(session.turns[0].stateBefore);
let lastTurn;
let replay;
for (const turn of session.turns) {
  const previous = structuredClone(replayState);
  replay = await runtime.runTurn({ provider, prevState: replayState, userTurn: turn.user,
    ...(lastTurn ? { lastTurn, lastAudit: lastTurn.audit } : {}) });
  assert.deepEqual(replayState, previous, "Replaying must not mutate an earlier state snapshot");
  assert.deepEqual(replay.state, turn.stateAfter);
  assert.equal(replay.finalAnswer, turn.answer);
  assert.deepEqual(replay.artifacts.pass_logs.map((entry) => entry.pass), ["state_updater", "negotiator", "project_compiler", "auditor"]);
  replayState = replay.state;
  lastTurn = { user_turn: turn.user, answer: replay.finalAnswer,
    negotiation: replay.negotiation, projection: replay.projection, audit: replay.audit };
}
assert.equal(replay.negotiation.projection_style_recommendation, "single");
assert.match(replay.negotiation.global_reason, /symbolic interpretation/);
assert.deepEqual(replay.projection.projection_ir.frame_commitments, ["I2"]);
assert.equal(replay.projection.projection_ir.claim_frames.length, 1);
assert.equal(replay.projection.projection_ir.claim_frames[0].section, "S2");
assert.equal(replay.projection.projection_ir.claim_frames[0].kind, "speculative");
assert.deepEqual(replay.projection.projection_ir.claim_frames[0].licensed_if, ["I2"]);
assert.deepEqual(replay.audit.findings, []);

const payload = selectSession(session);
assert.ok(!("traces" in payload.turns[0].stateAfter));
assert.ok(!("contract" in payload.turns[0].stateAfter));
assert.ok(!("pass_logs" in payload.turns[0]));
assert.equal(payload.turns[4].stateAfter.sections.find((entry) => entry.id === "S2").status, "active");
assert.deepEqual(payload.turns[4].stateAfter.rejected_variants, payload.turns[2].stateAfter.rejected_variants);
const hostile = structuredClone(session);
hostile.title = "</script><img src=x onerror=alert(1)>";
hostile.turns[0].answer = "</script><script>alert('injected')</script> & $& ";
hostile.turns[0].stateAfter.traces.push({ id: "hidden", action: "project", turn: 1, targets: [], cause: "RAW_TRACE_SENTINEL" });
hostile.turns[0].pass_logs = [{ rawResponse: "RAW_PROVIDER_SENTINEL" }];
const html = await renderViewer(hostile);
assert.ok(!html.includes("<img src=x"));
assert.ok(!html.includes("<script>alert('injected')"));
assert.ok(!html.includes("RAW_TRACE_SENTINEL"));
assert.ok(!html.includes("RAW_PROVIDER_SENTINEL"));
assert.match(html, /connect-src 'none'/);
assert.ok(!html.includes("/* VIEWER_"));
const embedded = html.match(/<script type="application\/json" id="session-data">([\s\S]*?)<\/script>/)[1];
assert.equal(JSON.parse(embedded).title, hostile.title);
assert.equal(JSON.parse(embedded).turns[0].answer, hostile.turns[0].answer);
assert.equal(JSON.parse(serializeData({ text: "<\u2028\u2029" })).text, "<\u2028\u2029");
assert.throws(() => selectSession({ ...session, turns: [] }), /No completed turns/);

const dir = await mkdtemp(join(tmpdir(), "rough-shell-viewer-"));
try {
  // Deliberately write directory entries out of order and include an incomplete turn.
  for (const index of [4, 3, 1, 0, 2]) {
    const turn = session.turns[index];
    const turnDirectory = join(dir, `turn-${String(turn.stateAfter.turn).padStart(4, "0")}`);
    await mkdir(turnDirectory);
    await writeFile(join(turnDirectory, "turn.json"), JSON.stringify({
      turn: turn.stateAfter.turn, user_turn: turn.user, final_answer: turn.answer,
      state_before: turn.stateBefore, final_state: turn.stateAfter, audit: { verdict: turn.audit },
      pass_logs: [{ rawResponse: "SHOULD_NOT_EXPORT" }],
    }));
  }
  await mkdir(join(dir, "turn-9999"));
  const imported = await loadSession(dir);
  assert.equal(imported.turns.length, 5);
  assert.deepEqual(imported.turns.map((t) => t.stateAfter.turn), [1, 2, 3, 4, 5]);
  assert.deepEqual(imported.turns[4].stateAfter, last);
  const output = join(dir, "session.html");
  const result = await exec(process.execPath, ["apps/viewer/dist/index.js", "--session", dir, "--out", output]);
  assert.match(result.stdout, /Wrote 5 turns/);
  assert.ok(!(await readFile(output, "utf8")).includes("SHOULD_NOT_EXPORT"));
  await exec(process.execPath, ["apps/viewer/dist/index.js", "--demo", "--out", join(dir, "demo.html")]);
  await assert.rejects(exec(process.execPath, ["apps/viewer/dist/index.js", "--demo", "--session", dir]), /Choose --demo or --session/);
  await assert.rejects(exec(process.execPath, ["apps/viewer/dist/index.js", "--out"]), /Missing value/);
  await assert.rejects(exec(process.execPath, ["apps/viewer/dist/index.js", "--wrong"]), /Unknown argument/);
  await writeFile(join(dir, "turn-9999", "turn.json"), '{"state_before":{}}');
  await assert.rejects(loadSession(dir), /Invalid completed turn/);
} finally { await rm(dir, { recursive: true, force: true }); }
console.log("Viewer smoke passed: five real runtime turns, symbolic reactivation, correction persistence, artifact import, safe HTML export, CLI errors.");

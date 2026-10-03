import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { SchemaRegistry } from "../packages/core/dist/index.js";
import { buildDemo } from "../apps/viewer/dist/demo.js";
import { loadSession } from "../apps/viewer/dist/load-session.js";
import { renderViewer, selectSession, serializeData } from "../apps/viewer/dist/render.js";

const exec = promisify(execFile);
const schema = new SchemaRegistry();
const session = await buildDemo();
assert.equal(session.turns.length, 4);
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
const last = session.turns[3].stateAfter;
assert.ok(corrected.rejected_variants.some((entry) => entry.rejected_by === "user"));
assert.deepEqual(last.rejected_variants, corrected.rejected_variants, "The correction must survive the following turn");
assert.ok(last.sections.some((entry) => entry.domain_mode === "fictional"));
assert.ok(last.voids.every((entry) => entry.status !== "open"));

const payload = selectSession(session);
assert.ok(!("traces" in payload.turns[0].stateAfter));
assert.ok(!("contract" in payload.turns[0].stateAfter));
assert.ok(!("pass_logs" in payload.turns[0]));
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
  for (const index of [3, 1, 0, 2]) {
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
  assert.equal(imported.turns.length, 4);
  assert.deepEqual(imported.turns.map((t) => t.stateAfter.turn), [1, 2, 3, 4]);
  const output = join(dir, "session.html");
  const result = await exec(process.execPath, ["apps/viewer/dist/index.js", "--session", dir, "--out", output]);
  assert.match(result.stdout, /Wrote 4 turns/);
  assert.ok(!(await readFile(output, "utf8")).includes("SHOULD_NOT_EXPORT"));
  await exec(process.execPath, ["apps/viewer/dist/index.js", "--demo", "--out", join(dir, "demo.html")]);
  await assert.rejects(exec(process.execPath, ["apps/viewer/dist/index.js", "--demo", "--session", dir]), /Choose --demo or --session/);
  await assert.rejects(exec(process.execPath, ["apps/viewer/dist/index.js", "--out"]), /Missing value/);
  await assert.rejects(exec(process.execPath, ["apps/viewer/dist/index.js", "--wrong"]), /Unknown argument/);
  await writeFile(join(dir, "turn-9999", "turn.json"), '{"state_before":{}}');
  await assert.rejects(loadSession(dir), /Invalid completed turn/);
} finally { await rm(dir, { recursive: true, force: true }); }
console.log("Viewer smoke passed: four real runtime turns, correction persistence, artifact import, safe HTML export, CLI errors.");

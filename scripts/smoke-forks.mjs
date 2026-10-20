import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { FileArtifactStore, loadTurnCheckpoint } from "../packages/core/dist/index.js";
import { buildForkDemo } from "../apps/viewer/dist/fork-demo.js";
import { renderComparison } from "../apps/viewer/dist/render.js";
import { loadSession } from "../apps/viewer/dist/load-session.js";

const exec = promisify(execFile);
const cli = (...args) => exec(process.execPath, ["apps/cli/dist/index.js", ...args], { timeout: 30_000 });
const viewer = (...args) => exec(process.execPath, ["apps/viewer/dist/index.js", ...args], { timeout: 30_000 });
const hash = (contents) => createHash("sha256").update(contents).digest("hex");
async function files(directory) {
  const result = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const [name, digest] of Object.entries(await files(path))) result[`${entry.name}/${name}`] = digest;
    } else result[entry.name] = hash(await readFile(path));
  }
  return result;
}
function payload(html) {
  return JSON.parse(html.match(/<script type="application\/json" id="session-data">([\s\S]*?)<\/script>/)[1]);
}
function priorDialogue(artifact) {
  return JSON.parse(artifact.pass_logs[0].userPrompt.split("LAST_TURN_CONTEXT_JSON:\n").at(-1));
}

const dir = await mkdtemp(join(tmpdir(), "rough-shell-forks-"));
try {
  const demo = await buildForkDemo(dir);
  const originalFiles = await files(demo.originalDirectory);
  const checkpoint = await loadTurnCheckpoint(demo.originalDirectory, 3);
  const saved = JSON.parse(await readFile(join(demo.originalDirectory, "turn-0003/turn.json"), "utf8"));
  assert.equal(checkpoint.source.artifact_sha256, originalFiles["turn-0003/turn.json"]);
  assert.deepEqual(checkpoint.state, demo.left.turns[2].stateAfter);
  assert.deepEqual(checkpoint.last_turn, {
    user_turn: saved.user_turn, answer: saved.final_answer,
    negotiation: saved.negotiation, projection: saved.projection, audit: saved.audit,
  });
  assert.equal(checkpoint.state.turn, 3, "The latest turn must not leak into an earlier fork");
  assert.deepEqual(demo.right.turns[0].stateBefore, demo.left.turns[3].stateBefore);
  assert.deepEqual(demo.right.turns[0].stateAfter.rejected_variants, checkpoint.state.rejected_variants);
  assert.deepEqual(demo.right.turns[0].stateAfter.anchors, checkpoint.state.anchors);
  assert.deepEqual(demo.right.turns[0].stateAfter.interpretation_openings.filter((item) => item.status === "selected").map((item) => item.id), ["I2"]);
  assert.deepEqual(demo.left.turns[3].stateAfter.interpretation_openings.filter((item) => item.status === "selected").map((item) => item.id), ["I1"]);
  const forkArtifact = JSON.parse(await readFile(join(demo.forkDirectory, "turn-0004/turn.json"), "utf8"));
  assert.equal(forkArtifact.provider.model, "offline-fixture-v2-symbolic-at-4");
  assert.deepEqual(forkArtifact.pass_logs.map((pass) => pass.pass), ["state_updater", "negotiator", "project_compiler", "auditor"]);
  assert.deepEqual(priorDialogue(forkArtifact), checkpoint.last_turn);
  assert.deepEqual(forkArtifact.projection.projection_ir.frame_commitments, ["I2"]);
  assert.equal(forkArtifact.projection.projection_ir.claim_frames[0].section, "S2");

  // Real CLI forks from the same checkpoint may run concurrently without
  // sharing a session directory, prior context, or a mutable state object.
  const artifacts = join(dir, "children");
  const inputs = ["分岐 A の続きを試す。", "分岐 B の別の続きを試す。"];
  const runs = await Promise.all(inputs.map((input) => cli("--provider", "mock", "--fork", demo.originalDirectory,
    "--at-turn", "3", "--artifacts", artifacts, "--once", input)));
  const children = runs.map(({ stdout, stderr }) => {
    assert.equal(stderr, "");
    assert.match(stdout, /forked from:/);
    return /^artifacts: (.+)$/m.exec(stdout)[1];
  });
  assert.notEqual(children[0], children[1]);
  for (const [index, child] of children.entries()) {
    const turn = JSON.parse(await readFile(join(child, "turn-0004/turn.json"), "utf8"));
    assert.deepEqual(turn.state_before, checkpoint.state);
    assert.deepEqual(priorDialogue(turn), checkpoint.last_turn);
    assert.equal(turn.user_turn, inputs[index]);
    assert.deepEqual(JSON.parse(await readFile(join(child, "fork.json"), "utf8")), checkpoint);
    const metadata = JSON.parse(await readFile(join(child, "session.json"), "utf8"));
    assert.deepEqual(metadata.forked_from, checkpoint.source);
    const events = (await readFile(join(child, "session-journal.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(events.find((event) => event.event === "session_started").forked_from, checkpoint.source);
    assert.equal(events.find((event) => event.event === "state_loaded").turn, 3);
    assert.equal(events.find((event) => event.event === "turn_succeeded").turn, 4);
  }
  await cli("--provider", "mock", "--fork", children[0], "--at-turn", "4", "--artifacts", artifacts, "--once", "分岐からさらに続ける。");
  assert.deepEqual(await files(demo.originalDirectory), originalFiles, "Forks must leave every source file byte-for-byte unchanged");
  const sessions = new Set(Array.from({ length: 500 }, () => new FileArtifactStore(dir).sessionDir));
  assert.equal(sessions.size, 500, "Rapidly created sessions must not collide within a millisecond");

  // Reject missing, malformed, and mismatched context before creating a child.
  for (const turn of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(loadTurnCheckpoint(demo.originalDirectory, turn), /positive safe integer/);
  }
  await assert.rejects(loadTurnCheckpoint(demo.originalDirectory, 99), /ENOENT/);
  const bad = join(dir, "bad");
  await mkdir(join(bad, "turn-0003"), { recursive: true });
  for (const mutate of [
    (value) => { delete value.negotiation; },
    (value) => { value.projection.turn = 2; },
    (value) => { value.audit.turn = 5; },
    (value) => { value.final_state.turn = 4; },
    (value) => { value.final_answer = "not the recorded projection"; },
    (value) => { value.state_before = {}; },
  ]) {
    const value = structuredClone(saved);
    mutate(value);
    await writeFile(join(bad, "turn-0003/turn.json"), JSON.stringify(value));
    await assert.rejects(loadTurnCheckpoint(bad, 3));
  }
  const invalidArtifacts = join(dir, "must-not-exist");
  await assert.rejects(cli("--fork", bad, "--at-turn", "3", "--artifacts", invalidArtifacts, "--once", "test"));
  await assert.rejects(readdir(invalidArtifacts), /ENOENT/);
  for (const args of [["--fork", bad], ["--at-turn", "3"], ["--at-turn", "1.5"], ["--at-turn", "0"], ["--fork"],
    ["--fork", bad, "--at-turn", "3", "--state", "state/v0.5/sample_shell_state.json"]]) {
    await assert.rejects(cli(...args));
  }

  const html = await renderComparison(demo.left, demo.right);
  const exported = payload(html);
  assert.deepEqual(exported.sharedStartTurns, [4]);
  assert.ok(!("anchors" in exported.right.turns[0].stateAfter));
  assert.match(html, /connect-src 'none'/);
  const hiddenDifference = structuredClone(demo.right);
  hiddenDifference.turns[0].stateBefore.contract.budgets.answer_tokens += 1;
  assert.deepEqual(payload(await renderComparison(demo.left, hiddenDifference)).sharedStartTurns, [], "Shared start must compare the full state, not only visible fields");
  const hostile = structuredClone(demo.right);
  hostile.source = "</script><script>alert('injected')</script>";
  hostile.turns[0].stateAfter.traces.push({ id: "hidden", action: "project", targets: [], turn: 4, cause: "PRIVATE_TRACE_SENTINEL" });
  hostile.turns[0].pass_logs = "RAW_PROVIDER_SENTINEL";
  const escaped = await renderComparison(demo.left, hostile);
  assert.ok(!escaped.includes("<script>alert('injected')"));
  assert.ok(!escaped.includes("PRIVATE_TRACE_SENTINEL"));
  assert.ok(!escaped.includes("RAW_PROVIDER_SENTINEL"));
  assert.equal(payload(escaped).right.source, hostile.source);
  const duplicate = structuredClone(demo.right);
  duplicate.turns.push(duplicate.turns[0]);
  await assert.rejects(renderComparison(demo.left, duplicate), /Duplicate turn/);
  const output = join(dir, "compare.html");
  await viewer("--session", demo.originalDirectory, "--compare", demo.forkDirectory, "--out", output);
  assert.deepEqual(payload(await readFile(output, "utf8")).sharedStartTurns, [4]);
  assert.equal((await loadSession(demo.forkDirectory)).turns[0].stateAfter.turn, 4);
  for (const args of [["--compare", bad], ["--demo", "--fork-demo"], ["--fork-demo", "--session", bad]]) await assert.rejects(viewer(...args));
  console.log("Fork smoke passed: exact checkpoint and dialogue context, immutable source, parallel CLI forks, fork-of-fork, symbolic branch with retained correction, validated failures, safe comparison export.");
} finally { await rm(dir, { recursive: true, force: true }); }

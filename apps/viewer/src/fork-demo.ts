import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FileArtifactStore, loadTurnCheckpoint, RoughShellRuntime } from "@rough-shell/core";
import { buildDemo, demoScript, DesertMermaidDemoProvider } from "./demo.js";
import type { ViewerSession } from "./types.js";

/** Two saved runtime continuations, with a common turn-3 checkpoint. */
export async function buildForkDemo(artifactsDirectory: string) {
  const root = join(artifactsDirectory, `fork-demo-${randomUUID()}`);
  const originalStore = new FileArtifactStore(root, "original");
  const left = await buildDemo(originalStore);
  const checkpoint = await loadTurnCheckpoint(originalStore.sessionDir, 3);
  const forkStore = new FileArtifactStore(root, "symbolic");
  const entry = demoScript[4];
  const result = await new RoughShellRuntime().runTurn({
    provider: new DesertMermaidDemoProvider(4),
    artifactStore: forkStore,
    prevState: checkpoint.state,
    lastTurn: checkpoint.last_turn,
    lastAudit: checkpoint.last_turn.audit,
    userTurn: entry.user,
  });
  if (result.audit.verdict !== "pass") throw new Error("Fork demo failed its runtime audit.");
  await writeFile(join(forkStore.sessionDir, "fork.json"), `${JSON.stringify(checkpoint, null, 2)}\n`, { flag: "wx" });
  const right: ViewerSession = {
    title: "訂正のあと、すぐに象徴へ",
    description: "Turn 3 の保存状態と直前の対話を読み込み、別の問いで Turn 4 を実行した枝。",
    source: "手書きの固定応答を実際の四パス runtime で実行。ライブモデルの性能評価ではありません。",
    turns: [{ label: "4 · 訂正を保って象徴へ", user: entry.user, answer: result.finalAnswer,
      stateBefore: checkpoint.state, stateAfter: result.state, audit: result.audit.verdict }],
  };
  return { left, right, originalDirectory: originalStore.sessionDir, forkDirectory: forkStore.sessionDir };
}

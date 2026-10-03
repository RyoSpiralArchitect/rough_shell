import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { SchemaRegistry, type TurnArtifacts } from "@rough-shell/core";
import type { ViewerSession } from "./types.js";

export async function loadSession(directory: string): Promise<ViewerSession> {
  const registry = new SchemaRegistry();
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^turn-\d+$/.test(entry.name))
    .sort((a, b) => Number(a.name.slice(5)) - Number(b.name.slice(5)));
  const turns: ViewerSession["turns"] = [];
  for (const entry of entries) {
    const file = join(directory, entry.name, "turn.json");
    // Ignore incomplete turns (failure artifacts have no turn.json), but never
    // silently omit a completed turn that contains malformed JSON/state.
    let contents: string;
    try { contents = await readFile(file, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const value = JSON.parse(contents) as Partial<TurnArtifacts>;
    if (typeof value.user_turn !== "string" || typeof value.final_answer !== "string" ||
        !value.audit || !["pass", "revise", "block"].includes(value.audit.verdict)) {
      throw new Error(`Invalid completed turn: ${file}`);
    }
    const before = registry.validateShellState(value.state_before);
    const after = registry.validateShellState(value.final_state);
    if (after.turn !== before.turn + 1 || value.turn !== after.turn) {
      throw new Error(`Inconsistent turn numbers: ${file}`);
    }
    turns.push({ label: `Turn ${after.turn}`, user: value.user_turn, answer: value.final_answer,
      audit: value.audit.verdict, stateBefore: before, stateAfter: after });
  }
  if (!turns.length) throw new Error(`No completed turn.json artifacts found in ${directory}`);
  return { title: "保存した対話をたどる", description: "ローカルの turn.json から読み込んだ完了済みターン。外部 API へのアクセスはありません。",
    source: "Local session artifacts · read-only export", turns };
}

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SchemaRegistry } from "./schema-registry.js";
import type { AuditResult, LastTurnContext, NegotiationResult, ProjectionOutput, ShellState } from "./types.js";

export interface TurnCheckpoint {
  checkpoint_version: 1;
  source: {
    session_dir: string;
    turn: number;
    artifact_sha256: string;
  };
  state: ShellState;
  last_turn: LastTurnContext;
}

/** Read one completed turn, never a later state or an uncommitted failure. */
export async function loadTurnCheckpoint(
  sessionDirectory: string,
  turn: number,
  registry = new SchemaRegistry(),
): Promise<TurnCheckpoint> {
  if (!Number.isSafeInteger(turn) || turn < 1) {
    throw new Error("Checkpoint turn must be a positive safe integer.");
  }
  const directory = resolve(sessionDirectory);
  const file = join(directory, `turn-${String(turn).padStart(4, "0")}`, "turn.json");
  const contents = await readFile(file);
  const value: unknown = JSON.parse(contents.toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid completed turn: ${file}`);
  }
  const artifact = value as Record<string, unknown>;
  if (artifact.artifact_version !== 1 || artifact.turn !== turn ||
      typeof artifact.user_turn !== "string" || typeof artifact.final_answer !== "string") {
    throw new Error(`Invalid completed turn: ${file}`);
  }
  const before = registry.validateShellState(artifact.state_before);
  const state = registry.validateShellState(artifact.final_state);
  const negotiation = registry.validate<NegotiationResult>("negotiation_result.schema.json", artifact.negotiation);
  const projection = registry.validate<ProjectionOutput>("projection_output.schema.json", artifact.projection);
  const audit = registry.validate<AuditResult>("audit_result.schema.json", artifact.audit);
  if (before.turn !== turn - 1 || state.turn !== turn ||
      [negotiation, projection, audit].some((pass) => pass.turn !== turn || pass.version !== state.version) ||
      projection.answer !== artifact.final_answer) {
    throw new Error(`Inconsistent checkpoint state, context, or turn numbers: ${file}`);
  }
  return {
    checkpoint_version: 1,
    source: {
      session_dir: directory,
      turn,
      artifact_sha256: createHash("sha256").update(contents).digest("hex"),
    },
    state,
    last_turn: { user_turn: artifact.user_turn, answer: artifact.final_answer, negotiation, projection, audit },
  };
}

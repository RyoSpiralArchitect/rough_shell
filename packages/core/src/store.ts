import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ArtifactStore, FailedPassArtifacts, TurnArtifacts } from "./types.js";

function timestampSessionId(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export class FileArtifactStore implements ArtifactStore {
  public readonly rootDir: string;

  public readonly sessionDir: string;

  public constructor(rootDir: string, sessionId = timestampSessionId()) {
    this.rootDir = rootDir;
    this.sessionDir = join(rootDir, sessionId);
  }

  public async recordTurn(artifacts: TurnArtifacts): Promise<string> {
    const turnDir = join(this.sessionDir, `turn-${String(artifacts.turn).padStart(4, "0")}`);
    await mkdir(turnDir, { recursive: true });

    await Promise.all([
      writeJson(join(turnDir, "turn.json"), artifacts),
      writeJson(join(turnDir, "state-before.json"), artifacts.state_before),
      writeJson(join(turnDir, "state-delta.json"), artifacts.state_delta),
      writeJson(join(turnDir, "state-after-delta.json"), artifacts.state_after_delta),
      writeJson(join(turnDir, "negotiation.json"), artifacts.negotiation),
      writeJson(join(turnDir, "projection.json"), artifacts.projection),
      writeJson(join(turnDir, "audit.json"), artifacts.audit),
      writeJson(join(turnDir, "state-final.json"), artifacts.final_state),
      writeJson(join(turnDir, "pass-logs.json"), artifacts.pass_logs),
      writeFile(join(turnDir, "answer.txt"), `${artifacts.final_answer}\n`, "utf8"),
    ]);

    return turnDir;
  }

  public async recordFailure(artifacts: FailedPassArtifacts): Promise<string> {
    const failureDir = join(
      this.sessionDir,
      `failed-turn-${String(artifacts.turn).padStart(4, "0")}-${artifacts.pass}-seq-${artifacts.sequence}`,
    );

    await mkdir(failureDir, { recursive: true });
    await Promise.all([
      writeJson(join(failureDir, "failure.json"), artifacts),
      writeFile(
        join(failureDir, "last-validation-error.txt"),
        `${artifacts.final_validation_error}\n`,
        "utf8",
      ),
    ]);

    return failureDir;
  }
}

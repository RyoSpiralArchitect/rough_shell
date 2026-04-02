import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface JournalError {
  failureArtifactDirectory?: string;
  message: string;
  name: string;
  pass?: string;
  schemaName?: string;
  stack?: string;
}

interface SessionStartEvent {
  artifacts_dir: string;
  cwd: string;
  event: "session_started";
  mode: "once" | "repl";
  model?: string;
  pid: number;
  provider: string;
  state_path: string;
}

interface StateLoadedEvent {
  event: "state_loaded";
  state_summary: string;
  turn: number;
}

interface UserInputEvent {
  event: "user_input";
  input: string;
  source: "once" | "repl";
  turn: number;
}

interface CommandEvent {
  command: string;
  event: "command";
}

interface TurnStartedEvent {
  event: "turn_started";
  input: string;
  state_turn: number;
  turn: number;
}

interface TurnSucceededEvent {
  answer_preview: string;
  artifact_directory?: string;
  event: "turn_succeeded";
  input: string;
  state_turn: number;
  turn: number;
  verdict: string;
}

interface TurnFailedEvent {
  error: JournalError;
  event: "turn_failed";
  input: string;
  state_turn: number;
  turn: number;
}

interface CrashEvent {
  error?: JournalError;
  event: "process_crash";
  input?: string;
  last_artifact_directory?: string;
  reason: "SIGINT" | "SIGTERM" | "uncaughtException" | "unhandledRejection";
  state_turn: number;
  turn?: number;
}

interface ExitEvent {
  code: number;
  event: "process_exit";
}

type SessionJournalEvent =
  | CommandEvent
  | CrashEvent
  | ExitEvent
  | SessionStartEvent
  | StateLoadedEvent
  | TurnFailedEvent
  | TurnStartedEvent
  | TurnSucceededEvent
  | UserInputEvent;

interface CrashSnapshot {
  currentInput?: string;
  lastArtifactDirectory?: string;
  stateTurn: number;
  turn?: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function truncatePreview(value: string, maxLength = 200): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function appendJsonLine(filePath: string, value: unknown): void {
  appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

export function serializeJournalError(error: unknown): JournalError {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const serialized: JournalError = {
      message:
        typeof record.message === "string" && record.message.length > 0
          ? record.message
          : "Unknown error",
      name:
        typeof record.name === "string" && record.name.length > 0
          ? record.name
          : "Error",
    };

    if (typeof record.stack === "string" && record.stack.length > 0) {
      serialized.stack = record.stack;
    }

    if (
      typeof record.failureArtifactDirectory === "string" &&
      record.failureArtifactDirectory.length > 0
    ) {
      serialized.failureArtifactDirectory = record.failureArtifactDirectory;
    }

    if (typeof record.pass === "string" && record.pass.length > 0) {
      serialized.pass = record.pass;
    }

    if (typeof record.schemaName === "string" && record.schemaName.length > 0) {
      serialized.schemaName = record.schemaName;
    }

    return serialized;
  }

  return {
    message: typeof error === "string" ? error : "Unknown error",
    name: "Error",
  };
}

export class CliSessionJournal {
  public readonly journalPath: string;

  public readonly sessionDir: string;

  public constructor(
    sessionDir: string,
    metadata: {
      artifactsDir: string;
      cwd: string;
      mode: "once" | "repl";
      model?: string;
      provider: string;
      statePath: string;
    },
  ) {
    this.sessionDir = sessionDir;
    this.journalPath = join(sessionDir, "session-journal.jsonl");

    mkdirSync(this.sessionDir, { recursive: true });

    const sessionInfo = {
      artifacts_dir: metadata.artifactsDir,
      cwd: metadata.cwd,
      mode: metadata.mode,
      model: metadata.model ?? null,
      provider: metadata.provider,
      session_dir: this.sessionDir,
      started_at: nowIso(),
      state_path: metadata.statePath,
    };

    if (!existsSync(join(this.sessionDir, "session.json"))) {
      writeFileSync(join(this.sessionDir, "session.json"), `${JSON.stringify(sessionInfo, null, 2)}\n`, "utf8");
    }

    this.append({
      artifacts_dir: metadata.artifactsDir,
      cwd: metadata.cwd,
      event: "session_started",
      mode: metadata.mode,
      ...(metadata.model ? { model: metadata.model } : {}),
      pid: process.pid,
      provider: metadata.provider,
      state_path: metadata.statePath,
    });
  }

  public recordCommand(command: string): void {
    this.append({
      command,
      event: "command",
    });
  }

  public recordCrash(
    reason: CrashEvent["reason"],
    snapshot: CrashSnapshot,
    error?: unknown,
  ): void {
    this.append({
      ...(snapshot.currentInput ? { input: snapshot.currentInput } : {}),
      ...(snapshot.lastArtifactDirectory
        ? { last_artifact_directory: snapshot.lastArtifactDirectory }
        : {}),
      ...(error ? { error: serializeJournalError(error) } : {}),
      event: "process_crash",
      reason,
      state_turn: snapshot.stateTurn,
      ...(snapshot.turn === undefined ? {} : { turn: snapshot.turn }),
    });
  }

  public recordExit(code: number): void {
    this.append({
      code,
      event: "process_exit",
    });
  }

  public recordStateLoaded(turn: number, stateSummary: string): void {
    this.append({
      event: "state_loaded",
      state_summary: stateSummary,
      turn,
    });
  }

  public recordTurnFailed(
    inputText: string,
    turn: number,
    stateTurn: number,
    error: unknown,
  ): void {
    this.append({
      error: serializeJournalError(error),
      event: "turn_failed",
      input: inputText,
      state_turn: stateTurn,
      turn,
    });
  }

  public recordTurnStarted(inputText: string, turn: number, stateTurn: number): void {
    this.append({
      event: "turn_started",
      input: inputText,
      state_turn: stateTurn,
      turn,
    });
  }

  public recordTurnSucceeded(options: {
    answer: string;
    artifactDirectory?: string;
    inputText: string;
    stateTurn: number;
    turn: number;
    verdict: string;
  }): void {
    this.append({
      answer_preview: truncatePreview(options.answer),
      ...(options.artifactDirectory ? { artifact_directory: options.artifactDirectory } : {}),
      event: "turn_succeeded",
      input: options.inputText,
      state_turn: options.stateTurn,
      turn: options.turn,
      verdict: options.verdict,
    });
  }

  public recordUserInput(inputText: string, turn: number, source: "once" | "repl"): void {
    this.append({
      event: "user_input",
      input: inputText,
      source,
      turn,
    });
  }

  private append(event: SessionJournalEvent): void {
    appendJsonLine(this.journalPath, {
      at: nowIso(),
      ...event,
    });
  }
}

export function installCrashGuards(options: {
  journal: CliSessionJournal;
  onSignal: () => void;
  readSnapshot: () => CrashSnapshot;
  reportError: (error: unknown) => void;
}): () => void {
  let crashLogged = false;

  function logCrash(reason: CrashEvent["reason"], error?: unknown): void {
    if (crashLogged) {
      return;
    }

    crashLogged = true;
    options.journal.recordCrash(reason, options.readSnapshot(), error);
  }

  const uncaughtExceptionHandler = (error: Error): void => {
    logCrash("uncaughtException", error);
    options.reportError(error);
    process.exit(1);
  };

  const unhandledRejectionHandler = (reason: unknown): void => {
    logCrash("unhandledRejection", reason);
    options.reportError(reason);
    process.exit(1);
  };

  const signalHandler = (signal: "SIGINT" | "SIGTERM"): void => {
    logCrash(signal);
    options.onSignal();
    process.exit(signal === "SIGINT" ? 130 : 143);
  };

  const exitHandler = (code: number): void => {
    options.journal.recordExit(code);
  };

  process.on("uncaughtException", uncaughtExceptionHandler);
  process.on("unhandledRejection", unhandledRejectionHandler);
  process.on("SIGINT", signalHandler);
  process.on("SIGTERM", signalHandler);
  process.on("exit", exitHandler);

  return () => {
    process.off("uncaughtException", uncaughtExceptionHandler);
    process.off("unhandledRejection", unhandledRejectionHandler);
    process.off("SIGINT", signalHandler);
    process.off("SIGTERM", signalHandler);
    process.off("exit", exitHandler);
  };
}

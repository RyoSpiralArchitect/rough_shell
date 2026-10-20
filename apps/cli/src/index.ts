#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { join, resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";

import {
  FileArtifactStore,
  findRepositoryRoot,
  loadTurnCheckpoint,
  type LastTurnContext,
  PassValidationRuntimeError,
  RoughShellRuntime,
  SchemaRegistry,
  type JsonProvider,
  type ShellState,
} from "@rough-shell/core";
import { AnthropicProvider } from "@rough-shell/provider-anthropic";
import { MockProvider } from "@rough-shell/provider-mock";
import { MistralProvider } from "@rough-shell/provider-mistral";
import { OpenAICompatibleProvider } from "@rough-shell/provider-openai-compat";

import { CliSessionJournal, installCrashGuards } from "./session-journal.js";

type ProviderName = "anthropic" | "mistral" | "mock" | "openai-compat";

interface CliOptions {
  artifactsDir: string;
  forkSession?: string;
  atTurn?: number;
  baseUrl?: string;
  help: boolean;
  model?: string;
  once?: string;
  provider: ProviderName;
  statePath: string;
}

interface OpenAICompatPreset {
  apiKeyEnvNames: string[];
  baseUrl: string;
  label: "claude" | "gemini" | "openai";
}

const GEMINI_OPENAI_COMPAT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const CLAUDE_OPENAI_COMPAT_BASE_URL = "https://api.anthropic.com/v1";
const OPENAI_BASE_URL = "https://api.openai.com/v1";

function inferOpenAICompatPreset(model: string): OpenAICompatPreset {
  if (/^gemini(?:-|$)/i.test(model)) {
    return {
      apiKeyEnvNames: ["OPENAI_COMPAT_API_KEY", "GEMINI_API_KEY"],
      baseUrl: GEMINI_OPENAI_COMPAT_BASE_URL,
      label: "gemini",
    };
  }

  if (/^claude(?:-|$)/i.test(model)) {
    return {
      apiKeyEnvNames: ["OPENAI_COMPAT_API_KEY", "ANTHROPIC_API_KEY"],
      baseUrl: CLAUDE_OPENAI_COMPAT_BASE_URL,
      label: "claude",
    };
  }

  return {
    apiKeyEnvNames: ["OPENAI_COMPAT_API_KEY", "OPENAI_API_KEY"],
    baseUrl: OPENAI_BASE_URL,
    label: "openai",
  };
}

function usage(): string {
  return [
    "rough-shell runtime CLI",
    "",
    "Usage:",
    "  npm run cli -- --provider mock",
    "  npm run cli -- --provider mock --once \"test the runtime\"",
    "  npm run cli -- --fork <session-directory> --at-turn 3 --once \"Try another continuation\"",
    "  npm run cli -- --provider mistral --model mistral-large-latest",
    "  npm run cli -- --provider openai-compat --model <model>",
    "  npm run cli -- --provider openai --model <model>",
    "  npm run cli -- --provider anthropic --model <model>",
    "",
    "Options:",
    "  --provider <mock|mistral|openai-compat|openai|anthropic>",
    "  --model <name>",
    "  --base-url <url>",
    "  --state <path>",
    "  --fork <session-directory>  start a new session from a completed turn",
    "  --at-turn <number>         use that turn's final state and prior dialogue",
    "  --artifacts <dir>",
    "  --once <text>",
    "  --help",
    "",
    "Commands inside the REPL:",
    "  /help   show commands",
    "  /journal print the session journal path",
    "  /state  print a compact state summary",
    "  /last   print the last artifact directory",
    "  /exit   quit the session",
  ].join("\n");
}

function parseArgs(argv: string[], repoRoot: string): CliOptions {
  let explicitState = false;
  const options: CliOptions = {
    artifactsDir: resolve(repoRoot, ".rough-shell-runs"),
    help: false,
    provider: "mock",
    statePath: resolve(repoRoot, "state", "v0.5", "sample_shell_state.json"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--fork":
        if (!next || next.startsWith("--")) throw new Error("--fork requires a session directory.");
        options.forkSession = resolve(next);
        index += 1;
        break;
      case "--at-turn":
        if (!next || !/^[1-9]\d*$/.test(next) || !Number.isSafeInteger(Number(next))) {
          throw new Error("--at-turn requires a positive safe integer.");
        }
        options.atTurn = Number(next);
        index += 1;
        break;
      case "--provider":
        if (
          next !== "mock" &&
          next !== "mistral" &&
          next !== "openai" &&
          next !== "openai-compat" &&
          next !== "anthropic"
        ) {
          throw new Error(
            "--provider must be one of mock, mistral, openai-compat, openai, or anthropic.",
          );
        }
        options.provider = next === "openai" ? "openai-compat" : next;
        index += 1;
        break;
      case "--model":
        if (!next) {
          throw new Error("--model requires a value.");
        }
        options.model = next;
        index += 1;
        break;
      case "--base-url":
        if (!next) {
          throw new Error("--base-url requires a value.");
        }
        options.baseUrl = next;
        index += 1;
        break;
      case "--state":
        if (!next) {
          throw new Error("--state requires a value.");
        }
        options.statePath = resolve(next);
        explicitState = true;
        index += 1;
        break;
      case "--artifacts":
        if (!next) {
          throw new Error("--artifacts requires a value.");
        }
        options.artifactsDir = resolve(next);
        index += 1;
        break;
      case "--once":
        if (!next) {
          throw new Error("--once requires a value.");
        }
        options.once = next;
        index += 1;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (Boolean(options.forkSession) !== (options.atTurn !== undefined)) {
    throw new Error("Use --fork and --at-turn together.");
  }
  if (options.forkSession && explicitState) throw new Error("Choose --fork or --state, not both.");
  return options;
}

async function loadState(schemaRegistry: SchemaRegistry, statePath: string): Promise<ShellState> {
  const raw = await readFile(statePath, "utf8");
  return schemaRegistry.validateShellState(JSON.parse(raw) as unknown);
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }

  return value;
}

function getFirstPresentEnv(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value) {
      return value;
    }
  }

  return undefined;
}

function createProvider(options: CliOptions): JsonProvider {
  switch (options.provider) {
    case "mock":
      return new MockProvider();
    case "mistral": {
      const model = options.model ?? process.env.MISTRAL_MODEL ?? "mistral-large-latest";
      const baseUrl = options.baseUrl ?? process.env.MISTRAL_BASE_URL;
      const config: ConstructorParameters<typeof MistralProvider>[0] = {
        apiKey: getRequiredEnv("MISTRAL_API_KEY"),
        model,
      };

      if (baseUrl) {
        config.baseUrl = baseUrl;
      }

      return new MistralProvider(config);
    }
    case "openai-compat": {
      const model =
        options.model ?? process.env.OPENAI_COMPAT_MODEL ?? process.env.OPENAI_MODEL;
      if (!model) {
        throw new Error("Provide --model or set OPENAI_COMPAT_MODEL / OPENAI_MODEL.");
      }

      const preset = inferOpenAICompatPreset(model);
      const apiKey = getFirstPresentEnv(preset.apiKeyEnvNames);
      if (!apiKey) {
        throw new Error(
          `Model "${model}" is being routed through the ${preset.label} OpenAI-compatible endpoint. Set one of: ${preset.apiKeyEnvNames.join(", ")}.`,
        );
      }

      return new OpenAICompatibleProvider({
        apiKey,
        baseUrl: options.baseUrl ?? process.env.OPENAI_COMPAT_BASE_URL ?? preset.baseUrl,
        model,
      });
    }
    case "anthropic": {
      const model = options.model ?? process.env.ANTHROPIC_MODEL;
      if (!model) {
        throw new Error("Provide --model or set ANTHROPIC_MODEL.");
      }

      const baseUrl = options.baseUrl ?? process.env.ANTHROPIC_BASE_URL;
      const config: ConstructorParameters<typeof AnthropicProvider>[0] = {
        apiKey: getRequiredEnv("ANTHROPIC_API_KEY"),
        model,
      };

      if (baseUrl) {
        config.baseUrl = baseUrl;
      }

      return new AnthropicProvider(config);
    }
    default: {
      const exhaustiveCheck: never = options.provider;
      throw new Error(`Unhandled provider ${String(exhaustiveCheck)}.`);
    }
  }
}

function summarizeState(state: ShellState): string {
  return [
    `version: ${state.version}`,
    `turn: ${state.turn}`,
    `anchors: ${state.anchors.length}`,
    `sections: ${state.sections.length}`,
    `voids: ${state.voids.length}`,
    `obstructions: ${state.obstructions.length}`,
    `negotiations: ${state.negotiations.length}`,
    `openings: ${(state.interpretation_openings ?? []).length}`,
    `rejected: ${(state.rejected_variants ?? []).length}`,
    `provenances: ${(state.term_provenances ?? []).length}`,
    `referents: ${(state.referent_bindings ?? []).length}`,
    `traces: ${state.traces.length}`,
  ].join(", ");
}

async function runSingleTurn(
  runtime: RoughShellRuntime,
  provider: JsonProvider,
  artifactStore: FileArtifactStore,
  state: ShellState,
  userTurn: string,
  lastTurn?: LastTurnContext,
): Promise<{
  artifactDirectory?: string;
  answer: string;
  audit: LastTurnContext["audit"];
  negotiation: LastTurnContext["negotiation"];
  nextState: ShellState;
  projection: LastTurnContext["projection"];
  verdict: string;
}> {
  const result = await runtime.runTurn({
    artifactStore,
    ...(lastTurn ? { lastAudit: lastTurn.audit } : {}),
    ...(lastTurn ? { lastTurn } : {}),
    provider,
    prevState: state,
    userTurn,
  });

  return {
    ...(result.artifactDirectory ? { artifactDirectory: result.artifactDirectory } : {}),
    answer: result.finalAnswer,
    audit: result.audit,
    negotiation: result.negotiation,
    nextState: result.state,
    projection: result.projection,
    verdict: result.audit.verdict,
  };
}

function reportCliError(error: unknown): void {
  if (error instanceof PassValidationRuntimeError) {
    console.error(error.message);

    if (error.debugFallbackAnswer) {
      console.log("");
      console.log("debug fallback>");
      console.log(error.debugFallbackAnswer);
      console.log("");
      console.log("state not committed: schema validation failed, so this text is for debugging only.");
    }

    return;
  }

  console.error(error instanceof Error ? error.message : "An unknown runtime error occurred.");
}

async function main(): Promise<void> {
  const repoRoot = findRepositoryRoot();
  const options = parseArgs(process.argv.slice(2), repoRoot);

  if (options.help) {
    console.log(usage());
    return;
  }

  const schemaRegistry = new SchemaRegistry(repoRoot);
  const runtime = new RoughShellRuntime({ schemaRegistry });
  const checkpoint = options.forkSession && options.atTurn !== undefined
    ? await loadTurnCheckpoint(options.forkSession, options.atTurn, schemaRegistry)
    : undefined;
  let currentState = checkpoint?.state ?? await loadState(schemaRegistry, options.statePath);
  let lastTurn: LastTurnContext | undefined = checkpoint?.last_turn;
  const provider = createProvider(options);
  const artifactStore = new FileArtifactStore(options.artifactsDir);
  const statePath = checkpoint ? join(artifactStore.sessionDir, "fork.json") : options.statePath;
  const journal = new CliSessionJournal(artifactStore.sessionDir, {
    artifactsDir: options.artifactsDir,
    cwd: process.cwd(),
    mode: options.once ? "once" : "repl",
    provider: options.provider,
    statePath,
    ...(checkpoint ? { forkedFrom: checkpoint.source } : {}),
    ...(options.model ? { model: options.model } : {}),
  });
  if (checkpoint) {
    await writeFile(statePath, `${JSON.stringify(checkpoint, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  }
  let lastArtifactDirectory: string | undefined;
  let pendingTurn:
    | {
        input: string;
        turn: number;
      }
    | undefined;

  journal.recordStateLoaded(currentState.turn, summarizeState(currentState));

  installCrashGuards({
    journal,
    onSignal: () => {
      console.log("");
      console.log("session interrupted.");
    },
    readSnapshot: () => ({
      ...(pendingTurn ? { currentInput: pendingTurn.input, turn: pendingTurn.turn } : {}),
      ...(lastArtifactDirectory ? { lastArtifactDirectory } : {}),
      stateTurn: currentState.turn,
    }),
    reportError: reportCliError,
  });

  console.log("rough-shell runtime CLI");
  console.log(`provider: ${provider.name}${provider.model ? ` (${provider.model})` : ""}`);
  console.log(`state: ${statePath}`);
  if (checkpoint) console.log(`forked from: ${checkpoint.source.session_dir} / turn ${checkpoint.source.turn}`);
  console.log(`artifacts: ${artifactStore.sessionDir}`);
  console.log(`journal: ${journal.journalPath}`);
  console.log(`summary: ${summarizeState(currentState)}`);

  if (options.once) {
    const turn = currentState.turn + 1;
    journal.recordUserInput(options.once, turn, "once");
    journal.recordTurnStarted(options.once, turn, currentState.turn);
    pendingTurn = {
      input: options.once,
      turn,
    };

    try {
      const result = await runSingleTurn(
        runtime,
        provider,
        artifactStore,
        currentState,
        options.once,
        lastTurn,
      );
      currentState = result.nextState;
      lastArtifactDirectory = result.artifactDirectory;
      lastTurn = {
        answer: result.answer,
        audit: result.audit,
        negotiation: result.negotiation,
        projection: result.projection,
        user_turn: options.once,
      };
      pendingTurn = undefined;
      journal.recordTurnSucceeded({
        answer: result.answer,
        ...(result.artifactDirectory ? { artifactDirectory: result.artifactDirectory } : {}),
        inputText: options.once,
        stateTurn: currentState.turn,
        turn,
        verdict: result.verdict,
      });

      console.log("");
      console.log("assistant>");
      console.log(result.answer);
      console.log("");
      console.log(`audit verdict: ${result.verdict}`);
      if (lastArtifactDirectory) {
        console.log(`artifacts saved to: ${lastArtifactDirectory}`);
      }
    } catch (error) {
      journal.recordTurnFailed(options.once, turn, currentState.turn, error);
      pendingTurn = undefined;
      reportCliError(error);
      process.exitCode = 1;
    }

    return;
  }

  console.log("");
  console.log("Type /help for commands.");

  const rl = createInterface({ input, output });

  try {
    while (true) {
      const line = (await rl.question("you> ")).trim();
      if (!line) {
        continue;
      }

      if (line === "/exit") {
        journal.recordCommand("/exit");
        break;
      }

      if (line === "/help") {
        journal.recordCommand("/help");
        console.log(usage());
        continue;
      }

      if (line === "/journal") {
        journal.recordCommand("/journal");
        console.log(journal.journalPath);
        continue;
      }

      if (line === "/state") {
        journal.recordCommand("/state");
        console.log(summarizeState(currentState));
        continue;
      }

      if (line === "/last") {
        journal.recordCommand("/last");
        console.log(lastArtifactDirectory ?? "No turns have been recorded yet.");
        continue;
      }

      const turn = currentState.turn + 1;
      journal.recordUserInput(line, turn, "repl");
      journal.recordTurnStarted(line, turn, currentState.turn);
      pendingTurn = {
        input: line,
        turn,
      };

      try {
        const result = await runSingleTurn(runtime, provider, artifactStore, currentState, line, lastTurn);
        currentState = result.nextState;
        lastArtifactDirectory = result.artifactDirectory;
        lastTurn = {
          answer: result.answer,
          audit: result.audit,
          negotiation: result.negotiation,
          projection: result.projection,
          user_turn: line,
        };
        pendingTurn = undefined;
        journal.recordTurnSucceeded({
          answer: result.answer,
          ...(result.artifactDirectory ? { artifactDirectory: result.artifactDirectory } : {}),
          inputText: line,
          stateTurn: currentState.turn,
          turn,
          verdict: result.verdict,
        });

        console.log("");
        console.log("assistant>");
        console.log(result.answer);
        console.log("");
        console.log(`audit verdict: ${result.verdict}`);
        if (lastArtifactDirectory) {
          console.log(`artifacts saved to: ${lastArtifactDirectory}`);
        }
      } catch (error) {
        journal.recordTurnFailed(line, turn, currentState.turn, error);
        pendingTurn = undefined;
        reportCliError(error);
      }
    }
  } finally {
    rl.close();
  }
}

try {
  await main();
} catch (error) {
  reportCliError(error);
  process.exitCode = 1;
}

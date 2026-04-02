# rough_shell

`rough_shell` is an experimental runtime for treating dialogue as a state machine instead of a single prompt-response event.

The project asks a simple question: what changes when we preserve not only an answer, but also the shape of the conversation that produced it?

Instead of asking a model to respond once and forgetting the rest, this runtime keeps track of things like:

- active sections of thought
- unresolved factual gaps (`voids`)
- unresolved interpretive ambiguity (`interpretation_openings`)
- rejected framings
- anchor policies that should stay latent unless touched
- speculative or fictional answer modes

The goal is not just "better answers." The goal is to build a runtime that can remember how an answer was shaped, where it narrowed too early, and what the user corrected along the way.

## Why this exists

Many LLM systems are good at producing a plausible answer, but much weaker at preserving dialogue shape:

- when a question has multiple live readings
- when the model chooses one frame too early
- when a user rejects a framing and the system silently overwrites history
- when creative, symbolic, or hypothetical questions get mistaken for factual unknowns

`rough_shell` is a testbed for making those states explicit.

## Core idea

The runtime executes a four-pass loop on every turn:

1. `StateUpdater`
   Reads the new user turn and proposes how the conversation state should change.
2. `Negotiator`
   Decides whether the runtime should answer directly, branch, clarify, or defer.
3. `ProjectCompiler`
   Compiles the current state into a projected answer shape and claim plan.
4. `Auditor`
   Checks the projected answer for drift, premature narrowing, unsupported claims, and unnecessary anchor exposure.

Each pass is schema-constrained, artifacts are saved turn by turn, and the runtime can retry or revise if validation or audit fails.

## Current direction

The repository contains both a legacy `v0.4` bundle and a newer `v0.5`-first runtime path.

`v0.5` is where the more interesting state-machine ideas are being pushed forward. Recent additions include:

- `interpretation_openings`
  First-class storage for materially different live readings of the same question.
- `rejected_variants`
  Memory for framings the user explicitly corrected or rejected.
- `sections[*].domain_mode`
  A way to distinguish `factual`, `hypothetical`, `fictional`, and `symbolic` sections.
- `ClaimKind.speculative`
  A place for imaginative or generated claims that should not pretend to be externally verified.

That split matters because "what must be known?" and "what may be invented?" are not the same problem.

## Repository layout

This is a small TypeScript workspace:

- `packages/core`
  Runtime orchestration, schema loading, validation, state application, prompt supplements, artifact writing, and audit heuristics.
- `packages/provider-mock`
  Deterministic provider for exercising the loop without external APIs.
- `packages/provider-mistral`
  Mistral chat-completions adapter.
- `packages/provider-openai-compat`
  OpenAI-compatible adapter used for OpenAI, Gemini compatibility, and Anthropic's compatibility layer.
- `packages/provider-anthropic`
  Anthropic tool-call adapter.
- `apps/cli`
  Turn-by-turn CLI / REPL for running and inspecting the runtime.
- `notes/`
  Design observations, schema drafts, and run-driven iteration notes.

## What the runtime saves

Every session writes artifacts under `.rough-shell-runs/<session>/turn-xxxx/`.

Typical files include:

- `turn.json`
  Full turn result.
- `state-before.json`
  State before the new user input is processed.
- `state-delta.json`
  The delta proposed by `StateUpdater`.
- `negotiation.json`
  Output of the negotiation pass.
- `projection.json`
  Compiled answer projection.
- `audit.json`
  Audit verdict and findings.
- `pass-logs.json`
  Raw provider responses, retries, validation failures, and pass-level traces.

Each session directory also includes:

- `session.json`
  Session metadata such as provider, state path, and start time.
- `session-journal.jsonl`
  Crash-safe JSONL events for accepted inputs and turn lifecycle events.

This makes it practical to inspect not only what the assistant said, but why the runtime believed it was allowed to say it.

## Getting started

Install dependencies:

```bash
npm install
```

Type-check the workspace:

```bash
npm run check
```

Run the mock runtime interactively:

```bash
npm run cli:mock
```

Run one turn with the mock provider:

```bash
npm run cli -- --provider mock --once "What kind of question forces the runtime to branch?"
```

By default, the CLI starts from `sample_shell_state_v0_5.json`.

If you want the legacy base state explicitly:

```bash
npm run cli -- --provider mock --state sample_shell_state.json
```

## Running with live providers

Mistral:

```bash
MISTRAL_API_KEY=... npm run cli -- --provider mistral --model mistral-large-latest
```

OpenAI-compatible:

```bash
OPENAI_API_KEY=... npm run cli -- --provider openai-compat --model <model>
```

`--provider openai` is accepted as a short alias for `openai-compat`.

Gemini via the OpenAI-compatible endpoint:

```bash
GEMINI_API_KEY=... npm run cli -- --provider openai-compat --model gemini-2.5-flash
```

Claude via Anthropic's OpenAI SDK compatibility layer:

```bash
ANTHROPIC_API_KEY=... npm run cli -- --provider openai-compat --model claude-sonnet-4-6
```

If `--base-url` and `OPENAI_COMPAT_BASE_URL` are both unset, the CLI infers:

- `https://generativelanguage.googleapis.com/v1beta/openai` for `gemini-*`
- `https://api.anthropic.com/v1` for `claude-*`
- `https://api.openai.com/v1` otherwise

For Gemini, the runtime sends a slightly simplified tool schema to the compatibility layer, then validates the returned JSON against the full local schema before committing state.

Optional environment variables:

- `OPENAI_COMPAT_API_KEY`
- `OPENAI_COMPAT_BASE_URL`
- `OPENAI_COMPAT_MODEL`
- `MISTRAL_BASE_URL`
- `ANTHROPIC_BASE_URL`

## CLI commands

The interactive CLI supports:

- `/help`
- `/journal`
- `/state`
- `/last`
- `/exit`

## Schema assets

Legacy `v0.4` bundle:

- [common defs](./rough_shell_v0_4_common_defs.json)
- [shell state schema](./shell_state.schema.json)
- [state delta schema](./state_delta.schema.json)
- [negotiation result schema](./negotiation_result.schema.json)
- [projection output schema](./projection_output.schema.json)
- [audit result schema](./audit_result.schema.json)
- [sample shell state](./sample_shell_state.json)
- [4-pass prompts](./rough_shell_v0_4_prompts.md)

Current `v0.5` bundle:

- [v0.5 common defs](./rough_shell_v0_5_common_defs.json)
- [v0.5 shell state schema](./shell_state_v0_5.schema.json)
- [v0.5 state delta schema](./state_delta_v0_5.schema.json)
- [v0.5 negotiation result schema](./negotiation_result_v0_5.schema.json)
- [v0.5 projection output schema](./projection_output_v0_5.schema.json)
- [v0.5 audit result schema](./audit_result_v0_5.schema.json)
- [v0.5 sample shell state](./sample_shell_state_v0_5.json)
- [v0.5 schema notes](./notes/v0_5_schema_draft.md)
- [v0.5 run observations](./notes/v0_5_observations.md)

## Status

This is a research scaffold, not a finished framework.

The runtime is already useful for:

- replaying and inspecting multi-pass generations
- comparing provider behavior under a shared runtime contract
- testing new state primitives against real logs

It is still evolving in areas like:

- prompt/schema alignment across providers
- audit heuristics for frame narrowing
- better persistence rules for correction and decay
- cleaner separation between runtime contract and provider-facing schemas

If that sounds interesting, the right way to use this repo is to run it, inspect the artifacts, find where the state machine broke, and teach the runtime a better distinction.

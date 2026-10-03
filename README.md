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

The repository currently targets a `v0.5` runtime contract, with versioning carried by directory layout instead of file-name suffixes. That keeps the current assets readable while leaving room for future schema upgrades under a new version folder.

Recent additions include:

- `interpretation_openings`
  First-class storage for materially different live readings of the same question.
- `rejected_variants`
  Memory for framings the user explicitly corrected or rejected.
- `sections[*].domain_mode`
  A way to distinguish `factual`, `hypothetical`, `fictional`, and `symbolic` sections.
- `ClaimKind.speculative`
  A place for imaginative or generated claims that should not pretend to be externally verified.

That split matters because "what must be known?" and "what may be invented?" are not the same problem.

## Roadmap

The near-term roadmap currently looks like this:

1. Cross-provider contract stabilization.
   Absorb provider-specific quirks in the adapter and normalization layers so `rough_shell` sees a steadier runtime contract across OpenAI, Gemini, Claude, Mistral, and other compatible backends.
2. Epistemic discipline and anti-overclaim.
   Make the shell less permissive of unsupported confidence, performative certainty, flattened compliance, premature closure, and fast speculative leaps that read smoother than they are licensed to be.
3. Safe exploratory shell.
   Re-open exploration only after the shell is steadier, so hypothetical, fictional, symbolic, and branched answers can stay live without collapsing into hallucinated certainty or silent narrowing.
4. Run-driven adaptation and memory.
   Turn repeated failures from real runs into reusable structure: better corrections, more durable rejected variants, cleaner decay rules, curated examples, and regression cases that teach the runtime what not to repeat.

Examples and regression-style evaluations cut across every phase. The long-term aim is not only to improve answers, but to improve the runtime's ability to learn from the shape of its own failures.

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
- `apps/viewer`
  Offline, self-contained dialogue/state replay for the desert-mermaid demo and saved local sessions.
- `apps/cli`
  Turn-by-turn CLI / REPL for running and inspecting the runtime.
- `schemas/v0.5`
  The current schema contract with unversioned file names inside a versioned directory.
- `prompts/v0.5`
  The current 4-pass prompt bundle.
- `state/v0.5`
  The current sample shell state used by the CLI by default.
- `examples/`
  Curated run writeups distilled from local artifacts.
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

## Examples

Curated run writeups live under [examples/](./examples/README.md).

The first example is [desert-mermaid-fictional-domain.md](./examples/desert-mermaid-fictional-domain.md), a real Gemini run where an imaginative question was initially misclassified as an information gap. It is a good snapshot of the kind of failure this repository is trying to model and repair.

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

By default, the CLI starts from `state/v0.5/sample_shell_state.json`.

## See dialogue state in a browser

```bash
npm run viewer:demo
```

Open `.rough-shell-runs/dialogue-viewer.html` to step through the desert-mermaid
question and corrections, switch between before/after state, and see which
interpretations and rejected premises carry into the next turn. This is a
hand-authored offline fixture passed through the real four-pass runtime, not the
historical Gemini transcript or a live-model evaluation. No API key is needed.

You can also export an existing session without changing its artifacts:

```bash
npm run viewer -- --session .rough-shell-runs/<session> --out /tmp/session.html
```

See [the viewer guide](./apps/viewer/README.md) for field scope, privacy, and checks.

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

## Current assets

Current schema bundle:

- [common defs](./schemas/v0.5/common_defs.json)
- [shell state schema](./schemas/v0.5/shell_state.schema.json)
- [state delta schema](./schemas/v0.5/state_delta.schema.json)
- [negotiation result schema](./schemas/v0.5/negotiation_result.schema.json)
- [projection output schema](./schemas/v0.5/projection_output.schema.json)
- [audit result schema](./schemas/v0.5/audit_result.schema.json)

Current runtime inputs and prompts:

- [sample shell state](./state/v0.5/sample_shell_state.json)
- [4-pass prompts](./prompts/v0.5/4-pass.md)
- [schema notes](./notes/v0.5/schema_draft.md)
- [run observations](./notes/v0.5/observations.md)

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

# Dialogue / state viewer

A small, dependency-free browser entrypoint for the existing `v0.5` runtime.
The output is one self-contained HTML file: open it directly, no server, API key,
network access, or frontend build service required.

## Try the desert-mermaid demo

From the repository root:

```bash
npm ci
npm run viewer:demo
```

Open `.rough-shell-runs/dialogue-viewer.html` in your browser. Or choose a path:

```bash
npm run viewer -- --demo --out /tmp/desert-mermaid.html
```

1. Click the four turns to follow an imaginative question, selection of a fictional
   reading, rejection of obligatory thirst, and the next answer.
2. Switch **入力前 / 応答後** to inspect the selected turn's state transition.
3. Compare **生きている解釈** (`open` and `selected`), **否定された前提**,
   and **次へ持ち越す状態**. Rejected premises are preserved across turns.
4. Expand the state JSON to inspect the exact displayed fields. Browser Back and
   Forward navigate the turn history; selecting a turn never runs a model.

### What this fixture does and does not prove

The dialogue and provider outputs are **new, hand-authored fixture data** inspired
by [the desert-mermaid failure writeup](../../examples/desert-mermaid-fictional-domain.md).
They are not the original Gemini run, a reproduction of its transcript, or evidence
that a live model now avoids that failure. The fixture runs the actual
`RoughShellRuntime.runTurn` four-pass loop, including schema validation, existing
state application/postprocessing, and audit heuristics. The browser reads the
resulting application state. No runtime contract or interpretation feature is
reimplemented in the UI, and no live provider is instantiated.

## Inspect an existing local session

```bash
npm run viewer -- --session .rough-shell-runs/<session> --out /tmp/session.html
```

The exporter reads completed `turn-*/turn.json` files in numeric order, validates
`state_before` and `final_state` using the core schema, and skips incomplete turn
directories without a `turn.json`. Malformed completed turns fail loudly rather
than disappearing. It does not write back to the session.

Only dialogue, the audit verdict, and selected application-state fields are
embedded. Raw provider responses, pass logs, prompts, traces, delta rationales,
and arbitrary extra artifact fields are excluded. All dynamic text uses
`textContent`; embedded JSON escapes HTML script terminators. The generated page
uses no external libraries/fonts and blocks network connections with CSP.

The export still contains conversation text and state summaries, which may be
private. Review it before sharing. It is an application-state viewer, not a view
of private model reasoning. The carry panel always describes the response's final
state; the before/after toggle applies to the inspector and JSON. Matching
carry-over only compares the displayed fields, not omitted state fields.

## Check

```bash
npm run check
npm run smoke:viewer
npm run smoke
```

The viewer smoke checks all four actual runtime turns, state continuity, explicit
rejection persistence, fixture provenance, import ordering/failures, exporter
allowlisting and escaping, and CLI errors. The implementation adds no third-party
dependencies. Browser QA can use a local static server or the generated `file:` URL.

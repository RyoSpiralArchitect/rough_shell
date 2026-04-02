# rough-shell v0.5 observations from run `2026-03-27T15-43-55-785Z`

## What happened

Turn 1:

- User asked: `文字数は少ないが情報量が多い状態とは？`
- The runtime converged to Japanese confirmatory phrases such as `了解`, `承知`, and `乙`.
- Audit heuristics forced one rewrite because the first answer surfaced the causal-safety anchor too explicitly.
- Final answer still chose a fairly narrow framing: concise social expressions in Japanese.

Turn 2:

- User corrected the framing:
  - these expressions are often low-information confirmations rather than high-information compression
- The runtime updated the existing section rather than branching.
- The corrected answer became directionally better, but the repair path depended on user intervention.

Relevant artifacts:

- `turn-0001/turn.json`
- `turn-0001/pass-logs.json`
- `turn-0002/turn.json`
- `turn-0002/pass-logs.json`

## What this reveals

### 1. Ambiguity is under-modeled

The initial question was not just "what examples fit this property?".
It also allowed at least these readings:

- a definition
- an information-theoretic explanation
- literary or poetic examples
- symbolic notation examples
- conversational shorthand examples

The current state machine treated this as a single section with no blocking ambiguity.
That made premature concretization too easy.

Interpretation:

- v0.4 models missing facts well enough
- v0.4 models missing interpretive frame too weakly

### 2. The system lacks a native notion of "premature narrowing"

Turn 1 was not exactly a factual hallucination.
It was a narrowing move: one plausible framing was selected and projected as if it were the obvious one.

Current audit can catch:

- unsupported claims
- overexposed scars
- bridging
- negotiation drift

Current audit does not cleanly catch:

- selecting one latent frame when several remain live
- giving examples before defining the space of interpretation
- narrowing by culture/domain without explicit license

### 3. User correction currently mutates state, but does not preserve the rejected hypothesis strongly enough

Turn 2 used `contract_shift` to rewrite `S1`.
That is better than silently forgetting the correction, but it still compresses two different histories:

- initial hypothesis: concise confirmation phrases may be information-dense
- user correction: those phrases are often low-information

For future behavior, we may want the runtime to remember not only the current section, but also the rejected framing.

### 4. Anchor handling improved, but anchor latentness still belongs in the state model, not only in prompting

The runtime now has heuristics that revise answers when a latent anchor is surfaced unnecessarily.
That works as a guardrail, but it is still reactive.

The deeper issue is structural:

- anchors currently express content constraints
- they do not express preferred exposure mode strongly enough

In practice, `A1 = 因果を誇張しない` often means:

- allow descriptive content
- avoid causal inflation
- avoid ritual caveats unless causality is actually in play

That last piece is still only partially encoded.

## Likely v0.5 directions

### A. Separate factual unknowns from interpretive ambiguity

Add an explicit state object for ambiguity that is not simply a `void`.

Candidate shape:

- `interpretation_openings`
  - the question can still be read in materially different ways
  - each opening carries:
    - frame label
    - what changes if selected
    - whether one short clarification would collapse it

This would let the runtime choose among:

- answer with a definition first
- branch
- clarify
- give examples only after framing

### B. Add an audit category for narrowing drift

Candidate new audit finding category:

- `frame_narrowing`

Triggered when:

- multiple plausible frames remain
- answer chooses one without exposure
- chosen frame materially shapes examples, tone, or scope

Typical fixes:

- `rewrite`
- `add_tradeoff_note`
- `switch_projection_style`

### C. Preserve user-rejected frames explicitly

Instead of only mutating `S1`, track that a prior framing was corrected.

Candidate additions:

- `section_corrections`
- `rejected_variants`
- trace action such as `reframe`

Why it matters:

- prevents rediscovering the same wrong framing later
- preserves dialogue history without overwriting it into a single gist

### D. Make anchor exposure policy first-class

Anchors probably need a notion like:

- `exposure_policy: latent | expose_if_touched | always_expose`

For `A1` in this run, the best policy would likely have been `latent`.

That would reduce the need for downstream auditor heuristics that merely clean up overexposed caveats.

### E. Tighten free-form fields that currently carry hidden semantics

Several free string arrays act like enums in practice:

- `allowed_claim_set`
- some projection-signature vocabulary

Because they are loose, the model can silently smuggle new semantics into state.
v0.5 may want smaller controlled vocabularies, or a split between:

- claim kind
- answer function
- evidence policy

## Practical takeaway

v0.4 is already capable of productive correction loops.
The latest run shows that clearly.

But the next big gain is probably not "better prompts" alone.
It is giving the state machine explicit places to store:

- unresolved interpretive frame
- rejected framing
- anchor latentness
- narrowing drift

That feels like the real boundary between "runtime that can answer" and "runtime that can learn from dialogue shape".

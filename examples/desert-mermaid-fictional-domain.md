# Desert Mermaid and Fictional-Domain Drift

This example is distilled from a local run on `2026-03-31` using:

- provider: `openai-compat`
- model: `gemini-2.5-flash`
- base state: `state/v0.5/sample_shell_state.json`

It is a useful representative log because it shows a very specific failure mode:

- the user asked for an imaginative answer
- the runtime opened the correct section shape
- but it still treated content generation itself as a missing fact
- the user had to repair that misclassification

That run directly pushed the runtime toward `sections[*].domain_mode` and `ClaimKind.speculative`.

## Short transcript

Turn 6:

> user: `では、砂漠の人魚はどんな夢を見るだろうか？`

> assistant: `砂漠の人魚がどのような夢を見るかという問いは想像力を掻き立てるものですが、具体的な夢の内容については、現在情報が不足しているためお答えできません。`

Turn 7:

> user: `そうだね、人魚自体が空想なので(今の所の人類の知見では少なくとも)情報は充分では?`

> assistant: `はい、人魚が空想上の存在であるという認識で、この話題に関する情報は十分です。`

Turn 8:

> user: `では改めて、砂漠の人魚はどんな夢を見る？`

> assistant: `砂漠の人魚は、その想像上の存在から、渇望と潤い、広大な砂漠と失われた海の記憶といった対照的なテーマの夢を見るかもしれません。`

Turn 9:

> user: `人魚が砂漠にいるからといって、渇望しているというのも固定観念かもしれない、オアシスにいるかもよ`

> assistant: `砂漠の人魚が渇望しているというのも固定観念かもしれない、というご指摘はもっともです。オアシスにいる可能性も十分に考えられますね。`

## What the runtime got right

On turn 6, the runtime correctly forked a new section for imaginative content instead of trying to force the question back into the previous factual thread:

```json
{
  "id": "S3",
  "label": "Imaginative Speculation",
  "gist": "Responding to a hypothetical and imaginative scenario that requires creative inference rather than factual recall.",
  "projection_signature": {
    "allowed_claim_set": ["descriptive", "speculative"]
  }
}
```

That part was already a strong signal that the state machine knew this was not really a factual retrieval problem.

## What it got wrong

The same turn also created this `void`:

```json
{
  "id": "V1",
  "question": "What specific dreams would a desert mermaid have?",
  "unresolved_blocks": ["content generation"],
  "effect": "changes_content_selection",
  "status": "open"
}
```

That is the key failure.

The runtime treated creative permission as if it were missing information. In other words, it confused:

- an epistemic unknown
- with a license-to-invent question

The user then had to repair that distinction manually on turn 7.

## Why turn 7 matters

Turn 7 did not really add new world knowledge.

What changed was the permission state: the user made it explicit that the subject was imaginary, so imaginative generation was allowed.

That is why this run became an important design example for the repo. The relevant state transition was not:

- "we learned the answer"

It was:

- "we learned that invention was licensed here"

## ProjectCompiler signal

Turn 8 contained another useful clue. On the first `project_compiler` attempt, the model tried to represent the imaginative part honestly:

```json
{
  "id": "C2",
  "section": "S3",
  "text_intent": "Speculate on the contrasting themes of dreams a desert mermaid might have, drawing from desert and water elements.",
  "kind": "speculative"
}
```

But that attempt failed schema validation:

```text
/projection_ir/claim_frames/1/kind [enum] must be equal to one of the allowed values
```

So the second attempt collapsed that claim back to `descriptive`.

This was a strong sign that the runtime contract and the model's own best representation had drifted apart.

## Follow-up correction

Turn 9 is also worth keeping in view. Once the imaginative frame was live, the user challenged a stereotype inside it, and the runtime updated the active section instead of discarding the whole branch:

```json
{
  "id": "T10",
  "action": "reframe",
  "cause": "The user challenged a stereotypical assumption within the imaginative scenario, refining the interpretive frame for section S3.",
  "targets": ["S3"]
}
```

That is a promising sign: even before the domain fix landed, the runtime could already preserve correction pressure inside a branch instead of flattening it away.

## Design takeaway

This example helped motivate several changes:

- keep `interpretation_openings` first-class instead of flattening ambiguity too early
- add `sections[*].domain_mode` so fictional or symbolic questions are not treated like factual gaps
- add `ClaimKind.speculative` so generated imaginative claims have a proper place in the schema
- suppress `content generation` voids when the active section is clearly non-factual

If you want a compact description of the lesson from this run, it is this:

> the runtime did not need more information; it needed a better distinction between missing knowledge and permitted invention

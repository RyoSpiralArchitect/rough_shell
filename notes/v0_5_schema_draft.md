# rough-shell v0.5 schema draft

This draft turns the current v0.5 hunches into concrete state slots without wiring them into the runtime yet.

## New state objects

- `anchors[*].exposure_policy`
  - `latent | expose_if_touched | always_expose`
  - makes anchor surface policy explicit instead of leaving it entirely to prompting and audit cleanup
- `interpretation_openings[*]`
  - stores materially live readings that are not simple factual unknowns
  - each opening records:
    - a frame label
    - the reading itself
    - what changes if that reading is selected
    - whether one clarification could collapse it
- `rejected_variants[*]`
  - preserves user- or audit-rejected framings instead of overwriting them into the latest section state
- `sections[*].domain_mode`
  - `factual | hypothetical | fictional | symbolic`
  - separates "what kind of world are we reasoning inside?" from unresolved factual dependency
- `ClaimKind.speculative`
  - lets the projection mark generated imaginative content without forcing it back into descriptive/factual-looking language

## New update paths

- `state_delta.update_anchor_exposure`
  - lets the runtime shift an anchor between latent and explicit modes
- `state_delta.add_interpretation_openings`
- `state_delta.update_interpretation_openings`
- `state_delta.add_rejected_variants`

## New audit surface

- `AuditFinding.category` adds `frame_narrowing`
  - intended for cases where multiple readings remain live, but the answer picks one as if it were licensed

## New projection surface

- `projection_ir.frame_commitments`
  - explicit list of interpretation-opening ids the answer is actually committing to
  - gives audit a cleaner place to compare projection against live ambiguity
- `claim_frames[*].kind = speculative`
  - distinguishes imaginative generation from descriptive explanation

## New trace vocabulary

- `reframe`
  - for user or auditor corrections that do more than a normal `contract_shift`

## Files

- `rough_shell_v0_5_common_defs.json`
- `shell_state_v0_5.schema.json`
- `state_delta_v0_5.schema.json`
- `negotiation_result_v0_5.schema.json`
- `projection_output_v0_5.schema.json`
- `audit_result_v0_5.schema.json`
- `sample_shell_state_v0_5.json`

## Current limits of this draft

- `ProjectionSignature.allowed_claim_set` is still loose string vocabulary
- `domain_mode` is still a first pass; we may later want section-level decay or inheritance rules
- v0.5 schemas are wired into `SchemaRegistry` and the runtime, but the prompt/runtime behavior is still evolving
- this is a first pass at state shape, not a settled protocol

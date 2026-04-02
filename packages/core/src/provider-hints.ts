import type { JsonProvider, PassName, SchemaVersion } from "./types.js";

function buildMistralHint(pass: PassName, schemaVersion: SchemaVersion): string {
  switch (pass) {
    case "state_updater":
      return [
        "Provider-specific hint for Mistral:",
        "- Do not rename schema fields into semantic aliases.",
        "- Prefer copying the exact field names from the prompt examples.",
        "- If unsure, return empty arrays rather than inventing alternate object shapes.",
        "- For enum fields, copy one of the exact allowed literals shown in the prompt.",
        "- Do not emit anchor_add for an existing anchor unless it is actually new in add_anchors.",
        "- Do not invent trace actions like void or void_add.",
        ...(schemaVersion === "v0.5"
          ? [
              "- When the schema asks for interpretation_openings, do not rename them to interpretations, readings, or options.",
              "- When the schema asks for rejected_variants, preserve the rejected framing there instead of hiding it inside section text.",
              "- update_anchor_exposure must stay separate from update_anchor_status.",
              "- Valid exposure_policy literals are only: latent, expose_if_touched, always_expose.",
              "- section.domain_mode must be one of exactly: factual, hypothetical, fictional, symbolic.",
              "- If multiple plausible readings remain, keep more than one interpretation_opening live instead of forcing one section too early.",
              "- If the user corrects a prior frame, preserve that earlier frame in rejected_variants and use reframe when appropriate.",
              "- If multiple live readings would change the answer meaning, add_obstructions or add_negotiations is better than silently narrowing.",
              "- If domain_mode is hypothetical, fictional, or symbolic, do not create a void just because the subject is invented or underdescribed.",
              "- Use reframe only for explicit corrections or reframings.",
            ]
          : []),
      ].join("\n");
    case "negotiator":
      return [
        "Provider-specific hint for Mistral:",
        "- Do not invent wrapper objects like result or frontiers.",
        "- decisions must be an array of canonical decision objects, or [] when there is no active negotiation.",
        `- Valid trace actions are only: ${schemaVersion === "v0.5"
          ? "anchor_add, anchor_relax, fork, suspend, obstruct, revive, resolve, retire, project, contract_shift, negotiate, audit_rewrite, reframe."
          : "anchor_add, anchor_relax, fork, suspend, obstruct, revive, resolve, retire, project, contract_shift, negotiate, audit_rewrite."}`,
        "- If no canonical trace action fits, use traces: [].",
        "- If decisions is [], traces should also be [].",
        "- Put explanation in global_reason, not in traces.",
        ...(schemaVersion === "v0.5"
          ? [
              "- Multiple live interpretation_openings usually mean the style should be clarify, branched, or meta rather than single.",
              "- If one clarification can collapse the live readings, prefer clarify.",
            ]
          : []),
        "- Prefer copying the exact field names from the prompt examples.",
      ].join("\n");
    case "project_compiler":
      return [
        "Provider-specific hint for Mistral:",
        "- answer must be a plain string, not a localized object.",
        "- Do not rename claim_frames to claims.",
        "- Do not add explanatory fields that are not in the schema.",
        "- Prefer empty arrays over invented scar/withheld sub-shapes when unsure.",
        "- Keep active anchors latent by default; do not add generic causal caveats unless a concrete claim needs them.",
        ...(schemaVersion === "v0.5"
          ? [
              "- projection_ir.frame_commitments must be an array, not a string or object.",
              "- claim_frames[*].kind may also be speculative in v0.5 when the answer is imaginatively generated.",
              "- If the answer chooses one live reading, put the opening ids in frame_commitments.",
              "- Do not jump straight to examples, genre, or cultural instantiations when that framing is still unresolved in interpretation_openings.",
              "- If the active section domain_mode is hypothetical, fictional, or symbolic, speculative claims are allowed and should not be collapsed back into factual-seeming descriptive claims.",
              "- Do not revive rejected_variants as if they were still live.",
            ]
          : []),
        "- Prefer copying the exact field names from the prompt examples.",
      ].join("\n");
    case "auditor":
      return [
        "Provider-specific hint for Mistral:",
        "- findings must be an array of canonical finding objects, not a checks object.",
        "- Do not add wrapper fields like checks or revision_suggestions.",
        "- summary must be a plain string.",
        "- If verdict is pass and there are no open issues, prefer findings: [] and required_actions: [].",
        "- If local_inference is stated too strongly, verdict should be revise with an unsupported_claim finding.",
        "- If a latent anchor is surfaced as a generic caveat without need, verdict should be revise with a scar_overexposure finding.",
        ...(schemaVersion === "v0.5"
          ? [
              "- frame_narrowing is a valid finding category when live interpretation openings are narrowed without license.",
              "- When live readings remain, do not call the answer pass unless frame narrowing has been checked.",
              "- Also use frame_narrowing if the answer jumps to examples before framing or silently chooses a culture/genre-specific frame.",
              "- Also use frame_narrowing if a rejected_variant is revived as if it were still live.",
            ]
          : []),
        "- Prefer copying the exact field names from the prompt examples.",
      ].join("\n");
    default:
      return "";
  }
}

export function appendProviderHint(
  provider: JsonProvider,
  pass: PassName,
  schemaVersion: SchemaVersion,
  userPrompt: string,
): string {
  if (provider.name !== "mistral") {
    return userPrompt;
  }

  const hint = buildMistralHint(pass, schemaVersion);
  return hint ? `${userPrompt}\n\n${hint}` : userPrompt;
}

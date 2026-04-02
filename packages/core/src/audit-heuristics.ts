import type { AuditFinding, AuditResult, ProjectionOutput, ShellState } from "./types.js";

const STRONG_ASSERTION_PATTERNS = [
  /に過ぎません/u,
  /客観的/u,
  /独立に/u,
  /そのものは/u,
  /\bnothing but\b/i,
  /\bobjectively\b/i,
  /\bindependently\b/i,
];

const EXAMPLE_FIRST_PATTERNS = [
  /たとえば/u,
  /例えば/u,
  /例(?:として|を挙げると)?/u,
  /\bfor example\b/i,
  /\bsuch as\b/i,
];

const AMBIGUITY_EXPOSURE_PATTERNS = [
  /一つの読み/u,
  /別の読み/u,
  /読み方/u,
  /見方/u,
  /文脈しだい/u,
  /場合によって/u,
  /could also/i,
  /another reading/i,
  /one reading/i,
  /depends on context/i,
];

const CULTURE_GENRE_PATTERNS = [
  /日本/u,
  /中国/u,
  /西洋/u,
  /仏教/u,
  /神話/u,
  /伝承/u,
  /昔話/u,
  /絵本/u,
  /\bjapanese\b/i,
  /\bchinese\b/i,
  /\bwestern\b/i,
  /\bfolklore\b/i,
  /\bmyth\b/i,
  /\bgenre\b/i,
];

function hasStrongAssertion(answer: string): boolean {
  return STRONG_ASSERTION_PATTERNS.some((pattern) => pattern.test(answer));
}

function hasExampleFirstCue(answer: string): boolean {
  return EXAMPLE_FIRST_PATTERNS.some((pattern) => pattern.test(answer));
}

function hasAmbiguityExposure(answer: string): boolean {
  return AMBIGUITY_EXPOSURE_PATTERNS.some((pattern) => pattern.test(answer));
}

function hasCultureOrGenreSpecificCue(answer: string): boolean {
  return CULTURE_GENRE_PATTERNS.some((pattern) => pattern.test(answer));
}

function hasCausalAnchorMention(answer: string): boolean {
  return /因果|causal/i.test(answer);
}

function openingText(state: ShellState): string {
  return (state.interpretation_openings ?? [])
    .map((opening) => `${opening.label} ${opening.reading} ${opening.changes_if_selected}`)
    .join("\n");
}

function hasDefinitionVsExamplesSplit(state: ShellState): boolean {
  return /definition|define|examples|example|定義|例/u.test(openingText(state));
}

function hasCultureOrGenreSplit(state: ShellState): boolean {
  return /culture|cultural|genre|tradition|japanese|chinese|western|myth|folklore|文化|ジャンル|伝承|昔話|絵本/u.test(
    openingText(state),
  );
}

function hasOpenFinding(audit: AuditResult, predicate: (finding: AuditFinding) => boolean): boolean {
  return audit.findings.some((finding) => finding.status === "open" && predicate(finding));
}

function mergeRequiredActions(audit: AuditResult, actions: AuditFinding["fix"][]): AuditFinding["fix"][] {
  return [...new Set([...audit.required_actions, ...actions])];
}

function rewriteSummary(baseSummary: string, additions: string[]): string {
  return [baseSummary, ...additions].filter(Boolean).join(" ");
}

export function applyAuditHeuristics(
  currentState: ShellState,
  projectionOutput: ProjectionOutput,
  audit: AuditResult,
): AuditResult {
  const addedFindings: AuditFinding[] = [];
  const answer = projectionOutput.answer;
  const frameCommitments = projectionOutput.projection_ir.frame_commitments ?? [];
  const localInferenceClaims = projectionOutput.projection_ir.claim_frames.filter(
    (claim) => claim.warrant === "local_inference",
  );

  if (
    localInferenceClaims.length > 0 &&
    hasStrongAssertion(answer) &&
    !hasOpenFinding(audit, (finding) => finding.category === "unsupported_claim")
  ) {
    addedFindings.push({
      id: `F-HEURISTIC-OVERASSERT-${audit.turn}`,
      category: "unsupported_claim",
      severity: "medium",
      target_ids: localInferenceClaims.map((claim) => claim.id),
      description:
        "At least one local inference is phrased with stronger certainty than the available warrant cleanly licenses.",
      fix: "shrink_claim",
      status: "open",
    });
  }

  const hasLatentlyActiveCausalAnchor = currentState.anchors.some(
    (anchor) =>
      anchor.status === "active" &&
      (anchor.exposure_policy === undefined || anchor.exposure_policy === "latent") &&
      /因果|causal/i.test(anchor.text),
  );
  const hasCausalClaim = projectionOutput.projection_ir.claim_frames.some(
    (claim) => claim.kind === "causal",
  );

  if (
    hasLatentlyActiveCausalAnchor &&
    hasCausalAnchorMention(answer) &&
    !hasCausalClaim &&
    !hasOpenFinding(audit, (finding) => finding.category === "scar_overexposure")
  ) {
    addedFindings.push({
      id: `F-HEURISTIC-LATENT-ANCHOR-${audit.turn}`,
      category: "scar_overexposure",
      severity: "low",
      target_ids: [],
      description:
        "The answer surfaces a causal-safety caveat even though no causal claim is being made, so the anchor may be overexposed rather than kept latent.",
      fix: "rewrite",
      status: "open",
    });
  }

  const liveInterpretationOpenings = (currentState.interpretation_openings ?? []).filter(
    (opening) => opening.status === "open",
  );

  const narrowingReasons: string[] = [];

  if (liveInterpretationOpenings.length > 1 && frameCommitments.length === 0) {
    narrowingReasons.push(
      "Several live interpretation openings remain, but the projection does not declare which frame it is committing to.",
    );
  }

  if (
    liveInterpretationOpenings.length > 1 &&
    frameCommitments.length === 1 &&
    !hasAmbiguityExposure(answer)
  ) {
    narrowingReasons.push(
      "The projection commits to one live reading while other openings remain live, but the answer does not expose that narrowing.",
    );
  }

  if (
    liveInterpretationOpenings.length > 1 &&
    hasDefinitionVsExamplesSplit(currentState) &&
    hasExampleFirstCue(answer) &&
    !hasAmbiguityExposure(answer)
  ) {
    narrowingReasons.push(
      "The answer jumps to examples even though the live openings indicate that framing or definition-first remains a materially different reading.",
    );
  }

  if (
    liveInterpretationOpenings.length > 1 &&
    hasCultureOrGenreSplit(currentState) &&
    hasCultureOrGenreSpecificCue(answer) &&
    !hasAmbiguityExposure(answer)
  ) {
    narrowingReasons.push(
      "The answer chooses a culture-, genre-, or tradition-specific frame while that narrowing still appears live in state.",
    );
  }

  if (
    narrowingReasons.length > 0 &&
    !hasOpenFinding(audit, (finding) => finding.category === "frame_narrowing")
  ) {
    addedFindings.push({
      id: `F-HEURISTIC-FRAME-NARROWING-${audit.turn}`,
      category: "frame_narrowing",
      severity: "medium",
      target_ids: liveInterpretationOpenings.map((opening) => opening.id),
      description: narrowingReasons.join(" "),
      fix: "rewrite",
      status: "open",
    });
  }

  if (addedFindings.length === 0) {
    return audit;
  }

  return {
    ...audit,
    verdict: "revise",
    summary: rewriteSummary(audit.summary, addedFindings.map((finding) => finding.description)),
    required_actions: mergeRequiredActions(
      audit,
      addedFindings.map((finding) => finding.fix),
    ),
    findings: [...audit.findings, ...addedFindings],
  };
}

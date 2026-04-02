import type {
  Anchor,
  AnchorExposurePolicy,
  AuditFinding,
  ClaimKind,
  FindingCategory,
  FixAction,
  InterpretationOpening,
  InterpretationOpeningPatch,
  JsonProvider,
  PassName,
  ProjectionStyle,
  RejectedVariant,
  SchemaVersion,
  Trace,
  TraceAction,
  Verdict,
} from "./types.js";

const TRACE_ACTIONS = new Set<TraceAction>([
  "anchor_add",
  "anchor_relax",
  "fork",
  "suspend",
  "obstruct",
  "revive",
  "resolve",
  "retire",
  "project",
  "contract_shift",
  "negotiate",
  "audit_rewrite",
  "reframe",
]);

const PROJECTION_STYLES = new Set<ProjectionStyle>([
  "auto",
  "single",
  "branched",
  "meta",
  "clarify",
]);

const VERDICTS = new Set<Verdict>(["pass", "revise", "block"]);

const FINDING_CATEGORIES = new Set<FindingCategory>([
  "provenance",
  "bridge",
  "implicature",
  "scope_coverage",
  "negotiation_fidelity",
  "unsupported_claim",
  "scar_underexposure",
  "scar_overexposure",
  "frame_narrowing",
]);

const FIX_ACTIONS = new Set<FixAction>([
  "add_scar",
  "drop_claim",
  "shrink_claim",
  "rebundle_scars",
  "switch_projection_style",
  "add_tradeoff_note",
  "rewrite",
]);

const CLAIM_KINDS = new Set<ClaimKind>([
  "descriptive",
  "causal",
  "comparative",
  "normative",
  "procedural",
  "meta",
  "speculative",
]);

const ANCHOR_EXPOSURE_POLICIES = new Set<AnchorExposurePolicy>([
  "latent",
  "expose_if_touched",
  "always_expose",
]);

const INTERPRETATION_OPENING_STATUSES = new Set([
  "open",
  "selected",
  "collapsed",
  "rejected",
]);

const REJECTED_VARIANT_KINDS = new Set([
  "interpretation_frame",
  "section_variant",
  "frontier",
  "claim_strategy",
]);

const REJECTED_BY_VALUES = new Set([
  "user",
  "system",
  "audit",
  "inferred",
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] {
  const single = readString(value);
  if (single) {
    return [single];
  }

  return Array.isArray(value)
    ? value.map((item) => readString(item)).filter((item): item is string => item !== undefined)
    : [];
}

function readLocalizedContent(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) {
    return readString(value);
  }

  return readString(record.ja) ?? readString(record.en) ?? readString(record.text);
}

function readAnswerLike(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) {
    return readString(value);
  }

  return (
    readString(record.answer) ??
    readLocalizedContent(record.answer) ??
    readLocalizedContent(record.content) ??
    readString(record.text) ??
    undefined
  );
}

function readProjectionStyle(value: unknown): ProjectionStyle | undefined {
  const style = readString(value) as ProjectionStyle | undefined;
  return style && PROJECTION_STYLES.has(style) ? style : undefined;
}

function readSchemaVersion(value: unknown): SchemaVersion | undefined {
  const version = readString(value) as SchemaVersion | undefined;
  return version === "v0.5" ? version : undefined;
}

function readVerdict(value: unknown): Verdict | undefined {
  const verdict = readString(value) as Verdict | undefined;
  return verdict && VERDICTS.has(verdict) ? verdict : undefined;
}

function readTraceAction(value: unknown): TraceAction | undefined {
  const action = readString(value) as TraceAction | undefined;
  if (action && TRACE_ACTIONS.has(action)) {
    return action;
  }

  switch (readString(value)) {
    case "reinterpret":
    case "reframed":
    case "reframe":
    case "frame_shift":
      return "reframe";
    default:
      return undefined;
  }
}

function readFindingCategory(value: unknown): FindingCategory | undefined {
  const category = readString(value) as FindingCategory | undefined;
  return category && FINDING_CATEGORIES.has(category) ? category : undefined;
}

function readAnchorExposurePolicy(value: unknown): AnchorExposurePolicy | undefined {
  const policy = readString(value) as AnchorExposurePolicy | undefined;
  return policy && ANCHOR_EXPOSURE_POLICIES.has(policy) ? policy : undefined;
}

function readFixAction(value: unknown): FixAction | undefined {
  const action = readString(value) as FixAction | undefined;
  return action && FIX_ACTIONS.has(action) ? action : undefined;
}

function readClaimKind(value: unknown): ClaimKind | undefined {
  const kind = readString(value) as ClaimKind | undefined;
  return kind && CLAIM_KINDS.has(kind) ? kind : undefined;
}

function normalizeClaimKind(value: unknown): ClaimKind {
  const exact = readClaimKind(value);
  if (exact) {
    return exact;
  }

  switch (readString(value)) {
    case "speculative":
    case "creative":
    case "fictional":
    case "imagined":
    case "hypothetical":
      return "speculative";
    case "prescriptive":
      return "normative";
    case "philosophical":
    case "epistemological":
    case "existential":
    case "taxonomic":
    case "morphological":
    case "evaluative":
    case "structural":
      return "descriptive";
    default:
      return "meta";
  }
}

function uniqueFixActions(values: FixAction[]): FixAction[] {
  return [...new Set(values)];
}

function mapAuditCategory(value: string | undefined): FindingCategory | undefined {
  switch (value) {
    case "provenance":
      return "provenance";
    case "bridge":
    case "bridge_implicature":
      return "bridge";
    case "implicature":
      return "implicature";
    case "scope_coverage":
      return "scope_coverage";
    case "negotiation_fidelity":
      return "negotiation_fidelity";
    case "unsupported_claim":
      return "unsupported_claim";
    case "withheld_integrity":
    case "scar_underexposure":
      return "scar_underexposure";
    case "scar_inflation":
    case "scar_overexposure":
      return "scar_overexposure";
    case "frame_narrowing":
    case "narrowing":
    case "premature_narrowing":
    case "frame_selection":
    case "frame_commitment":
      return "frame_narrowing";
    default:
      return undefined;
  }
}

function inferSeverity(status: string | undefined, value: unknown): "low" | "medium" | "high" {
  const explicit = readString(value);
  if (explicit === "low" || explicit === "medium" || explicit === "high") {
    return explicit;
  }

  switch (status) {
    case "block":
    case "fail":
      return "high";
    case "revise":
    case "warn":
    case "warning":
    case "open":
      return "medium";
    default:
      return "low";
  }
}

function inferFix(category: FindingCategory): FixAction {
  switch (category) {
    case "scar_underexposure":
      return "add_scar";
    case "scar_overexposure":
      return "rebundle_scars";
    case "negotiation_fidelity":
      return "switch_projection_style";
    case "unsupported_claim":
      return "drop_claim";
    case "frame_narrowing":
      return "rewrite";
    default:
      return "rewrite";
  }
}

function normalizeAnchor(
  value: unknown,
  schemaVersion: SchemaVersion,
  index: number,
): Anchor | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const id = readString(record.id);
  const text = readString(record.text);
  const kind = readString(record.kind);
  const priority = readString(record.priority);
  const source = readString(record.source);
  const scope = readString(record.scope);
  const status = readString(record.status);

  if (!id || !text || !kind || !priority || !source || !scope || !status) {
    return undefined;
  }

  return {
    id: id || `A${index + 1}`,
    text,
    kind: kind as Anchor["kind"],
    priority: priority as Anchor["priority"],
    source: source as Anchor["source"],
    scope: scope as Anchor["scope"],
    status: status as Anchor["status"],
    ...(schemaVersion === "v0.5"
      ? {
          exposure_policy:
            readAnchorExposurePolicy(record.exposure_policy) ?? "latent",
        }
      : {}),
  };
}

function normalizeInterpretationOpening(
  value: unknown,
  index: number,
): InterpretationOpening | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const statusRaw = readString(record.status);
  const status =
    statusRaw && INTERPRETATION_OPENING_STATUSES.has(statusRaw)
      ? statusRaw
      : "open";
  const id = readString(record.id) ?? `I${index + 1}`;
  const label = readString(record.label) ?? readString(record.frame) ?? readString(record.name);
  const reading =
    readString(record.reading) ??
    readString(record.interpretation) ??
    readString(record.summary);
  const changes =
    readString(record.changes_if_selected) ??
    readString(record.impact) ??
    readString(record.effect);
  const clarificationPrompt =
    readString(record.clarification_prompt) ??
    readString(record.clarify) ??
    readString(record.question);

  if (!label || !reading || !changes || !clarificationPrompt) {
    return undefined;
  }

  return {
    id,
    label,
    reading,
    changes_if_selected: changes,
    clarification_prompt: clarificationPrompt,
    collapsible_with_one_clarification:
      record.collapsible_with_one_clarification === true ||
      record.clarifiable_with_one_question === true,
    status: status as InterpretationOpening["status"],
    competes_with: readStringArray(record.competes_with),
    related_sections: readStringArray(record.related_sections),
  };
}

function normalizeInterpretationOpeningPatch(
  value: unknown,
): InterpretationOpeningPatch | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const id = readString(record.id);
  const reason = readString(record.reason) ?? readString(record.note);
  if (!id || !reason) {
    return undefined;
  }

  const statusRaw = readString(record.status);
  const status =
    statusRaw && INTERPRETATION_OPENING_STATUSES.has(statusRaw)
      ? (statusRaw as InterpretationOpeningPatch["status"])
      : undefined;
  const clarificationPrompt = readString(record.clarification_prompt);
  const relatedSections = readStringArray(record.related_sections);

  return {
    id,
    reason,
    ...(status ? { status } : {}),
    ...(clarificationPrompt ? { clarification_prompt: clarificationPrompt } : {}),
    ...(relatedSections.length > 0 ? { related_sections: relatedSections } : {}),
  };
}

function normalizeRejectedVariant(value: unknown, turn: number, index: number): RejectedVariant | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const kindRaw = readString(record.kind);
  const kind =
    kindRaw && REJECTED_VARIANT_KINDS.has(kindRaw) ? kindRaw : "section_variant";
  const rejectedByRaw = readString(record.rejected_by);
  const rejectedBy =
    rejectedByRaw && REJECTED_BY_VALUES.has(rejectedByRaw) ? rejectedByRaw : "inferred";
  const label = readString(record.label) ?? readString(record.name);
  const summary =
    readString(record.summary) ?? readString(record.content) ?? readString(record.reading);
  const reason = readString(record.reason) ?? readString(record.note);

  if (!label || !summary || !reason) {
    return undefined;
  }

  return {
    id: readString(record.id) ?? `R${index + 1}`,
    kind: kind as RejectedVariant["kind"],
    label,
    summary,
    derived_from: readStringArray(record.derived_from ?? record.source_ids ?? record.from),
    rejected_by: rejectedBy as RejectedVariant["rejected_by"],
    reason,
    superseded_by: readStringArray(record.superseded_by),
    turn: readNumber(record.turn) ?? turn,
  };
}

function normalizeProjectionIrLike(
  value: unknown,
  schemaVersion: SchemaVersion,
): Record<string, unknown> | undefined {
  const projectionIr = asRecord(value);
  if (!projectionIr) {
    return undefined;
  }

  const claimFrames = Array.isArray(projectionIr.claim_frames)
    ? projectionIr.claim_frames
        .map((entry) => {
          const claim = asRecord(entry);
          if (!claim) {
            return undefined;
          }

          const id = readString(claim.id);
          const section = readString(claim.section);
          const textIntent = readString(claim.text_intent);
          const warrant = readString(claim.warrant);

          if (!id || !section || !textIntent || !warrant) {
            return undefined;
          }

          return {
            id,
            section,
            kind: normalizeClaimKind(claim.kind),
            text_intent: textIntent,
            warrant,
            depends_on: readStringArray(claim.depends_on),
            licensed_if: readStringArray(claim.licensed_if),
            drop_if_unexposed: claim.drop_if_unexposed === true,
          };
        })
        .filter((entry) => entry !== undefined)
    : [];

  const scars = Array.isArray(projectionIr.scars)
    ? projectionIr.scars
        .map((entry) => {
          const scar = asRecord(entry);
          if (!scar) {
            return undefined;
          }

          const id = readString(scar.id);
          const leakage = readString(scar.leakage_if_hidden);
          const severity = readString(scar.severity);
          const scope = readString(scar.scope);
          const operator = readString(scar.operator);
          const compressible = scar.compressible === true || scar.compressible === false
            ? scar.compressible
            : false;

          if (!id || !leakage || !severity || !scope || !operator) {
            return undefined;
          }

          return {
            id,
            from: readStringArray(scar.from),
            leakage_if_hidden: leakage,
            severity,
            scope,
            operator,
            compressible,
            bundle_key: readStringArray(scar.bundle_key),
            attached_to: readStringArray(scar.attached_to),
          };
        })
        .filter((entry) => entry !== undefined)
    : [];

  const withheld = Array.isArray(projectionIr.withheld)
    ? projectionIr.withheld
        .map((entry) => {
          const item = asRecord(entry);
          if (!item) {
            return undefined;
          }

          const id = readString(item.id);
          const withheldItem = readString(item.item);
          const reason = readString(item.reason);
          if (!id || !withheldItem || !reason) {
            return undefined;
          }

          return {
            id,
            item: withheldItem,
            reason,
            recover_when: readStringArray(item.recover_when),
            expose_if_material: item.expose_if_material === true,
          };
        })
        .filter((entry) => entry !== undefined)
    : [];

  const bodyPlan = asRecord(projectionIr.body_plan);

  return {
    selected_frontiers: readStringArray(projectionIr.selected_frontiers),
    ...(schemaVersion === "v0.5"
      ? {
          frame_commitments: readStringArray(
            projectionIr.frame_commitments ?? projectionIr.selected_frames ?? projectionIr.frame_ids,
          ),
        }
      : {}),
    claim_frames: claimFrames,
    scars,
    withheld,
    body_plan: {
      intro_scars: readStringArray(bodyPlan?.intro_scars),
      claims: readStringArray(bodyPlan?.claims),
      close_withheld: readStringArray(bodyPlan?.close_withheld),
      tradeoff_notes: readStringArray(bodyPlan?.tradeoff_notes),
    },
  };
}

function readSummaryFromNotes(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const notes = value
      .map((item) => readString(item))
      .filter((item): item is string => item !== undefined);
    return notes.length > 0 ? notes.join(" ") : undefined;
  }

  return readString(value);
}

function normalizeAuditFinding(
  value: unknown,
  fallbackCategory: string | undefined,
  index: number,
): AuditFinding | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const rawStatus = readString(record.status);
  const category =
    readFindingCategory(record.category) ??
    mapAuditCategory(readString(record.category) ?? fallbackCategory);
  if (!category) {
    return undefined;
  }

  const status = rawStatus === "pass" || rawStatus === "resolved" ? "resolved" : "open";
  const description =
    readString(record.description) ??
    readSummaryFromNotes(record.notes) ??
    readString(record.summary);

  if (!description) {
    return undefined;
  }

  return {
    id: readString(record.id) ?? `F${index + 1}`,
    category,
    severity: inferSeverity(rawStatus, record.severity),
    target_ids: readStringArray(record.target_ids),
    description,
    fix: readFixAction(record.fix) ?? inferFix(category),
    status,
  };
}

function normalizeAuditFindings(value: unknown): AuditFinding[] {
  if (Array.isArray(value)) {
    return value
      .map((entry, index) => normalizeAuditFinding(entry, undefined, index))
      .filter((entry): entry is AuditFinding => entry !== undefined);
  }

  const record = asRecord(value);
  if (!record) {
    return [];
  }

  return Object.entries(record)
    .map(([key, entry], index) => normalizeAuditFinding(entry, key, index))
    .filter((entry): entry is AuditFinding => entry !== undefined)
    .filter((entry) => entry.status === "open");
}

function normalizeRequiredActions(
  rawRequiredActions: unknown,
  findings: AuditFinding[],
  verdict: Verdict,
): FixAction[] {
  const explicit = Array.isArray(rawRequiredActions)
    ? rawRequiredActions
        .map((item) => readFixAction(item))
        .filter((item): item is FixAction => item !== undefined)
    : [];

  if (explicit.length > 0) {
    return uniqueFixActions(explicit);
  }

  if (findings.length > 0) {
    return uniqueFixActions(findings.map((finding) => finding.fix));
  }

  return verdict === "pass" ? [] : ["rewrite"];
}

function synthesizeAuditSummary(verdict: Verdict, findings: AuditFinding[]): string {
  switch (verdict) {
    case "pass":
      return "The answer passes audit checks within the licensed scope.";
    case "block":
      return `The answer is blocked by ${findings.length || 1} material audit issue(s).`;
    case "revise":
    default:
      return `The answer needs revision for ${findings.length || 1} audit issue(s).`;
  }
}

function normalizeNegotiationDecision(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const negotiationId =
    readString(record.negotiation_id) ??
    readString(record.negotiationId) ??
    readString(record.id);
  const selectedFrontier =
    readString(record.selected_frontier) ??
    readString(record.selectedFrontier) ??
    readString(record.selected) ??
    readString(record.frontier);
  const reason = readString(record.reason) ?? readString(record.note);

  if (!negotiationId || !selectedFrontier || !reason) {
    return undefined;
  }

  return {
    negotiation_id: negotiationId,
    selected_frontier: selectedFrontier,
    reason,
    tradeoff_note:
      readString(record.tradeoff_note) ??
      readString(record.tradeoff) ??
      "Alternative frontiers remain preserved unless explicitly relaxed.",
    alternatives_preserved: readStringArray(record.alternatives_preserved),
    relaxed_anchors: readStringArray(record.relaxed_anchors),
  };
}

function normalizeTrace(value: unknown, fallbackTurn: number, index: number): Trace | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const action = readTraceAction(record.action);
  if (!action) {
    return undefined;
  }

  const cause = readString(record.cause) ?? readString(record.reason);
  if (!cause) {
    return undefined;
  }

  return {
    id: readString(record.id) ?? `T${index + 1}`,
    action,
    targets: readStringArray(record.targets),
    cause,
    turn: readNumber(record.turn) ?? fallbackTurn,
  };
}

function normalizeStateUpdaterResponse(
  rawResponse: unknown,
  input: Record<string, unknown>,
): unknown {
  const record = asRecord(rawResponse);
  if (!record) {
    return rawResponse;
  }

  const prevState = asRecord(input.prev_state);
  const schemaVersion =
    readSchemaVersion(record.version) ?? readSchemaVersion(prevState?.version) ?? "v0.5";
  const turn = readNumber(record.turn) ?? readNumber(prevState?.turn) ?? 0;
  const existingAnchorIds = new Set(
    readStringArray(
      (prevState?.anchors as unknown[] | undefined)?.map((anchor) => asRecord(anchor)?.id),
    ),
  );
  const addAnchors = Array.isArray(record.add_anchors)
    ? record.add_anchors
        .map((anchor, index) => normalizeAnchor(anchor, schemaVersion, index))
        .filter((anchor): anchor is Anchor => anchor !== undefined)
    : [];
  const addedAnchorIds = new Set(
    addAnchors
      .map((anchor) => readString(anchor.id))
      .filter((id): id is string => id !== undefined),
  );
  const traces = Array.isArray(record.traces)
    ? record.traces
        .map((entry, index) => normalizeTrace(entry, turn, index))
        .filter((entry): entry is Trace => entry !== undefined)
        .filter((trace) => {
          if (trace.action === "anchor_add") {
            return trace.targets.some(
              (target) => addedAnchorIds.has(target) || !existingAnchorIds.has(target),
            );
          }

          if (trace.action === "resolve" && trace.targets.length === 0) {
            return false;
          }

          return true;
        })
    : [];

  return {
    version: schemaVersion,
    turn,
    rationale:
      readLocalizedContent(record.rationale) ??
      readString(record.reason) ??
      "No structural change was required.",
    contract_patch: asRecord(record.contract_patch) ?? {},
    add_anchors: addAnchors,
    update_anchor_status: Array.isArray(record.update_anchor_status)
      ? record.update_anchor_status
      : [],
    ...(schemaVersion === "v0.5"
      ? {
          update_anchor_exposure: Array.isArray(record.update_anchor_exposure)
            ? record.update_anchor_exposure
                .map((entry) => {
                  const patch = asRecord(entry);
                  if (!patch) {
                    return undefined;
                  }

                  const id = readString(patch.id);
                  const exposurePolicy = readAnchorExposurePolicy(
                    patch.exposure_policy ?? patch.policy,
                  );
                  const reason = readString(patch.reason) ?? readString(patch.note);

                  if (!id || !exposurePolicy || !reason) {
                    return undefined;
                  }

                  return {
                    id,
                    exposure_policy: exposurePolicy,
                    reason,
                  };
                })
                .filter((entry) => entry !== undefined)
            : [],
        }
      : {}),
    add_sections: Array.isArray(record.add_sections) ? record.add_sections : [],
    update_sections: Array.isArray(record.update_sections) ? record.update_sections : [],
    ...(schemaVersion === "v0.5"
      ? {
          add_interpretation_openings: Array.isArray(record.add_interpretation_openings)
            ? record.add_interpretation_openings
                .map((entry, index) => normalizeInterpretationOpening(entry, index))
                .filter((entry): entry is InterpretationOpening => entry !== undefined)
            : Array.isArray(record.interpretation_openings)
              ? record.interpretation_openings
                  .map((entry, index) => normalizeInterpretationOpening(entry, index))
                  .filter((entry): entry is InterpretationOpening => entry !== undefined)
              : Array.isArray(record.openings)
                ? record.openings
                    .map((entry, index) => normalizeInterpretationOpening(entry, index))
                    .filter((entry): entry is InterpretationOpening => entry !== undefined)
                : [],
          update_interpretation_openings: Array.isArray(record.update_interpretation_openings)
            ? record.update_interpretation_openings
                .map((entry) => normalizeInterpretationOpeningPatch(entry))
                .filter((entry): entry is InterpretationOpeningPatch => entry !== undefined)
            : [],
          add_rejected_variants: Array.isArray(record.add_rejected_variants)
            ? record.add_rejected_variants
                .map((entry, index) => normalizeRejectedVariant(entry, turn, index))
                .filter((entry): entry is RejectedVariant => entry !== undefined)
            : Array.isArray(record.rejected_variants)
              ? record.rejected_variants
                  .map((entry, index) => normalizeRejectedVariant(entry, turn, index))
                  .filter((entry): entry is RejectedVariant => entry !== undefined)
              : [],
        }
      : {}),
    add_voids: Array.isArray(record.add_voids) ? record.add_voids : [],
    resolve_voids: Array.isArray(record.resolve_voids) ? record.resolve_voids : [],
    add_obstructions: Array.isArray(record.add_obstructions) ? record.add_obstructions : [],
    clear_obstructions: Array.isArray(record.clear_obstructions) ? record.clear_obstructions : [],
    add_negotiations: Array.isArray(record.add_negotiations) ? record.add_negotiations : [],
    update_negotiations: Array.isArray(record.update_negotiations)
      ? record.update_negotiations
      : [],
    traces,
  };
}

function normalizeProjectCompilerResponse(
  rawResponse: unknown,
  input: Record<string, unknown>,
): unknown {
  const record = asRecord(rawResponse);
  if (!record) {
    return rawResponse;
  }

  const currentState = asRecord(input.current_state);
  const schemaVersion =
    readSchemaVersion(record.version) ?? readSchemaVersion(currentState?.version) ?? "v0.5";
  const projectionIr = normalizeProjectionIrLike(record.projection_ir, schemaVersion);
  if (!projectionIr) {
    return {
      version: schemaVersion,
      turn: readNumber(record.turn) ?? readNumber(currentState?.turn) ?? 1,
      answer: readAnswerLike(record.answer) ?? "",
    };
  }

  return {
    version: schemaVersion,
    turn: readNumber(record.turn) ?? readNumber(currentState?.turn) ?? 1,
    projection_ir: projectionIr,
    answer: readAnswerLike(record.answer) ?? "",
  };
}

function normalizeNegotiatorResponse(
  rawResponse: unknown,
  input: Record<string, unknown>,
): unknown {
  const record = asRecord(rawResponse);
  if (!record) {
    return rawResponse;
  }

  const currentState = asRecord(input.current_state);
  const schemaVersion =
    readSchemaVersion(record.version) ?? readSchemaVersion(currentState?.version) ?? "v0.5";
  const turn = readNumber(record.turn) ?? readNumber(currentState?.turn) ?? 1;
  const decisionsSource = Array.isArray(record.decisions)
    ? record.decisions
    : asRecord(record.decisions)
      ? [record.decisions]
      : [];
  const decisions = decisionsSource
    .map((entry) => normalizeNegotiationDecision(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== undefined);
  const tracesSource = Array.isArray(record.traces) ? record.traces : [];
  const traces =
    decisions.length === 0
      ? []
      : tracesSource
          .map((entry, index) => normalizeTrace(entry, turn, index))
          .filter((entry): entry is Trace => entry !== undefined);

  return {
    version: schemaVersion,
    turn,
    projection_style_recommendation:
      readProjectionStyle(record.projection_style_recommendation) ?? "auto",
    global_reason:
      readString(record.global_reason) ??
      readString(record.reason) ??
      "No active negotiation requires a frontier choice.",
    decisions,
    traces,
  };
}

function normalizeAuditorResponse(rawResponse: unknown, input: Record<string, unknown>): unknown {
  const record = asRecord(rawResponse);
  if (!record) {
    return rawResponse;
  }

  const projectionOutput = asRecord(input.projection_output);
  const negotiationResult = asRecord(input.negotiation_result);
  const currentState = asRecord(input.current_state);
  const schemaVersion =
    readSchemaVersion(record.version) ??
    readSchemaVersion(projectionOutput?.version) ??
    readSchemaVersion(currentState?.version) ??
    "v0.5";
  const turn = readNumber(record.turn) ?? readNumber(projectionOutput?.turn) ?? 1;
  const findings = normalizeAuditFindings(record.findings ?? record.checks);
  const verdict =
    readVerdict(record.verdict) ??
    (findings.some((finding) => finding.severity === "high") ? "block" : findings.length > 0 ? "revise" : "pass");

  const normalized: Record<string, unknown> = {
    version: schemaVersion,
    turn,
    verdict,
    summary: readString(record.summary) ?? synthesizeAuditSummary(verdict, findings),
    required_actions: normalizeRequiredActions(record.required_actions, findings, verdict),
    projection_style_recommendation:
      readProjectionStyle(record.projection_style_recommendation) ??
      readProjectionStyle(negotiationResult?.projection_style_recommendation) ??
      "auto",
    findings,
  };

  const revisedAnswer = readAnswerLike(record.revised_answer);
  if (revisedAnswer) {
    normalized.revised_answer = revisedAnswer;
  }

  const revisedProjectionIr = asRecord(record.revised_projection_ir);
  if (revisedProjectionIr) {
    normalized.revised_projection_ir =
      normalizeProjectionIrLike(revisedProjectionIr, schemaVersion) ?? revisedProjectionIr;
  }

  return normalized;
}

export function normalizeProviderResponse(
  provider: JsonProvider,
  pass: PassName,
  rawResponse: unknown,
  input: Record<string, unknown>,
): unknown {
  if (provider.name !== "mistral") {
    return rawResponse;
  }

  switch (pass) {
    case "state_updater":
      return normalizeStateUpdaterResponse(rawResponse, input);
    case "negotiator":
      return normalizeNegotiatorResponse(rawResponse, input);
    case "project_compiler":
      return normalizeProjectCompilerResponse(rawResponse, input);
    case "auditor":
      return normalizeAuditorResponse(rawResponse, input);
    default:
      return rawResponse;
  }
}

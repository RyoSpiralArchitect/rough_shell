import { applyAuditHeuristics } from "./audit-heuristics.js";
import { extractDebugFallbackAnswer } from "./debug-fallback.js";
import { normalizeProviderResponse } from "./provider-normalization.js";
import { appendPromptSupplement } from "./prompt-supplements.js";
import { loadPromptSet, renderUserPrompt } from "./prompts.js";
import { appendProviderHint } from "./provider-hints.js";
import { SchemaValidationError, SchemaRegistry } from "./schema-registry.js";
import type {
  Anchor,
  AuditResult,
  Contract,
  ContractPatch,
  InterpretationOpening,
  JsonProvider,
  Negotiation,
  NegotiationPatch,
  NegotiationResult,
  Obstruction,
  ObstructionClear,
  PassLog,
  PassName,
  ProjectionStyle,
  ProjectionOutput,
  PromptSet,
  RejectedVariant,
  RunTurnOptions,
  RunTurnResult,
  SchemaName,
  SchemaVersion,
  Section,
  SectionPatch,
  ShellState,
  StateDelta,
  Trace,
  TurnArtifacts,
  Void,
  VoidResolution,
  ArtifactStore,
  FailedPassArtifacts,
  PassValidationRuntimeErrorLike,
} from "./types.js";

function stableJson(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

function cloneState<T>(value: T): T {
  return structuredClone(value);
}

function appendUniqueById<T extends { id: string }>(
  current: T[],
  additions: T[],
  label: string,
): T[] {
  const seen = new Set(current.map((item) => item.id));
  const result = [...current];

  for (const addition of additions) {
    if (seen.has(addition.id)) {
      throw new Error(`Duplicate ${label} id "${addition.id}" encountered during delta apply.`);
    }

    seen.add(addition.id);
    result.push(addition);
  }

  return result;
}

function mergeById<T extends { id: string }, P extends Partial<T> & { id: string }>(
  current: T[],
  patches: P[],
): T[] {
  if (patches.length === 0) {
    return current;
  }

  const patchMap = new Map(patches.map((patch) => [patch.id, patch]));

  return current.map((item) => {
    const patch = patchMap.get(item.id);
    if (!patch) {
      return item;
    }

    return {
      ...item,
      ...patch,
    };
  });
}

function applyContractPatch(contract: Contract, patch: ContractPatch): Contract {
  const mergedBudgets = patch.budgets
    ? {
        ...contract.budgets,
        ...patch.budgets,
      }
    : contract.budgets;

  return {
    ...contract,
    ...patch,
    budgets: mergedBudgets,
  };
}

function resolveVoids(voids: Void[], resolutions: VoidResolution[]): Void[] {
  const resolutionIds = new Set(resolutions.map((resolution) => resolution.id));

  return voids.map((entry) =>
    resolutionIds.has(entry.id)
      ? {
          ...entry,
          status: "resolved",
        }
      : entry,
  );
}

function clearObstructions(obstructions: Obstruction[], clears: ObstructionClear[]): Obstruction[] {
  const clearIds = new Set(clears.map((clear) => clear.id));

  return obstructions.map((entry) =>
    clearIds.has(entry.id)
      ? {
          ...entry,
          status: "cleared",
        }
      : entry,
  );
}

function applyNegotiationPatches(
  negotiations: Negotiation[],
  patches: NegotiationPatch[],
): Negotiation[] {
  return mergeById(negotiations, patches);
}

function applyNegotiationResult(
  state: ShellState,
  negotiationResult: NegotiationResult,
): ShellState {
  if (negotiationResult.decisions.length === 0 && negotiationResult.traces.length === 0) {
    return state;
  }

  const decisionMap = new Map(
    negotiationResult.decisions.map((decision) => [decision.negotiation_id, decision]),
  );

  const negotiations = state.negotiations.map((negotiation) => {
    const decision = decisionMap.get(negotiation.id);
    if (!decision) {
      return negotiation;
    }

    return {
      ...negotiation,
      selected: decision.selected_frontier,
      reason: decision.reason,
      alternatives_preserved: decision.alternatives_preserved,
    };
  });

  return {
    ...state,
    negotiations,
    traces: [...state.traces, ...negotiationResult.traces],
  };
}

function appendPromptAppendix(userPrompt: string, appendix: string | undefined): string {
  return appendix ? `${userPrompt}\n\n${appendix}` : userPrompt;
}

function getLiveInterpretationOpenings(state: ShellState): InterpretationOpening[] {
  return (state.interpretation_openings ?? []).filter((opening) => opening.status === "open");
}

function getRecentRejectedVariants(state: ShellState, limit = 3): RejectedVariant[] {
  const variants = state.rejected_variants ?? [];
  return variants.slice(Math.max(0, variants.length - limit));
}

function formatOpeningSummary(opening: InterpretationOpening): string {
  return `${opening.id} (${opening.label}): ${opening.reading} Changes if selected: ${opening.changes_if_selected} One clarification collapses it: ${opening.collapsible_with_one_clarification ? "yes" : "no"}.`;
}

function formatRejectedVariantSummary(variant: RejectedVariant): string {
  return `${variant.id} (${variant.label}, rejected_by=${variant.rejected_by}): ${variant.summary} Reason: ${variant.reason}.`;
}

function isNonFactualDomainMode(domainMode: Section["domain_mode"] | undefined): boolean {
  return (
    domainMode === "hypothetical" ||
    domainMode === "fictional" ||
    domainMode === "symbolic"
  );
}

function getActiveNonFactualSections(state: ShellState): Section[] {
  return state.sections.filter(
    (section) => section.status === "active" && isNonFactualDomainMode(section.domain_mode),
  );
}

function formatSectionDomainSummary(section: Section): string {
  return `${section.id} (${section.label}, domain_mode=${section.domain_mode ?? "factual"}): ${section.gist}`;
}

function buildPassContextAppendix(
  pass: PassName,
  state: ShellState,
  options?: {
    lastAudit?: AuditResult | undefined;
  },
): string | undefined {
  if (state.version !== "v0.5") {
    return undefined;
  }

  const liveOpenings = getLiveInterpretationOpenings(state).slice(0, 4);
  const rejectedVariants = getRecentRejectedVariants(state);
  const activeNonFactualSections = getActiveNonFactualSections(state).slice(0, 4);
  const lines: string[] = ["V0_5_RUNTIME_CONTEXT:"];

  if (liveOpenings.length > 0) {
    lines.push("LIVE_INTERPRETATION_OPENINGS:");
    for (const opening of liveOpenings) {
      lines.push(`- ${formatOpeningSummary(opening)}`);
    }
  }

  if (rejectedVariants.length > 0) {
    lines.push("REJECTED_VARIANTS_TO_KEEP_REJECTED:");
    for (const variant of rejectedVariants) {
      lines.push(`- ${formatRejectedVariantSummary(variant)}`);
    }
  }

  if (activeNonFactualSections.length > 0) {
    lines.push("ACTIVE_NON_FACTUAL_SECTIONS:");
    for (const section of activeNonFactualSections) {
      lines.push(`- ${formatSectionDomainSummary(section)}`);
    }
  }

  switch (pass) {
    case "state_updater":
      lines.push("STATE_UPDATER_NOTES:");
      lines.push(
        "- Treat interpretive ambiguity as first-class state. Use add_voids for missing facts/referents and add_interpretation_openings for materially different readings.",
      );
      lines.push(
        "- If the user corrects or displaces a prior framing, preserve the displaced framing in add_rejected_variants and prefer a reframe trace.",
      );
      if (activeNonFactualSections.length > 0) {
        lines.push(
          "- When an active section is hypothetical, fictional, or symbolic, invented or underdescribed referents are not voids by default. Use voids only for real blocking constraints.",
        );
      }
      if (options?.lastAudit?.findings.some((finding) => finding.category === "frame_narrowing")) {
        lines.push(
          "- LAST_AUDIT raised frame_narrowing, so prefer reopening or preserving multiple readings rather than narrowing again.",
        );
      }
      break;
    case "negotiator":
      if (liveOpenings.length === 0 && rejectedVariants.length === 0) {
        return undefined;
      }

      lines.push("NEGOTIATOR_NOTES:");
      lines.push(
        "- If multiple live interpretation openings remain, projection_style_recommendation should usually not stay single unless one reading is already licensed.",
      );
      lines.push(
        "- If one clarification could collapse the live openings, clarify is usually preferred; otherwise branched or meta may be safer than premature single projection.",
      );
      break;
    case "project_compiler":
      if (liveOpenings.length === 0 && rejectedVariants.length === 0 && activeNonFactualSections.length === 0) {
        return undefined;
      }

      lines.push("PROJECT_COMPILER_NOTES:");
      lines.push(
        "- Do not silently naturalize a live opening into the only frame. If you commit to one reading, reflect it in frame_commitments and keep the narrowing visible in the answer shape.",
      );
      lines.push(
        "- Do not revive rejected variants as if they were still live or canonical unless the user explicitly reopens them.",
      );
      if (activeNonFactualSections.length > 0) {
        lines.push(
          "- In hypothetical, fictional, or symbolic sections, speculative claims are allowed when they are clearly generated rather than externally verified.",
        );
      }
      break;
    case "auditor":
      if (liveOpenings.length === 0 && rejectedVariants.length === 0) {
        if (activeNonFactualSections.length === 0) {
          return undefined;
        }
      }

      lines.push("AUDITOR_NOTES:");
      lines.push(
        "- Check whether the answer silently selected one live reading, jumped to examples before framing, or revived a rejected variant.",
      );
      if (activeNonFactualSections.length > 0) {
        lines.push(
          "- In non-factual sections, do not treat the absence of an external referent as a factual insufficiency by itself.",
        );
      }
      break;
    default:
      break;
  }

  return lines.length > 1 ? lines.join("\n") : undefined;
}

function chooseInterpretationProjectionStyle(state: ShellState): ProjectionStyle | undefined {
  if (state.version !== "v0.5") {
    return undefined;
  }

  const liveOpenings = getLiveInterpretationOpenings(state);
  if (liveOpenings.length < 2) {
    return undefined;
  }

  if (
    state.contract.budgets.clarification_budget > 0 &&
    liveOpenings.every((opening) => opening.collapsible_with_one_clarification)
  ) {
    return "clarify";
  }

  if (
    state.contract.budgets.branch_budget > 0 &&
    state.contract.exploration_width !== "narrow"
  ) {
    return "branched";
  }

  return state.contract.budgets.meta_projection_allowed ? "meta" : undefined;
}

const PREMISE_PUSHBACK_PATTERNS = [
  /前提/u,
  /assumption/i,
  /premise/i,
  /依存して(?:いる|る)?/u,
  /どこから/u,
  /とも限らない/u,
  /ではなく/u,
  /じゃなく/u,
  /押し返/u,
];

const HIDDEN_PREMISE_PATTERNS = [
  /hidden assumption/i,
  /hidden premise/i,
  /前提/u,
  /assumes?/i,
  /smuggle/i,
  /special premise/i,
  /added complexity/i,
  /addition(?:s)? to the system/i,
  /arrives? as an addition/i,
  /tracking accretion/i,
  /複雑.*追加/u,
  /系への付け足し/u,
  /付け加わ/u,
];

function matchesAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function hasPremisePushback(text: string): boolean {
  return matchesAnyPattern(text, PREMISE_PUSHBACK_PATTERNS);
}

function hasHiddenPremiseLanguage(text: string): boolean {
  return matchesAnyPattern(text, HIDDEN_PREMISE_PATTERNS);
}

function summarizeRejectedFrame(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

function nextRejectedVariantId(prevState: ShellState, delta: StateDelta): string {
  const ids = [
    ...(prevState.rejected_variants ?? []).map((variant) => variant.id),
    ...((delta.add_rejected_variants ?? []).map((variant) => variant.id) ?? []),
  ];
  const maxNumeric = ids.reduce((max, id) => {
    const match = /^R(\d+)$/.exec(id);
    if (!match) {
      return max;
    }

    const value = Number(match[1]);
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0);

  return `R${maxNumeric + 1}`;
}

function collectHiddenPremiseSectionIds(prevState: ShellState, delta: StateDelta): string[] {
  const touchedIds = new Set<string>();

  for (const section of delta.add_sections) {
    const sectionText = [
      section.label,
      section.gist,
      ...section.projection_signature.mandatory_exposures,
    ].join(" ");
    if (hasHiddenPremiseLanguage(sectionText)) {
      touchedIds.add(section.id);
    }
  }

  for (const patch of delta.update_sections) {
    const baseSection = prevState.sections.find((section) => section.id === patch.id);
    const patchText = [
      patch.label,
      patch.gist,
      ...(patch.projection_signature?.mandatory_exposures ?? []),
      baseSection?.label,
      baseSection?.gist,
      ...(baseSection?.projection_signature.mandatory_exposures ?? []),
    ]
      .filter((value): value is string => typeof value === "string")
      .join(" ");

    if (hasHiddenPremiseLanguage(patchText)) {
      touchedIds.add(patch.id);
    }
  }

  if (touchedIds.size > 0) {
    return [...touchedIds];
  }

  return prevState.sections
    .filter((section) => {
      const sectionText = [
        section.label,
        section.gist,
        ...section.projection_signature.mandatory_exposures,
      ].join(" ");
      return hasHiddenPremiseLanguage(sectionText);
    })
    .map((section) => section.id)
    .slice(-2);
}

function stateAlreadyCarriesHiddenPremiseDispute(prevState: ShellState): boolean {
  const recentTraceCauses = prevState.traces.slice(-6).map((trace) => trace.cause).join(" ");
  const sectionText = prevState.sections
    .map((section) => [section.label, section.gist, ...section.projection_signature.mandatory_exposures].join(" "))
    .join(" ");

  return hasHiddenPremiseLanguage(`${recentTraceCauses} ${sectionText}`);
}

function promoteRepeatedPremisePushbackToRejectedVariant(
  prevState: ShellState,
  userTurn: string,
  delta: StateDelta,
): StateDelta {
  if (delta.version !== "v0.5") {
    return delta;
  }

  if (!hasPremisePushback(userTurn)) {
    return delta;
  }

  if (!stateAlreadyCarriesHiddenPremiseDispute(prevState)) {
    return delta;
  }

  const existingRejectedVariant = [...(prevState.rejected_variants ?? []), ...(delta.add_rejected_variants ?? [])]
    .some((variant) => hasHiddenPremiseLanguage([variant.label, variant.summary, variant.reason].join(" ")));
  if (existingRejectedVariant) {
    return delta;
  }

  const derivedFrom = collectHiddenPremiseSectionIds(prevState, delta);
  if (derivedFrom.length === 0) {
    return delta;
  }

  const primarySection = prevState.sections.find((section) => section.id === derivedFrom[0]);
  const summarySource = primarySection?.gist ?? "A prior framing kept resurfacing a hidden premise instead of leaving it as critique residue.";
  const rejectedVariantId = nextRejectedVariantId(prevState, delta);
  const rejectedVariant: RejectedVariant = {
    id: rejectedVariantId,
    kind: "interpretation_frame",
    label: "hidden-premise-frame",
    summary: summarizeRejectedFrame(summarySource),
    derived_from: derivedFrom,
    rejected_by: "user",
    reason:
      "The user pushed back again on a hidden premise already present in state, so this framing should remain as rejected residue instead of resurfacing as the active lens.",
    superseded_by: (delta.add_interpretation_openings ?? []).map((opening) => opening.id),
    turn: delta.turn,
  };
  const heuristicTrace: Trace = {
    id: `T-REJECT-HIDDEN-PREMISE-${delta.turn}`,
    action: "reframe",
    targets: [...derivedFrom, rejectedVariantId],
    cause:
      "Repeated user pushback on a hidden premise promoted that framing into rejected residue rather than leaving it as an implicitly reusable live frame.",
    turn: delta.turn,
  };

  return {
    ...delta,
    add_rejected_variants: [...(delta.add_rejected_variants ?? []), rejectedVariant],
    traces: delta.traces.some((trace) => trace.id === heuristicTrace.id)
      ? delta.traces
      : [...delta.traces, heuristicTrace],
  };
}

function getSectionPatchMap(delta: StateDelta): Map<string, SectionPatch> {
  return new Map(delta.update_sections.map((patch) => [patch.id, patch]));
}

function hasActiveNonFactualSectionAfterDelta(prevState: ShellState, delta: StateDelta): boolean {
  if (
    delta.add_sections.some(
      (section) => section.status === "active" && isNonFactualDomainMode(section.domain_mode),
    )
  ) {
    return true;
  }

  const patchMap = getSectionPatchMap(delta);
  return prevState.sections.some((section) => {
    const patch = patchMap.get(section.id);
    const nextStatus = patch?.status ?? section.status;
    const nextDomainMode = patch?.domain_mode ?? section.domain_mode;
    return nextStatus === "active" && isNonFactualDomainMode(nextDomainMode);
  });
}

function isCreativeDomainContentVoid(entry: Void): boolean {
  const normalizedBlocks = entry.unresolved_blocks.map((block) => block.trim().toLowerCase());
  if (normalizedBlocks.length === 0) {
    return false;
  }

  return normalizedBlocks.every(
    (block) =>
      block === "content generation" ||
      block === "content claims" ||
      block === "generated content",
  );
}

function suppressCreativeDomainContentVoids(prevState: ShellState, delta: StateDelta): StateDelta {
  if (delta.version !== "v0.5" || !hasActiveNonFactualSectionAfterDelta(prevState, delta)) {
    return delta;
  }

  const nextVoids = delta.add_voids.filter((entry) => !isCreativeDomainContentVoid(entry));
  if (nextVoids.length === delta.add_voids.length) {
    return delta;
  }

  return {
    ...delta,
    add_voids: nextVoids,
  };
}

export function applyStateDelta(prevState: ShellState, delta: StateDelta): ShellState {
  const nextState = cloneState(prevState);

  nextState.turn = delta.turn;
  nextState.version = delta.version;
  nextState.contract = applyContractPatch(nextState.contract, delta.contract_patch);
  nextState.anchors = appendUniqueById(nextState.anchors, delta.add_anchors, "anchor");
  nextState.anchors = nextState.anchors.map((anchor) => {
    const update = delta.update_anchor_status.find((entry) => entry.id === anchor.id);
    const exposureUpdate = (delta.update_anchor_exposure ?? []).find(
      (entry) => entry.id === anchor.id,
    );
    return update
      ? {
          ...anchor,
          status: update.status,
          ...(exposureUpdate ? { exposure_policy: exposureUpdate.exposure_policy } : {}),
        }
      : exposureUpdate
        ? {
            ...anchor,
            exposure_policy: exposureUpdate.exposure_policy,
          }
        : anchor;
  });
  nextState.sections = appendUniqueById(nextState.sections, delta.add_sections, "section");
  nextState.sections = mergeById<Section, SectionPatch>(nextState.sections, delta.update_sections);
  nextState.interpretation_openings = appendUniqueById(
    nextState.interpretation_openings ?? [],
    delta.add_interpretation_openings ?? [],
    "interpretation opening",
  );
  nextState.interpretation_openings = nextState.interpretation_openings.map((opening) => {
    const patch = (delta.update_interpretation_openings ?? []).find(
      (entry) => entry.id === opening.id,
    );
    if (!patch) {
      return opening;
    }

    const { reason: _reason, ...openingPatch } = patch;
    return {
      ...opening,
      ...openingPatch,
    };
  });
  nextState.rejected_variants = appendUniqueById(
    nextState.rejected_variants ?? [],
    delta.add_rejected_variants ?? [],
    "rejected variant",
  );
  nextState.voids = appendUniqueById(nextState.voids, delta.add_voids, "void");
  nextState.voids = resolveVoids(nextState.voids, delta.resolve_voids);
  nextState.obstructions = appendUniqueById(
    nextState.obstructions,
    delta.add_obstructions,
    "obstruction",
  );
  nextState.obstructions = clearObstructions(nextState.obstructions, delta.clear_obstructions);
  nextState.negotiations = appendUniqueById(
    nextState.negotiations,
    delta.add_negotiations,
    "negotiation",
  );
  nextState.negotiations = applyNegotiationPatches(
    nextState.negotiations,
    delta.update_negotiations,
  );
  nextState.traces = [...nextState.traces, ...delta.traces];

  return nextState;
}

interface PassExecution<T> {
  log: PassLog;
  value: T;
}

interface PreparedPass {
  input: Record<string, unknown>;
  pass: PassName;
  schemaName: SchemaName;
  schemaVersion: SchemaVersion;
  systemPrompt: string;
  turn: number;
  userPrompt: string;
}

interface FailureContext {
  artifactStore: ArtifactStore | undefined;
  provider: JsonProvider;
  userTurn: string;
}

function buildCompilerRetryUserPrompt(basePrompt: string, audit: AuditResult): string {
  return `${basePrompt}\n\nLAST_AUDIT_JSON:\n${stableJson(audit)}`;
}

export class PassValidationRuntimeError
  extends Error
  implements PassValidationRuntimeErrorLike
{
  public readonly debugFallbackAnswer: string | undefined;

  public readonly failureArtifactDirectory: string | undefined;

  public readonly pass: PassName;

  public readonly schemaName: SchemaName;

  public readonly validationError: string;

  public constructor(options: {
    cause: unknown | undefined;
    debugFallbackAnswer: string | undefined;
    failureArtifactDirectory: string | undefined;
    message: string;
    pass: PassName;
    schemaName: SchemaName;
    validationError: string;
  }) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "PassValidationRuntimeError";
    this.debugFallbackAnswer = options.debugFallbackAnswer;
    this.failureArtifactDirectory = options.failureArtifactDirectory;
    this.pass = options.pass;
    this.schemaName = options.schemaName;
    this.validationError = options.validationError;
  }
}

export class RoughShellRuntime {
  private readonly prompts: PromptSet;

  private readonly schemaRegistry: SchemaRegistry;

  public constructor(options?: {
    promptSet?: PromptSet;
    schemaRegistry?: SchemaRegistry;
  }) {
    this.schemaRegistry = options?.schemaRegistry ?? new SchemaRegistry();
    this.prompts = options?.promptSet ?? loadPromptSet(this.schemaRegistry.getRepositoryRoot());
  }

  public getSchemaRegistry(): SchemaRegistry {
    return this.schemaRegistry;
  }

  public async runTurn(options: RunTurnOptions): Promise<RunTurnResult> {
    const stateBefore = cloneState(options.prevState);
    const turn = stateBefore.turn + 1;
    const passLogs: PassLog[] = [];
    const maxValidationAttempts = options.maxValidationAttempts ?? 2;
    const maxCompilerRetries = options.maxCompilerRetries ?? 1;

    const stateUpdater = this.prepareStateUpdaterPass(
      turn,
      stateBefore,
      options.userTurn,
      options.sourceSnippets,
      options.lastAudit,
    );
    const stateDeltaExecution = await this.executePass<StateDelta>(
      options.provider,
      stateUpdater,
      1,
      maxValidationAttempts,
      {
        artifactStore: options.artifactStore,
        provider: options.provider,
        userTurn: options.userTurn,
      },
    );
    const postProcessedStateDeltaExecution = this.postProcessStateDeltaExecution(
      stateBefore,
      options.userTurn,
      stateDeltaExecution,
    );
    passLogs.push(postProcessedStateDeltaExecution.log);

    const stateAfterDelta = applyStateDelta(stateBefore, postProcessedStateDeltaExecution.value);

    const negotiator = this.prepareNegotiatorPass(turn, stateAfterDelta);
    const negotiationExecution = await this.executePass<NegotiationResult>(
      options.provider,
      negotiator,
      1,
      maxValidationAttempts,
      {
        artifactStore: options.artifactStore,
        provider: options.provider,
        userTurn: options.userTurn,
      },
    );
    const postProcessedNegotiationExecution = this.postProcessNegotiationExecution(
      stateAfterDelta,
      negotiationExecution,
    );
    passLogs.push(postProcessedNegotiationExecution.log);

    const projectCompiler = this.prepareProjectCompilerPass(
      turn,
      stateAfterDelta,
      postProcessedNegotiationExecution.value,
      options.userTurn,
      options.sourceSnippets,
    );
    let projectionExecution = await this.executePass<ProjectionOutput>(
      options.provider,
      projectCompiler,
      1,
      maxValidationAttempts,
      {
        artifactStore: options.artifactStore,
        provider: options.provider,
        userTurn: options.userTurn,
      },
    );
    passLogs.push(projectionExecution.log);

    const auditor = this.prepareAuditorPass(
      turn,
      stateAfterDelta,
      postProcessedNegotiationExecution.value,
      projectionExecution.value,
    );
    let auditExecution = await this.executePass<AuditResult>(
      options.provider,
      auditor,
      1,
      maxValidationAttempts,
      {
        artifactStore: options.artifactStore,
        provider: options.provider,
        userTurn: options.userTurn,
      },
    );
    auditExecution = this.postProcessAuditExecution(
      stateAfterDelta,
      projectionExecution.value,
      auditExecution,
    );
    passLogs.push(auditExecution.log);

    if (auditExecution.value.verdict === "revise" && maxCompilerRetries > 0) {
      const retriedCompiler = {
        ...projectCompiler,
        userPrompt: buildCompilerRetryUserPrompt(projectCompiler.userPrompt, auditExecution.value),
      };
      projectionExecution = await this.executePass<ProjectionOutput>(
        options.provider,
        retriedCompiler,
        2,
        maxValidationAttempts,
        {
          artifactStore: options.artifactStore,
          provider: options.provider,
          userTurn: options.userTurn,
        },
      );
      passLogs.push(projectionExecution.log);

      const retriedAuditor = this.prepareAuditorPass(
        turn,
        stateAfterDelta,
        postProcessedNegotiationExecution.value,
        projectionExecution.value,
      );
      auditExecution = await this.executePass<AuditResult>(
        options.provider,
        retriedAuditor,
        2,
        maxValidationAttempts,
        {
          artifactStore: options.artifactStore,
          provider: options.provider,
          userTurn: options.userTurn,
        },
      );
      auditExecution = this.postProcessAuditExecution(
        stateAfterDelta,
        projectionExecution.value,
        auditExecution,
      );
      passLogs.push(auditExecution.log);
    }

    let finalState = applyNegotiationResult(stateAfterDelta, postProcessedNegotiationExecution.value);
    if (
      passLogs.some((log) => log.pass === "project_compiler" && log.sequence > 1)
    ) {
      const rewriteTrace: Trace = {
        id: `T-AUDIT-REWRITE-${turn}`,
        action: "audit_rewrite",
        targets: [],
        cause: "Compiler retried after audit requested a revision.",
        turn,
      };
      finalState = {
        ...finalState,
        traces: [...finalState.traces, rewriteTrace],
      };
    }

    const artifacts: TurnArtifacts = {
      artifact_version: 1,
      created_at: new Date().toISOString(),
      final_answer: projectionExecution.value.answer,
      final_state: finalState,
      negotiation: postProcessedNegotiationExecution.value,
      projection: projectionExecution.value,
      provider: {
        name: options.provider.name,
        ...(options.provider.model ? { model: options.provider.model } : {}),
      },
      state_after_delta: stateAfterDelta,
      state_before: stateBefore,
      state_delta: postProcessedStateDeltaExecution.value,
      turn,
      user_turn: options.userTurn,
      audit: auditExecution.value,
      pass_logs: passLogs,
    };

    const artifactDirectory = options.artifactStore
      ? await options.artifactStore.recordTurn(artifacts)
      : undefined;

    return {
      ...(artifactDirectory ? { artifactDirectory } : {}),
      artifacts,
      audit: auditExecution.value,
      finalAnswer: projectionExecution.value.answer,
      negotiation: postProcessedNegotiationExecution.value,
      projection: projectionExecution.value,
      state: finalState,
    };
  }

  private postProcessStateDeltaExecution(
    prevState: ShellState,
    userTurn: string,
    execution: PassExecution<StateDelta>,
  ): PassExecution<StateDelta> {
    const nextValue = suppressCreativeDomainContentVoids(
      prevState,
      promoteRepeatedPremisePushbackToRejectedVariant(prevState, userTurn, execution.value),
    );
    return nextValue === execution.value
      ? execution
      : {
          ...execution,
          log: {
            ...execution.log,
            validatedResponse: nextValue,
          },
          value: nextValue,
        };
  }

  private async executePass<T>(
    provider: JsonProvider,
    prepared: PreparedPass,
    sequence: number,
    maxValidationAttempts: number,
    failureContext: FailureContext,
  ): Promise<PassExecution<T>> {
    const attempts: PassLog["attempts"] = [];
    let currentUserPrompt = appendProviderHint(
      provider,
      prepared.pass,
      prepared.schemaVersion,
      appendPromptSupplement(prepared.pass, prepared.schemaVersion, prepared.userPrompt),
    );
    let validatedResponse: T | undefined;

    for (let attempt = 1; attempt <= maxValidationAttempts; attempt += 1) {
      const rawResponse = await provider.generateJson({
        attempt,
        input: prepared.input,
        pass: prepared.pass,
        schema: this.schemaRegistry.getProviderSchema(prepared.schemaName),
        schemaName: prepared.schemaName,
        systemPrompt: prepared.systemPrompt,
        turn: prepared.turn,
        userPrompt: currentUserPrompt,
      });
      const normalizedResponse = normalizeProviderResponse(
        provider,
        prepared.pass,
        rawResponse,
        prepared.input,
      );

      try {
        validatedResponse = this.schemaRegistry.validate<T>(prepared.schemaName, normalizedResponse);
        attempts.push({
          attempt,
          rawResponse,
        });
        break;
      } catch (error) {
        const validationError =
          error instanceof SchemaValidationError ? error.message : String(error);

        attempts.push({
          attempt,
          rawResponse,
          validationError,
        });

        if (attempt === maxValidationAttempts) {
          const debugFallbackAnswer = extractDebugFallbackAnswer(
            prepared.pass,
            rawResponse,
            prepared.input,
          );
          const failureArtifactDirectory = await this.recordFailureArtifact(
            attempts,
            debugFallbackAnswer,
            failureContext,
            prepared,
            sequence,
            validationError,
          );

          const message = failureArtifactDirectory
            ? `${validationError}\nFailure artifact saved to: ${failureArtifactDirectory}`
            : validationError;

          throw new PassValidationRuntimeError({
            cause: error,
            debugFallbackAnswer,
            failureArtifactDirectory,
            message,
            pass: prepared.pass,
            schemaName: prepared.schemaName,
            validationError,
          });
        }

        currentUserPrompt = [
          appendProviderHint(
            provider,
            prepared.pass,
            prepared.schemaVersion,
            appendPromptSupplement(prepared.pass, prepared.schemaVersion, prepared.userPrompt),
          ),
          "",
          "LAST_INVALID_JSON:",
          stableJson(rawResponse),
          "",
          "VALIDATION_ERROR:",
          validationError,
          "",
          `Return ONLY corrected JSON that matches ${prepared.schemaName}.`,
          "Preserve any already-valid fields unless the validation error requires changing them.",
          "Do not add commentary. Do not add extra properties.",
        ].join("\n");
      }
    }

    if (validatedResponse === undefined) {
      throw new Error(`Pass ${prepared.pass} did not return a validated response.`);
    }

    return {
      log: {
        pass: prepared.pass,
        sequence,
        schemaName: prepared.schemaName,
        systemPrompt: prepared.systemPrompt,
        userPrompt: prepared.userPrompt,
        attempts,
        validatedResponse,
      },
      value: validatedResponse,
    };
  }

  private async recordFailureArtifact(
    attempts: PassLog["attempts"],
    debugFallbackAnswer: string | undefined,
    failureContext: FailureContext,
    prepared: PreparedPass,
    sequence: number,
    validationError: string,
  ): Promise<string | undefined> {
    if (!failureContext.artifactStore?.recordFailure) {
      return undefined;
    }

    const failureArtifacts: FailedPassArtifacts = {
      artifact_version: 1,
      attempts,
      created_at: new Date().toISOString(),
      ...(debugFallbackAnswer ? { debug_fallback_answer: debugFallbackAnswer } : {}),
      final_validation_error: validationError,
      input: prepared.input,
      pass: prepared.pass,
      provider: {
        name: failureContext.provider.name,
        ...(failureContext.provider.model ? { model: failureContext.provider.model } : {}),
      },
      schemaName: prepared.schemaName,
      sequence,
      systemPrompt: prepared.systemPrompt,
      turn: prepared.turn,
      userPrompt: prepared.userPrompt,
      user_turn: failureContext.userTurn,
    };

    return failureContext.artifactStore.recordFailure(failureArtifacts);
  }

  private postProcessAuditExecution(
    currentState: ShellState,
    projectionOutput: ProjectionOutput,
    execution: PassExecution<AuditResult>,
  ): PassExecution<AuditResult> {
    const nextValue = applyAuditHeuristics(currentState, projectionOutput, execution.value);
    return nextValue === execution.value
      ? execution
      : {
          ...execution,
          log: {
            ...execution.log,
            validatedResponse: nextValue,
          },
          value: nextValue,
        };
  }

  private postProcessNegotiationExecution(
    currentState: ShellState,
    execution: PassExecution<NegotiationResult>,
  ): PassExecution<NegotiationResult> {
    const suggestedStyle = chooseInterpretationProjectionStyle(currentState);
    const liveOpenings = getLiveInterpretationOpenings(currentState);

    if (
      currentState.version !== "v0.5" ||
      suggestedStyle === undefined ||
      liveOpenings.length < 2 ||
      execution.value.decisions.length > 0 ||
      (execution.value.projection_style_recommendation !== "auto" &&
        execution.value.projection_style_recommendation !== "single")
    ) {
      return execution;
    }

    const reason = `Multiple live interpretation openings remain (${liveOpenings
      .map((opening) => opening.id)
      .join(", ")}), so projecting a single frame would narrow the answer too early. ${suggestedStyle === "clarify"
      ? "One clarification could collapse the live readings."
      : suggestedStyle === "branched"
        ? "More than one framing remains materially worth preserving."
        : "A meta-level response is safer than silently selecting one frame."}`;
    const heuristicTrace: Trace = {
      id: `T-NEGOTIATION-HEURISTIC-${execution.value.turn}`,
      action: "negotiate",
      targets: liveOpenings.map((opening) => opening.id),
      cause: reason,
      turn: execution.value.turn,
    };
    const nextValue: NegotiationResult = {
      ...execution.value,
      projection_style_recommendation: suggestedStyle,
      global_reason: `${execution.value.global_reason} ${reason}`.trim(),
      traces: [...execution.value.traces, heuristicTrace],
    };

    return {
      ...execution,
      log: {
        ...execution.log,
        validatedResponse: nextValue,
      },
      value: nextValue,
    };
  }

  private prepareStateUpdaterPass(
    turn: number,
    prevState: ShellState,
    userTurn: string,
    sourceSnippets?: unknown,
    lastAudit?: AuditResult,
  ): PreparedPass {
    const template = this.prompts.state_updater;
    const schemaVersion = prevState.version;

    return {
      input: {
        last_audit: lastAudit ?? null,
        prev_state: prevState,
        source_snippets: sourceSnippets ?? [],
        user_turn: userTurn,
      },
      pass: "state_updater",
      schemaName: this.schemaRegistry.getSchemaName(schemaVersion, "state_delta"),
      schemaVersion,
      systemPrompt: template.systemPrompt,
      turn,
      userPrompt: appendPromptAppendix(
        renderUserPrompt(template.userPromptTemplate, {
          LAST_AUDIT_JSON: stableJson(lastAudit ?? null),
          PREV_STATE_JSON: stableJson(prevState),
          SOURCE_SNIPPETS_JSON: stableJson(sourceSnippets ?? []),
          USER_TURN: userTurn,
        }),
        buildPassContextAppendix("state_updater", prevState, { lastAudit }),
      ),
    };
  }

  private prepareNegotiatorPass(turn: number, currentState: ShellState): PreparedPass {
    const template = this.prompts.negotiator;
    const schemaVersion = currentState.version;

    return {
      input: {
        current_state: currentState,
      },
      pass: "negotiator",
      schemaName: this.schemaRegistry.getSchemaName(schemaVersion, "negotiation_result"),
      schemaVersion,
      systemPrompt: template.systemPrompt,
      turn,
      userPrompt: appendPromptAppendix(
        renderUserPrompt(template.userPromptTemplate, {
          CURRENT_STATE_JSON: stableJson(currentState),
        }),
        buildPassContextAppendix("negotiator", currentState),
      ),
    };
  }

  private prepareProjectCompilerPass(
    turn: number,
    currentState: ShellState,
    negotiationResult: NegotiationResult,
    userTurn: string,
    sourceSnippets?: unknown,
  ): PreparedPass {
    const template = this.prompts.project_compiler;
    const schemaVersion = currentState.version;

    return {
      input: {
        current_state: currentState,
        negotiation_result: negotiationResult,
        source_snippets: sourceSnippets ?? [],
        user_turn: userTurn,
      },
      pass: "project_compiler",
      schemaName: this.schemaRegistry.getSchemaName(schemaVersion, "projection_output"),
      schemaVersion,
      systemPrompt: template.systemPrompt,
      turn,
      userPrompt: appendPromptAppendix(
        renderUserPrompt(template.userPromptTemplate, {
          CURRENT_STATE_JSON: stableJson(currentState),
          NEGOTIATION_RESULT_JSON: stableJson(negotiationResult),
          SOURCE_SNIPPETS_JSON: stableJson(sourceSnippets ?? []),
          USER_TURN: userTurn,
        }),
        buildPassContextAppendix("project_compiler", currentState),
      ),
    };
  }

  private prepareAuditorPass(
    turn: number,
    currentState: ShellState,
    negotiationResult: NegotiationResult,
    projectionOutput: ProjectionOutput,
  ): PreparedPass {
    const template = this.prompts.auditor;
    const schemaVersion = currentState.version;

    return {
      input: {
        current_state: currentState,
        negotiation_result: negotiationResult,
        projection_output: projectionOutput,
      },
      pass: "auditor",
      schemaName: this.schemaRegistry.getSchemaName(schemaVersion, "audit_result"),
      schemaVersion,
      systemPrompt: template.systemPrompt,
      turn,
      userPrompt: appendPromptAppendix(
        renderUserPrompt(template.userPromptTemplate, {
          CURRENT_STATE_JSON: stableJson(currentState),
          NEGOTIATION_RESULT_JSON: stableJson(negotiationResult),
          PROJECTION_OUTPUT_JSON: stableJson(projectionOutput),
        }),
        buildPassContextAppendix("auditor", currentState),
      ),
    };
  }
}

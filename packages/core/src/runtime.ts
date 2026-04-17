import { applyAuditHeuristics } from "./audit-heuristics.js";
import { extractDebugFallbackAnswer } from "./debug-fallback.js";
import { normalizeProviderResponse } from "./provider-normalization.js";
import { appendPromptSupplement } from "./prompt-supplements.js";
import { loadPromptSet, renderUserPrompt } from "./prompts.js";
import { appendProviderHint } from "./provider-hints.js";
import { applyNegotiationResult, applyStateDelta } from "./runtime-state.js";
import {
  isNonFactualDomainMode,
  postProcessStateDelta,
} from "./runtime-state-delta.js";
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
  LastTurnContext,
  PassLog,
  PassName,
  ProjectionSignature,
  ProjectionStyle,
  ProjectionOutput,
  PromptSet,
  ReferentBinding,
  ReferentBindingPatch,
  RejectedVariant,
  RunTurnOptions,
  RunTurnResult,
  SchemaName,
  SchemaVersion,
  Section,
  SectionPatch,
  ShellState,
  StateDelta,
  TermProvenance,
  TermProvenancePatch,
  Trace,
  TurnArtifacts,
  Void,
  VoidPatch,
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

function getRecentTermProvenances(state: ShellState, limit = 4): TermProvenance[] {
  const provenances = state.term_provenances ?? [];
  return provenances.slice(Math.max(0, provenances.length - limit));
}

function getActiveReferentBindings(state: ShellState, limit = 4): ReferentBinding[] {
  return (state.referent_bindings ?? [])
    .filter((binding) => binding.status === "active" || binding.status === "tentative")
    .slice(0, limit);
}

function formatOpeningSummary(opening: InterpretationOpening): string {
  return `${opening.id} (${opening.label}): ${opening.reading} Changes if selected: ${opening.changes_if_selected} One clarification collapses it: ${opening.collapsible_with_one_clarification ? "yes" : "no"}.`;
}

function formatRejectedVariantSummary(variant: RejectedVariant): string {
  return `${variant.id} (${variant.label}, rejected_by=${variant.rejected_by}): ${variant.summary} Reason: ${variant.reason}.`;
}

function formatTermProvenanceSummary(provenance: TermProvenance): string {
  return `${provenance.id} (${provenance.term}, origin=${provenance.origin}, confidence=${provenance.confidence}): ${provenance.evidence}`;
}

function formatReferentBindingSummary(binding: ReferentBinding): string {
  return `${binding.id} (${binding.surface} -> ${binding.refers_to}, kind=${binding.kind}, status=${binding.status}, confidence=${binding.confidence}): ${binding.evidence}`;
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
  const recentTermProvenances = getRecentTermProvenances(state);
  const activeReferentBindings = getActiveReferentBindings(state);
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

  if (recentTermProvenances.length > 0) {
    lines.push("RECENT_TERM_PROVENANCES:");
    for (const provenance of recentTermProvenances) {
      lines.push(`- ${formatTermProvenanceSummary(provenance)}`);
    }
  }

  if (activeReferentBindings.length > 0) {
    lines.push("ACTIVE_REFERENT_BINDINGS:");
    for (const binding of activeReferentBindings) {
      lines.push(`- ${formatReferentBindingSummary(binding)}`);
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
        "- Use term_provenances for conversation-local coined labels or phrases whose origin matters later, and referent_bindings for handles like 'system', 'that term', or omitted Japanese subjects.",
      );
      lines.push(
        "- If the user corrects or displaces a prior framing, preserve the displaced framing in add_rejected_variants and prefer a reframe trace.",
      );
      lines.push(
        "- If a dependency is already tracked as a void, prefer updating or reopening that same void instead of creating a duplicate with a new id.",
      );
      lines.push(
        "- If the user asks what kind of examples or what a just-mentioned option means, treat that as repair on the assistant's immediately prior option rather than as a request to repeat the same clarification.",
      );
      lines.push(
        "- If the user says either is fine or delegates the choice back, collapse that clarification opening so the next answer can proceed.",
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
      lines.push(
        "- If the answer substantially repeats the previous turn's clarification without new thread-level progress, that should not pass.",
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
  const retryNotes: string[] = [];
  if (
    audit.findings.some((finding) => finding.id.startsWith("F-HEURISTIC-CLARIFICATION-CASHOUT-"))
  ) {
    retryNotes.push(
      "- LAST_AUDIT says the previous answer only acknowledged a newly resolved framing choice. On retry, use that now-licensed frame to answer the user's underlying question in the same turn.",
    );
  }
  if (
    audit.projection_style_recommendation === "clarify" &&
    audit.findings.some((finding) => finding.category === "negotiation_fidelity")
  ) {
    retryNotes.push(
      "- LAST_AUDIT says the previous answer responded substantively even though clarification was still the recommended style. On retry, ask the clarifying question directly instead of answering through it.",
    );
  }
  if (
    audit.findings.some((finding) => finding.id.startsWith("F-HEURISTIC-CLARIFICATION-LOOP-"))
  ) {
    retryNotes.push(
      "- LAST_AUDIT says the previous answer substantially repeated an earlier clarification. On retry, do not ask the same clarification again; if no live opening still blocks projection, cash the answer out directly.",
    );
  }

  return retryNotes.length > 0
    ? `${basePrompt}\n\nCOMPILER_RETRY_NOTES:\n${retryNotes.join("\n")}\n\nLAST_AUDIT_JSON:\n${stableJson(audit)}`
    : `${basePrompt}\n\nLAST_AUDIT_JSON:\n${stableJson(audit)}`;
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
      options.lastTurn,
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
      options.lastTurn,
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
      options.lastTurn,
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
        options.lastTurn,
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
    lastTurn?: LastTurnContext,
  ): PassExecution<StateDelta> {
    const nextValue = postProcessStateDelta(prevState, userTurn, execution.value, lastTurn);
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
    lastTurn?: LastTurnContext,
  ): PassExecution<AuditResult> {
    const nextValue = applyAuditHeuristics(currentState, projectionOutput, execution.value, lastTurn);
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
    const liveOpenings = getLiveInterpretationOpenings(currentState);
    const hasUnresolvedDependency =
      currentState.voids.some((entry) => entry.status !== "resolved") ||
      currentState.obstructions.length > 0;

    if (
      currentState.version === "v0.5" &&
      liveOpenings.length === 0 &&
      execution.value.decisions.length === 0 &&
      execution.value.projection_style_recommendation === "clarify" &&
      !hasUnresolvedDependency
    ) {
      const reason =
        "No live interpretation openings or unresolved blocking dependencies remain, so clarification is no longer the licensed projection style.";
      const heuristicTrace: Trace = {
        id: `T-NEGOTIATION-CLARIFY-RESET-${execution.value.turn}`,
        action: "negotiate",
        targets: [],
        cause: reason,
        turn: execution.value.turn,
      };
      const nextValue: NegotiationResult = {
        ...execution.value,
        projection_style_recommendation: "single",
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

    const suggestedStyle = chooseInterpretationProjectionStyle(currentState);

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
    lastTurn?: LastTurnContext,
  ): PreparedPass {
    const template = this.prompts.state_updater;
    const schemaVersion = prevState.version;

    return {
      input: {
        last_audit: lastAudit ?? null,
        last_turn: lastTurn ?? null,
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
        appendPromptAppendix(
          renderUserPrompt(template.userPromptTemplate, {
            LAST_AUDIT_JSON: stableJson(lastAudit ?? null),
            PREV_STATE_JSON: stableJson(prevState),
            SOURCE_SNIPPETS_JSON: stableJson(sourceSnippets ?? []),
            USER_TURN: userTurn,
          }),
          buildPassContextAppendix("state_updater", prevState, { lastAudit }),
        ),
        lastTurn ? `LAST_TURN_CONTEXT_JSON:\n${stableJson(lastTurn)}` : undefined,
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

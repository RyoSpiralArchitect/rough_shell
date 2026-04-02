export type JsonPrimitive = boolean | null | number | string;

export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonValue = JsonObject | JsonPrimitive | JsonValue[];

export type Audience = "unknown" | "general" | "expert" | "mixed";
export type Stakes = "low" | "medium" | "high" | "critical";
export type Level3 = "low" | "medium" | "high";
export type Priority = "low" | "medium" | "high" | "critical";
export type SchemaVersion = "v0.5";
export type SchemaKind =
  | "shell_state"
  | "state_delta"
  | "negotiation_result"
  | "projection_output"
  | "audit_result";
export type ProjectionStyle = "auto" | "single" | "branched" | "meta" | "clarify";
export type Warrant =
  | "local_inference"
  | "user_asserted"
  | "source_observed"
  | "externally_verified";
export type AnchorKind = "veto" | "constraint" | "preference";
export type AnchorScope = "global" | "turn" | "local";
export type AnchorStatus = "active" | "inactive" | "relaxed";
export type SectionStatus = "active" | "latent" | "frozen" | "retired";
export type VoidEffect =
  | "changes_entire_content"
  | "changes_content_selection"
  | "changes_risk_boundary"
  | "changes_tone"
  | "changes_ordering"
  | "changes_evaluation_boundary";
export type EffectScope = "local" | "global";
export type CouplingMode = "none" | "joint" | "gated_by" | "parent_of";
export type VoidStatus = "open" | "parked" | "resolved";
export type ObstructionType =
  | "semantic_split"
  | "goal_tension"
  | "evidence_gap"
  | "value_conflict"
  | "time_conflict"
  | "anchor_conflict";
export type ExposureOperator =
  | "premise_disclosure"
  | "scope_boundary"
  | "withheld_alternative"
  | "tradeoff_note"
  | "branched_projection";
export type ObstructionStatus = "active" | "cleared";
export type TraceAction =
  | "anchor_add"
  | "anchor_relax"
  | "fork"
  | "suspend"
  | "obstruct"
  | "revive"
  | "resolve"
  | "retire"
  | "project"
  | "contract_shift"
  | "negotiate"
  | "audit_rewrite"
  | "reframe";
export type ClaimKind =
  | "descriptive"
  | "causal"
  | "comparative"
  | "normative"
  | "procedural"
  | "meta"
  | "speculative";
export type DomainMode = "factual" | "hypothetical" | "fictional" | "symbolic";
export type LeakageType =
  | "false_completeness"
  | "causal_overreach"
  | "audience_misfit"
  | "boundary_breach"
  | "false_finality"
  | "false_consensus";
export type ScarScope = "claim" | "sentence" | "block" | "answer";
export type FindingCategory =
  | "provenance"
  | "bridge"
  | "implicature"
  | "scope_coverage"
  | "negotiation_fidelity"
  | "unsupported_claim"
  | "scar_underexposure"
  | "scar_overexposure"
  | "frame_narrowing";
export type FixAction =
  | "add_scar"
  | "drop_claim"
  | "shrink_claim"
  | "rebundle_scars"
  | "switch_projection_style"
  | "add_tradeoff_note"
  | "rewrite";
export type Verdict = "pass" | "revise" | "block";

export type PassName = "state_updater" | "negotiator" | "project_compiler" | "auditor";
export type SchemaName =
  | "shell_state.schema.json"
  | "state_delta.schema.json"
  | "negotiation_result.schema.json"
  | "projection_output.schema.json"
  | "audit_result.schema.json";
export type AnchorExposurePolicy = "latent" | "expose_if_touched" | "always_expose";
export type InterpretationOpeningStatus = "open" | "selected" | "collapsed" | "rejected";
export type RejectedVariantKind =
  | "interpretation_frame"
  | "section_variant"
  | "frontier"
  | "claim_strategy";
export type RejectedBy = "user" | "system" | "audit" | "inferred";

export interface Budgets {
  answer_tokens: number;
  scar_density_max: number;
  branch_budget: number;
  clarification_budget: number;
  meta_projection_allowed: boolean;
}

export interface Contract {
  audience: Audience;
  stakes: Stakes;
  factual_strictness: Level3;
  ambiguity_tolerance: Level3;
  exploration_width: "narrow" | "medium" | "wide";
  projection_style: ProjectionStyle;
  budgets: Budgets;
}

export interface ContractPatch {
  audience?: Audience;
  stakes?: Stakes;
  factual_strictness?: Level3;
  ambiguity_tolerance?: Level3;
  exploration_width?: "narrow" | "medium" | "wide";
  projection_style?: ProjectionStyle;
  budgets?: Partial<Budgets>;
}

export interface Anchor {
  id: string;
  text: string;
  kind: AnchorKind;
  priority: Priority;
  source: "user" | "system" | "domain" | "inferred";
  scope: AnchorScope;
  status: AnchorStatus;
  exposure_policy?: AnchorExposurePolicy;
}

export interface ProjectionSignature {
  allowed_claim_set: string[];
  mandatory_exposures: string[];
  clarification_needs: string[];
  anchor_touch: string[];
  obstruction_touch: string[];
}

export interface BranchCost {
  cognitive_load: number;
  projection_block_risk: number;
  obstruction_yield: number;
  revive_likelihood: Level3;
}

export interface Section {
  id: string;
  label: string;
  gist: string;
  warrant: Warrant;
  domain_mode?: DomainMode;
  status: SectionStatus;
  parents: string[];
  revive_when: string[];
  projection_signature: ProjectionSignature;
  branch_cost: BranchCost;
  variants: string[];
}

export interface Void {
  id: string;
  question: string;
  effect: VoidEffect;
  effect_scope: EffectScope;
  coupled_with: string[];
  coupling_mode: CouplingMode;
  resolution_priority: Priority;
  unresolved_blocks: string[];
  exposure_required_if_touched: boolean;
  status: VoidStatus;
  resolution_requires: string[];
}

export interface Obstruction {
  id: string;
  between: string[];
  type: ObstructionType;
  note: string;
  bridge_risk: Level3;
  exposure_operator: ExposureOperator;
  clearance_modes: ExposureOperator[];
  status: ObstructionStatus;
}

export interface Frontier {
  id: string;
  satisfies: string[];
  relaxes: string[];
  projection_delta: string;
  exposure_cost: Level3;
}

export interface Negotiation {
  id: string;
  anchors: string[];
  unsat_core: string[];
  frontiers: Frontier[];
  selected: string;
  reason: string;
  alternatives_preserved: string[];
  status: "active" | "settled";
}

export interface Trace {
  id: string;
  action: TraceAction;
  targets: string[];
  cause: string;
  turn: number;
}

export interface InterpretationOpening {
  id: string;
  label: string;
  reading: string;
  changes_if_selected: string;
  clarification_prompt: string;
  collapsible_with_one_clarification: boolean;
  status: InterpretationOpeningStatus;
  competes_with: string[];
  related_sections: string[];
}

export interface RejectedVariant {
  id: string;
  kind: RejectedVariantKind;
  label: string;
  summary: string;
  derived_from: string[];
  rejected_by: RejectedBy;
  reason: string;
  superseded_by: string[];
  turn: number;
}

export interface ShellState {
  version: SchemaVersion;
  turn: number;
  contract: Contract;
  anchors: Anchor[];
  sections: Section[];
  voids: Void[];
  obstructions: Obstruction[];
  negotiations: Negotiation[];
  interpretation_openings?: InterpretationOpening[];
  rejected_variants?: RejectedVariant[];
  traces: Trace[];
}

export interface AnchorStatusUpdate {
  id: string;
  status: AnchorStatus;
  reason: string;
}

export interface AnchorExposureUpdate {
  id: string;
  exposure_policy: AnchorExposurePolicy;
  reason: string;
}

export interface SectionPatch {
  id: string;
  label?: string;
  gist?: string;
  warrant?: Warrant;
  domain_mode?: DomainMode;
  status?: SectionStatus;
  parents?: string[];
  revive_when?: string[];
  projection_signature?: ProjectionSignature;
  branch_cost?: BranchCost;
  variants?: string[];
}

export interface VoidResolution {
  id: string;
  resolution: string;
  reason: string;
}

export interface ObstructionClear {
  id: string;
  reason: string;
}

export interface NegotiationPatch {
  id: string;
  selected?: string;
  reason?: string;
  alternatives_preserved?: string[];
  status?: "active" | "settled";
}

export interface InterpretationOpeningPatch {
  id: string;
  status?: InterpretationOpeningStatus;
  reason: string;
  clarification_prompt?: string;
  related_sections?: string[];
}

export interface StateDelta {
  version: SchemaVersion;
  turn: number;
  rationale: string;
  contract_patch: ContractPatch;
  add_anchors: Anchor[];
  update_anchor_status: AnchorStatusUpdate[];
  update_anchor_exposure?: AnchorExposureUpdate[];
  add_sections: Section[];
  update_sections: SectionPatch[];
  add_interpretation_openings?: InterpretationOpening[];
  update_interpretation_openings?: InterpretationOpeningPatch[];
  add_rejected_variants?: RejectedVariant[];
  add_voids: Void[];
  resolve_voids: VoidResolution[];
  add_obstructions: Obstruction[];
  clear_obstructions: ObstructionClear[];
  add_negotiations: Negotiation[];
  update_negotiations: NegotiationPatch[];
  traces: Trace[];
}

export interface NegotiationDecision {
  negotiation_id: string;
  selected_frontier: string;
  reason: string;
  tradeoff_note: string;
  alternatives_preserved: string[];
  relaxed_anchors: string[];
}

export interface NegotiationResult {
  version: SchemaVersion;
  turn: number;
  projection_style_recommendation: ProjectionStyle;
  global_reason: string;
  decisions: NegotiationDecision[];
  traces: Trace[];
}

export interface ClaimFrame {
  id: string;
  section: string;
  kind: ClaimKind;
  text_intent: string;
  warrant: Warrant;
  depends_on: string[];
  licensed_if: string[];
  drop_if_unexposed: boolean;
}

export interface Scar {
  id: string;
  from: string[];
  leakage_if_hidden: LeakageType;
  severity: Level3;
  scope: ScarScope;
  operator: ExposureOperator;
  compressible: boolean;
  bundle_key: string[];
  attached_to: string[];
}

export interface Withheld {
  id: string;
  item: string;
  reason: string;
  recover_when: string[];
  expose_if_material: boolean;
}

export interface BodyPlan {
  intro_scars: string[];
  claims: string[];
  close_withheld: string[];
  tradeoff_notes: string[];
}

export interface ProjectionIR {
  selected_frontiers: string[];
  frame_commitments?: string[];
  claim_frames: ClaimFrame[];
  scars: Scar[];
  withheld: Withheld[];
  body_plan: BodyPlan;
}

export interface ProjectionOutput {
  version: SchemaVersion;
  turn: number;
  projection_ir: ProjectionIR;
  answer: string;
}

export interface AuditFinding {
  id: string;
  category: FindingCategory;
  severity: Level3;
  target_ids: string[];
  description: string;
  fix: FixAction;
  status: "open" | "resolved";
}

export interface AuditResult {
  version: SchemaVersion;
  turn: number;
  verdict: Verdict;
  summary: string;
  required_actions: FixAction[];
  projection_style_recommendation: ProjectionStyle;
  findings: AuditFinding[];
  revised_answer?: string;
  revised_projection_ir?: ProjectionIR;
}

export interface PromptTemplate {
  systemPrompt: string;
  userPromptTemplate: string;
}

export interface PromptSet {
  auditor: PromptTemplate;
  negotiator: PromptTemplate;
  project_compiler: PromptTemplate;
  state_updater: PromptTemplate;
}

export interface JsonGenerationRequest {
  attempt: number;
  input: Record<string, unknown>;
  pass: PassName;
  schema: JsonObject;
  schemaName: SchemaName;
  systemPrompt: string;
  turn: number;
  userPrompt: string;
}

export interface JsonProvider {
  readonly name: string;
  readonly model?: string;
  generateJson(request: JsonGenerationRequest): Promise<unknown>;
}

export interface PassAttemptLog {
  attempt: number;
  rawResponse: unknown;
  validationError?: string;
}

export interface PassLog {
  pass: PassName;
  sequence: number;
  schemaName: SchemaName;
  systemPrompt: string;
  userPrompt: string;
  attempts: PassAttemptLog[];
  validatedResponse: unknown;
}

export interface FailedPassArtifacts {
  artifact_version: 1;
  attempts: PassAttemptLog[];
  created_at: string;
  debug_fallback_answer?: string;
  final_validation_error: string;
  input: Record<string, unknown>;
  pass: PassName;
  provider: {
    model?: string;
    name: string;
  };
  schemaName: SchemaName;
  sequence: number;
  systemPrompt: string;
  turn: number;
  userPrompt: string;
  user_turn: string;
}

export interface TurnArtifacts {
  artifact_version: 1;
  created_at: string;
  final_answer: string;
  final_state: ShellState;
  negotiation: NegotiationResult;
  projection: ProjectionOutput;
  provider: {
    model?: string;
    name: string;
  };
  state_after_delta: ShellState;
  state_before: ShellState;
  state_delta: StateDelta;
  turn: number;
  user_turn: string;
  audit: AuditResult;
  pass_logs: PassLog[];
}

export interface ArtifactStore {
  recordTurn(artifacts: TurnArtifacts): Promise<string>;
  recordFailure?(artifacts: FailedPassArtifacts): Promise<string>;
}

export interface RunTurnOptions {
  artifactStore?: ArtifactStore;
  lastAudit?: AuditResult;
  maxCompilerRetries?: number;
  maxValidationAttempts?: number;
  provider: JsonProvider;
  prevState: ShellState;
  sourceSnippets?: unknown;
  userTurn: string;
}

export interface RunTurnResult {
  artifactDirectory?: string;
  artifacts: TurnArtifacts;
  audit: AuditResult;
  finalAnswer: string;
  negotiation: NegotiationResult;
  projection: ProjectionOutput;
  state: ShellState;
}

export interface PassValidationRuntimeErrorLike {
  debugFallbackAnswer: string | undefined;
  failureArtifactDirectory: string | undefined;
  pass: PassName;
  schemaName: SchemaName;
  validationError: string;
}

export interface SchemaValidationIssue {
  instancePath: string;
  keyword: string;
  message: string;
  params: Record<string, unknown>;
}

export interface SchemaValidationFailure {
  errors: SchemaValidationIssue[];
  schemaName: SchemaName;
}

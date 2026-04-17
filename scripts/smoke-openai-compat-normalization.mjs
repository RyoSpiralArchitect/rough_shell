import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const { SchemaRegistry } = await import(new URL("../packages/core/dist/index.js", import.meta.url));
const { normalizeProviderResponse } = await import(
  new URL("../packages/core/dist/provider-normalization.js", import.meta.url)
);

const schemaRegistry = new SchemaRegistry(repoRoot);
const sampleStatePath = join(repoRoot, "state", "v0.5", "sample_shell_state.json");
const sampleState = schemaRegistry.validateShellState(
  JSON.parse(await readFile(sampleStatePath, "utf8")),
);
const nextTurn = sampleState.turn + 1;
const openAiCompatProvider = { name: "openai-compat" };

const stateUpdaterRaw = {
  version: "v0.5",
  turn: nextTurn,
  reason: "Normalization smoke keeps the state update shape stable.",
  update_anchor_exposure: [
    {
      id: "A1",
      policy: "expose_if_touched",
      reason: "Alias fields should normalize cleanly.",
    },
  ],
  add_sections: [
    {
      id: "S2",
      label: "Normalized state section",
      gist: "A section that passes through normalization untouched.",
      warrant: "local_inference",
      domain_mode: "factual",
      status: "active",
      parents: [],
      revive_when: [],
      projection_signature: {
        allowed_claim_set: ["descriptive"],
        mandatory_exposures: [],
        clarification_needs: [],
        anchor_touch: ["A1"],
        obstruction_touch: [],
      },
      branch_cost: {
        cognitive_load: 1,
        projection_block_risk: 1,
        obstruction_yield: 1,
        revive_likelihood: "medium",
      },
      variants: [],
    },
  ],
  openings: [
    {
      id: "I2",
      label: "framing_choice",
      reading: "One reading defines the concept before examples.",
      changes_if_selected: "It changes how quickly the answer commits to examples.",
      clarification_prompt: "Should the answer define the concept first?",
      collapsible_with_one_clarification: true,
      status: "open",
      competes_with: [],
      related_sections: ["S2"],
    },
  ],
  term_provenances: [
    {
      id: "P1",
      term: "rough-shell",
      kind: "shorthand",
      confidence: "high",
      evidence: "This label is treated as local shorthand across the repo.",
      first_turn: nextTurn,
      sections: ["S2"],
      referents: ["RF1"],
    },
  ],
  referent_bindings: [
    {
      id: "RF1",
      surface: "system",
      target: "the assistant generating this conversation",
      kind: "speaker",
      status: "active",
      confidence: "medium",
      evidence: "The runtime uses system as a local handle for the assistant.",
      sections: ["S2"],
      provenances: ["P1"],
    },
  ],
  add_voids: [],
  traces: [
    {
      id: "T2",
      action: "reframe",
      targets: ["S2"],
      reason: "Normalization should accept reason as a cause alias.",
      turn: nextTurn,
    },
  ],
};

const normalizedStateUpdater = normalizeProviderResponse(
  openAiCompatProvider,
  "state_updater",
  stateUpdaterRaw,
  { prev_state: sampleState },
);

schemaRegistry.validate(
  schemaRegistry.getSchemaName("v0.5", "state_delta"),
  normalizedStateUpdater,
);

assert.equal(normalizedStateUpdater.update_anchor_exposure[0].exposure_policy, "expose_if_touched");
assert.equal(normalizedStateUpdater.add_interpretation_openings[0].id, "I2");
assert.equal(normalizedStateUpdater.add_term_provenances[0].origin, "shared_shorthand");
assert.equal(
  normalizedStateUpdater.add_referent_bindings[0].refers_to,
  "the assistant generating this conversation",
);

const negotiatorRaw = {
  version: "v0.5",
  turn: nextTurn,
  reason: "Normalization smoke keeps decision aliases stable.",
  projection_style_recommendation: "single",
  decisions: {
    negotiationId: "N1",
    selected: "F1",
    note: "Prefer the direct frontier in this smoke case.",
    tradeoff: "Alternatives remain preserved in state.",
  },
  traces: [
    {
      id: "TN1",
      action: "negotiate",
      targets: ["N1"],
      reason: "One lightweight decision was made.",
      turn: nextTurn,
    },
  ],
};

const normalizedNegotiator = normalizeProviderResponse(
  openAiCompatProvider,
  "negotiator",
  negotiatorRaw,
  { current_state: sampleState },
);

schemaRegistry.validate(
  schemaRegistry.getSchemaName("v0.5", "negotiation_result"),
  normalizedNegotiator,
);

assert.equal(normalizedNegotiator.decisions[0].negotiation_id, "N1");
assert.equal(normalizedNegotiator.decisions[0].selected_frontier, "F1");

const projectCompilerRaw = {
  version: "v0.5",
  turn: nextTurn,
  answer: {
    text: "A compact answer stays inside the normalized projection output.",
  },
  projection_ir: {
    selected_frontiers: "F1",
    frame_ids: ["I1"],
    claim_frames: [
      {
        id: "C1",
        section: "S1",
        kind: "meta",
        text_intent: "Answer briefly while preserving the current framing.",
        warrant: "local_inference",
        depends_on: [],
        licensed_if: [],
        drop_if_unexposed: false,
      },
    ],
    scars: [],
    withheld: [],
    body_plan: {
      intro_scars: [],
      claims: ["C1"],
      close_withheld: [],
      tradeoff_notes: [],
    },
  },
};

const normalizedProjection = normalizeProviderResponse(
  openAiCompatProvider,
  "project_compiler",
  projectCompilerRaw,
  { current_state: sampleState },
);

schemaRegistry.validate(
  schemaRegistry.getSchemaName("v0.5", "projection_output"),
  normalizedProjection,
);

assert.equal(
  normalizedProjection.answer,
  "A compact answer stays inside the normalized projection output.",
);
assert.deepEqual(normalizedProjection.projection_ir.frame_commitments, ["I1"]);

const auditorRaw = {
  version: "v0.5",
  turn: nextTurn,
  summary: "Normalization smoke promotes open checks into findings.",
  checks: {
    scope_coverage: {
      status: "open",
      notes: ["One scoped rewrite is still needed."],
    },
  },
  revised_answer: {
    text: "Clarify the scope before giving examples.",
  },
  revised_projection_ir: {
    selected_frontiers: ["F1"],
    frame_ids: ["I1"],
    claim_frames: [
      {
        id: "C2",
        section: "S1",
        kind: "meta",
        text_intent: "Ask for scope before committing to examples.",
        warrant: "local_inference",
        depends_on: [],
        licensed_if: [],
        drop_if_unexposed: false,
      },
    ],
    scars: [],
    withheld: [],
    body_plan: {
      intro_scars: [],
      claims: ["C2"],
      close_withheld: [],
      tradeoff_notes: [],
    },
  },
};

const normalizedAudit = normalizeProviderResponse(
  openAiCompatProvider,
  "auditor",
  auditorRaw,
  {
    current_state: sampleState,
    negotiation_result: normalizedNegotiator,
    projection_output: normalizedProjection,
  },
);

schemaRegistry.validate(
  schemaRegistry.getSchemaName("v0.5", "audit_result"),
  normalizedAudit,
);

assert.equal(normalizedAudit.verdict, "revise");
assert.equal(normalizedAudit.findings[0].category, "scope_coverage");
assert.ok(normalizedAudit.required_actions.includes("rewrite"));
assert.equal(normalizedAudit.revised_answer, "Clarify the scope before giving examples.");

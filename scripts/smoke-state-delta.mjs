import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const { SchemaRegistry, applyStateDelta } = await import(
  new URL("../packages/core/dist/index.js", import.meta.url)
);

const schemaRegistry = new SchemaRegistry(repoRoot);
const sampleStatePath = join(repoRoot, "state", "v0.5", "sample_shell_state.json");
const sampleState = schemaRegistry.validateShellState(
  JSON.parse(await readFile(sampleStatePath, "utf8")),
);
const nextTurn = sampleState.turn + 1;

const stateDelta = {
  version: "v0.5",
  turn: nextTurn,
  rationale: "Smoke delta covers the v0.5 state extensions and patch paths.",
  contract_patch: {
    ambiguity_tolerance: "high",
    budgets: {
      clarification_budget: 2,
    },
  },
  add_anchors: [],
  update_anchor_status: [],
  update_anchor_exposure: [
    {
      id: "A1",
      exposure_policy: "expose_if_touched",
      reason: "Smoke check exercises anchor exposure updates.",
    },
  ],
  add_sections: [
    {
      id: "S2",
      label: "Smoke section",
      gist: "A lightweight section added by the smoke delta.",
      warrant: "local_inference",
      domain_mode: "factual",
      status: "active",
      parents: ["S1"],
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
  update_sections: [],
  add_interpretation_openings: [
    {
      id: "I2",
      label: "define_then_examples",
      reading: "The answer may define the concept before giving examples.",
      changes_if_selected: "It changes the ordering and framing of the reply.",
      clarification_prompt: "Should the answer define the space first?",
      collapsible_with_one_clarification: true,
      status: "open",
      competes_with: [],
      related_sections: ["S2"],
    },
  ],
  update_interpretation_openings: [],
  add_rejected_variants: [
    {
      id: "R2",
      kind: "claim_strategy",
      label: "example-first shortcut",
      summary: "A shortcut that jumps to examples before clarifying the frame.",
      derived_from: ["S2"],
      rejected_by: "audit",
      reason: "The smoke delta records one explicitly rejected answer shape.",
      superseded_by: ["I2"],
      turn: nextTurn,
    },
  ],
  add_term_provenances: [
    {
      id: "P1",
      term: "rough-shell",
      origin: "shared_shorthand",
      confidence: "high",
      evidence: "The repository consistently uses this term as its local shorthand.",
      first_turn: nextTurn,
      related_sections: ["S2"],
      related_referents: ["RF1"],
    },
  ],
  update_term_provenances: [],
  add_referent_bindings: [
    {
      id: "RF1",
      surface: "system",
      refers_to: "the assistant generating this conversation",
      kind: "speaker",
      status: "active",
      confidence: "medium",
      evidence: "Within this runtime, system is a local discourse handle for the assistant.",
      related_sections: ["S2"],
      related_provenances: ["P1"],
    },
  ],
  update_referent_bindings: [],
  add_voids: [
    {
      id: "V2",
      question: "Which example should be foregrounded first?",
      effect: "changes_content_selection",
      effect_scope: "local",
      coupled_with: [],
      coupling_mode: "none",
      resolution_priority: "medium",
      unresolved_blocks: ["example selection"],
      exposure_required_if_touched: true,
      status: "parked",
      resolution_requires: [],
    },
  ],
  update_voids: [
    {
      id: "V2",
      reason: "Smoke delta reopens the void and widens the tracked blocking surface.",
      status: "open",
      unresolved_blocks: ["example selection", "ordering"],
    },
  ],
  resolve_voids: [
    {
      id: "V2",
      reason: "Smoke coverage resolves the void after reopening it.",
      resolution: "The smoke delta also verifies that resolution still wins after a patch.",
    },
  ],
  add_obstructions: [],
  clear_obstructions: [],
  add_negotiations: [],
  update_negotiations: [],
  traces: [
    {
      id: "T-smoke",
      action: "fork",
      targets: ["S2"],
      cause: "Smoke coverage adds one simple section branch.",
      turn: nextTurn,
    },
  ],
};

const validatedDelta = schemaRegistry.validate(
  schemaRegistry.getSchemaName("v0.5", "state_delta"),
  stateDelta,
);
const nextState = applyStateDelta(sampleState, validatedDelta);

schemaRegistry.validateShellState(nextState);

assert.equal(nextState.turn, nextTurn);
assert.equal(nextState.contract.ambiguity_tolerance, "high");
assert.equal(nextState.contract.budgets.clarification_budget, 2);
assert.equal(
  nextState.anchors.find((anchor) => anchor.id === "A1")?.exposure_policy,
  "expose_if_touched",
);
assert.ok(nextState.sections.some((section) => section.id === "S2"));
assert.ok(nextState.interpretation_openings?.some((opening) => opening.id === "I2"));
assert.ok(nextState.rejected_variants?.some((variant) => variant.id === "R2"));
assert.ok(nextState.term_provenances?.some((provenance) => provenance.id === "P1"));
assert.ok(nextState.referent_bindings?.some((binding) => binding.id === "RF1"));
assert.equal(nextState.voids.find((entry) => entry.id === "V2")?.status, "resolved");
assert.deepEqual(
  nextState.voids.find((entry) => entry.id === "V2")?.unresolved_blocks,
  ["example selection", "ordering"],
);

import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const { SchemaRegistry } = await import(new URL("../packages/core/dist/index.js", import.meta.url));
const { postProcessStateDelta } = await import(
  new URL("../packages/core/dist/runtime-state-delta.js", import.meta.url)
);
const { applyAuditHeuristics } = await import(
  new URL("../packages/core/dist/audit-heuristics.js", import.meta.url)
);

const schemaRegistry = new SchemaRegistry(repoRoot);
const sampleStatePath = join(repoRoot, "state", "v0.5", "sample_shell_state.json");
const sampleState = schemaRegistry.validateShellState(
  JSON.parse(await readFile(sampleStatePath, "utf8")),
);

function makeNegotiation(turn, projectionStyle = "clarify") {
  return schemaRegistry.validate(
    schemaRegistry.getSchemaName("v0.5", "negotiation_result"),
    {
      version: "v0.5",
      turn,
      projection_style_recommendation: projectionStyle,
      global_reason: "Smoke negotiation keeps clarification live.",
      decisions: [],
      traces: [],
    },
  );
}

function makeProjection(turn, answer) {
  return schemaRegistry.validate(
    schemaRegistry.getSchemaName("v0.5", "projection_output"),
    {
      version: "v0.5",
      turn,
      answer,
      projection_ir: {
        selected_frontiers: [],
        frame_commitments: [],
        claim_frames: [
          {
            id: "C-smoke",
            section: "S1",
            kind: "meta",
            text_intent: "Keep the answer at the clarification layer.",
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
          claims: ["C-smoke"],
          close_withheld: [],
          tradeoff_notes: [],
        },
      },
    },
  );
}

function makeAudit(turn, projectionStyle = "clarify") {
  return schemaRegistry.validate(
    schemaRegistry.getSchemaName("v0.5", "audit_result"),
    {
      version: "v0.5",
      turn,
      verdict: "pass",
      summary: "Smoke audit starts permissive so heuristics can tighten it.",
      required_actions: [],
      projection_style_recommendation: projectionStyle,
      findings: [],
    },
  );
}

function makeDelta(turn, reason) {
  return schemaRegistry.validate(
    schemaRegistry.getSchemaName("v0.5", "state_delta"),
    {
      version: "v0.5",
      turn,
      rationale: reason,
      contract_patch: {},
      add_anchors: [],
      update_anchor_status: [],
      update_anchor_exposure: [],
      add_sections: [],
      update_sections: [],
      add_interpretation_openings: [],
      update_interpretation_openings: [
        {
          id: "I1",
          status: "open",
          reason: "Smoke keeps the clarification open before heuristics adjust it.",
        },
      ],
      add_rejected_variants: [],
      add_term_provenances: [],
      update_term_provenances: [],
      add_referent_bindings: [],
      update_referent_bindings: [],
      add_voids: [],
      update_voids: [],
      resolve_voids: [],
      add_obstructions: [],
      clear_obstructions: [],
      add_negotiations: [],
      update_negotiations: [],
      traces: [],
    },
  );
}

const priorTurn = {
  user_turn: "Hello.",
  answer: "Should the answer define the space first, or jump straight to examples?",
  negotiation: makeNegotiation(sampleState.turn),
  projection: makeProjection(
    sampleState.turn,
    "Should the answer define the space first, or jump straight to examples?",
  ),
  audit: makeAudit(sampleState.turn),
};

const repairDelta = postProcessStateDelta(
  sampleState,
  "What kind of examples do you mean?",
  makeDelta(sampleState.turn + 1, "Smoke repair keeps the opening open before heuristics."),
  priorTurn,
);

assert.equal(
  repairDelta.update_interpretation_openings.find((patch) => patch.id === "I1")?.status,
  "selected",
);
assert.ok(
  repairDelta.add_referent_bindings.some(
    (binding) =>
      binding.surface === "examples" &&
      binding.refers_to === "the example-first option from the assistant's previous clarification",
  ),
);

const delegatedDelta = postProcessStateDelta(
  sampleState,
  "Okay, either is fine.",
  makeDelta(sampleState.turn + 1, "Smoke delegation keeps the opening open before heuristics."),
  priorTurn,
);

assert.equal(
  delegatedDelta.update_interpretation_openings.find((patch) => patch.id === "I1")?.status,
  "collapsed",
);

const repeatedClarificationAudit = applyAuditHeuristics(
  sampleState,
  makeProjection(
    sampleState.turn + 1,
    "Could you please clarify whether you want a definition of the space first, or if you prefer to jump straight to concrete examples?",
  ),
  makeAudit(sampleState.turn + 1),
  priorTurn,
);

assert.equal(repeatedClarificationAudit.verdict, "revise");
assert.ok(
  repeatedClarificationAudit.findings.some((finding) =>
    finding.id.startsWith("F-HEURISTIC-CLARIFICATION-LOOP-"),
  ),
);

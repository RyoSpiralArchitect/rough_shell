import type {
  JsonGenerationRequest,
  JsonProvider,
  NegotiationResult,
  ProjectionOutput,
  SchemaVersion,
  ShellState,
  StateDelta,
  Trace,
  AuditResult,
} from "@rough-shell/core";

function pickUserTurn(input: Record<string, unknown>): string {
  return typeof input.user_turn === "string" ? input.user_turn : "No user turn provided.";
}

function pickState(input: Record<string, unknown>, key: "prev_state" | "current_state"): ShellState {
  const value = input[key];
  if (!value || typeof value !== "object") {
    throw new Error(`Mock provider expected ${key} in the pass input.`);
  }

  return value as ShellState;
}

function summarizeUserTurn(userTurn: string): string {
  const trimmed = userTurn.trim().replace(/\s+/g, " ");
  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
}

function buildTrace(id: string, action: Trace["action"], turn: number, cause: string): Trace {
  return {
    id,
    action,
    targets: [],
    cause,
    turn,
  };
}

function pickVersion(request: JsonGenerationRequest): SchemaVersion {
  const prevState = request.input.prev_state;
  if (prevState && typeof prevState === "object" && "version" in prevState) {
    const version = (prevState as { version?: unknown }).version;
    if (version === "v0.5") {
      return version;
    }
  }

  const currentState = request.input.current_state;
  if (currentState && typeof currentState === "object" && "version" in currentState) {
    const version = (currentState as { version?: unknown }).version;
    if (version === "v0.5") {
      return version;
    }
  }

  return "v0.5";
}

function buildStateDelta(request: JsonGenerationRequest): StateDelta {
  const prevState = pickState(request.input, "prev_state");
  const userTurn = pickUserTurn(request.input);
  const turn = request.turn;
  const sectionId = `S${turn}`;
  const version = pickVersion(request);

  return {
    version,
    turn,
    rationale: "Mock provider added one summary section so the runtime can exercise the full loop.",
    contract_patch: {},
    add_anchors: [],
    update_anchor_status: [],
    update_anchor_exposure: [],
    add_sections: [
      {
        id: sectionId,
        label: `Turn ${turn}`,
        gist: summarizeUserTurn(userTurn),
        warrant: "user_asserted",
        domain_mode: "factual",
        status: "active",
        parents: [],
        revive_when: [],
        projection_signature: {
          allowed_claim_set: ["procedural", "meta", "descriptive"],
          mandatory_exposures: [],
          clarification_needs: [],
          anchor_touch: prevState.anchors.map((anchor) => anchor.id),
          obstruction_touch: [],
        },
        branch_cost: {
          cognitive_load: 1,
          projection_block_risk: 1,
          obstruction_yield: 1,
          revive_likelihood: "high",
        },
        variants: [],
      },
    ],
    update_sections: [],
    add_interpretation_openings: [],
    update_interpretation_openings: [],
    add_rejected_variants: [],
    add_voids: [],
    resolve_voids: [],
    add_obstructions: [],
    clear_obstructions: [],
    add_negotiations: [],
    update_negotiations: [],
    traces: [
      buildTrace(
        `T${turn}-fork`,
        "fork",
        turn,
        "Mock provider created a single active section for the new turn.",
      ),
    ],
  };
}

function buildNegotiationResult(request: JsonGenerationRequest): NegotiationResult {
  const version = pickVersion(request);

  return {
    version,
    turn: request.turn,
    projection_style_recommendation: "single",
    global_reason: "Mock provider found no active frontier conflict, so a single projection is sufficient.",
    decisions: [],
    traces: [],
  };
}

function buildProjectionOutput(request: JsonGenerationRequest): ProjectionOutput {
  const currentState = pickState(request.input, "current_state");
  const userTurn = pickUserTurn(request.input);
  const sectionId = currentState.sections.at(-1)?.id ?? `S${request.turn}`;
  const claimId = `C${request.turn}-1`;
  const version = pickVersion(request);

  return {
    version,
    turn: request.turn,
    projection_ir: {
      selected_frontiers: [],
      frame_commitments: [],
      claim_frames: [
        {
          id: claimId,
          section: sectionId,
          kind: "meta",
          text_intent:
            "Reflect the user request back in a compact, clearly marked scaffold response.",
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
        claims: [claimId],
        close_withheld: [],
        tradeoff_notes: [],
      },
    },
    answer: [
      `[mock] turn ${request.turn}`,
      "",
      `Observed request: ${summarizeUserTurn(userTurn)}`,
      "",
      "This response comes from the mock provider so the runtime can be exercised before wiring in a live model.",
    ].join("\n"),
  };
}

function buildAuditResult(request: JsonGenerationRequest): AuditResult {
  const version = pickVersion(request);

  return {
    version,
    turn: request.turn,
    verdict: "pass",
    summary: "Mock provider emitted a valid projection payload for runtime testing.",
    required_actions: [],
    projection_style_recommendation: "single",
    findings: [],
  };
}

export class MockProvider implements JsonProvider {
  public readonly model = "mock-runtime";

  public readonly name = "mock";

  public async generateJson(request: JsonGenerationRequest): Promise<unknown> {
    switch (request.pass) {
      case "state_updater":
        return buildStateDelta(request);
      case "negotiator":
        return buildNegotiationResult(request);
      case "project_compiler":
        return buildProjectionOutput(request);
      case "auditor":
        return buildAuditResult(request);
      default: {
        const exhaustiveCheck: never = request.pass;
        throw new Error(`Unhandled mock pass: ${String(exhaustiveCheck)}`);
      }
    }
  }
}

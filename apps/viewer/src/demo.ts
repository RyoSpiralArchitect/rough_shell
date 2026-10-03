import { RoughShellRuntime } from "@rough-shell/core";
import type {
  AuditResult,
  JsonGenerationRequest,
  JsonProvider,
  LastTurnContext,
  NegotiationResult,
  ProjectionOutput,
  Section,
  ShellState,
  StateDelta,
} from "@rough-shell/core";

import type { ViewerSession, ViewerTurn } from "./types.js";

const FICTION = "I1";
const SYMBOLIC = "I2";
const MERMAID = "S1";
const SYMBOLIC_SECTION = "S2";
const REJECTED_THIRST = "R1";
const NO_ASSUMED_THIRST = "A1";

const script = [
  {
    label: "1 · 二つの読み方を開く",
    user: "砂漠の人魚はどんな夢を見るだろうか？",
    answer:
      "一つの読み方は架空の人魚の夢を創作すること。別の読み方は「砂漠の人魚」を象徴として読むことです。今回は物語として想像しますか、それとも象徴として考えますか？",
  },
  {
    label: "2 · 創作の許可を明確にする",
    user: "象徴の解釈ではなく、架空の人魚の物語として想像してほしい。",
    answer:
      "創作として、まずは水を恋しがる人魚を思い描きます。夢の中で彼女は砂丘を波に変え、遠い海の歌を聴いていました。",
  },
  {
    label: "3 · 決めつけた前提を退ける",
    user:
      "砂漠にいるからといって、必ず渇望しているという前提は固定観念かもしれない。オアシスにいるかもよ。",
    answer:
      "砂漠にいるだけで渇望しているとは決められませんね。さっきの創作では、その前提を置いていました。オアシスで満ち足りて暮らす人魚も想像できます。水への渇望を必須にせず、夢を考え直します。",
  },
  {
    label: "4 · 訂正を次の夢へ引き継ぐ",
    user:
      "その前提は戻さず、オアシスで暮らす人魚の短い夢を一つ創作して。",
    answer:
      "創作：オアシスの人魚は、月が小さな銀の魚になり、池の底で眠る夢を見た。朝、彼女の髪には星の砂が一粒だけ残っていた。",
  },
] as const;

/** Blank v0.5 state using the sample contract, without its unrelated dialogue. */
export function createInitialState(): ShellState {
  return {
    version: "v0.5",
    turn: 0,
    contract: {
      audience: "unknown",
      stakes: "medium",
      factual_strictness: "high",
      ambiguity_tolerance: "medium",
      exploration_width: "medium",
      projection_style: "auto",
      budgets: {
        answer_tokens: 220,
        scar_density_max: 2,
        branch_budget: 2,
        clarification_budget: 1,
        meta_projection_allowed: true,
      },
    },
    anchors: [],
    sections: [],
    voids: [],
    obstructions: [],
    negotiations: [],
    interpretation_openings: [],
    rejected_variants: [],
    term_provenances: [],
    referent_bindings: [],
    traces: [],
  };
}

function section(id: string, domainMode: "fictional" | "symbolic"): Section {
  return {
    id,
    label: domainMode === "fictional" ? "人魚の物語" : "象徴としての人魚",
    gist:
      domainMode === "fictional"
        ? "砂漠の架空の人魚の夢を、現実の事実として扱わずに創作する。"
        : "ユーザーがこの読み方を選んだ場合、「砂漠の人魚」を象徴として解釈する。",
    warrant: "local_inference",
    domain_mode: domainMode,
    status: "active",
    parents: [],
    revive_when: [],
    projection_signature: {
      allowed_claim_set: ["meta", "speculative"],
      mandatory_exposures: [],
      clarification_needs: [domainMode === "fictional" ? FICTION : SYMBOLIC],
      anchor_touch: [],
      obstruction_touch: [],
    },
    branch_cost: {
      cognitive_load: 1,
      projection_block_risk: 1,
      obstruction_yield: 1,
      revive_likelihood: "medium",
    },
    variants: [],
  };
}

function stateDelta(turn: number): StateDelta {
  const delta: StateDelta = {
    version: "v0.5",
    turn,
    rationale: "Scripted fixture transition for the offline viewer; not a model inference.",
    contract_patch: {},
    add_anchors: [],
    update_anchor_status: [],
    update_anchor_exposure: [],
    add_sections: [],
    update_sections: [],
    add_interpretation_openings: [],
    update_interpretation_openings: [],
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
  };

  if (turn === 1) {
    delta.add_sections = [section(MERMAID, "fictional"), section(SYMBOLIC_SECTION, "symbolic")];
    delta.add_interpretation_openings = [
      {
        id: FICTION,
        label: "物語としての読み方",
        reading: "架空の世界にいる人魚の夢を創作する。",
        changes_if_selected: "象徴の説明ではなく、夢の場面を自由に創作できる。",
        clarification_prompt: "物語として夢を創作しますか？",
        collapsible_with_one_clarification: true,
        status: "open",
        competes_with: [SYMBOLIC],
        related_sections: [MERMAID],
      },
      {
        id: SYMBOLIC,
        label: "象徴としての読み方",
        reading: "「砂漠の人魚」を象徴的なイメージとして解釈する。",
        changes_if_selected: "場面を創作する代わりに、イメージに読み取れる意味を考える。",
        clarification_prompt: "象徴として読みますか？",
        collapsible_with_one_clarification: true,
        status: "open",
        competes_with: [FICTION],
        related_sections: [SYMBOLIC_SECTION],
      },
    ];
    delta.traces = [{
      id: "T1-open",
      action: "fork",
      targets: [MERMAID, SYMBOLIC_SECTION, FICTION, SYMBOLIC],
      cause: "The scripted question permits both fictional and symbolic readings.",
      turn,
    }];
  } else if (turn === 2) {
    delta.update_interpretation_openings = [
      { id: FICTION, status: "selected", reason: "ユーザーが明確に物語の創作を求めた。" },
      { id: SYMBOLIC, status: "collapsed", reason: "今回は象徴の解釈ではなく物語を選んだ。" },
    ];
    delta.update_sections = [
      {
        id: MERMAID,
        warrant: "user_asserted",
        domain_mode: "fictional",
        gist: "創作の許可が明確になった。最初の場面では、仮に水を恋しがる人魚を描く。",
        variants: ["水を恋しがる人魚（仮に置いた創作上のモチーフ）。"],
      },
      {
        id: SYMBOLIC_SECTION,
        status: "latent",
        revive_when: ["ユーザーが象徴としての読み方に戻るよう明確に求めたとき。"],
      },
    ];
    delta.traces = [{
      id: "T2-fiction",
      action: "resolve",
      targets: [FICTION, SYMBOLIC],
      cause: "The user chose fiction; invention is licensed without an external factual answer.",
      turn,
    }];
  } else if (turn === 3) {
    delta.add_anchors = [{
      id: NO_ASSUMED_THIRST,
      text: "砂漠に住んでいるというだけで、人魚が必ず水を渇望していると決めつけない。",
      kind: "constraint",
      priority: "high",
      source: "user",
      scope: "local",
      status: "active",
      exposure_policy: "latent",
    }];
    delta.add_rejected_variants = [{
      id: REJECTED_THIRST,
      kind: "claim_strategy",
      label: "砂漠なら必ず渇望する",
      summary: "砂漠の人魚には渇きや水への渇望が必ずある、と扱うこと。",
      derived_from: [MERMAID],
      rejected_by: "user",
      reason: "ユーザーが渇望を必須とする前提を疑い、オアシスにいる可能性を示した。",
      superseded_by: [NO_ASSUMED_THIRST],
      turn,
    }];
    delta.update_sections = [{
      id: MERMAID,
      domain_mode: "fictional",
      gist: "創作の許可は続いている。オアシスにいる可能性を残し、水への渇望を必須の前提にしない。",
      variants: ["オアシスで満ち足りて暮らす人魚。"],
      projection_signature: {
        ...section(MERMAID, "fictional").projection_signature,
        clarification_needs: [],
        anchor_touch: [NO_ASSUMED_THIRST],
      },
    }];
    delta.traces = [{
      id: "T3-reframe",
      action: "reframe",
      targets: [MERMAID, REJECTED_THIRST, NO_ASSUMED_THIRST],
      cause: "Retain the user's rejection of obligatory thirst while keeping the fictional branch.",
      turn,
    }];
  } else if (turn === 4) {
    delta.update_sections = [{
      id: MERMAID,
      domain_mode: "fictional",
      gist: "渇望を必須とする前提を退けたまま、オアシスの人魚の短い夢を一つ創作する。",
    }];
    delta.traces = [{
      id: "T4-carry-correction",
      action: "project",
      targets: [MERMAID, REJECTED_THIRST, NO_ASSUMED_THIRST],
      cause: "Produce a new invented scene without restoring the rejected premise.",
      turn,
    }];
  }

  return delta;
}

/** All four passes are scripted locally. No model, credentials, or network calls. */
export class DesertMermaidDemoProvider implements JsonProvider {
  public readonly name = "scripted-desert-mermaid";

  public readonly model = "offline-fixture-v1";

  public async generateJson(request: JsonGenerationRequest): Promise<unknown> {
    const entry = script[request.turn - 1];
    if (!entry) throw new Error(`No scripted demo turn ${request.turn}.`);

    switch (request.pass) {
      case "state_updater":
        return stateDelta(request.turn);
      case "negotiator": {
        const result: NegotiationResult = {
          version: "v0.5",
          turn: request.turn,
          projection_style_recommendation: request.turn === 1 ? "clarify" : "single",
          global_reason: request.turn === 1
            ? "Both readings remain live; the scripted response asks the user to choose."
            : "The user selected fiction; preserve later corrections inside that branch.",
          decisions: [],
          traces: [],
        };
        return result;
      }
      case "project_compiler": {
        const claimId = `C${request.turn}`;
        const result: ProjectionOutput = {
          version: "v0.5",
          turn: request.turn,
          projection_ir: {
            selected_frontiers: [],
            frame_commitments: request.turn === 1 ? [FICTION, SYMBOLIC] : [FICTION],
            claim_frames: [{
              id: claimId,
              section: MERMAID,
              kind: request.turn === 1 || request.turn === 3 ? "meta" : "speculative",
              text_intent: request.turn === 1
                ? "Ask which of two live readings to use."
                : request.turn === 3
                  ? "Recognize and retain the user's correction to an invented premise."
                  : "Offer an explicitly invented fictional scene.",
              warrant: "local_inference",
              depends_on: [],
              licensed_if: request.turn === 1 ? [] : [FICTION],
              drop_if_unexposed: false,
            }],
            scars: [],
            withheld: [],
            body_plan: {
              intro_scars: [],
              claims: [claimId],
              close_withheld: [],
              tradeoff_notes: [],
            },
          },
          answer: entry.answer,
        };
        return result;
      }
      case "auditor": {
        const result: AuditResult = {
          version: "v0.5",
          turn: request.turn,
          verdict: "pass",
          summary: "Scripted audit baseline; core audit heuristics still run. This is not an independent model evaluation.",
          required_actions: [],
          projection_style_recommendation: request.turn === 1 ? "clarify" : "single",
          findings: [],
        };
        return result;
      }
      default: {
        const exhaustive: never = request.pass;
        throw new Error(`Unsupported demo pass: ${String(exhaustive)}`);
      }
    }
  }
}

/** Run the real runtime; the renderer selects the smaller public field allowlist. */
export async function buildDemo(): Promise<ViewerSession> {
  const runtime = new RoughShellRuntime();
  const registry = runtime.getSchemaRegistry();
  const provider = new DesertMermaidDemoProvider();
  let state = registry.validateShellState(createInitialState());
  let lastTurn: LastTurnContext | undefined;
  const turns: ViewerTurn[] = [];

  for (const entry of script) {
    const result = await runtime.runTurn({
      provider,
      prevState: state,
      userTurn: entry.user,
      ...(lastTurn ? { lastTurn, lastAudit: lastTurn.audit } : {}),
    });
    registry.validateShellState(result.state);
    if (result.audit.verdict !== "pass") {
      throw new Error(`Scripted demo turn ${result.state.turn} did not pass the core audit.`);
    }
    turns.push({
      label: entry.label,
      user: entry.user,
      answer: result.finalAnswer,
      stateBefore: structuredClone(state),
      stateAfter: structuredClone(result.state),
      audit: result.audit.verdict,
    });
    state = result.state;
    lastTurn = {
      user_turn: entry.user,
      answer: result.finalAnswer,
      negotiation: result.negotiation,
      projection: result.projection,
      audit: result.audit,
    };
  }

  return {
    title: "対話は、訂正を覚えている。",
    description:
      "手書き fixture を使うオフラインデモ。実際の四パス runtime で、解釈・創作の許可・訂正の持ち越しをたどります。API 呼び出しはありません。",
    source:
      "「砂漠の人魚」の失敗例に着想した新しい固定応答デモ。元の Gemini ログではなく、audit: pass もモデル性能の証明ではありません。",
    turns,
  };
}

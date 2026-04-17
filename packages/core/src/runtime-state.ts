import type {
  Contract,
  ContractPatch,
  Negotiation,
  NegotiationPatch,
  NegotiationResult,
  Obstruction,
  ObstructionClear,
  ReferentBinding,
  ReferentBindingPatch,
  Section,
  SectionPatch,
  ShellState,
  StateDelta,
  TermProvenance,
  TermProvenancePatch,
  Void,
  VoidPatch,
  VoidResolution,
} from "./types.js";

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

function applyVoidPatches(voids: Void[], patches: VoidPatch[]): Void[] {
  if (patches.length === 0) {
    return voids;
  }

  const patchMap = new Map(patches.map((patch) => [patch.id, patch]));
  return voids.map((entry) => {
    const patch = patchMap.get(entry.id);
    if (!patch) {
      return entry;
    }

    const { reason: _reason, ...voidPatch } = patch;
    return {
      ...entry,
      ...voidPatch,
    };
  });
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

export function applyTermProvenancePatches(
  provenances: TermProvenance[],
  patches: TermProvenancePatch[],
): TermProvenance[] {
  return provenances.map((entry) => {
    const patch = patches.find((candidate) => candidate.id === entry.id);
    if (!patch) {
      return entry;
    }

    const { reason: _reason, ...rest } = patch;
    return {
      ...entry,
      ...rest,
    };
  });
}

export function applyReferentBindingPatches(
  bindings: ReferentBinding[],
  patches: ReferentBindingPatch[],
): ReferentBinding[] {
  return bindings.map((entry) => {
    const patch = patches.find((candidate) => candidate.id === entry.id);
    if (!patch) {
      return entry;
    }

    const { reason: _reason, ...rest } = patch;
    return {
      ...entry,
      ...rest,
    };
  });
}

export function applyNegotiationResult(
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
  nextState.term_provenances = appendUniqueById(
    nextState.term_provenances ?? [],
    delta.add_term_provenances ?? [],
    "term provenance",
  );
  nextState.term_provenances = applyTermProvenancePatches(
    nextState.term_provenances,
    delta.update_term_provenances ?? [],
  );
  nextState.referent_bindings = appendUniqueById(
    nextState.referent_bindings ?? [],
    delta.add_referent_bindings ?? [],
    "referent binding",
  );
  nextState.referent_bindings = applyReferentBindingPatches(
    nextState.referent_bindings,
    delta.update_referent_bindings ?? [],
  );
  nextState.voids = appendUniqueById(nextState.voids, delta.add_voids, "void");
  nextState.voids = applyVoidPatches(nextState.voids, delta.update_voids ?? []);
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

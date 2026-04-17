import { applyReferentBindingPatches, applyTermProvenancePatches } from "./runtime-state.js";
import type {
  InterpretationOpening,
  InterpretationOpeningPatch,
  LastTurnContext,
  ProjectionSignature,
  ReferentBinding,
  ReferentBindingPatch,
  RejectedVariant,
  Section,
  SectionPatch,
  ShellState,
  StateDelta,
  TermProvenance,
  Trace,
  Void,
  VoidPatch,
} from "./types.js";

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

const USER_PROPOSED_READING_PATTERNS = [
  /という(?:理解|こと|感じ|わけ)(?:で)?(?:いい|よい)?(?:の)?(?:かな|でしょうか|ですか)?[?？]?/u,
  /\bdoes that mean\b/i,
  /\bwould it be fair to say\b/i,
];

const ANAPHORIC_EXPRESSION_PATTERNS = [
  /そのような表現/u,
  /その表現/u,
  /その語/u,
  /\bthat expression\b/i,
  /\bthis expression\b/i,
  /\bthat term\b/i,
  /\bthis term\b/i,
];

const ASSISTANT_COINAGE_PATTERNS = [
  /後で.*(?:君|あなた).*(?:表現|言い方|語|単語).*(?:使い始め|言い始め|始めた)/u,
  /(?:君|あなた).*(?:表現|言い方|語|単語).*(?:作った|創出した)/u,
  /\bafter i asked\b.*\byou started using\b/i,
  /\byou started using (?:that|this|the) (?:expression|term|phrase)\b/i,
];

const TERM_ORIGIN_PATTERNS = [
  /\borigin\b/i,
  /\bderivation\b/i,
  /\bderive\b/i,
  /\bcreate(?:d)? the term\b/i,
  /\bintroduced\b.*\bterm\b/i,
  /由来/u,
  /どこから/u,
  /創出/u,
  /作った/u,
];

const REFERENT_QUERY_PATTERNS = [
  /\brefer(?:s|red)? to\b/i,
  /\breferent\b/i,
  /何を指/u,
  /何を意味/u,
];

const CHOICE_DELEGATION_PATTERNS = [
  /\beither is fine\b/i,
  /\beither works\b/i,
  /\bwhichever\b/i,
  /\bup to you\b/i,
  /\byour call\b/i,
  /どちらでも(?:いい|よい|大丈夫)/u,
  /どっちでも(?:いい|よい|大丈夫)/u,
  /任せ(?:る|ます)/u,
  /お任せ/u,
  /好きな方(?:で|を)?/u,
];

const EXAMPLE_OPTION_PATTERNS = [
  /\bexamples?\b/i,
  /\bconcrete examples?\b/i,
  /具体例/u,
  /例(?:として|を)?/u,
];

const DEFINITION_OPTION_PATTERNS = [
  /\bdefine\b/i,
  /\bdefinition\b/i,
  /\bframe\b/i,
  /定義/u,
  /枠組/u,
];

const CLARIFICATION_OPTION_REPAIR_PATTERNS = [
  /\bwhat kind of (?:concrete )?examples?\b/i,
  /\bwhich examples?\b/i,
  /\bwhat do you mean by (?:concrete )?examples?\b/i,
  /どんな(?:具体)?例/u,
  /どういう(?:具体)?例/u,
  /例って/u,
  /具体例.*(?:何|どんな|どういう)/u,
];

const SYSTEM_SURFACE_PATTERNS = [/^system$/i, /^システム$/u];

function matchesAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function hasPremisePushback(text: string): boolean {
  return matchesAnyPattern(text, PREMISE_PUSHBACK_PATTERNS);
}

function hasHiddenPremiseLanguage(text: string): boolean {
  return matchesAnyPattern(text, HIDDEN_PREMISE_PATTERNS);
}

function hasUserProposedReading(text: string): boolean {
  return matchesAnyPattern(text, USER_PROPOSED_READING_PATTERNS);
}

function hasAnaphoricExpressionReference(text: string): boolean {
  return matchesAnyPattern(text, ANAPHORIC_EXPRESSION_PATTERNS);
}

function hasAssistantCoinageSignal(text: string): boolean {
  return matchesAnyPattern(text, ASSISTANT_COINAGE_PATTERNS);
}

function isTermOriginQuestion(text: string): boolean {
  return matchesAnyPattern(text, TERM_ORIGIN_PATTERNS);
}

function isReferentQuestion(text: string): boolean {
  return matchesAnyPattern(text, REFERENT_QUERY_PATTERNS);
}

function normalizeDiscourseKey(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[“”"'‘’「」『』]/g, "")
    .replace(/[?？!！.,，。:：]/g, " ")
    .replace(/\s+/g, " ");
}

function extractQuotedPhrases(text: string): string[] {
  const patterns = [
    /"([^"]+)"/g,
    /'([^']+)'/g,
    /「([^」]+)」/g,
    /『([^』]+)』/g,
    /“([^”]+)”/g,
    /‘([^’]+)’/g,
  ];
  const results: string[] = [];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const candidate = match[1]?.trim();
      if (candidate) {
        results.push(candidate);
      }
    }
  }

  return [...new Set(results)];
}

function isSystemSurface(surface: string): boolean {
  return SYSTEM_SURFACE_PATTERNS.some((pattern) => pattern.test(surface.trim()));
}

function appendRationaleNote(delta: StateDelta, note: string): StateDelta {
  if (delta.rationale.includes(note)) {
    return delta;
  }

  return {
    ...delta,
    rationale: `${delta.rationale} ${note}`.trim(),
  };
}

function nextIdFromCollections(
  prefix: string,
  collections: Array<Array<{ id: string }> | undefined>,
): string {
  const ids = collections.flatMap((collection) => collection ?? []).map((entry) => entry.id);
  const maxNumeric = ids.reduce((max, id) => {
    const match = new RegExp(`^${prefix}(\\d+)$`).exec(id);
    if (!match) {
      return max;
    }

    const value = Number(match[1]);
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0);

  return `${prefix}${maxNumeric + 1}`;
}

function nextTermProvenanceId(prevState: ShellState, delta: StateDelta): string {
  return nextIdFromCollections("P", [
    prevState.term_provenances,
    delta.add_term_provenances,
  ]);
}

function nextReferentBindingId(prevState: ShellState, delta: StateDelta): string {
  return nextIdFromCollections("RF", [
    prevState.referent_bindings,
    delta.add_referent_bindings,
  ]);
}

function combineById<T extends { id: string }>(
  current: T[] | undefined,
  additions: T[] | undefined,
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const entry of [...(current ?? []), ...(additions ?? [])]) {
    if (seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    result.push(entry);
  }
  return result;
}

function getProjectedTermProvenances(prevState: ShellState, delta: StateDelta): TermProvenance[] {
  return applyTermProvenancePatches(
    combineById(prevState.term_provenances, delta.add_term_provenances),
    delta.update_term_provenances ?? [],
  );
}

function getProjectedReferentBindings(prevState: ShellState, delta: StateDelta): ReferentBinding[] {
  return applyReferentBindingPatches(
    combineById(prevState.referent_bindings, delta.add_referent_bindings),
    delta.update_referent_bindings ?? [],
  );
}

function upsertEntriesById<T extends { id: string }>(
  current: T[] | undefined,
  additions: T[],
): T[] {
  const next = [...(current ?? [])];

  for (const addition of additions) {
    const index = next.findIndex((entry) => entry.id === addition.id);
    if (index === -1) {
      next.push(addition);
      continue;
    }

    next[index] = {
      ...next[index],
      ...addition,
    };
  }

  return next;
}

function getProjectedInterpretationOpenings(
  prevState: ShellState,
  delta: StateDelta,
): InterpretationOpening[] {
  const mergedPatches = upsertEntriesById<InterpretationOpeningPatch>(
    [],
    delta.update_interpretation_openings ?? [],
  );

  return combineById(prevState.interpretation_openings, delta.add_interpretation_openings).map((opening) => {
    const patch = mergedPatches.find((candidate) => candidate.id === opening.id);
    if (!patch) {
      return opening;
    }

    const { reason: _reason, ...rest } = patch;
    return {
      ...opening,
      ...rest,
    };
  });
}

function hasChoiceDelegation(text: string): boolean {
  return matchesAnyPattern(text, CHOICE_DELEGATION_PATTERNS);
}

type ClarificationOptionCue = {
  kind: "definition" | "examples";
  refersTo: string;
  surface: string;
};

function detectClarificationOptionCue(text: string): ClarificationOptionCue | undefined {
  const normalized = text.trim();
  if (!normalized) {
    return undefined;
  }

  const exampleMatch = EXAMPLE_OPTION_PATTERNS.find((pattern) => pattern.test(normalized));
  if (exampleMatch) {
    return {
      kind: "examples",
      refersTo: "the example-first option from the assistant's previous clarification",
      surface: /具体例/u.test(normalized)
        ? "具体例"
        : /\bconcrete examples?\b/i.test(normalized)
          ? "concrete examples"
          : "examples",
    };
  }

  const definitionMatch = DEFINITION_OPTION_PATTERNS.find((pattern) => pattern.test(normalized));
  if (definitionMatch) {
    return {
      kind: "definition",
      refersTo: "the definition-first option from the assistant's previous clarification",
      surface: /定義/u.test(normalized) ? "定義" : "definition",
    };
  }

  return undefined;
}

function openingMatchesClarificationCue(
  opening: InterpretationOpening,
  cue: ClarificationOptionCue,
): boolean {
  const haystack = [
    opening.label,
    opening.reading,
    opening.changes_if_selected,
    opening.clarification_prompt,
  ].join(" ");
  return cue.kind === "examples"
    ? matchesAnyPattern(haystack, EXAMPLE_OPTION_PATTERNS)
    : matchesAnyPattern(haystack, DEFINITION_OPTION_PATTERNS);
}

function collectRelevantSectionIds(prevState: ShellState, delta: StateDelta): string[] {
  const ids = new Set<string>();

  for (const section of delta.add_sections) {
    ids.add(section.id);
  }
  for (const patch of delta.update_sections) {
    ids.add(patch.id);
  }
  for (const opening of delta.add_interpretation_openings ?? []) {
    for (const sectionId of opening.related_sections) {
      ids.add(sectionId);
    }
  }
  for (const opening of prevState.interpretation_openings ?? []) {
    if (opening.status === "open" || opening.status === "selected") {
      for (const sectionId of opening.related_sections) {
        ids.add(sectionId);
      }
    }
  }

  if (ids.size === 0) {
    const activeSections = prevState.sections.filter((section) => section.status === "active");
    const [onlyActiveSection] = activeSections;
    if (activeSections.length === 1 && onlyActiveSection) {
      ids.add(onlyActiveSection.id);
    }
  }

  return [...ids];
}

function chooseLikelyConversationLocalTerm(
  prevState: ShellState,
  delta: StateDelta,
  userTurn: string,
): string | undefined {
  const relevantSectionIds = new Set(collectRelevantSectionIds(prevState, delta));
  const relatedSections = prevState.sections.filter((section) => relevantSectionIds.has(section.id));
  const [onlyRelatedSection] = relatedSections;
  if (
    hasAssistantCoinageSignal(userTurn) &&
    hasAnaphoricExpressionReference(userTurn) &&
    relatedSections.length === 1 &&
    onlyRelatedSection
  ) {
    return onlyRelatedSection.label;
  }

  const quotedTerms = extractQuotedPhrases(userTurn).filter((phrase) => !isSystemSurface(phrase));
  if (quotedTerms.length > 0) {
    return quotedTerms[0];
  }

  if (relatedSections.length === 1 && onlyRelatedSection) {
    return onlyRelatedSection.label;
  }

  const recentProvenances = getProjectedTermProvenances(prevState, delta);
  const [onlyProvenance] = recentProvenances;
  if (recentProvenances.length === 1 && onlyProvenance) {
    return onlyProvenance.term;
  }

  const [onlySection] = prevState.sections;
  if (prevState.sections.length === 1 && onlySection) {
    return onlySection.label;
  }

  return undefined;
}

function findMatchingTermProvenance(
  provenances: TermProvenance[],
  term: string,
): TermProvenance | undefined {
  const normalized = normalizeDiscourseKey(term);
  return provenances.find((entry) => normalizeDiscourseKey(entry.term) === normalized);
}

function findMatchingReferentBinding(
  bindings: ReferentBinding[],
  surface: string,
): ReferentBinding | undefined {
  const normalized = normalizeDiscourseKey(surface);
  return bindings.find((entry) => normalizeDiscourseKey(entry.surface) === normalized);
}

function extractVoidTarget(
  question: string,
  knownTerms: string[],
): string | undefined {
  const quoted = extractQuotedPhrases(question).find((phrase) => !isSystemSurface(phrase));
  if (quoted) {
    return quoted;
  }

  const normalizedQuestion = normalizeDiscourseKey(question);
  return knownTerms.find((term) => normalizedQuestion.includes(normalizeDiscourseKey(term)));
}

function classifyVoid(
  entry: Void,
  knownTerms: string[],
): { kind: "referent" | "term_origin" | "other"; target?: string } {
  if (
    entry.unresolved_blocks.some((block) => normalizeDiscourseKey(block) === "referent") ||
    isReferentQuestion(entry.question)
  ) {
    const surface = extractQuotedPhrases(entry.question)[0];
    return surface ? { kind: "referent", target: surface } : { kind: "referent" };
  }

  if (isTermOriginQuestion(entry.question)) {
    const target = extractVoidTarget(entry.question, knownTerms);
    return target ? { kind: "term_origin", target } : { kind: "term_origin" };
  }

  return { kind: "other" };
}

function remapVoidIdsInProjectionSignature(
  projectionSignature: ProjectionSignature,
  idMap: Map<string, string>,
): ProjectionSignature {
  const nextClarificationNeeds = projectionSignature.clarification_needs.map(
    (id) => idMap.get(id) ?? id,
  );
  return nextClarificationNeeds.every(
    (id, index) => id === projectionSignature.clarification_needs[index],
  )
    ? projectionSignature
    : {
        ...projectionSignature,
        clarification_needs: nextClarificationNeeds,
      };
}

function remapVoidIdsInDelta(delta: StateDelta, idMap: Map<string, string>): StateDelta {
  if (idMap.size === 0) {
    return delta;
  }

  const nextAddSections = delta.add_sections.map((section) => {
    const nextProjectionSignature = remapVoidIdsInProjectionSignature(
      section.projection_signature,
      idMap,
    );
    return nextProjectionSignature === section.projection_signature
      ? section
      : {
          ...section,
          projection_signature: nextProjectionSignature,
        };
  });

  const nextUpdateSections = delta.update_sections.map((patch) => {
    if (!patch.projection_signature) {
      return patch;
    }
    const nextProjectionSignature = remapVoidIdsInProjectionSignature(
      patch.projection_signature,
      idMap,
    );
    return nextProjectionSignature === patch.projection_signature
      ? patch
      : {
          ...patch,
          projection_signature: nextProjectionSignature,
        };
  });

  return {
    ...delta,
    add_sections: nextAddSections,
    update_sections: nextUpdateSections,
    update_voids: (delta.update_voids ?? []).map((patch) => ({
      ...patch,
      id: idMap.get(patch.id) ?? patch.id,
    })),
    resolve_voids: delta.resolve_voids.map((resolution) => ({
      ...resolution,
      id: idMap.get(resolution.id) ?? resolution.id,
    })),
    traces: delta.traces.map((trace) => ({
      ...trace,
      targets: trace.targets.map((target) => idMap.get(target) ?? target),
    })),
  };
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

export function isNonFactualDomainMode(domainMode: Section["domain_mode"] | undefined): boolean {
  return (
    domainMode === "hypothetical" ||
    domainMode === "fictional" ||
    domainMode === "symbolic"
  );
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

function collapseStaleInterpretationOpeningsForFreshNonFactualTurn(
  prevState: ShellState,
  delta: StateDelta,
): StateDelta {
  if (
    delta.version !== "v0.5" ||
    !delta.add_sections.some((section) => isNonFactualDomainMode(section.domain_mode)) ||
    (delta.add_interpretation_openings ?? []).length > 0 ||
    (delta.update_interpretation_openings ?? []).length > 0 ||
    delta.add_voids.length > 0 ||
    delta.add_negotiations.length > 0 ||
    delta.add_obstructions.length > 0
  ) {
    return delta;
  }

  const touchedSectionIds = new Set<string>();
  for (const section of delta.add_sections) {
    touchedSectionIds.add(section.id);
  }
  for (const patch of delta.update_sections) {
    touchedSectionIds.add(patch.id);
  }
  for (const opening of delta.add_interpretation_openings ?? []) {
    for (const sectionId of opening.related_sections) {
      touchedSectionIds.add(sectionId);
    }
  }
  const staleOpenings = (prevState.interpretation_openings ?? []).filter(
    (opening) =>
      opening.status === "open" &&
      opening.related_sections.length > 0 &&
      opening.related_sections.every((sectionId) => !touchedSectionIds.has(sectionId)),
  );

  if (staleOpenings.length === 0) {
    return delta;
  }

  const openingIds = staleOpenings.map((opening) => opening.id);
  const reason =
    "The turn opened a distinct non-factual branch, so unrelated older clarification openings are collapsed instead of leaking into the new answer path.";

  return appendRationaleNote(
    {
      ...delta,
      update_interpretation_openings: upsertEntriesById(
        delta.update_interpretation_openings ?? [],
        openingIds.map((id) => ({
          id,
          status: "collapsed" as const,
          reason,
        })),
      ),
      traces: [
        ...delta.traces,
        {
          id: `T-COLLAPSE-STALE-OPENINGS-${delta.turn}`,
          action: "resolve",
          targets: openingIds,
          cause: reason,
          turn: delta.turn,
        },
      ],
    },
    "Unrelated older interpretation openings were collapsed so a fresh imaginative branch would not inherit stale clarification pressure.",
  );
}

function selectClarificationOpeningFromAssistantOptionRepair(
  prevState: ShellState,
  userTurn: string,
  delta: StateDelta,
  lastTurn?: LastTurnContext,
): StateDelta {
  if (
    delta.version !== "v0.5" ||
    !lastTurn ||
    !matchesAnyPattern(userTurn, CLARIFICATION_OPTION_REPAIR_PATTERNS)
  ) {
    return delta;
  }

  const priorAnswer = lastTurn.answer.trim();
  if (
    !/\bclarif/i.test(priorAnswer) &&
    !/\bprefer\b/i.test(priorAnswer) &&
    !/\bexamples?\b/i.test(priorAnswer) &&
    !/定義|例/u.test(priorAnswer)
  ) {
    return delta;
  }

  const cue = detectClarificationOptionCue(userTurn);
  if (!cue || !detectClarificationOptionCue(priorAnswer)) {
    return delta;
  }

  const selectedOpening = getProjectedInterpretationOpenings(prevState, delta)
    .filter((opening) => opening.status === "open")
    .find((opening) => openingMatchesClarificationCue(opening, cue));
  if (!selectedOpening) {
    return delta;
  }

  const reason =
    "The user's follow-up targets one option from the assistant's prior clarification, so that opening is treated as selected rather than repeated as a fresh clarification.";
  const relatedSections = selectedOpening.related_sections;
  const projectedBindings = getProjectedReferentBindings(prevState, delta);
  const existingBinding = findMatchingReferentBinding(projectedBindings, cue.surface);

  return pruneResolvedOpeningNeedsFromSections(
    prevState,
    appendRationaleNote(
      {
        ...delta,
        update_interpretation_openings: upsertEntriesById(
          delta.update_interpretation_openings ?? [],
          [
            {
              id: selectedOpening.id,
              status: "selected" as const,
              reason,
            },
          ],
        ),
        add_referent_bindings:
          existingBinding === undefined
            ? [
                ...(delta.add_referent_bindings ?? []),
                {
                  id: nextReferentBindingId(prevState, delta),
                  surface: cue.surface,
                  refers_to: cue.refersTo,
                  kind: "concept",
                  status: "active",
                  confidence: "medium",
                  evidence: userTurn.trim(),
                  related_sections: relatedSections,
                  related_provenances: [],
                },
              ]
            : delta.add_referent_bindings ?? [],
        update_referent_bindings:
          existingBinding === undefined
            ? delta.update_referent_bindings ?? []
            : upsertEntriesById(
                delta.update_referent_bindings ?? [],
                [
                  {
                    id: existingBinding.id,
                    reason,
                    refers_to: cue.refersTo,
                    status: "active",
                    confidence: "medium",
                    evidence: userTurn.trim(),
                    ...(relatedSections.length > 0 ? { related_sections: relatedSections } : {}),
                  },
                ],
              ),
        traces: delta.traces.some((trace) => trace.id === `T-SELECT-CLARIFICATION-OPTION-${delta.turn}`)
          ? delta.traces
          : [
              ...delta.traces,
              {
                id: `T-SELECT-CLARIFICATION-OPTION-${delta.turn}`,
                action: "resolve",
                targets: [selectedOpening.id],
                cause: reason,
                turn: delta.turn,
              },
            ],
      },
      "A follow-up question about one previously offered option is treated as selecting that option, not as restarting the same clarification loop.",
    ),
    [selectedOpening.id],
  );
}

function collapseClarificationOpeningsOnDelegatedChoice(
  prevState: ShellState,
  userTurn: string,
  delta: StateDelta,
): StateDelta {
  if (delta.version !== "v0.5" || !hasChoiceDelegation(userTurn)) {
    return delta;
  }

  const collapsibleOpeningIds = getProjectedInterpretationOpenings(prevState, delta)
    .filter(
      (opening) =>
        opening.status === "open" && opening.collapsible_with_one_clarification,
    )
    .map((opening) => opening.id);

  if (collapsibleOpeningIds.length === 0) {
    return delta;
  }

  const reason =
    "The user delegated the structural choice back to the assistant, so this clarification no longer blocks answering.";

  return pruneResolvedOpeningNeedsFromSections(
    prevState,
    appendRationaleNote(
      {
        ...delta,
        update_interpretation_openings: upsertEntriesById(
          delta.update_interpretation_openings ?? [],
          collapsibleOpeningIds.map((id) => ({
            id,
            status: "collapsed" as const,
            reason,
          })),
        ),
        traces: delta.traces.some((trace) => trace.id === `T-COLLAPSE-DELEGATED-CHOICE-${delta.turn}`)
          ? delta.traces
          : [
              ...delta.traces,
              {
                id: `T-COLLAPSE-DELEGATED-CHOICE-${delta.turn}`,
                action: "resolve",
                targets: collapsibleOpeningIds,
                cause: reason,
                turn: delta.turn,
              },
            ],
      },
      "The user's delegation collapsed clarification openings so the next answer can cash out instead of asking again.",
    ),
    collapsibleOpeningIds,
  );
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

function pruneSuppressedVoidClarificationNeeds(
  projectionSignature: ProjectionSignature,
  suppressedVoidIds: Set<string>,
): ProjectionSignature {
  const nextClarificationNeeds = projectionSignature.clarification_needs.filter(
    (id) => !suppressedVoidIds.has(id),
  );

  return nextClarificationNeeds.length === projectionSignature.clarification_needs.length
    ? projectionSignature
    : {
        ...projectionSignature,
        clarification_needs: nextClarificationNeeds,
      };
}

function pruneResolvedClarificationNeeds(
  projectionSignature: ProjectionSignature,
  resolvedOpeningIds: Set<string>,
): ProjectionSignature {
  const nextClarificationNeeds = projectionSignature.clarification_needs.filter(
    (id) => !resolvedOpeningIds.has(id),
  );

  return nextClarificationNeeds.length === projectionSignature.clarification_needs.length
    ? projectionSignature
    : {
        ...projectionSignature,
        clarification_needs: nextClarificationNeeds,
      };
}

function pruneResolvedOpeningNeedsFromSections(
  prevState: ShellState,
  delta: StateDelta,
  openingIds: string[],
): StateDelta {
  if (openingIds.length === 0) {
    return delta;
  }

  const openingIdSet = new Set(openingIds);
  const relatedSectionIds = new Set<string>();
  for (const opening of combineById(prevState.interpretation_openings, delta.add_interpretation_openings)) {
    if (!openingIdSet.has(opening.id)) {
      continue;
    }
    for (const sectionId of opening.related_sections) {
      relatedSectionIds.add(sectionId);
    }
  }

  let touched = false;
  const nextAddSections = delta.add_sections.map((section) => {
    if (!relatedSectionIds.has(section.id)) {
      return section;
    }

    const nextProjectionSignature = pruneResolvedClarificationNeeds(
      section.projection_signature,
      openingIdSet,
    );
    if (nextProjectionSignature === section.projection_signature) {
      return section;
    }

    touched = true;
    return {
      ...section,
      projection_signature: nextProjectionSignature,
    };
  });

  const nextUpdateSections = [...delta.update_sections];
  for (const sectionId of relatedSectionIds) {
    const baseSection = prevState.sections.find((section) => section.id === sectionId);
    const patchIndex = nextUpdateSections.findIndex((patch) => patch.id === sectionId);
    const currentPatch = patchIndex === -1 ? undefined : nextUpdateSections[patchIndex];
    const sourceProjectionSignature = currentPatch?.projection_signature ?? baseSection?.projection_signature;
    if (!sourceProjectionSignature) {
      continue;
    }

    const nextProjectionSignature = pruneResolvedClarificationNeeds(
      sourceProjectionSignature,
      openingIdSet,
    );
    if (nextProjectionSignature === sourceProjectionSignature) {
      continue;
    }

    touched = true;
    if (currentPatch) {
      nextUpdateSections[patchIndex] = {
        ...currentPatch,
        projection_signature: nextProjectionSignature,
      };
      continue;
    }

    nextUpdateSections.push({
      id: sectionId,
      projection_signature: nextProjectionSignature,
    });
  }

  return touched
    ? {
        ...delta,
        add_sections: nextAddSections,
        update_sections: nextUpdateSections,
      }
    : delta;
}

function pruneSuppressedVoidTargetsFromTraces(
  traces: Trace[],
  suppressedVoidIds: Set<string>,
): Trace[] {
  return traces
    .map((trace) => {
      const nextTargets = trace.targets.filter((target) => !suppressedVoidIds.has(target));
      if (nextTargets.length === trace.targets.length) {
        return trace;
      }

      if (trace.targets.length > 0 && nextTargets.length === 0) {
        return undefined;
      }

      return {
        ...trace,
        targets: nextTargets,
      };
    })
    .filter((trace): trace is Trace => trace !== undefined);
}

function pruneSuppressedVoidsFromDelta(delta: StateDelta, suppressedVoidIds: Set<string>): StateDelta {
  if (suppressedVoidIds.size === 0) {
    return delta;
  }

  return {
    ...delta,
    add_sections: delta.add_sections.map((section) => {
      const nextProjectionSignature = pruneSuppressedVoidClarificationNeeds(
        section.projection_signature,
        suppressedVoidIds,
      );
      return nextProjectionSignature === section.projection_signature
        ? section
        : {
            ...section,
            projection_signature: nextProjectionSignature,
          };
    }),
    update_sections: delta.update_sections.map((section) => {
      if (!section.projection_signature) {
        return section;
      }

      const nextProjectionSignature = pruneSuppressedVoidClarificationNeeds(
        section.projection_signature,
        suppressedVoidIds,
      );
      return nextProjectionSignature === section.projection_signature
        ? section
        : {
            ...section,
            projection_signature: nextProjectionSignature,
          };
    }),
    add_voids: delta.add_voids.filter((entry) => !suppressedVoidIds.has(entry.id)),
    update_voids: (delta.update_voids ?? []).filter((entry) => !suppressedVoidIds.has(entry.id)),
    resolve_voids: delta.resolve_voids.filter((entry) => !suppressedVoidIds.has(entry.id)),
    traces: pruneSuppressedVoidTargetsFromTraces(delta.traces, suppressedVoidIds),
  };
}

function suppressCreativeDomainContentVoids(prevState: ShellState, delta: StateDelta): StateDelta {
  if (delta.version !== "v0.5" || !hasActiveNonFactualSectionAfterDelta(prevState, delta)) {
    return delta;
  }

  const nextVoids = delta.add_voids.filter((entry) => !isCreativeDomainContentVoid(entry));
  if (nextVoids.length === delta.add_voids.length) {
    return delta;
  }

  const suppressedVoidIds = new Set(
    delta.add_voids
      .filter((entry) => isCreativeDomainContentVoid(entry))
      .map((entry) => entry.id),
  );
  const nextDelta = pruneSuppressedVoidsFromDelta(delta, suppressedVoidIds);
  return {
    ...nextDelta,
    add_voids: nextVoids,
  };
}

function preferUserProposedReadingInNonFactualDomains(
  prevState: ShellState,
  userTurn: string,
  delta: StateDelta,
): StateDelta {
  if (
    delta.version !== "v0.5" ||
    !hasActiveNonFactualSectionAfterDelta(prevState, delta) ||
    !hasUserProposedReading(userTurn)
  ) {
    return delta;
  }

  if (
    (delta.add_interpretation_openings ?? []).length !== 1 ||
    delta.add_voids.length > 0 ||
    delta.add_negotiations.length > 0 ||
    delta.add_obstructions.length > 0
  ) {
    return delta;
  }

  const [opening] = delta.add_interpretation_openings ?? [];
  if (!opening || opening.status !== "open") {
    return delta;
  }

  const selectedOpeningId = opening.id;
  const nextAddInterpretationOpenings: InterpretationOpening[] = (
    delta.add_interpretation_openings ?? []
  ).map((entry) =>
    entry.id === selectedOpeningId
      ? {
          ...entry,
          status: "selected" as const,
        }
      : entry,
  );
  let traceTouched = false;
  const nextTraces: Trace[] = delta.traces.map((trace) => {
    if (!trace.targets.includes(selectedOpeningId)) {
      return trace;
    }

    traceTouched = true;
    return trace.action === "project"
      ? {
          ...trace,
          action: "resolve" as const,
          cause:
            "The user already proposed a workable reading for the non-factual section, so this opening can be provisionally treated as selected rather than reopened as a fresh clarification.",
        }
      : trace;
  });

  if (!traceTouched) {
    nextTraces.push({
      id: `T-SELECT-PROPOSED-READING-${delta.turn}`,
      action: "resolve",
      targets: [selectedOpeningId],
      cause:
        "The user already proposed a workable reading for the non-factual section, so this opening can be provisionally treated as selected rather than reopened as a fresh clarification.",
      turn: delta.turn,
    });
  }

  return {
    ...delta,
    add_interpretation_openings: nextAddInterpretationOpenings,
    rationale: `${delta.rationale} The user already supplied a candidate reading, so the new opening is provisionally selected rather than left open.`.trim(),
    traces: nextTraces,
  };
}

function inferAssistantCoinageTermProvenance(
  prevState: ShellState,
  userTurn: string,
  delta: StateDelta,
): StateDelta {
  if (delta.version !== "v0.5" || !hasAssistantCoinageSignal(userTurn)) {
    return delta;
  }

  const term = chooseLikelyConversationLocalTerm(prevState, delta, userTurn);
  if (!term) {
    return delta;
  }

  const relatedSections = collectRelevantSectionIds(prevState, delta);
  const projectedProvenances = getProjectedTermProvenances(prevState, delta);
  const existing = findMatchingTermProvenance(projectedProvenances, term);

  if (existing) {
    if (existing.origin === "assistant_coinage") {
      return delta;
    }

    return appendRationaleNote(
      {
        ...delta,
        update_term_provenances: [
          ...(delta.update_term_provenances ?? []),
          {
            id: existing.id,
            reason:
              "The user explicitly located this term as a conversation-local assistant coinage, so provenance should be updated rather than left implicit.",
            origin: "assistant_coinage",
            confidence: "high",
            evidence: userTurn.trim(),
            ...(relatedSections.length > 0 ? { related_sections: relatedSections } : {}),
          },
        ],
      },
      "The user's correction made the local term provenance explicit, so the conversation now records that provenance directly.",
    );
  }

  return appendRationaleNote(
    {
      ...delta,
      add_term_provenances: [
        ...(delta.add_term_provenances ?? []),
        {
          id: nextTermProvenanceId(prevState, delta),
          term,
          origin: "assistant_coinage",
          confidence: "high",
          evidence: userTurn.trim(),
          first_turn: delta.turn,
          related_sections: relatedSections,
          related_referents: [],
        },
      ],
    },
    "The user's correction made the local term provenance explicit, so the conversation now records that provenance directly.",
  );
}

function materializeSystemReferentBinding(
  prevState: ShellState,
  userTurn: string,
  delta: StateDelta,
): StateDelta {
  if (delta.version !== "v0.5") {
    return delta;
  }

  const surfaces = new Set<string>();
  const userTurnQuotedSurfaces = extractQuotedPhrases(userTurn);
  if (isReferentQuestion(userTurn)) {
    for (const surface of userTurnQuotedSurfaces) {
      if (isSystemSurface(surface)) {
        surfaces.add(surface);
      }
    }
  }

  const projectedProvenances = getProjectedTermProvenances(prevState, delta);
  const relatedProvenances = projectedProvenances.map((entry) => entry.id);
  for (const entry of delta.add_voids) {
    const classification = classifyVoid(entry, projectedProvenances.map((item) => item.term));
    if (classification.kind === "referent" && classification.target && isSystemSurface(classification.target)) {
      surfaces.add(classification.target);
    }
  }

  if (surfaces.size === 0) {
    return delta;
  }

  const projectedBindings = getProjectedReferentBindings(prevState, delta);
  const relatedSections = collectRelevantSectionIds(prevState, delta);
  const additions: ReferentBinding[] = [];
  const updates: ReferentBindingPatch[] = [];

  for (const surface of surfaces) {
    const existing = findMatchingReferentBinding(projectedBindings, surface);
    if (!existing) {
      additions.push({
        id: nextReferentBindingId(prevState, {
          ...delta,
          add_referent_bindings: [...(delta.add_referent_bindings ?? []), ...additions],
        }),
        surface,
        refers_to: "the assistant generating this conversation",
        kind: "speaker",
        status: "active",
        confidence: "medium",
        evidence:
          "In this conversation, 'system' is used as a local handle for the assistant/runtime producing the current answer.",
        related_sections: relatedSections,
        related_provenances: relatedProvenances,
      });
      continue;
    }

    if (
      existing.status !== "active" ||
      normalizeDiscourseKey(existing.refers_to) !==
        normalizeDiscourseKey("the assistant generating this conversation")
    ) {
      updates.push({
        id: existing.id,
        reason:
          "The referent of 'system' is being stabilized as the assistant/runtime speaking in this conversation.",
        refers_to: "the assistant generating this conversation",
        status: "active",
        confidence: "medium",
        evidence:
          "In this conversation, 'system' is used as a local handle for the assistant/runtime producing the current answer.",
        ...(relatedSections.length > 0 ? { related_sections: relatedSections } : {}),
        ...(relatedProvenances.length > 0 ? { related_provenances: relatedProvenances } : {}),
      });
    }
  }

  if (additions.length === 0 && updates.length === 0) {
    return delta;
  }

  return appendRationaleNote(
    {
      ...delta,
      add_referent_bindings: [...(delta.add_referent_bindings ?? []), ...additions],
      update_referent_bindings: [...(delta.update_referent_bindings ?? []), ...updates],
    },
    "The local referent of 'system' was stabilized so later turns can reuse it without reopening the same ambiguity.",
  );
}

function suppressKnownContextVoids(prevState: ShellState, delta: StateDelta): StateDelta {
  if (delta.version !== "v0.5" || delta.add_voids.length === 0) {
    return delta;
  }

  const projectedProvenances = getProjectedTermProvenances(prevState, delta);
  const projectedBindings = getProjectedReferentBindings(prevState, delta);
  const knownTerms = [
    ...projectedProvenances.map((entry) => entry.term),
    ...prevState.sections.map((section) => section.label),
  ];
  const suppressedVoidIds = new Set<string>();

  for (const entry of delta.add_voids) {
    const classification = classifyVoid(entry, knownTerms);
    if (classification.kind === "term_origin") {
      const matchingProvenance =
        (classification.target
          ? findMatchingTermProvenance(projectedProvenances, classification.target)
          : undefined) ?? (projectedProvenances.length === 1 ? projectedProvenances[0] : undefined);
      if (matchingProvenance) {
        suppressedVoidIds.add(entry.id);
      }
      continue;
    }

    if (classification.kind === "referent") {
      const matchingBinding =
        (classification.target
          ? findMatchingReferentBinding(projectedBindings, classification.target)
          : undefined) ?? (projectedBindings.length === 1 ? projectedBindings[0] : undefined);
      if (matchingBinding) {
        suppressedVoidIds.add(entry.id);
      }
    }
  }

  if (suppressedVoidIds.size === 0) {
    return delta;
  }

  return appendRationaleNote(
    pruneSuppressedVoidsFromDelta(delta, suppressedVoidIds),
    "Voids that were already answerable from tracked provenance or referent bindings were suppressed instead of being reintroduced.",
  );
}

function arraysEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

function findSemanticallyMatchingVoid(
  prevState: ShellState,
  entry: Void,
  knownTerms: string[],
): Void | undefined {
  const incoming = classifyVoid(entry, knownTerms);
  if (incoming.kind === "other") {
    return undefined;
  }

  return prevState.voids.find((candidate) => {
    const existing = classifyVoid(candidate, knownTerms);
    if (existing.kind !== incoming.kind) {
      return false;
    }

    if (incoming.target && existing.target) {
      return normalizeDiscourseKey(incoming.target) === normalizeDiscourseKey(existing.target);
    }

    return true;
  });
}

function buildVoidReopenPatch(existing: Void, incoming: Void): VoidPatch {
  const shouldReopen = existing.status === "resolved" && incoming.status !== "resolved";
  return {
    id: existing.id,
    reason:
      existing.id === incoming.id
        ? "This dependency already exists in state, so it is being updated rather than added again."
        : "This new void matches an existing dependency and is being folded back into that tracked void.",
    ...(incoming.question !== existing.question ? { question: incoming.question } : {}),
    ...(incoming.effect !== existing.effect ? { effect: incoming.effect } : {}),
    ...(incoming.effect_scope !== existing.effect_scope
      ? { effect_scope: incoming.effect_scope }
      : {}),
    ...(!arraysEqual(incoming.coupled_with, existing.coupled_with)
      ? { coupled_with: incoming.coupled_with }
      : {}),
    ...(incoming.coupling_mode !== existing.coupling_mode
      ? { coupling_mode: incoming.coupling_mode }
      : {}),
    ...(incoming.resolution_priority !== existing.resolution_priority
      ? { resolution_priority: incoming.resolution_priority }
      : {}),
    ...(!arraysEqual(incoming.unresolved_blocks, existing.unresolved_blocks)
      ? { unresolved_blocks: incoming.unresolved_blocks }
      : {}),
    ...(incoming.exposure_required_if_touched !== existing.exposure_required_if_touched
      ? { exposure_required_if_touched: incoming.exposure_required_if_touched }
      : {}),
    ...(shouldReopen
      ? { status: "open" as const }
      : incoming.status !== existing.status
        ? { status: incoming.status }
        : {}),
    ...(!arraysEqual(incoming.resolution_requires, existing.resolution_requires)
      ? { resolution_requires: incoming.resolution_requires }
      : {}),
  };
}

function reopenOrReuseExistingVoids(prevState: ShellState, delta: StateDelta): StateDelta {
  if (delta.version !== "v0.5" || delta.add_voids.length === 0) {
    return delta;
  }

  const knownTerms = [
    ...getProjectedTermProvenances(prevState, delta).map((entry) => entry.term),
    ...prevState.sections.map((section) => section.label),
  ];
  const keptVoids: Void[] = [];
  const generatedUpdates: VoidPatch[] = [];
  const idMap = new Map<string, string>();

  for (const entry of delta.add_voids) {
    const existing =
      prevState.voids.find((candidate) => candidate.id === entry.id) ??
      findSemanticallyMatchingVoid(prevState, entry, knownTerms);

    if (!existing) {
      keptVoids.push(entry);
      continue;
    }

    generatedUpdates.push(buildVoidReopenPatch(existing, entry));
    if (entry.id !== existing.id) {
      idMap.set(entry.id, existing.id);
    }
  }

  if (generatedUpdates.length === 0) {
    return delta;
  }

  return appendRationaleNote(
    remapVoidIdsInDelta(
      {
        ...delta,
        add_voids: keptVoids,
        update_voids: [...(delta.update_voids ?? []), ...generatedUpdates],
      },
      idMap,
    ),
    "Existing voids were reopened or updated instead of duplicating the same dependency with a fresh id.",
  );
}

export function postProcessStateDelta(
  prevState: ShellState,
  userTurn: string,
  delta: StateDelta,
  lastTurn?: LastTurnContext,
): StateDelta {
  return suppressCreativeDomainContentVoids(
    prevState,
    collapseClarificationOpeningsOnDelegatedChoice(
      prevState,
      userTurn,
      preferUserProposedReadingInNonFactualDomains(
        prevState,
        userTurn,
        reopenOrReuseExistingVoids(
          prevState,
          suppressKnownContextVoids(
            prevState,
            materializeSystemReferentBinding(
              prevState,
              userTurn,
              inferAssistantCoinageTermProvenance(
                prevState,
                userTurn,
                selectClarificationOpeningFromAssistantOptionRepair(
                  prevState,
                  userTurn,
                  collapseStaleInterpretationOpeningsForFreshNonFactualTurn(
                    prevState,
                    promoteRepeatedPremisePushbackToRejectedVariant(
                      prevState,
                      userTurn,
                      delta,
                    ),
                  ),
                  lastTurn,
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

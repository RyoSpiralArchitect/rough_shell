import { readFile } from "node:fs/promises";
import type { ShellState } from "@rough-shell/core";
import type { ViewerSession } from "./types.js";

// Explicit application-state view. Never embed pass logs, prompts, raw provider
// responses, delta rationales, or any arbitrary field from a turn artifact.
export function selectState(state: ShellState) {
  return {
    version: state.version,
    turn: state.turn,
    sections: state.sections.map(({ id, label, gist, domain_mode, status }) => ({
      id, label, gist, domain_mode: domain_mode ?? "factual", status,
    })),
    interpretation_openings: (state.interpretation_openings ?? []).map(({
      id, label, reading, changes_if_selected, status,
    }) => ({ id, label, reading, changes_if_selected, status })),
    rejected_variants: (state.rejected_variants ?? []).map(({
      id, label, summary, reason, rejected_by, turn,
    }) => ({ id, label, summary, reason, rejected_by, turn })),
    voids: state.voids.map(({ id, question, status }) => ({ id, question, status })),
  };
}

export function selectSession(session: ViewerSession) {
  if (session.turns.length === 0) throw new Error("No completed turns to display.");
  return {
    title: session.title,
    description: session.description,
    source: session.source,
    turns: session.turns.map((turn) => ({
      label: turn.label,
      user: turn.user,
      answer: turn.answer,
      audit: turn.audit,
      stateBefore: selectState(turn.stateBefore),
      stateAfter: selectState(turn.stateAfter),
    })),
  };
}

export function serializeData(data: unknown): string {
  // A JSON script element is still parsed as HTML. Escape '<' so user text
  // cannot close it; the renderer also writes text with textContent only.
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export async function renderViewer(session: ViewerSession): Promise<string> {
  const [template, css, js] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/style.css", import.meta.url), "utf8"),
    readFile(new URL("../public/viewer.js", import.meta.url), "utf8"),
  ]);
  return template.replace("/* VIEWER_CSS */", () => css)
    .replace("/* VIEWER_JS */", () => js)
    .replace("/* VIEWER_DATA */", () => serializeData(selectSession(session)));
}

import type { AuditResult, ShellState } from "@rough-shell/core";

/** Internal view model. render.ts allowlists the fields embedded into HTML. */
export interface ViewerTurn {
  label: string;
  user: string;
  answer: string;
  stateBefore: ShellState;
  stateAfter: ShellState;
  audit: AuditResult["verdict"];
}

export interface ViewerSession {
  title: string;
  description: string;
  source: string;
  turns: ViewerTurn[];
}

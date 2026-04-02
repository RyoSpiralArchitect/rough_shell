import { readFileSync } from "node:fs";
import { join } from "node:path";

import { findRepositoryRoot } from "./schema-registry.js";
import type { PassName, PromptSet, PromptTemplate } from "./types.js";

const PASS_REGEX: Record<PassName, RegExp> = {
  state_updater:
    /## Pass 1 — StateUpdater[\s\S]*?### System prompt\s+```text\n([\s\S]*?)```\s+### User prompt template\s+```text\n([\s\S]*?)```/m,
  negotiator:
    /## Pass 2 — Negotiator[\s\S]*?### System prompt\s+```text\n([\s\S]*?)```\s+### User prompt template\s+```text\n([\s\S]*?)```/m,
  project_compiler:
    /## Pass 3 — ProjectCompiler[\s\S]*?### System prompt\s+```text\n([\s\S]*?)```\s+### User prompt template\s+```text\n([\s\S]*?)```/m,
  auditor:
    /## Pass 4 — Auditor[\s\S]*?### System prompt\s+```text\n([\s\S]*?)```\s+### User prompt template\s+```text\n([\s\S]*?)```/m,
};

function normalizePrompt(prompt: string): string {
  return prompt.trim().replace(/\r\n/g, "\n");
}

function extractTemplate(source: string, pass: PassName): PromptTemplate {
  const match = PASS_REGEX[pass].exec(source);
  if (!match) {
    throw new Error(`Could not extract prompt template for ${pass}.`);
  }

  const [, systemPrompt, userPromptTemplate] = match;
  if (systemPrompt === undefined || userPromptTemplate === undefined) {
    throw new Error(`Prompt template for ${pass} was malformed.`);
  }

  return {
    systemPrompt: normalizePrompt(systemPrompt),
    userPromptTemplate: normalizePrompt(userPromptTemplate),
  };
}

export function loadPromptSet(repoRoot = findRepositoryRoot()): PromptSet {
  const promptFilePath = join(repoRoot, "rough_shell_v0_4_prompts.md");
  const markdown = readFileSync(promptFilePath, "utf8");

  return {
    auditor: extractTemplate(markdown, "auditor"),
    negotiator: extractTemplate(markdown, "negotiator"),
    project_compiler: extractTemplate(markdown, "project_compiler"),
    state_updater: extractTemplate(markdown, "state_updater"),
  };
}

export function renderUserPrompt(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_full, token: string) => {
    if (!(token in values)) {
      throw new Error(`Missing prompt variable ${token}.`);
    }

    return values[token] ?? "";
  });
}

import { strict as assert } from "node:assert";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const { loadPromptSet, renderUserPrompt } = await import(
  new URL("../packages/core/dist/index.js", import.meta.url)
);

const promptSet = loadPromptSet(repoRoot);

for (const [passName, template] of Object.entries(promptSet)) {
  assert.ok(template.systemPrompt.trim().length > 0, `${passName} is missing a system prompt`);
  assert.ok(
    template.userPromptTemplate.trim().length > 0,
    `${passName} is missing a user prompt template`,
  );

  const tokens = [
    ...template.userPromptTemplate.matchAll(/\{\{([A-Z0-9_]+)\}\}/g),
  ].map((match) => match[1]);
  const values = Object.fromEntries(tokens.map((token) => [token, `<${token}>`]));
  const rendered = renderUserPrompt(template.userPromptTemplate, values);

  assert.ok(
    !/\{\{[A-Z0-9_]+\}\}/.test(rendered),
    `${passName} left an unreplaced prompt token behind`,
  );
  assert.ok(rendered.includes("PREV_STATE_JSON:") || rendered.includes("CURRENT_STATE_JSON:"));
}

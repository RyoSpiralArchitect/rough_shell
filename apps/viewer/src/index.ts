import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildDemo } from "./demo.js";
import { loadSession } from "./load-session.js";
import { renderViewer } from "./render.js";

async function main() {
  const args = process.argv.slice(2);
  let sessionDirectory: string | undefined;
  let output = ".rough-shell-runs/dialogue-viewer.html";
  let demo = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--help") {
      console.log("Usage: npm run viewer -- [--demo | --session <directory>] [--out <file.html>]\nDefault: offline scripted desert-mermaid demo. Open the generated HTML in any browser.");
      return;
    }
    if (arg === "--demo") { demo = true; continue; }
    if (arg === "--session" || arg === "--out") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      if (arg === "--session") sessionDirectory = value; else output = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}. Use --help.`);
  }
  if (demo && sessionDirectory) throw new Error("Choose --demo or --session, not both.");
  const session = sessionDirectory ? await loadSession(resolve(sessionDirectory)) : await buildDemo();
  const file = resolve(output);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, await renderViewer(session), "utf8");
  console.log(`Wrote ${session.turns.length} turns to ${file}\nOpen this HTML file in your browser. It works offline and makes no API calls.`);
  if (sessionDirectory) console.log("This export contains dialogue and selected application-state fields. Review before sharing.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

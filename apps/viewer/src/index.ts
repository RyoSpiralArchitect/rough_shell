import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildDemo } from "./demo.js";
import { buildForkDemo } from "./fork-demo.js";
import { loadSession } from "./load-session.js";
import { renderComparison, renderViewer } from "./render.js";

async function main() {
  const args = process.argv.slice(2);
  let sessionDirectory: string | undefined;
  let output = ".rough-shell-runs/dialogue-viewer.html";
  let demo = false;
  let forkDemo = false;
  let compareDirectory: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--help") {
      console.log("Usage: npm run viewer -- [--demo | --fork-demo | --session <directory> [--compare <directory>]] [--out <file.html>]\nDefault: offline scripted desert-mermaid demo. --fork-demo saves two branches and exports their comparison.");
      return;
    }
    if (arg === "--demo") { demo = true; continue; }
    if (arg === "--fork-demo") { forkDemo = true; continue; }
    if (arg === "--session" || arg === "--out" || arg === "--compare") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      if (arg === "--session") sessionDirectory = value;
      else if (arg === "--compare") compareDirectory = value;
      else output = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}. Use --help.`);
  }
  if (demo && sessionDirectory) throw new Error("Choose --demo or --session, not both.");
  if (forkDemo && (demo || sessionDirectory || compareDirectory)) throw new Error("Use --fork-demo on its own.");
  if (compareDirectory && !sessionDirectory) throw new Error("--compare requires --session.");
  if (forkDemo) {
    const branches = await buildForkDemo(resolve(".rough-shell-runs"));
    const file = resolve(output);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, await renderComparison(branches.left, branches.right), "utf8");
    console.log(`Wrote fork comparison to ${file}\nOriginal session: ${branches.originalDirectory}\nFork session: ${branches.forkDirectory}\nScripted fixture; no API calls. Fork either saved session with --fork and --at-turn.`);
    return;
  }
  const session = sessionDirectory ? await loadSession(resolve(sessionDirectory)) : await buildDemo();
  const comparison = compareDirectory ? await loadSession(resolve(compareDirectory)) : undefined;
  const file = resolve(output);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, comparison ? await renderComparison(session, comparison) : await renderViewer(session), "utf8");
  console.log(comparison
    ? `Wrote comparison (${session.turns.length} / ${comparison.turns.length} turns) to ${file}\nOpen this HTML file in your browser. It works offline and makes no API calls.`
    : `Wrote ${session.turns.length} turns to ${file}\nOpen this HTML file in your browser. It works offline and makes no API calls.`);
  if (sessionDirectory) console.log("This export contains dialogue and selected application-state fields. Review before sharing.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

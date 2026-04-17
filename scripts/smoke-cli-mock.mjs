import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const artifactsDir = await mkdtemp(join(tmpdir(), "rough-shell-smoke-"));

try {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [
      "apps/cli/dist/index.js",
      "--provider",
      "mock",
      "--artifacts",
      artifactsDir,
      "--once",
      "文字数は少ないが情報量が多い状態とは？",
    ],
    {
      cwd: repoRoot,
      timeout: 30_000,
    },
  );

  assert.match(stdout, /assistant>/, "mock CLI smoke did not print an assistant response");
  assert.match(stdout, /audit verdict: pass/, "mock CLI smoke did not reach a passing audit");
  assert.equal(stderr.trim(), "", "mock CLI smoke wrote to stderr");
} finally {
  await rm(artifactsDir, { force: true, recursive: true });
}

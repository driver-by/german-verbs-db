import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parserLooksBroken } from "../src/scrape.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Runs in a copy of the project with fetch stubbed, so a command that starts
// on import can touch neither the network nor the real database and state file.
function importInCopy(modulePath) {
  const dir = mkdtempSync(join(tmpdir(), "german-verbs-entry-"));
  try {
    cpSync(join(root, "src"), join(dir, "src"), { recursive: true });
    cpSync(join(root, "schema.sql"), join(dir, "schema.sql"));
    cpSync(join(root, "package.json"), join(dir, "package.json"));
    symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
    writeFileSync(
      join(dir, "stub.mjs"),
      'globalThis.fetch = async () => { throw new Error("no network in tests"); };\n'
    );
    return spawnSync(
      process.execPath,
      [
        "--import",
        "./stub.mjs",
        "--input-type=module",
        "-e",
        `await import("${modulePath}");`,
      ],
      {
        cwd: dir,
        encoding: "utf-8",
        env: { ...process.env, WIKIMEDIA_CONTACT: "https://example.org" },
      }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const modulePath of ["./src/scrape.js", "./src/frequency.js"]) {
  test(`importing ${modulePath} does not start it`, () => {
    const result = importInCopy(modulePath);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.equal(result.status, 0);
  });
}

test("a run stops if its first 25 pages yield no verbs", () => {
  assert.equal(parserLooksBroken({ parsed: 0, attempted: 24 }), false);
  assert.equal(parserLooksBroken({ parsed: 0, attempted: 25 }), true);
  assert.equal(parserLooksBroken({ parsed: 1, attempted: 500 }), false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = readFileSync(join(root, "test/fixtures/gehen.html"), "utf-8");

/**
 * Run a command in a copy of the project, so the real database and state file
 * stay untouched. `respond` is the source of a stub for fetch; it receives the
 * page title and returns { status, body }. Delays are removed.
 */
function runInCopy({ args, state, respond }) {
  const dir = mkdtempSync(join(tmpdir(), "german-verbs-scrape-"));
  try {
    cpSync(join(root, "src"), join(dir, "src"), { recursive: true });
    cpSync(join(root, "schema.sql"), join(dir, "schema.sql"));
    cpSync(join(root, "package.json"), join(dir, "package.json"));
    symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
    writeFileSync(join(dir, "fixture.html"), fixture);
    writeFileSync(
      join(dir, "stub.mjs"),
      `import { readFileSync } from "node:fs";
const fixture = readFileSync("fixture.html", "utf-8");
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, _ms, ...rest) => realSetTimeout(fn, 0, ...rest);
const respond = ${respond};
globalThis.fetch = async (url) => {
  const { status = 200, body } = respond(new URL(url).searchParams.get("page"), fixture);
  return Response.json(body, { status });
};
`
    );
    if (state) {
      writeFileSync(join(dir, ".scraper-state.json"), JSON.stringify(state));
    }

    const result = spawnSync(
      process.execPath,
      ["--import", "./stub.mjs", "src/index.js", ...args],
      {
        cwd: dir,
        encoding: "utf-8",
        env: { ...process.env, WIKIMEDIA_CONTACT: "https://example.org" },
      }
    );

    const dbPath = join(dir, "german-verbs.db");
    const db = existsSync(dbPath) ? new Database(dbPath) : null;
    const dbResult = db && {
      verbs: db.prepare("SELECT infinitive, separable_prefix FROM verbs").all(),
      retrievedAt: Object.fromEntries(
        db.prepare("SELECT key, retrieved_at FROM sources").all().map((row) => [
          row.key,
          row.retrieved_at,
        ])
      ),
    };
    db?.close();

    const statePath = join(dir, ".scraper-state.json");
    return {
      status: result.status,
      output: result.stdout + result.stderr,
      db: dbResult,
      state: existsSync(statePath)
        ? JSON.parse(readFileSync(statePath, "utf-8"))
        : null,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function conjugationState(verbs, extra = {}) {
  return {
    phase: "fetching_conjugations",
    verbListContinueToken: null,
    verbList: verbs.map((verb) => `Flexion:${verb}`),
    processedVerbIndex: -1,
    lastUpdated: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

const manyVerbs = Array.from({ length: 30 }, (_, i) => `verb${i}`);

const PAGE = `(page, fixture) => ({
  body: { parse: { revid: 1, text: { "*": fixture } } },
})`;
const MISSING = `() => ({ body: { error: { code: "missingtitle" } } })`;

test("a failed request stops the run on that verb, for --resume to retry", () => {
  const result = runInCopy({
    args: ["scrape", "--resume"],
    state: conjugationState(["eins", "zwei", "drei"]),
    respond: `(page, fixture) =>
      page === "Flexion:zwei"
        ? { status: 403, body: {} }
        : { body: { parse: { revid: 1, text: { "*": fixture } } } }`,
  });

  assert.equal(result.status, 1, result.output);
  assert.equal(result.state.phase, "fetching_conjugations");
  assert.equal(result.state.processedVerbIndex, 0);
  assert.deepEqual(
    result.db.verbs.map((verb) => verb.infinitive),
    ["eins"]
  );
  assert.equal(result.db.retrievedAt["wiktionary-de-flexion"], null);
});

test("an API error is not recorded as a missing page", () => {
  const result = runInCopy({
    args: ["scrape", "--resume"],
    state: conjugationState(["eins"]),
    respond: `() => ({ body: { error: { code: "readonly" } } })`,
  });

  assert.equal(result.status, 1, result.output);
  assert.equal(result.state.processedVerbIndex, -1);
});

test("missing pages do not count as a broken parser", () => {
  const result = runInCopy({
    args: ["scrape", "--resume"],
    state: conjugationState(manyVerbs),
    respond: MISSING,
  });

  assert.equal(result.status, 0, result.output);
  assert.equal(result.state.phase, "completed");
});

// Removes the Perfekt heading, so the other tenses still parse
const NO_PERFEKT = `(page, fixture) => ({
  body: {
    parse: {
      revid: 1,
      text: { "*": fixture.replaceAll(">Perfekt</a></b>", ">Gone</a></b>") },
    },
  },
})`;

test("an incomplete run tolerates pages that lack a tense", () => {
  const result = runInCopy({
    args: ["scrape", "--resume"],
    state: conjugationState(manyVerbs, { incompleteMode: true }),
    respond: NO_PERFEKT,
  });

  assert.equal(result.status, 0, result.output);
  assert.equal(result.state.phase, "completed");
  assert.deepEqual(result.db.verbs, []);
});

test("a full run stops if no page yields all three tenses", () => {
  const result = runInCopy({
    args: ["scrape", "--resume"],
    state: conjugationState(manyVerbs),
    respond: NO_PERFEKT,
  });

  assert.equal(result.status, 1, result.output);
  assert.equal(result.state.processedVerbIndex, -1);
  assert.equal(result.db.retrievedAt["wiktionary-de-flexion"], null);
});

test("--incomplete does not change the mode of a resumed full run", () => {
  const result = runInCopy({
    args: ["scrape", "--resume", "--incomplete"],
    state: conjugationState(manyVerbs),
    respond: NO_PERFEKT,
  });

  assert.equal(result.status, 1, result.output);
  assert.equal(result.state.incompleteMode, false);
});

test("a full run that stored nothing does not date the source", () => {
  const result = runInCopy({
    args: ["scrape", "--resume"],
    state: conjugationState(["eins"]),
    respond: NO_PERFEKT,
  });

  assert.equal(result.status, 0, result.output);
  assert.equal(result.db.retrievedAt["wiktionary-de-flexion"], null);
});

test("a run resumed after storing verbs dates the source", () => {
  const result = runInCopy({
    args: ["scrape", "--resume"],
    state: conjugationState(["fehlt"], { storedVerbs: 100 }),
    respond: MISSING,
  });

  assert.equal(result.status, 0, result.output);
  assert.notEqual(result.db.retrievedAt["wiktionary-de-flexion"], null);
});

test("pages with no conjugation tables stop the run", () => {
  const result = runInCopy({
    args: ["scrape", "--resume"],
    state: conjugationState(manyVerbs),
    respond: `() => ({
      body: { parse: { revid: 1, text: { "*": "<p>new markup</p>" } } },
    })`,
  });

  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Check src\/parser\.js/);
  assert.equal(result.state.phase, "fetching_conjugations");
  // Resuming after a parser fix must revisit those pages
  assert.equal(result.state.processedVerbIndex, -1);
});

const NO_TABLES = `() => ({
  body: { parse: { revid: 1, text: { "*": "<p>new markup</p>" } } },
})`;

test("the parser check fires when the 25th page is the last one", () => {
  const result = runInCopy({
    args: ["scrape", "--resume"],
    state: conjugationState(manyVerbs.slice(0, 25)),
    respond: NO_TABLES,
  });

  assert.equal(result.status, 1, result.output);
  assert.equal(result.state.phase, "fetching_conjugations");
  assert.equal(result.state.processedVerbIndex, -1);
});

test("the parser check keeps counting across an interrupted run", () => {
  const stopped = runInCopy({
    args: ["scrape", "--resume"],
    state: conjugationState(manyVerbs),
    respond: `(page) =>
      page === "Flexion:verb5"
        ? { status: 403, body: {} }
        : { body: { parse: { revid: 1, text: { "*": "<p>new markup</p>" } } } }`,
  });
  assert.equal(stopped.status, 1, stopped.output);
  assert.equal(stopped.state.processedVerbIndex, 4);

  const resumed = runInCopy({
    args: ["scrape", "--resume"],
    state: stopped.state,
    respond: NO_TABLES,
  });
  assert.equal(resumed.status, 1, resumed.output);
  assert.match(resumed.output, /Check src\/parser\.js/);
  assert.equal(resumed.state.processedVerbIndex, -1);
});

test("the parser check rewinds only to just after the last parsed page", () => {
  const result = runInCopy({
    args: ["scrape", "--resume"],
    state: conjugationState(manyVerbs),
    respond: `(page, fixture) => ({
      body: {
        parse: {
          revid: 1,
          text: { "*": page === "Flexion:verb0" ? fixture : "<p>new markup</p>" },
        },
      },
    })`,
  });

  assert.equal(result.status, 1, result.output);
  assert.equal(result.state.processedVerbIndex, 0);
  assert.equal(result.db.verbs.length, 1);
});

test("a stored verb that is not separable has a NULL prefix", () => {
  const result = runInCopy({
    args: ["scrape", "--resume"],
    state: conjugationState(["gehen"]),
    respond: PAGE,
  });

  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.db.verbs, [
    { infinitive: "gehen", separable_prefix: null },
  ]);
  assert.notEqual(result.db.retrievedAt["wiktionary-de-flexion"], null);
});

test("an incomplete run does not date the whole source", () => {
  const result = runInCopy({
    args: ["scrape", "--resume"],
    state: conjugationState(["gehen"], { incompleteMode: true }),
    respond: PAGE,
  });

  assert.equal(result.status, 0, result.output);
  assert.equal(result.db.verbs.length, 1);
  assert.equal(result.db.retrievedAt["wiktionary-de-flexion"], null);
});

test("a run that fetched no pages does not date the source", () => {
  const result = runInCopy({
    args: ["scrape", "--resume"],
    state: conjugationState(["fehlt"]),
    respond: MISSING,
  });

  assert.equal(result.status, 0, result.output);
  assert.equal(result.db.retrievedAt["wiktionary-de-flexion"], null);
});

test("frequency run without data fails and records nothing", () => {
  const result = runInCopy({ args: ["frequency"], respond: MISSING });

  assert.equal(result.status, 1, result.output);
  assert.equal(result.db, null);
});

test("frequency run with data dates its source", () => {
  const result = runInCopy({
    args: ["frequency"],
    respond: `() => ({
      body: { parse: { revid: 1, wikitext: { "*": "12 [[gehen]]" } } },
    })`,
  });

  assert.equal(result.status, 0, result.output);
  assert.notEqual(result.db.retrievedAt["wiktionary-en-frequency"], null);
});

test("init-db creates the database with its source records", () => {
  const result = runInCopy({ args: ["init-db"], respond: MISSING });

  assert.equal(result.status, 0, result.output);
  assert.deepEqual(Object.keys(result.db.retrievedAt).sort(), [
    "wiktionary-de-flexion",
    "wiktionary-en-frequency",
  ]);
});

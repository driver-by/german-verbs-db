import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { initDatabase, insertVerb, markSourceRetrieved } from "../src/db.js";

function withTempDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), "german-verbs-test-"));
  try {
    return fn(join(dir, "test.db"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("insertVerb stores where the forms came from", () => {
  withTempDb((path) => {
    const db = initDatabase(path);
    insertVerb(db, {
      infinitive: "gehen",
      isIrregular: true,
      sourceUrl: "https://de.wiktionary.org/wiki/Flexion:gehen",
      sourceRevisionId: 5421754,
      sourceRetrievedAt: "2026-10-31T12:00:00.000Z",
    });
    const row = db
      .prepare(
        "SELECT source_url, source_revision_id, source_retrieved_at FROM verbs"
      )
      .get();
    assert.deepEqual({ ...row }, {
      source_url: "https://de.wiktionary.org/wiki/Flexion:gehen",
      source_revision_id: 5421754,
      source_retrieved_at: "2026-10-31T12:00:00.000Z",
    });
    db.close();
  });
});

test("a new database carries licence and change notes for each source", () => {
  withTempDb((path) => {
    const db = initDatabase(path);
    const rows = db.prepare("SELECT * FROM sources ORDER BY key").all();
    assert.deepEqual(
      rows.map((r) => r.key),
      ["wiktionary-de-flexion", "wiktionary-en-frequency"]
    );
    for (const row of rows) {
      assert.match(row.license, /CC BY-SA/);
      assert.match(row.license_url, /^https:\/\/creativecommons\.org\//);
      assert.match(row.url, /wiktionary\.org/);
      assert.ok(row.modifications.length > 0);
    }
    db.close();
  });
});

test("an existing database gains the provenance columns and keeps its rows", () => {
  withTempDb((path) => {
    const old = new Database(path);
    old.exec(`CREATE TABLE verbs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      infinitive TEXT NOT NULL,
      separable_prefix TEXT,
      is_irregular INTEGER NOT NULL DEFAULT 0,
      usage_popularity INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      UNIQUE (infinitive)
    );
    INSERT INTO verbs (infinitive, usage_popularity) VALUES ('gehen', 7);`);
    old.close();

    const db = initDatabase(path);
    const row = db.prepare("SELECT * FROM verbs").get();
    assert.equal(row.infinitive, "gehen");
    assert.equal(row.usage_popularity, 7);
    assert.equal(row.source_url, null);
    db.close();

    // Opening twice must not fail on columns that already exist
    initDatabase(path).close();
  });
});

test("reopening a database keeps a source's retrieval date", () => {
  withTempDb((path) => {
    const db = initDatabase(path);
    markSourceRetrieved(db, "wiktionary-de-flexion", "2026-10-31T12:00:00.000Z");
    db.close();

    const reopened = initDatabase(path);
    const row = reopened
      .prepare("SELECT retrieved_at FROM sources WHERE key = ?")
      .get("wiktionary-de-flexion");
    assert.equal(row.retrieved_at, "2026-10-31T12:00:00.000Z");
    reopened.close();
  });
});

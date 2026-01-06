import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PROVENANCE_COLUMNS = [
  "source_url TEXT",
  "source_revision_id INTEGER",
  "source_retrieved_at TEXT",
];

const SOURCES = [
  {
    key: "wiktionary-de-flexion",
    title: "German Wiktionary Flexion pages",
    url: "https://de.wiktionary.org/wiki/Kategorie:Verbkonjugation_unregelm%C3%A4%C3%9Fig_(Deutsch)",
    author: "Wiktionary contributors; each page's history lists its authors",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    usedFor: "verbs, separable prefixes and conjugation forms",
    modifications:
      "Extracted Präsens, Präteritum and Perfekt forms from page tables; removed pronouns and footnote markers; derived separable prefixes; left out verbs with spaces in their names or without all three tenses.",
  },
  {
    key: "wiktionary-en-frequency",
    title: "German frequency list",
    url: "https://en.wiktionary.org/wiki/User:Matthias_Buchmeier/German_frequency_list-1-5000",
    author: "Matthias Buchmeier",
    license:
      "CC BY-SA (the page footer names no version); shared here under CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    usedFor: "usage_popularity",
    modifications:
      "Used the counts from both list pages, only for words that exactly match an infinitive in this database.",
  },
];

/**
 * Initialize the database with the schema
 * @param {string} dbPath - Path to the SQLite database file
 * @returns {Database} - The initialized database instance
 */
export function initDatabase(dbPath) {
  const db = new Database(dbPath);

  // Enable foreign keys
  db.pragma("foreign_keys = ON");

  // Read and execute schema
  const schemaPath = join(__dirname, "..", "schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");

  addMissingProvenanceColumns(db);
  db.exec(schema);
  seedSources(db);

  return db;
}

/**
 * Add provenance columns to a database created before they existed
 * @param {Database} db - Database instance
 */
function addMissingProvenanceColumns(db) {
  const existing = db.pragma("table_info(verbs)").map((c) => c.name);
  if (existing.length === 0) return;

  for (const column of PROVENANCE_COLUMNS) {
    if (!existing.includes(column.split(" ")[0])) {
      db.exec(`ALTER TABLE verbs ADD COLUMN ${column}`);
    }
  }
}

/**
 * Write the source records, keeping any recorded retrieval dates
 * @param {Database} db - Database instance
 */
function seedSources(db) {
  const stmt = db.prepare(`
    INSERT INTO sources (key, title, url, author, license, license_url, used_for, modifications)
    VALUES (@key, @title, @url, @author, @license, @licenseUrl, @usedFor, @modifications)
    ON CONFLICT (key) DO UPDATE SET
      title = excluded.title,
      url = excluded.url,
      author = excluded.author,
      license = excluded.license,
      license_url = excluded.license_url,
      used_for = excluded.used_for,
      modifications = excluded.modifications
  `);

  for (const source of SOURCES) {
    stmt.run(source);
  }
}

/**
 * Record when a source was last retrieved
 * @param {Database} db - Database instance
 * @param {string} key - Source key
 * @param {string} retrievedAt - ISO timestamp
 */
export function markSourceRetrieved(db, key, retrievedAt) {
  db.prepare("UPDATE sources SET retrieved_at = ? WHERE key = ?").run(
    retrievedAt,
    key
  );
}

/**
 * Insert a verb into the database
 * @param {Database} db - Database instance
 * @param {Object} verb - Verb data
 * @returns {number} - The inserted verb ID
 */
export function insertVerb(
  db,
  {
    infinitive,
    separablePrefix = null,
    isIrregular = false,
    usagePopularity = 0,
    sourceUrl = null,
    sourceRevisionId = null,
    sourceRetrievedAt = null,
  }
) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO verbs (
      infinitive, separable_prefix, is_irregular, usage_popularity,
      source_url, source_revision_id, source_retrieved_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    infinitive,
    separablePrefix,
    isIrregular ? 1 : 0,
    usagePopularity,
    sourceUrl,
    sourceRevisionId,
    sourceRetrievedAt
  );

  // If the verb already exists, get its ID
  if (result.changes === 0) {
    const existing = db
      .prepare("SELECT id FROM verbs WHERE infinitive = ?")
      .get(infinitive);
    return existing.id;
  }

  return result.lastInsertRowid;
}

/**
 * Insert a conjugation into the database
 * @param {Database} db - Database instance
 * @param {Object} conjugation - Conjugation data
 */
export function insertConjugation(
  db,
  { verbId, tense, sg1, sg2, sg3, pl1, pl2, pl3, notes = null }
) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO verb_conjugations (verb_id, tense, sg1, sg2, sg3, pl1, pl2, pl3, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(verbId, tense, sg1, sg2, sg3, pl1, pl2, pl3, notes);
}

/**
 * Get verb ID by infinitive
 * @param {Database} db - Database instance
 * @param {string} infinitive - Verb infinitive
 * @returns {number|null} - Verb ID or null if not found
 */
export function getVerbIdByInfinitive(db, infinitive) {
  const result = db
    .prepare("SELECT id FROM verbs WHERE infinitive = ?")
    .get(infinitive);
  return result ? result.id : null;
}

/**
 * Get verbs that don't have all 3 required conjugation tenses
 * @param {Database} db - Database instance
 * @returns {Array<{id: number, infinitive: string}>} - Array of verb objects needing completion
 */
export function getIncompleteVerbs(db) {
  const stmt = db.prepare(`
    SELECT v.id, v.infinitive
    FROM verbs v
    WHERE (
      SELECT COUNT(DISTINCT vc.tense)
      FROM verb_conjugations vc
      WHERE vc.verb_id = v.id
        AND vc.tense IN ('praesens', 'praeteritum', 'perfekt')
    ) < 3
    ORDER BY v.infinitive
  `);

  return stmt.all();
}

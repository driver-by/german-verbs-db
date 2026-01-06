import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

  db.exec(schema);

  return db;
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
  }
) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO verbs (infinitive, separable_prefix, is_irregular, usage_popularity)
    VALUES (?, ?, ?, ?)
  `);

  const result = stmt.run(
    infinitive,
    separablePrefix,
    isIrregular ? 1 : 0,
    usagePopularity
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

#!/usr/bin/env node

/**
 * Cleanup script for German verbs database
 *
 * Removes verbs that don't have all 3 required conjugation tenses.
 *
 * Usage:
 *   npm run cleanup
 */

import { DEFAULT_DB_PATH, initDatabase, getIncompleteVerbs } from "./db.js";

/**
 * Delete verbs that don't have all 3 required tenses
 * @param {Database} db - Database instance
 * @returns {number} - Number of verbs deleted
 */
function deleteIncompleteVerbs(db) {
  const incompleteVerbs = getIncompleteVerbs(db);

  if (incompleteVerbs.length === 0) {
    return 0;
  }

  // Delete verbs (conjugations are deleted via CASCADE)
  const deleteStmt = db.prepare("DELETE FROM verbs WHERE id = ?");

  for (const verb of incompleteVerbs) {
    console.log(`  Deleting: ${verb.infinitive}`);
    deleteStmt.run(verb.id);
  }

  return incompleteVerbs.length;
}

/**
 * Main cleanup function
 */
function main() {
  console.log("===================\n");
  console.log("German Verbs Database Cleanup\n");

  console.log("Connecting to database...");
  const db = initDatabase(DEFAULT_DB_PATH);
  console.log(`Database: ${DEFAULT_DB_PATH}\n`);

  try {
    console.log("Finding and deleting incomplete verbs...\n");

    const deletedCount = deleteIncompleteVerbs(db);

    console.log(`\n✅ Cleanup completed!`);
    console.log(`   Deleted ${deletedCount} incomplete verb(s)\n`);

    // Print remaining stats
    const stats = db
      .prepare(
        `
      SELECT 
        (SELECT COUNT(*) FROM verbs) as verb_count,
        (SELECT COUNT(*) FROM verb_conjugations) as conjugation_count
    `
      )
      .get();

    console.log("Remaining in database:");
    console.log(`  Verbs: ${stats.verb_count}`);
    console.log(`  Conjugations: ${stats.conjugation_count}`);
  } finally {
    db.close();
  }
}

main();

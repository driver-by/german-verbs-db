#!/usr/bin/env node

/**
 * Scraper script for German irregular verbs from Wiktionary
 * Extracted from src/index.js to be callable as a subcommand from a dispatcher.
 */

import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  initDatabase,
  insertVerb,
  insertConjugation,
  getIncompleteVerbs,
} from "./db.js";
import { getAllCategoryMembers, getPageText } from "./api.js";
import { parseConjugations, extractInfinitiveFromTitle } from "./parser.js";
import { loadState, saveState, hasState } from "./state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "..", "german-verbs.db");

// Category containing irregular German verbs
const CATEGORY_NAME = "Verbkonjugation_unregelmäßig_(Deutsch)";

function hasAllForms(forms) {
  const requiredForms = ["sg1", "sg2", "sg3", "pl1", "pl2", "pl3"];
  return requiredForms.every(
    (form) => forms[form] && forms[form] !== "—" && forms[form].trim() !== ""
  );
}

/**
 * Main scraper function
 * @param {boolean} resume - Whether to resume from saved state
 * @param {boolean} incompleteMode - Whether to fetch incomplete verbs from DB instead of Wiktionary
 */
export async function main(resume = false, incompleteMode = false) {
  console.log("===================\n");

  // Check for resume mode
  if (resume && !hasState()) {
    console.log("No saved state found. Starting fresh.\n");
    resume = false;
  }

  // Load or initialize state
  let state = resume
    ? loadState()
    : {
        phase: "fetching_verbs",
        verbListContinueToken: null,
        verbList: [],
        processedVerbIndex: -1,
        lastUpdated: new Date().toISOString(),
      };

  if (resume) {
    console.log(
      `Resuming from saved state (last updated: ${state.lastUpdated})`
    );
    console.log(`  Phase: ${state.phase}`);
    console.log(`  Verbs fetched: ${state.verbList.length}`);
    console.log(`  Verbs processed: ${state.processedVerbIndex + 1}\n`);
  }

  // Initialize database
  console.log("Initializing database...");
  const db = initDatabase(DB_PATH);
  console.log(`Database ready at ${DB_PATH}\n`);

  try {
    // Phase 1: Fetch verb list from category or database
    if (state.phase === "fetching_verbs") {
      if (incompleteMode) {
        console.log("Phase 1: Fetching incomplete verbs from database...");
        console.log("(Verbs missing praesens, praeteritum, or perfekt)\n");

        const incompleteVerbs = getIncompleteVerbs(db);
        // Add "Flexion:" prefix to match expected format for extractInfinitiveFromTitle
        state.verbList = incompleteVerbs.map((v) => `Flexion:${v.infinitive}`);

        console.log(`Total incomplete verbs found: ${state.verbList.length}\n`);
      } else {
        console.log("Phase 1: Fetching irregular verb list from Wiktionary...");
        console.log(`Category: ${CATEGORY_NAME}\n`);

        await getAllCategoryMembers(
          CATEGORY_NAME,
          (newMembers, continueToken) => {
            state.verbList.push(...newMembers);
            state.verbListContinueToken = continueToken;
            saveState(state);
          },
          state.verbListContinueToken
        );

        console.log(
          `\nTotal irregular verbs found: ${state.verbList.length}\n`
        );
      }

      state.phase = "fetching_conjugations";
      saveState(state);
    }

    // Phase 2: Fetch conjugations for each verb
    if (state.phase === "fetching_conjugations") {
      console.log("Phase 2: Fetching conjugations for each verb...\n");

      const startIndex = state.processedVerbIndex + 1;
      const totalVerbs = state.verbList.length;

      for (let i = startIndex; i < totalVerbs; i++) {
        const verbTitle = state.verbList[i];
        const infinitive = extractInfinitiveFromTitle(verbTitle);

        if (!infinitive || infinitive.includes(" ")) {
          console.log(
            `[${i + 1}/${totalVerbs}] Skipping: ${infinitive} (contains space)`
          );
          state.processedVerbIndex = i;
          saveState(state);
          continue;
        }

        console.log(`[${i + 1}/${totalVerbs}] Processing: ${infinitive}`);

        try {
          const wikitext = await getPageText(`Flexion:${infinitive}`);
          if (!wikitext) {
            console.log(`  Warning: No Flexion page found for ${infinitive}`);
            state.processedVerbIndex = i;
            saveState(state);
            continue;
          }

          const conjugations = parseConjugations(wikitext, infinitive);
          if (!conjugations) {
            console.log(
              `  Warning: Could not parse conjugations for ${infinitive}`
            );
            state.processedVerbIndex = i;
            saveState(state);
            continue;
          }

          // Check which tenses have all required forms
          const validTenses = [];
          if (conjugations.praesens && hasAllForms(conjugations.praesens)) {
            validTenses.push({
              tense: "praesens",
              forms: conjugations.praesens,
              label: "Präsens",
            });
          }
          if (
            conjugations.praeteritum &&
            hasAllForms(conjugations.praeteritum)
          ) {
            validTenses.push({
              tense: "praeteritum",
              forms: conjugations.praeteritum,
              label: "Präteritum",
            });
          }
          if (conjugations.perfekt && hasAllForms(conjugations.perfekt)) {
            validTenses.push({
              tense: "perfekt",
              forms: conjugations.perfekt,
              label: "Perfekt",
            });
          }

          // Skip verb entirely if not all 3 tenses are valid
          if (validTenses.length < 3) {
            console.log(
              `  ⊘ Skipping: only ${validTenses.length}/3 valid tenses`
            );
            state.processedVerbIndex = i;
            saveState(state);
            continue;
          }

          // Insert verb only if we have all 3 valid tenses
          const verbId = insertVerb(db, {
            infinitive,
            separablePrefix: conjugations.separablePrefix,
            isIrregular: true,
            usagePopularity: 0,
          });

          // Insert all valid conjugations
          for (const { tense, forms, label } of validTenses) {
            insertConjugation(db, {
              verbId,
              tense,
              ...forms,
            });
            console.log(`  ✓ ${label}`);
          }
        } catch (error) {
          if (error.message.startsWith("RATE_LIMIT")) {
            console.error(
              "\n⚠️  Rate limit (429) detected! Stopping execution."
            );
            console.log(
              "State has been saved. Run with --resume to continue.\n"
            );
            state.processedVerbIndex = i - 1;
            saveState(state);
            process.exit(1);
          }
          console.error(`  Error processing ${infinitive}:`, error.message);
        }

        state.processedVerbIndex = i;
        saveState(state);
      }

      state.phase = "completed";
      saveState(state);
    }

    // Phase 3: Completed
    if (state.phase === "completed") {
      console.log("\n✅ Scraping completed!");
      console.log(`Total verbs processed: ${state.verbList.length}`);
      console.log(`Database saved to: ${DB_PATH}\n`);

      // Print some stats
      const stats = db
        .prepare(
          `
        SELECT 
          (SELECT COUNT(*) FROM verbs) as verb_count,
          (SELECT COUNT(*) FROM verb_conjugations) as conjugation_count,
          (SELECT COUNT(*) FROM verb_conjugations WHERE tense = 'praesens') as praesens_count,
          (SELECT COUNT(*) FROM verb_conjugations WHERE tense = 'praeteritum') as praeteritum_count,
          (SELECT COUNT(*) FROM verb_conjugations WHERE tense = 'perfekt') as perfekt_count
      `
        )
        .get();

      console.log("Database Statistics:");
      console.log(`  Verbs: ${stats.verb_count}`);
      console.log(`  Total conjugations: ${stats.conjugation_count}`);
      console.log(`    - Präsens: ${stats.praesens_count}`);
      console.log(`    - Präteritum: ${stats.praeteritum_count}`);
      console.log(`    - Perfekt: ${stats.perfekt_count}`);
    }
  } catch (error) {
    if (error.message.startsWith("RATE_LIMIT")) {
      console.error("\n⚠️  Rate limit (429) detected! Stopping execution.");
      console.log("State has been saved. Run with --resume to continue.\n");
    } else {
      console.error("\nUnexpected error:", error);
    }
    saveState(state);
    process.exit(1);
  } finally {
    db.close();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const resumeMode = args.includes("--resume") || args.includes("-r");
const incompleteMode = args.includes("--incomplete") || args.includes("-i");

main(resumeMode, incompleteMode).catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

/**
 * Scraper script for German irregular verbs from Wiktionary
 * Extracted from src/index.js to be callable as a subcommand from a dispatcher.
 */

import {
  DEFAULT_DB_PATH,
  initDatabase,
  insertVerb,
  insertConjugation,
  getIncompleteVerbs,
  markSourceRetrieved,
} from "./db.js";
import {
  getAllCategoryMembers,
  getParsedPage,
  flexionPageUrl,
} from "./api.js";
import { parseConjugations, extractInfinitiveFromTitle } from "./parser.js";
import { getDefaultState, loadState, saveState, hasState } from "./state.js";

// Category containing irregular German verbs
const CATEGORY_NAME = "Verbkonjugation_unregelmäßig_(Deutsch)";

const PARSER_CHECK_PAGES = 25;

const TENSES = [
  { tense: "praesens", label: "Präsens" },
  { tense: "praeteritum", label: "Präteritum" },
  { tense: "perfekt", label: "Perfekt" },
];

/**
 * Detect a parser that no longer matches the page markup, so a run stops
 * early instead of sending thousands of requests for nothing
 * @param {Object} progress
 * @param {number} progress.parsed - Pages the parser handled: all three tenses valid,
 *   or in incomplete mode at least one tense table, since those verbs are expected to lack a tense
 * @param {number} progress.attempted - Pages that exist and were given to the parser
 */
export function parserLooksBroken({ parsed, attempted }) {
  return parsed === 0 && attempted >= PARSER_CHECK_PAGES;
}

function newParserCheck(startIndex) {
  return { parsed: 0, attempted: 0, startIndex };
}

function hasAllForms(forms) {
  const requiredForms = ["sg1", "sg2", "sg3", "pl1", "pl2", "pl3"];
  return requiredForms.every(
    (form) => forms[form] && forms[form] !== "—" && forms[form].trim() !== ""
  );
}

/**
 * Parse one Flexion page and store the verb if all three tenses are complete
 * @param {Database} db - Database instance
 * @param {string} infinitive - Verb infinitive
 * @param {{content: string, revisionId: number}} page - The fetched page
 * @param {{parsed: number, attempted: number}} progress - Updated for the parser check
 * @param {boolean} incompleteMode - Whether this run re-scrapes incomplete verbs only
 * @returns {boolean} - Whether the verb was stored
 */
function storeVerb(db, infinitive, page, progress, incompleteMode) {
  progress.attempted++;

  let conjugations;
  try {
    conjugations = parseConjugations(page.content);
  } catch (error) {
    console.error(`  Error parsing ${infinitive}:`, error.message);
    return false;
  }

  const validTenses = TENSES.filter(({ tense }) =>
    hasAllForms(conjugations[tense])
  );

  const foundTable = TENSES.some(
    ({ tense }) => Object.keys(conjugations[tense]).length > 0
  );
  if (incompleteMode ? foundTable : validTenses.length === TENSES.length) {
    progress.parsed++;
  }

  // Skip verb entirely if not all 3 tenses are valid
  if (validTenses.length < TENSES.length) {
    console.log(`  ⊘ Skipping: only ${validTenses.length}/3 valid tenses`);
    return false;
  }

  db.transaction(() => {
    const verbId = insertVerb(db, {
      infinitive,
      separablePrefix: conjugations.separablePrefix,
      isIrregular: true,
      sourceUrl: flexionPageUrl(infinitive),
      sourceRevisionId: page.revisionId,
      sourceRetrievedAt: new Date().toISOString(),
    });

    for (const { tense } of validTenses) {
      insertConjugation(db, { verbId, tense, ...conjugations[tense] });
    }
  })();

  for (const { label } of validTenses) {
    console.log(`  ✓ ${label}`);
  }
  return true;
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
  let state = resume ? loadState() : getDefaultState();
  // A resumed run keeps the mode it started with
  state.incompleteMode = resume ? Boolean(state.incompleteMode) : incompleteMode;

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
  const db = initDatabase(DEFAULT_DB_PATH);
  console.log(`Database ready at ${DEFAULT_DB_PATH}\n`);

  try {
    // Phase 1: Fetch verb list from category or database
    if (state.phase === "fetching_verbs") {
      if (state.incompleteMode) {
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
      // Counts pages since the last parsed one and survives a resume, so the
      // check can rewind to the first page that may have been misread
      state.parserCheck ??= newParserCheck(startIndex);

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

        // A failed fetch or database write stops the run with this verb still
        // unprocessed, so --resume picks it up again
        const page = await getParsedPage(`Flexion:${infinitive}`);
        if (page) {
          if (
            storeVerb(
              db,
              infinitive,
              page,
              state.parserCheck,
              state.incompleteMode
            )
          ) {
            state.storedVerbs = (state.storedVerbs ?? 0) + 1;
          }
        } else {
          console.log(`  Warning: No Flexion page found for ${infinitive}`);
        }

        if (parserLooksBroken(state.parserCheck)) {
          const { attempted, startIndex: rewindTo } = state.parserCheck;
          state.processedVerbIndex = rewindTo - 1;
          state.parserCheck = null;
          throw new Error(
            `No verbs parsed from ${attempted} pages in a row. Check src/parser.js against the current page markup, then resume.`
          );
        }
        if (state.parserCheck.parsed > 0) {
          state.parserCheck = newParserCheck(i + 1);
        }

        state.processedVerbIndex = i;
        saveState(state);
      }

      // Incomplete runs date each verb they fetch, but not the source as a whole
      if (state.storedVerbs > 0 && !state.incompleteMode) {
        markSourceRetrieved(
          db,
          "wiktionary-de-flexion",
          new Date().toISOString()
        );
      }

      state.phase = "completed";
      saveState(state);
    }

    // Phase 3: Completed
    if (state.phase === "completed") {
      console.log("\n✅ Scraping completed!");
      console.log(`Total verbs processed: ${state.verbList.length}`);
      console.log(`Database saved to: ${DEFAULT_DB_PATH}\n`);

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
      console.error(
        "\n⚠️  Rate limited or service unavailable after retries! Stopping execution."
      );
    } else {
      console.error("\nStopping execution:", error.message);
    }
    saveState(state);
    console.log("State has been saved. Run with --resume to continue.\n");
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

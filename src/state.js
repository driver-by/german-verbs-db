/**
 * State management for resume functionality
 * Saves progress to a JSON file that is not tracked by git
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dirname, "..", ".scraper-state.json");

/**
 * @typedef {Object} ScraperState
 * @property {'fetching_verbs'|'fetching_conjugations'|'completed'} phase
 * @property {string|null} verbListContinueToken - Continue token for category pagination
 * @property {string[]} verbList - List of all fetched verbs
 * @property {number} processedVerbIndex - Index of last processed verb for conjugations
 * @property {string} lastUpdated - ISO timestamp of last update
 */

/**
 * Get default initial state
 * @returns {ScraperState}
 */
function getDefaultState() {
  return {
    phase: "fetching_verbs",
    verbListContinueToken: null,
    verbList: [],
    processedVerbIndex: -1,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Load state from file
 * @returns {ScraperState}
 */
export function loadState() {
  if (!existsSync(STATE_FILE)) {
    return getDefaultState();
  }

  try {
    const content = readFileSync(STATE_FILE, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.warn("Warning: Could not parse state file, starting fresh");
    return getDefaultState();
  }
}

/**
 * Save state to file
 * @param {ScraperState} state
 */
export function saveState(state) {
  state.lastUpdated = new Date().toISOString();
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Clear state file (delete it)
 */
export function clearState() {
  if (existsSync(STATE_FILE)) {
    unlinkSync(STATE_FILE);
  }
}

/**
 * Check if state file exists
 * @returns {boolean}
 */
export function hasState() {
  return existsSync(STATE_FILE);
}

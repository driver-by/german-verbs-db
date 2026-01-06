#!/usr/bin/env node

import { getGermanWordsFrequences } from "./api.js";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { initDatabase } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "..", "german-verbs.db");

/**
 * Fetch German word frequencies and update local DB's usage_popularity
 */
export async function main() {
  console.log("Fetching German word frequencies...");
  const freqMap = await getGermanWordsFrequences();
  console.log(`Fetched ${freqMap.size} entries.`);

  const db = initDatabase(DB_PATH);
  try {
    const verbs = db.prepare("SELECT id, infinitive FROM verbs").all();
    console.log(`Database has ${verbs.length} verbs; checking for matches...`);

    const updateStmt = db.prepare(
      "UPDATE verbs SET usage_popularity = ? WHERE id = ?"
    );
    const updateMany = db.transaction((items) => {
      for (const [id, count] of items) {
        updateStmt.run(count, id);
      }
    });

    const toUpdate = [];
    let matched = 0;
    for (const v of verbs) {
      const infinitive = v.infinitive;
      if (freqMap.has(infinitive)) {
        toUpdate.push([v.id, freqMap.get(infinitive)]);
        matched++;
      }
    }

    if (toUpdate.length > 0) {
      updateMany(toUpdate);
    }

    console.log(`Updated ${matched} verbs with usage_popularity.`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

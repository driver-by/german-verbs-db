# German Verbs (SQLite)

Node.js project that builds a local **SQLite database of German verb conjugations** by scraping Wiktionary.

The database contains:

- **verbs**: infinitive, separable prefix, irregular flag, usage popularity
- **verb_conjugations**: 6 person/number slots per tense (sg1–pl3) for:
  - Präsens
  - Präteritum
  - Perfekt
- **verb_translations**: schema included (not populated by this scraper)

See: [schema.sql](schema.sql)

---

## Data sources / credits

### Irregular verbs list (German Wiktionary)

- Verb list is taken from the German Wiktionary category:  
  https://de.wiktionary.org/w/index.php?title=Kategorie:Verbkonjugation_unregelmäßig_(Deutsch)

### Conjugation forms (German Wiktionary Flexion pages)

- Each verb’s forms are parsed from its **Flexion page** linked from that list (e.g. `Flexion:<verb>` on de.wiktionary.org).

### Frequency list (English Wiktionary user page)

Usage frequency data is taken from the English Wiktionary user pages by **Matthias Buchmeier**:

- https://en.wiktionary.org/wiki/User:Matthias_Buchmeier/German_frequency_list-1-5000
- https://en.wiktionary.org/wiki/User:Matthias_Buchmeier/German_frequency_list-5001-10000

These lists are used to update the `usage_popularity` field for verbs present in the local database. The corpus behind the counts is not described in the parts of the page reviewed.

### Changes made to the source data

- Präsens, Präteritum and Perfekt forms are extracted from the Flexion page tables.
- Pronouns and footnote markers are removed, and separable prefixes are derived from the forms.
- Verbs with spaces in their names or without all three tenses are left out.
- Frequency counts are kept only for words that exactly match an infinitive in the database.

### Credits inside the database

The same information travels with `german-verbs.db`, so credits survive when the file is copied alone:

- `sources`: each source's URL, author, licence, changes and retrieval date
- `verbs.source_url`, `verbs.source_revision_id`, `verbs.source_retrieved_at`: the exact Flexion page and revision behind each verb

---

## Wikimedia access rules

The API client follows the [Robot policy](https://wikitech.wikimedia.org/wiki/Robot_policy), [User-Agent Policy](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy), [API etiquette](https://www.mediawiki.org/wiki/API:Etiquette) and [rate limits](https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits):

- one request at a time, at least 350 ms apart, and 5 seconds apart after a response slower than 1 second
- a descriptive `User-Agent` with contact details
- `maxlag` on every request
- `Retry-After` honoured, with exponential backoff from 5 seconds when it is absent

If you run the scraper yourself, set `WIKIMEDIA_CONTACT` to your own URL or email address so Wikimedia can reach you instead of this project.

---

## Requirements

- Node.js (ESM; project uses `"type": "module"`)
- `npm install`

---

## Usage

### Install

```bash
npm install
```

### Run tests

```bash
npm test
```

### Scrape conjugations into `german-verbs.db`

```bash
npm run scrape
```

### Resume scraping after an interruption / rate limit

```bash
npm run scrape:resume
```

### Re-scrape only “incomplete” verbs already in the DB

(verbs missing one of: `praesens`, `praeteritum`, `perfekt`)

```bash
npm run scrape:incomplete
```

### Update usage frequencies

A full scrape resets `usage_popularity`, so run this afterwards.

Fetches the frequency list(s) above and updates `verbs.usage_popularity` for matches:

```bash
npm run update-frequencies
```

### Cleanup incomplete verbs

Deletes verbs that still don’t have all three required tenses:

```bash
npm run cleanup
```

---

## State / resume file

Scraping progress is saved to:

- `.scraper-state.json` (not committed; see [.gitignore](.gitignore))

This enables continuing long runs across multiple sessions.

---

## License

- **Data:** `german-verbs.db`, and the Wiktionary page content in `test/parser.test.js` and `test/fixtures/`, are licensed under [CC BY-SA 4.0](LICENSE-DATA). They are adapted from Wiktionary as described above. Credit "Wiktionary contributors" and Matthias Buchmeier, and keep the `sources` table or an equivalent notice.
- **Code:** everything else in the repository is licensed under the [MIT License](LICENSE).

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

These lists are used to update the `usage_popularity` field for verbs present in the local database.

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

See [LICENSE](LICENSE).

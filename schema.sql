PRAGMA foreign_keys = ON;

-- Core verb entity (German side)
CREATE TABLE IF NOT EXISTS verbs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Infinitive includes separable prefix if applicable, e.g. 'aufstehen'
  infinitive TEXT NOT NULL,

  -- Stored separately too (NULL if not separable), e.g. 'auf'
  separable_prefix TEXT,

  is_irregular INTEGER NOT NULL DEFAULT 0,

  -- Usage popularity/frequency indicator (higher = more common)
  -- Can be derived from Wiktionary usage data, frequency lists, etc.
  usage_popularity INTEGER DEFAULT 0,

  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),

  UNIQUE (infinitive)
);

-- One row per (verb, tense), with the 6 forms as columns.
CREATE TABLE IF NOT EXISTS verb_conjugations (
  verb_id INTEGER NOT NULL,
  tense TEXT NOT NULL,                  -- e.g. 'praesens', 'praeteritum', 'perfekt'

  -- 6 slots (your naming)
  sg1 TEXT NOT NULL,
  sg2 TEXT NOT NULL,
  sg3 TEXT NOT NULL,
  pl1 TEXT NOT NULL,
  pl2 TEXT NOT NULL,
  pl3 TEXT NOT NULL,

  notes TEXT,

  PRIMARY KEY (verb_id, tense),

  FOREIGN KEY (verb_id) REFERENCES verbs(id) ON DELETE CASCADE
);

-- Translations: multiple per verb per locale
CREATE TABLE IF NOT EXISTS verb_translations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  verb_id INTEGER NOT NULL,
  locale TEXT NOT NULL,                 -- e.g. 'en', 'en-US', 'pl'
  text TEXT NOT NULL,                   -- e.g. 'to go', 'walk', 'leave'
  sense_order INTEGER NOT NULL DEFAULT 1,
  notes TEXT,

  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),

  FOREIGN KEY (verb_id) REFERENCES verbs(id) ON DELETE CASCADE,

  UNIQUE (verb_id, locale, text)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_verbs_infinitive ON verbs(infinitive);
CREATE INDEX IF NOT EXISTS idx_verbs_separable_prefix ON verbs(separable_prefix);
CREATE INDEX IF NOT EXISTS idx_verbs_usage_popularity ON verbs(usage_popularity);

CREATE INDEX IF NOT EXISTS idx_conj_tense ON verb_conjugations(tense);
CREATE INDEX IF NOT EXISTS idx_translations_locale_text ON verb_translations(locale, text);
CREATE INDEX IF NOT EXISTS idx_translations_verb_locale ON verb_translations(verb_id, locale);

/**
 * Extract verb infinitive from page title
 * Page titles are like "Flexion:belaufen" or "Flexion:aufstehen"
 * @param {string} pageTitle - Full page title
 * @returns {string|null} - Verb infinitive or null if not a Flexion page
 */
export function extractInfinitiveFromTitle(pageTitle) {
  const match = pageTitle?.match(/^Flexion:(.+)$/);
  return match ? match[1] : null;
}

/**
 * Extract text content from HTML table cell
 * Strips all HTML, then extracts verb forms by removing pronouns
 */
function extractTextFromCell(cell) {
  // Remove footnote references (sup tags with content) before stripping other tags
  const text = cell
    .replace(/<sup[^>]*>.*?<\/sup>/gi, "") // Remove footnote sup tags completely
    .replace(/<[^>]+>/g, " ")
    .replace(/&[^;]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Remove pronouns and normalize separators
  const cleaned = text
    .replace(/\ber\/sie\/es\b/gi, ",")
    .replace(/\b(ich|du|wir|ihr|sie)\b/gi, ",")
    .replace(/\b(mich|dich|sich|uns|euch)\b/gi, "") // Remove reflexive pronouns
    .replace(/\s+/g, " ") // Normalize whitespace after removals
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");

  return cleaned;
}

/**
 * Parse conjugation rows from a matched table section
 * Extracts 6 rows (sg1, sg2, sg3, pl1, pl2, pl3) and returns as object
 */
function parseConjugationRows(rows) {
  if (!rows || rows.length < 6) return {};

  return {
    sg1: extractTextFromCell(rows[0].match(/<td>(.*?)\n<\/td>/)[1]),
    sg2: extractTextFromCell(rows[1].match(/<td>(.*?)\n<\/td>/)[1]),
    sg3: extractTextFromCell(rows[2].match(/<td>(.*?)\n<\/td>/)[1]),
    pl1: extractTextFromCell(rows[3].match(/<td>(.*?)\n<\/td>/)[1]),
    pl2: extractTextFromCell(rows[4].match(/<td>(.*?)\n<\/td>/)[1]),
    pl3: extractTextFromCell(rows[5].match(/<td>(.*?)\n<\/td>/)[1]),
  };
}

/**
 * Parse conjugations from Wiktionary wikitext
 * @param {string} text - Raw text content
 * @returns {Object|null} - Parsed conjugation data with separablePrefix
 */
export function parseConjugations(text) {
  if (!text) return null;

  const result = {
    separablePrefix: "",
    infinitive: "",
    praesens: {},
    praeteritum: {},
    perfekt: {},
    plusquamperfekt: {},
    futur1: {},
    futur2: {},
  };

  // Extract infinitive from h2 heading
  const h2Match = text.match(/<h2[^>]*>(.*?)<\/h2>/);
  if (h2Match) {
    // Extract text content excluding HTML tags
    const h2Text = h2Match[1].replace(/<[^>]+>/g, "");
    // Extract infinitive before " (Konjugation)"
    const infinitiveMatch = h2Text.match(/^([^\s(]+)\s*\(Konjugation\)/);
    if (infinitiveMatch) {
      result.infinitive = infinitiveMatch[1];
    }
  }

  // Parse Präsens table (Aktiv, Hauptsatzkonjugation, Indikativ)
  const praesensSection = text.match(
    /<td colspan="\d+"[^>]*>.*?<b>.*?Präsens<\/a><\/b>\n<\/td><\/tr>(.*?)<td colspan="\d+"[^>]*><span/s
  );

  if (praesensSection) {
    const rows = praesensSection[1].match(
      /<tr>\n<td[^>]*><small>(.*?)<\/small>\n<\/td>\n<td>(.*?)\n<\/td>/g
    );
    result.praesens = parseConjugationRows(rows);
  }

  // Parse Präteritum table
  const praeteritumSection = text.match(
    /<td colspan="\d+"[^>]*>.*?<b>.*?Präteritum<\/a><\/b>\n<\/td><\/tr>(.*?)<td colspan="\d+"[^>]*><span/s
  );

  if (praeteritumSection) {
    const rows = praeteritumSection[1].match(
      /<tr>\n<td[^>]*><small>(.*?)<\/small>\n<\/td>\n<td>(.*?)\n<\/td>/g
    );
    result.praeteritum = parseConjugationRows(rows);
  }

  // Parse Perfekt table
  const perfektSection = text.match(
    /<td colspan="\d+"[^>]*>.*?<b>.*?Perfekt<\/a><\/b>\n<\/td><\/tr>(.*?)<td colspan="\d+"[^>]*><span/s
  );

  if (perfektSection) {
    const rows = perfektSection[1].match(
      /<tr>\n<td[^>]*><small>(.*?)<\/small>\n<\/td>\n<td>(.*?)\n<\/td>/g
    );
    result.perfekt = parseConjugationRows(rows);
  }

  // Parse Plusquamperfekt table
  const plusquamperfektSection = text.match(
    /<td colspan="\d+"[^>]*>.*?<b>.*?Plusquamperfekt<\/a><\/b>\n<\/td><\/tr>(.*?)<\/tbody><\/table>/s
  );

  if (plusquamperfektSection) {
    const rows = plusquamperfektSection[1].match(
      /<tr>\n<td[^>]*><small>(.*?)<\/small>\n<\/td>\n<td>(.*?)\n<\/td>/g
    );
    result.plusquamperfekt = parseConjugationRows(rows);
  }

  // Parse Futur I table
  const futur1Section = text.match(
    /<td colspan="\d+"[^>]*>.*?<b>.*?Futur I<\/a><\/b>\n<\/td><\/tr>(.*?)<td colspan="\d+"[^>]*><span/s
  );

  if (futur1Section) {
    const rows = futur1Section[1].match(
      /<tr>\n<td[^>]*><small>(.*?)<\/small>\n<\/td>\n<td>(.*?)\n<\/td>/g
    );
    result.futur1 = parseConjugationRows(rows);
  }

  // Parse Futur II table
  const futur2Section = text.match(
    /<td colspan="\d+"[^>]*>.*?<b>.*?Futur II<\/a><\/b>\n<\/td><\/tr>(.*?)<\/tbody><\/table>/s
  );

  if (futur2Section) {
    const rows = futur2Section[1].match(
      /<tr>\n<td[^>]*><small>(.*?)<\/small>\n<\/td>\n<td>(.*?)\n<\/td>/g
    );
    result.futur2 = parseConjugationRows(rows);
  }

  // Detect separable prefix (e.g., "an" from "ansehen", "wieder auf" from "wiederauferstehen")
  // Only consider the first form if there are multiple alternatives
  if (result.praesens.sg1) {
    const firstForm = result.praesens.sg1.split(",")[0].trim();
    if (firstForm.includes(" ")) {
      const parts = firstForm.split(" ");
      if (parts.length >= 2) {
        // First part is the root, rest are separable prefixes (excluding reflexive pronouns)
        const reflexive = /^(mich|dich|sich|uns|euch)$/i;
        result.separablePrefix = parts
          .slice(1)
          .filter((p) => !reflexive.test(p))
          .join(" ");
      }
    }
  }

  return result;
}

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

// A spacer cell ends a section; older pages put a <span> in it, newer ones &#160;
const NEXT_SECTION = '<td colspan="\\d+"[^>]*>(?:<span|&#160;)';
const TABLE_END = "</tbody></table>";

/**
 * Parse the rows under a tense heading
 * The ">" before the label keeps "Perfekt" from matching "Infinitiv Perfekt"
 */
function parseSection(text, label, end) {
  const section = text.match(
    new RegExp(`>${label}</a></b>\\n</td></tr>(.*?)${end}`, "s")
  );
  if (!section) return {};

  const rows = section[1].match(
    /<tr>\n<td[^>]*><small>(.*?)<\/small>\n<\/td>\n<td>(.*?)\n<\/td>/g
  );
  return parseConjugationRows(rows);
}

/**
 * Parse conjugations from Wiktionary wikitext
 * @param {string} text - Raw text content
 * @returns {Object|null} - Parsed conjugation data with separablePrefix
 */
export function parseConjugations(text) {
  if (!text) return null;

  const result = {
    separablePrefix: null,
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

  // Sections of the Aktiv, Hauptsatzkonjugation, Indikativ tables
  result.praesens = parseSection(text, "Präsens", NEXT_SECTION);
  result.praeteritum = parseSection(text, "Präteritum", NEXT_SECTION);
  result.perfekt = parseSection(text, "Perfekt", NEXT_SECTION);
  result.plusquamperfekt = parseSection(text, "Plusquamperfekt", TABLE_END);
  result.futur1 = parseSection(text, "Futur I", NEXT_SECTION);
  result.futur2 = parseSection(text, "Futur II", TABLE_END);

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
          .join(" ") || null;
      }
    }
  }

  return result;
}

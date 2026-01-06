/**
 * Wiktionary API client with rate limiting
 */

// Build API base URL for a given language (default 'de' for German Wiktionary)
const RATE_LIMIT_MS = 100; // 10 requests per second

let lastRequestTime = 0;

function apiBaseUrl(lang = "de") {
  return `https://${lang}.wiktionary.org/w/api.php`;
}

/**
 * Wait to ensure rate limiting
 */
async function waitForRateLimit() {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < RATE_LIMIT_MS) {
    const waitTime = RATE_LIMIT_MS - timeSinceLastRequest;
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }

  lastRequestTime = Date.now();
}

/**
 * Make a rate-limited request to the Wiktionary API
 * @param {Object} params - API parameters
 * @param {string} [lang='de'] - Language wiki to use (e.g. 'de', 'en')
 * @returns {Promise<Object>} - API response
 * @throws {Error} - On rate limit (429) or other errors
 */
export async function apiRequest(params, lang = "de") {
  await waitForRateLimit();

  const url = new URL(apiBaseUrl(lang));
  url.searchParams.set("format", "json");

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString());

  if (response.status === 429) {
    throw new Error(
      "RATE_LIMIT: Too many requests. Please wait and try again."
    );
  }

  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get category members (list of verbs in a category)
 * @param {string} category - Category name (without 'Kategorie:' prefix)
 * @param {string|null} resumeToken - Continue token for pagination
 * @returns {Promise<{members: string[], continueToken: string|null}>}
 */
export async function getCategoryMembers(
  category,
  resumeToken = null,
  lang = "de"
) {
  const params = {
    action: "query",
    list: "categorymembers",
    cmtitle: `Kategorie:${category}`,
    cmlimit: "500",
    cmtype: "page",
  };

  if (resumeToken) {
    params.cmcontinue = resumeToken;
  }

  const data = await apiRequest(params, lang);

  const members = (data.query?.categorymembers || []).map((m) => m.title);
  const continueToken = data.continue?.cmcontinue || null;

  return { members, continueToken };
}

/**
 * Get all category members with pagination
 * @param {string} category - Category name
 * @param {Function} onProgress - Progress callback (members, continueToken)
 * @param {string|null} continueToken - Continue token to resume from
 * @returns {Promise<string[]>} - All member titles
 */
export async function getAllCategoryMembers(
  category,
  onProgress = null,
  continueToken = null,
  lang = "de"
) {
  const allMembers = [];

  do {
    const { members, continueToken: nextToken } = await getCategoryMembers(
      category,
      continueToken,
      lang
    );
    allMembers.push(...members);
    continueToken = nextToken;

    if (onProgress) {
      onProgress(members, continueToken);
    }

    console.log(
      `  Fetched ${members.length} members (total: ${allMembers.length})${
        continueToken ? ", continuing..." : ""
      }`
    );
  } while (continueToken);

  return allMembers;
}

/**
 * Get parsed page content (wikitext)
 * @param {string} pageTitle - Page title
 * @returns {Promise<string>} - Page wikitext content
 */
export async function getPageText(pageTitle, prop = "text", lang = "de") {
  const params = {
    action: "parse",
    page: pageTitle,
    prop,
  };

  const data = await apiRequest(params, lang);

  if (prop === "wikitext") {
    return data.parse?.wikitext?.["*"] || null;
  }

  return data.parse?.text?.["*"] || null;
}

/**
 * Fetch German word frequencies from the English Wiktionary user page
 * Returns a Map where key is the word and value is the usage count (number)
 * Page: User:Matthias_Buchmeier/German_frequency_list-1-5000
 * @returns {Promise<Map<string, number>>}
 */
export async function getGermanWordsFrequences() {
  // Two pages that together contain the top 10k German words
  const titles = [
    "User:Matthias_Buchmeier/German_frequency_list-1-5000",
    "User:Matthias_Buchmeier/German_frequency_list-5001-10000",
  ];

  const map = new Map();
  const re = /^(\d+)\s+\[\[([^\]]+)\]\]/;

  for (const title of titles) {
    const wikitext = await getPageText(title, "wikitext", "en");
    if (!wikitext) continue;

    const lines = wikitext.split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(re);
      if (!m) continue;

      // m[1] = count, m[2] = word
      const count = parseInt(m[1].replace(/\./g, ""), 10);
      const word = m[2].trim();
      if (!word) continue;

      map.set(word, count);
    }
  }

  return map;
}

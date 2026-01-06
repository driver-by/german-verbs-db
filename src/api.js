/**
 * Wiktionary API client that follows Wikimedia's access rules:
 * https://wikitech.wikimedia.org/wiki/Robot_policy
 * https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits
 */

const CLIENT_VERSION = "1.0.0";
const DEFAULT_CONTACT = "https://github.com/driver-by/german-verbs-db";

const RATE_LIMIT_MS = 350; // Stays under 200 requests per minute
const SLOW_RESPONSE_MS = 1000;
const SLOW_RESPONSE_DELAY_MS = 5000;
const BASE_BACKOFF_MS = 5000;
const MAX_RETRIES = 5;
const MAXLAG_SECONDS = "5";

// Build API base URL for a given language (default 'de' for German Wiktionary)
function apiBaseUrl(lang = "de") {
  return `https://${lang}.wiktionary.org/w/api.php`;
}

/**
 * Get the public page URL used to attribute a verb's forms
 * @param {string} infinitive - Verb infinitive
 * @returns {string} - URL of the verb's Flexion page
 */
export function flexionPageUrl(infinitive) {
  return `https://de.wiktionary.org/wiki/Flexion:${encodeURIComponent(
    infinitive
  )}`;
}

/**
 * Read a Retry-After header, given as seconds or as an HTTP date
 * @returns {number|null} - Delay in milliseconds, or null if absent or invalid
 */
function parseRetryAfter(value, now) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(seconds * 1000, 0);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(date - now, 0);
}

/**
 * Create a client that sends one request at a time
 * @param {Object} [options]
 * @param {string} [options.contact] - URL or email for Wikimedia to reach the operator
 * @param {Function} [options.fetchFn] - fetch implementation
 * @param {Function} [options.sleep] - Waits for the given milliseconds
 * @param {Function} [options.now] - Returns the current time in milliseconds
 */
export function createApiClient({
  contact = process.env.WIKIMEDIA_CONTACT || DEFAULT_CONTACT,
  fetchFn = (...args) => fetch(...args),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
} = {}) {
  let nextRequestTime = 0;
  let queue = Promise.resolve();

  async function waitForRateLimit() {
    const waitTime = nextRequestTime - now();
    if (waitTime > 0) {
      await sleep(waitTime);
    }
  }

  async function send(params, lang) {
    if (!contact) {
      throw new Error("Set WIKIMEDIA_CONTACT to a URL or email address.");
    }

    const url = new URL(apiBaseUrl(lang));
    url.searchParams.set("format", "json");
    url.searchParams.set("maxlag", MAXLAG_SECONDS);

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const headers = {
      "User-Agent": `german-verbs-db-bot/${CLIENT_VERSION} (${contact}) node/${process.versions.node}`,
    };

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await waitForRateLimit();

      const startTime = now();
      const response = await fetchFn(url.toString(), { headers });
      const endTime = now();
      nextRequestTime =
        endTime +
        (endTime - startTime > SLOW_RESPONSE_MS
          ? SLOW_RESPONSE_DELAY_MS
          : RATE_LIMIT_MS);

      let data = null;
      if (response.ok) {
        data = await response.json();
      } else if (response.status !== 429 && response.status !== 503) {
        throw new Error(
          `HTTP error: ${response.status} ${response.statusText}`
        );
      }

      const throttledByApi =
        data?.error?.code === "maxlag" || data?.error?.code === "ratelimited";
      if (data && !throttledByApi) {
        return data;
      }

      const retryAfter = parseRetryAfter(
        response.headers.get("Retry-After"),
        endTime
      );
      nextRequestTime =
        endTime + (retryAfter ?? BASE_BACKOFF_MS * 2 ** attempt);
    }

    throw new Error(
      "RATE_LIMIT: Too many requests. Please wait and try again."
    );
  }

  /**
   * Make a request to the Wiktionary API, after any earlier request has finished
   * @param {Object} params - API parameters
   * @param {string} [lang='de'] - Language wiki to use (e.g. 'de', 'en')
   * @returns {Promise<Object>} - API response
   * @throws {Error} - When still throttled after retrying, or on other errors
   */
  function request(params, lang = "de") {
    const result = queue.then(() => send(params, lang));
    queue = result.catch(() => {});
    return result;
  }

  /**
   * Get a parsed page with the revision it was parsed from
   * @param {string} pageTitle - Page title
   * @param {string} [prop='text'] - 'text' for HTML or 'wikitext'
   * @param {string} [lang='de'] - Language wiki to use
   * @returns {Promise<{content: string, revisionId: number}|null>}
   */
  async function getParsedPage(pageTitle, prop = "text", lang = "de") {
    const data = await request(
      { action: "parse", page: pageTitle, prop: `${prop}|revid` },
      lang
    );
    const content = data.parse?.[prop]?.["*"];
    return content ? { content, revisionId: data.parse.revid } : null;
  }

  return { request, getParsedPage };
}

const defaultClient = createApiClient();

export const apiRequest = defaultClient.request;
export const getParsedPage = defaultClient.getParsedPage;

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
 * Get parsed page content
 * @param {string} pageTitle - Page title
 * @returns {Promise<string>} - Page content
 */
export async function getPageText(pageTitle, prop = "text", lang = "de") {
  const page = await getParsedPage(pageTitle, prop, lang);
  return page?.content ?? null;
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

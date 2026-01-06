import test from "node:test";
import assert from "node:assert/strict";
import { createApiClient, flexionPageUrl } from "../src/api.js";

/** Client on a fake clock: sleeping advances time instantly and is recorded. */
function setup(responses) {
  const clock = { time: 1_000_000, sleeps: [] };
  const calls = [];
  const queue = [...responses];
  const client = createApiClient({
    contact: "https://example.org/contact",
    now: () => clock.time,
    sleep: async (ms) => {
      clock.sleeps.push(ms);
      clock.time += ms;
    },
    fetchFn: async (url, options) => {
      calls.push({ url: new URL(url), headers: options?.headers ?? {} });
      const next = queue.shift() ?? { body: { ok: true } };
      if (next.latencyMs) clock.time += next.latencyMs;
      return new Response(JSON.stringify(next.body ?? {}), {
        status: next.status ?? 200,
        headers: next.headers ?? {},
      });
    },
  });
  return { client, clock, calls };
}

test("sends a descriptive User-Agent with contact details", async () => {
  const { client, calls } = setup([{}]);
  await client.request({ action: "query" });
  const ua = calls[0].headers["User-Agent"];
  assert.match(ua, /^german-verbs-db-bot\/\d+\.\d+\.\d+ \(https:\/\/example\.org\/contact\) node\//);
});

test("refuses to send a request without contact details", async () => {
  const client = createApiClient({
    contact: "",
    fetchFn: async () => assert.fail("must not reach the network"),
  });
  await assert.rejects(client.request({ action: "query" }), /WIKIMEDIA_CONTACT/);
});

test("sends maxlag on every request", async () => {
  const { client, calls } = setup([{}]);
  await client.request({ action: "query" });
  assert.equal(calls[0].url.searchParams.get("maxlag"), "5");
});

test("spaces requests at least 350 ms apart", async () => {
  const { client, clock } = setup([{}, {}]);
  await client.request({ action: "query" });
  await client.request({ action: "query" });
  assert.deepEqual(clock.sleeps, [350]);
});

test("waits 5 seconds after a request that took over 1 second", async () => {
  const { client, clock } = setup([{ latencyMs: 1500 }, {}]);
  await client.request({ action: "query" });
  await client.request({ action: "query" });
  assert.deepEqual(clock.sleeps, [5000]);
});

test("never runs two requests at the same time", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const client = createApiClient({
    contact: "https://example.org/contact",
    sleep: async () => {},
    fetchFn: async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight--;
      return Response.json({});
    },
  });
  await Promise.all([1, 2, 3].map(() => client.request({ action: "query" })));
  assert.equal(maxInFlight, 1);
});

test("a failed request does not block later requests", async () => {
  const { client } = setup([{ status: 500 }, { body: { value: 2 } }]);
  await assert.rejects(client.request({ action: "query" }), /HTTP error: 500/);
  assert.deepEqual(await client.request({ action: "query" }), { value: 2 });
});

for (const status of [429, 503]) {
  test(`honours Retry-After seconds on ${status}`, async () => {
    const { client, clock, calls } = setup([
      { status, headers: { "Retry-After": "42" } },
      { body: { value: 1 } },
    ]);
    assert.deepEqual(await client.request({ action: "query" }), { value: 1 });
    assert.deepEqual(clock.sleeps, [42_000]);
    assert.equal(calls.length, 2);
  });
}

test("honours Retry-After given as an HTTP date", async () => {
  const { client, clock } = setup([
    {
      status: 429,
      headers: { "Retry-After": new Date(1_000_000 + 90_000).toUTCString() },
    },
    {},
  ]);
  await client.request({ action: "query" });
  assert.equal(clock.sleeps.length, 1);
  // HTTP dates have one-second resolution
  assert.ok(Math.abs(clock.sleeps[0] - 90_000) <= 1000, `${clock.sleeps[0]}`);
});

test("backs off exponentially from 5 seconds without Retry-After", async () => {
  const { client, clock } = setup([{ status: 429 }, { status: 429 }, {}]);
  await client.request({ action: "query" });
  assert.deepEqual(clock.sleeps, [5000, 10000]);
});

test("waits and retries when the API reports replication lag", async () => {
  const { client, clock } = setup([
    {
      body: { error: { code: "maxlag" } },
      headers: { "Retry-After": "7" },
    },
    { body: { value: 1 } },
  ]);
  assert.deepEqual(await client.request({ action: "query" }), { value: 1 });
  assert.deepEqual(clock.sleeps, [7000]);
});

test("gives up with RATE_LIMIT after repeated throttling", async () => {
  const { client, calls } = setup(Array(20).fill({ status: 429 }));
  await assert.rejects(client.request({ action: "query" }), /^Error: RATE_LIMIT/);
  assert.equal(calls.length, 6);
});

test("getParsedPage returns content with its revision ID", async () => {
  const { client } = setup([
    { body: { parse: { revid: 5421754, text: { "*": "<table>" } } } },
  ]);
  assert.deepEqual(await client.getParsedPage("Flexion:gehen"), {
    content: "<table>",
    revisionId: 5421754,
  });
});

test("getParsedPage asks the API for the revision ID", async () => {
  const { client, calls } = setup([{ body: { parse: { text: { "*": "x" } } } }]);
  await client.getParsedPage("Flexion:gehen");
  assert.equal(calls[0].url.searchParams.get("prop"), "text|revid");
});

test("getParsedPage returns null for a missing page", async () => {
  const { client } = setup([{ body: { error: { code: "missingtitle" } } }]);
  assert.equal(await client.getParsedPage("Flexion:nope"), null);
});

test("flexionPageUrl encodes umlauts", () => {
  assert.equal(
    flexionPageUrl("überbacken"),
    "https://de.wiktionary.org/wiki/Flexion:%C3%BCberbacken"
  );
});

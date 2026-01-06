import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseConjugations } from "../src/parser.js";

// Saved from de.wiktionary.org: Flexion:gehen rev 5421754, Flexion:ansehen rev 4106951
const fixture = (name) =>
  readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), "utf-8");

test("parses each tense of gehen from current page markup", () => {
  const result = parseConjugations(fixture("gehen"));
  assert.deepEqual(result.praesens, {
    sg1: "gehe",
    sg2: "gehst",
    sg3: "geht",
    pl1: "gehen",
    pl2: "geht",
    pl3: "gehen",
  });
  assert.equal(result.praeteritum.sg1, "ging");
  assert.equal(result.praeteritum.pl3, "gingen");
  assert.equal(result.perfekt.sg1, "bin gegangen");
  assert.equal(result.perfekt.pl3, "sind gegangen");
});

test("parses a separable verb from current page markup", () => {
  const result = parseConjugations(fixture("ansehen"));
  assert.equal(result.separablePrefix, "an");
  assert.equal(result.praesens.sg3, "sieht an");
  assert.equal(result.perfekt.sg1, "habe angesehen");
});

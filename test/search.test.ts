import { test } from "node:test";
import assert from "node:assert/strict";
import { searchRules, foldCase, tokenize } from "../src/search.js";
import { expandQuery } from "../src/glossary.js";

function ids(query: string, limit = 10): string[] {
  return searchRules(query, limit).map((h) => h.clause_id);
}

test("Azerbaijani dotted/dotless i folds correctly", () => {
  // Default JS lowercasing gets this wrong: "I" must fold to "ı", not "i".
  assert.equal(foldCase("İŞGÜZAR"), "işgüzar");
  assert.equal(foldCase("MÜŞTƏRI"), "müştərı");
  assert.equal(foldCase("Qaydalar"), "qaydalar");
});

test("tokenizer strips stopwords and stems suffixes to a common prefix", () => {
  const tokens = tokenize("müştərilərin və müştəri üçün");
  assert.ok(!tokens.includes("və"), "stopwords removed");
  // "müştərilərin" and "müştəri" should collapse to the same stem.
  assert.equal(new Set(tokens).size, 1, `expected one distinct stem, got ${tokens.join(",")}`);
});

test("English queries are rewritten into the regulation's Azerbaijani wording", () => {
  const expanded = expandQuery("What are the rules for a politically exposed person?");
  assert.match(expanded, /siyasi nüfuzlu şəxs/);

  const edd = expandQuery("when is enhanced due diligence required");
  assert.match(edd, /gücləndirilmiş müştəri uyğunluğu/);
});

test("plural English terms expand too - people rarely type the singular", () => {
  // Regression: "politically exposed persons" expanded to nothing, so an
  // English plural returned zero hits against an all-Azerbaijani corpus.
  for (const q of [
    "politically exposed persons",
    "prepaid cards",
    "high risk countries",
    "transit accounts",
    "PEPs",
  ]) {
    assert.ok(searchRules(q, 5).length > 0, `"${q}" should retrieve something`);
  }
});

test("English question about PEPs retrieves the PEP clauses", () => {
  const hits = ids("politically exposed person high risk");
  assert.ok(
    hits.some((id) => id.startsWith("3.9")),
    `expected a 3.9.x clause, got ${hits.join(", ")}`,
  );
});

test("English question about enhanced due diligence retrieves Part 5", () => {
  const hits = ids("enhanced due diligence measures");
  assert.ok(
    hits.some((id) => id.startsWith("5.")),
    `expected a Part 5 clause, got ${hits.join(", ")}`,
  );
});

test("English question about remote onboarding retrieves Part 7", () => {
  const hits = ids("remote onboarding video verification new technology");
  assert.ok(
    hits.some((id) => id.startsWith("7.")),
    `expected a Part 7 clause, got ${hits.join(", ")}`,
  );
});

test("question about review frequency retrieves Part 8", () => {
  const hits = ids("how often must customer information be updated review frequency");
  assert.ok(
    hits.some((id) => id.startsWith("8.")),
    `expected a Part 8 clause, got ${hits.join(", ")}`,
  );
});

test("native Azerbaijani queries work without expansion", () => {
  const hits = ids("sadələşdirilmiş müştəri uyğunluğu tədbirləri");
  assert.ok(
    hits.some((id) => id.startsWith("4.")),
    `expected a Part 4 clause, got ${hits.join(", ")}`,
  );
});

test("UN sanctions query finds the sanctions clause", () => {
  const hits = ids("united nations sanctions embargo country");
  assert.ok(hits.includes("3.12.3"), `expected 3.12.3, got ${hits.join(", ")}`);
});

test("results are ordered by descending relevance", () => {
  const scores = searchRules("gücləndirilmiş müştəri uyğunluğu", 8).map((h) => h.score);
  const sorted = [...scores].sort((a, b) => b - a);
  assert.deepEqual(scores, sorted);
});

test("a query with no lexical overlap returns nothing rather than noise", () => {
  assert.equal(searchRules("zzzzqqq xxxyyy", 5).length, 0);
});

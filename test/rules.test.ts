import { test } from "node:test";
import assert from "node:assert/strict";
import { corpus, getClause, getClauseTree, clausesByTopic } from "../src/rules.js";

test("corpus covers all eight parts of the Rules", () => {
  const parts = new Set(corpus.clauses.map((c) => c.part));
  for (const expected of ["1", "2", "3", "4", "5", "6", "7", "8"]) {
    assert.ok(parts.has(expected), `missing part ${expected}`);
  }
});

test("clause numbering is reconstructed, not lost to Word auto-numbering", () => {
  // The source .docx keeps list numbers outside the paragraph text; if the
  // extractor regresses, these anchor clauses are the first to disappear.
  const pep = getClause("3.9.1");
  assert.ok(pep, "clause 3.9.1 should exist");
  assert.match(pep.text, /siyasi nüfuzlu şəxs/i);

  const un = getClause("3.12.3");
  assert.ok(un);
  assert.match(un.text, /Birləşmiş Millətlər/i);
});

test("clause ids are unique", () => {
  const seen = new Set<string>();
  for (const c of corpus.clauses) {
    assert.ok(!seen.has(c.id), `duplicate clause id ${c.id}`);
    seen.add(c.id);
  }
});

test("getClauseTree returns a clause with all of its children", () => {
  const tree = getClauseTree("3.9");
  const ids = tree.map((c) => c.id);
  assert.ok(ids.includes("3.9"), "should include the parent");
  assert.ok(ids.includes("3.9.1"));
  assert.ok(ids.includes("3.9.13"));
  // Must not bleed into a numerically adjacent branch.
  assert.ok(!ids.some((id) => id.startsWith("3.10")), "3.10.x must not leak into the 3.9 tree");
});

test("high and low risk factor clauses are tagged on the right side", () => {
  const high = clausesByTopic("high-risk-factor").map((c) => c.id);
  const low = clausesByTopic("low-risk-factor").map((c) => c.id);

  assert.ok(high.includes("3.9.1"), "3.9.1 (PEPs) is a high-risk factor");
  assert.ok(low.includes("3.4.1"), "3.4.1 (notaries/auditors) is a low-risk factor");
  assert.equal(
    high.filter((id) => low.includes(id)).length,
    0,
    "no clause may be tagged both high and low risk",
  );
});

test("review-cycle clauses of Part 8 are present", () => {
  for (const id of ["8.1.1", "8.1.2", "8.1.3", "8.1.4"]) {
    assert.ok(getClause(id), `missing ${id}`);
  }
});

test("annex lists the accepted identity documents", () => {
  assert.ok(corpus.annex_identity_documents.length >= 7);
  assert.ok(
    corpus.annex_identity_documents.some((d) => /şəxsiyyət vəsiqəsi/i.test(d)),
    "annex should mention the national ID card",
  );
});

test("no clause text is empty", () => {
  for (const c of corpus.clauses) {
    assert.ok(c.text.trim().length > 0, `clause ${c.id} has no text`);
  }
});

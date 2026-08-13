import { test } from "node:test";
import assert from "node:assert/strict";
import { runTool, TOOL_DEFINITIONS } from "../src/tools/index.js";
import { FACTORS } from "../src/factors.js";
import { getClause } from "../src/rules.js";

test("every catalogued risk factor points at a real clause", () => {
  for (const factor of FACTORS) {
    assert.ok(
      getClause(factor.clause),
      `factor ${factor.key} cites clause ${factor.clause}, which is not in the corpus`,
    );
  }
});

test("factor keys are unique", () => {
  const keys = FACTORS.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("risk factor polarity matches the clause range it comes from", () => {
  // 3.4-3.8 are the low-risk lists; 3.9-3.13 the high-risk lists.
  for (const factor of FACTORS) {
    const second = Number(factor.clause.split(".")[1]);
    const expected = second >= 4 && second <= 8 ? "low" : "high";
    assert.equal(
      factor.polarity,
      expected,
      `${factor.key} (clause ${factor.clause}) is tagged ${factor.polarity}`,
    );
  }
});

test("tool definitions expose valid JSON Schema with required fields", () => {
  for (const tool of TOOL_DEFINITIONS) {
    assert.ok(tool.name && tool.description, `${tool.name} needs a description`);
    assert.equal(tool.input_schema.type, "object");
    assert.ok(
      tool.description.length > 120,
      `${tool.name} description is too thin to steer tool choice`,
    );
  }
});

// ---------------------------------------------------------------- risk

test("a single high-risk factor drives the profile to high risk", () => {
  const r = runTool("assess_customer_risk", {
    high_risk_factors: ["non_resident_customer"],
    low_risk_factors: ["term_deposit"],
  });
  assert.equal(r.risk_group, "high");
  assert.equal((r.ongoing_review as any).clause, "8.1.1");
});

test("PEPs are reviewed continuously under clause 8.1.4, not annually", () => {
  const r = runTool("assess_customer_risk", {
    high_risk_factors: ["pep_or_relative_or_associate"],
  });
  assert.equal(r.risk_group, "high");
  assert.equal((r.ongoing_review as any).clause, "8.1.4");
  assert.equal((r.ongoing_review as any).cycle, "continuous");
});

test("only low-risk factors yield the low group and a three-year cycle", () => {
  const r = runTool("assess_customer_risk", {
    low_risk_factors: ["term_deposit", "utility_payments"],
  });
  assert.equal(r.risk_group, "low");
  assert.equal((r.ongoing_review as any).clause, "8.1.3");
});

test("no identified factors defaults to medium with a two-year cycle", () => {
  const r = runTool("assess_customer_risk", {});
  assert.equal(r.risk_group, "medium");
  assert.equal((r.ongoing_review as any).clause, "8.1.2");
});

test("matched factors carry their clause citation and original Azerbaijani text", () => {
  const r = runTool("assess_customer_risk", { high_risk_factors: ["shell_company"] });
  const matched = (r.matched_high_risk_factors as any[])[0];
  assert.equal(matched.clause, "3.9.12");
  assert.match(matched.clause_text_az, /şel şirkət/i);
});

test("unrecognised factor keys are reported rather than silently dropped", () => {
  const r = runTool("assess_customer_risk", {
    high_risk_factors: ["not_a_real_factor", "term_deposit"], // second is low-polarity
  });
  assert.deepEqual(r.unknown_factor_keys, ["not_a_real_factor", "term_deposit"]);
});

// ---------------------------------------------------------------- CDD level

test("PEP status makes enhanced due diligence mandatory under clause 5.2", () => {
  const r = runTool("determine_cdd_level", { is_pep_or_relative_or_associate: true });
  assert.equal(r.enhanced_due_diligence_required, true);
  assert.ok((r.enhanced_due_diligence_triggers as any[]).some((t) => t.clause === "5.2"));
  assert.ok((r.enhanced_measures_available as any[]).length >= 7);
});

test("a FATF call-for-action country triggers enhanced measures", () => {
  const r = runTool("determine_cdd_level", { from_fatf_call_for_action_country: true });
  assert.equal(r.enhanced_due_diligence_required, true);
});

test("clause 4.4 blocks simplified measures whenever enhanced ones are required", () => {
  const r = runTool("determine_cdd_level", {
    risk_group: "low",
    is_pep_or_relative_or_associate: true,
    occasion: "before_business_relationship",
  });
  assert.equal(r.simplified_due_diligence_permitted, false);
  assert.ok((r.simplified_blockers as string[]).some((b) => b.includes("4.4")));
});

test("simplified measures are permitted for a low-risk profile at a listed occasion", () => {
  const r = runTool("determine_cdd_level", {
    risk_group: "low",
    occasion: "before_business_relationship",
  });
  assert.equal(r.simplified_due_diligence_permitted, true);
  assert.equal(r.simplified_occasion_clause, "4.1.1");
  assert.ok((r.simplified_measures_available as any[]).length === 3);
});

test("clause 4.2 bars simplified measures from ongoing due diligence", () => {
  const r = runTool("determine_cdd_level", {
    risk_group: "low",
    occasion: "ongoing_due_diligence",
  });
  assert.equal(r.simplified_due_diligence_permitted, false);
  assert.ok((r.simplified_blockers as string[]).some((b) => b.includes("4.2")));
});

test("the AZN 20,000 one-off threshold is reported against clause 4.1.2", () => {
  const over = runTool("determine_cdd_level", { one_off_amount_azn: 25000 });
  const note = (over.thresholds as any[]).find((t) => t.clause === "4.1.2");
  assert.match(note.note, /meets or exceeds/i);

  const under = runTool("determine_cdd_level", { one_off_amount_azn: 4000 });
  assert.match((under.thresholds as any[])[0].note, /below/i);
});

test("turnover below AZN 100,000 surfaces the clause 4.3.2 relaxation", () => {
  const r = runTool("determine_cdd_level", { annual_turnover_azn: 50000 });
  assert.ok((r.thresholds as any[]).some((t) => t.clause === "4.3.2"));
});

// ---------------------------------------------------------------- onboarding

test("first-time remote onboarding requires the four clause 7.2 measures", () => {
  const r = runTool("check_remote_onboarding", {
    first_time_relationship: true,
    measures_applied: ["enhanced_electronic_signature", "check_electronic_databases"],
  });
  assert.equal(r.compliant_with_7_2, false);
  const missing = (r.missing_mandatory_measures as any[]).map((m) => m.key);
  assert.deepEqual(missing.sort(), ["live_video_verification", "strong_customer_authentication"]);
});

test("all four mandatory measures present satisfies clause 7.2", () => {
  const r = runTool("check_remote_onboarding", {
    first_time_relationship: true,
    measures_applied: [
      "enhanced_electronic_signature",
      "check_electronic_databases",
      "strong_customer_authentication",
      "live_video_verification",
    ],
  });
  assert.equal(r.compliant_with_7_2, true);
  assert.equal((r.missing_mandatory_measures as any[]).length, 0);
});

test("clause 7.4 prohibits remote onboarding via an authorised representative", () => {
  const r = runTool("check_remote_onboarding", {
    first_time_relationship: true,
    via_authorised_representative: true,
  });
  assert.equal(r.prohibited, true);
  assert.ok((r.prohibitions as any[]).every((p) => p.clause === "7.4"));
});

test("the legal representative of a legal person is the clause 7.4 exception", () => {
  const r = runTool("check_remote_onboarding", {
    via_authorised_representative: true,
    representative_is_legal_representative_of_legal_person: true,
  });
  assert.equal(r.prohibited, false);
});

test("clause 7.4 prohibits remote onboarding of non-resident legal persons", () => {
  const r = runTool("check_remote_onboarding", { customer_is_non_resident_legal_person: true });
  assert.equal(r.prohibited, true);
});

// ---------------------------------------------------------------- retrieval tools

test("search_rules returns cited clauses", () => {
  const r = runTool("search_rules", { query: "prepaid cards high risk product" });
  assert.equal(r.ok, true);
  assert.ok((r.results as any[]).length > 0);
  assert.ok((r.results as any[]).every((h) => typeof h.clause_id === "string"));
});

test("get_clause returns a clause and its children verbatim", () => {
  const r = runTool("get_clause", { clause_id: "8.1" });
  const clauses = r.clauses as any[];
  assert.ok(clauses.some((c) => c.clause_id === "8.1.4"));
  assert.match(clauses.find((c) => c.clause_id === "8.1.4").text, /davamlı/i);
});

test("get_clause fails helpfully on an unknown clause", () => {
  const r = runTool("get_clause", { clause_id: "99.9" });
  assert.equal(r.ok, false);
  assert.match(String(r.error), /No clause 99\.9/);
});

test("an unknown tool name is reported, not thrown", () => {
  const r = runTool("nope", {});
  assert.equal(r.ok, false);
  assert.ok(Array.isArray(r.available));
});

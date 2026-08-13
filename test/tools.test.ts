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
  assert.equal((r.risk_qrupu as any).kod, "high");
  assert.equal((r.davamli_nezaret as any).bend, "8.1.1");
});

test("PEPs are reviewed continuously under clause 8.1.4, not annually", () => {
  const r = runTool("assess_customer_risk", {
    high_risk_factors: ["pep_or_relative_or_associate"],
  });
  assert.equal((r.risk_qrupu as any).kod, "high");
  assert.equal((r.davamli_nezaret as any).bend, "8.1.4");
  // The cycle must be the regulation's own wording, not a paraphrase.
  assert.match((r.davamli_nezaret as any).metn, /davamlı olaraq/i);
});

test("only low-risk factors yield the low group and a three-year cycle", () => {
  const r = runTool("assess_customer_risk", {
    low_risk_factors: ["term_deposit", "utility_payments"],
  });
  assert.equal((r.risk_qrupu as any).kod, "low");
  assert.equal((r.davamli_nezaret as any).bend, "8.1.3");
  assert.match((r.davamli_nezaret as any).metn, /üç ildə bir dəfə/i);
});

test("no identified factors defaults to medium with a two-year cycle", () => {
  const r = runTool("assess_customer_risk", {});
  assert.equal((r.risk_qrupu as any).kod, "medium");
  assert.equal((r.davamli_nezaret as any).bend, "8.1.2");
});

test("matched factors carry their clause citation and original Azerbaijani text", () => {
  const r = runTool("assess_customer_risk", { high_risk_factors: ["shell_company"] });
  const matched = (r.uygun_yuksek_risk_faktorlari as any[])[0];
  assert.equal(matched.bend, "3.9.12");
  assert.match(matched.metn, /şel şirkət/i);
  assert.match(matched.kateqoriya, /müştəri riski/);
});

test("unrecognised factor keys are reported rather than silently dropped", () => {
  const r = runTool("assess_customer_risk", {
    high_risk_factors: ["not_a_real_factor", "term_deposit"], // second is low-polarity
  });
  assert.deepEqual(r.taninmayan_faktorlar, ["not_a_real_factor", "term_deposit"]);
});

// ---------------------------------------------------------------- CDD level

test("PEP status makes enhanced due diligence mandatory under clause 5.2", () => {
  const r = runTool("determine_cdd_level", { is_pep_or_relative_or_associate: true });
  assert.equal(r.guclendirilmis_tedbirler_mecburidir, true);
  assert.ok((r.guclendirilmis_tedbir_esaslari as any[]).some((t) => t.bend === "5.2"));
  // All seven measures of 5.3, quoted verbatim from the Rules.
  const measures = r.guclendirilmis_tedbirler as any[];
  assert.equal(measures.length, 7);
  assert.deepEqual(
    measures.map((m) => m.bend),
    ["5.3.1", "5.3.2", "5.3.3", "5.3.4", "5.3.5", "5.3.6", "5.3.7"],
  );
  assert.match(measures[4].metn, /rəhbərliyin razılığı/i);
});

test("a FATF call-for-action country triggers enhanced measures", () => {
  const r = runTool("determine_cdd_level", { from_fatf_call_for_action_country: true });
  assert.equal(r.guclendirilmis_tedbirler_mecburidir, true);
});

test("clause 4.4 blocks simplified measures whenever enhanced ones are required", () => {
  const r = runTool("determine_cdd_level", {
    risk_group: "low",
    is_pep_or_relative_or_associate: true,
    occasion: "before_business_relationship",
  });
  assert.equal(r.sadelesdirilmis_tedbirlere_icaze, false);
  assert.ok((r.sadelesdirilmis_tedbirlerin_maneeleri as any[]).some((b) => b.bend === "4.4"));
});

test("simplified measures are permitted for a low-risk profile at a listed occasion", () => {
  const r = runTool("determine_cdd_level", {
    risk_group: "low",
    occasion: "before_business_relationship",
  });
  assert.equal(r.sadelesdirilmis_tedbirlere_icaze, true);
  assert.equal((r.sadelesdirilmis_tedbir_hali as any).bend, "4.1.1");
  assert.deepEqual(
    (r.sadelesdirilmis_tedbirler as any[]).map((m) => m.bend),
    ["4.3.1", "4.3.2", "4.3.3"],
  );
});

test("clause 4.2 bars simplified measures from ongoing due diligence", () => {
  const r = runTool("determine_cdd_level", {
    risk_group: "low",
    occasion: "ongoing_due_diligence",
  });
  assert.equal(r.sadelesdirilmis_tedbirlere_icaze, false);
  assert.ok((r.sadelesdirilmis_tedbirlerin_maneeleri as any[]).some((b) => b.bend === "4.2"));
});

test("the AZN 20,000 one-off threshold is reported against clause 4.1.2", () => {
  const over = runTool("determine_cdd_level", { one_off_amount_azn: 25000 });
  const note = (over.hedler as any[]).find((t) => t.bend === "4.1.2");
  assert.match(note.qeyd, /həddinə çatır və ya onu aşır/i);

  const under = runTool("determine_cdd_level", { one_off_amount_azn: 4000 });
  assert.match((under.hedler as any[])[0].qeyd, /həddindən aşağıdır/i);
});

test("turnover below AZN 100,000 surfaces the clause 4.3.2 relaxation", () => {
  const r = runTool("determine_cdd_level", { annual_turnover_azn: 50000 });
  assert.ok((r.hedler as any[]).some((t) => t.bend === "4.3.2"));
});

// ---------------------------------------------------------------- onboarding

test("first-time remote onboarding requires the four clause 7.2 measures", () => {
  const r = runTool("check_remote_onboarding", {
    first_time_relationship: true,
    measures_applied: ["enhanced_electronic_signature", "check_electronic_databases"],
  });
  assert.equal(r.bend_7_2_uygunlugu, false);
  const missing = (r.catismayan_mecburi_tedbirler as any[]).map((m) => m.acar);
  assert.deepEqual(missing.sort(), ["live_video_verification", "strong_customer_authentication"]);
  // Missing measures carry the clause and its verbatim text.
  const video = (r.catismayan_mecburi_tedbirler as any[]).find(
    (m) => m.acar === "live_video_verification",
  );
  assert.equal(video.bend, "7.1.7");
  assert.match(video.metn, /video zəng/i);
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
  assert.equal(r.bend_7_2_uygunlugu, true);
  assert.equal((r.catismayan_mecburi_tedbirler as any[]).length, 0);
});

test("clause 7.4 prohibits remote onboarding via an authorised representative", () => {
  const r = runTool("check_remote_onboarding", {
    first_time_relationship: true,
    via_authorised_representative: true,
  });
  assert.equal(r.qadagandir, true);
  assert.ok((r.qadagalar as any[]).every((p) => p.bend === "7.4"));
});

test("the legal representative of a legal person is the clause 7.4 exception", () => {
  const r = runTool("check_remote_onboarding", {
    via_authorised_representative: true,
    representative_is_legal_representative_of_legal_person: true,
  });
  assert.equal(r.qadagandir, false);
});

test("clause 7.4 prohibits remote onboarding of non-resident legal persons", () => {
  const r = runTool("check_remote_onboarding", { customer_is_non_resident_legal_person: true });
  assert.equal(r.qadagandir, true);
});

// ---------------------------------------------------------------- retrieval tools

test("search_rules returns cited clauses", () => {
  const r = runTool("search_rules", { query: "prepaid cards high risk product" });
  assert.equal(r.ok, true);
  assert.ok((r.neticeler as any[]).length > 0);
  assert.ok((r.neticeler as any[]).every((h) => typeof h.bend === "string"));
});

test("get_clause returns a clause and its children verbatim", () => {
  const r = runTool("get_clause", { clause_id: "8.1" });
  const clauses = r.bendler as any[];
  assert.ok(clauses.some((c) => c.bend === "8.1.4"));
  assert.match(clauses.find((c) => c.bend === "8.1.4").metn, /davamlı/i);
});

test("get_clause fails helpfully on an unknown clause", () => {
  const r = runTool("get_clause", { clause_id: "99.9" });
  assert.equal(r.ok, false);
  assert.match(String(r.xeta), /99\.9 nömrəli bənd yoxdur/);
});

test("an unknown tool name is reported, not thrown", () => {
  const r = runTool("nope", {});
  assert.equal(r.ok, false);
  assert.ok(Array.isArray(r.movcud));
});

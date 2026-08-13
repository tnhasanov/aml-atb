import type Anthropic from "@anthropic-ai/sdk";
import { searchRules } from "../search.js";
import { corpus, getClause, getClauseTree, citation } from "../rules.js";
import {
  FACTORS,
  getFactor,
  HIGH_RISK_FACTOR_KEYS,
  LOW_RISK_FACTOR_KEYS,
  type Category,
} from "../factors.js";

export interface ToolResult {
  ok: boolean;
  [key: string]: unknown;
}

type Handler = (input: Record<string, any>) => ToolResult;

/**
 * Tool definitions handed to the model.
 *
 * Descriptions are prescriptive about *when* to call each tool, not just what
 * it does - the model reaches for tools more reliably when the trigger
 * condition is part of the description.
 */
export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: "search_rules",
    description:
      "Full-text search across the Azerbaijani AML/CFT customer due diligence Rules " +
      "(MMX Decision 3-21-28/3-6-4/2023). Call this FIRST for any question about what " +
      "the Rules require, permit or prohibit - including questions asked in English, " +
      "which are translated into the regulation's Azerbaijani wording automatically. " +
      "Returns matching clauses with their clause numbers so you can cite them. " +
      "Do not answer a regulatory question from memory without searching.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "The question or topic, in English or Azerbaijani. Use the user's own " +
            "terminology; synonym expansion is handled for you.",
        },
        limit: {
          type: "integer",
          description: "Number of clauses to return (default 8, max 20).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_clause",
    description:
      "Retrieve the verbatim text of a specific clause and everything nested beneath " +
      "it (e.g. '3.9' returns 3.9 and all of 3.9.1-3.9.13). Call this when a search " +
      "result or another tool cites a clause number and you need the full text before " +
      "quoting it, or when the user asks about a clause by number.",
    input_schema: {
      type: "object",
      properties: {
        clause_id: {
          type: "string",
          description: "Clause number such as '3.9', '3.12.3', '8.1' or '7.2'.",
        },
      },
      required: ["clause_id"],
    },
  },
  {
    name: "assess_customer_risk",
    description:
      "Classify a customer profile into a risk group (high / medium / low) by applying " +
      "the risk factors in Part 3 of the Rules, and return the resulting ongoing review " +
      "cycle from clause 8.1. Call this whenever the user describes a customer, " +
      "prospect or scenario and asks how to risk-rate it, what CDD level applies, or " +
      "how often to review it. Pass every factor you can identify from the " +
      "conversation; omit those you cannot determine.",
    input_schema: {
      type: "object",
      properties: {
        high_risk_factors: {
          type: "array",
          items: { type: "string", enum: HIGH_RISK_FACTOR_KEYS },
          description: "Keys of the high-risk factors present (clauses 3.9-3.13).",
        },
        low_risk_factors: {
          type: "array",
          items: { type: "string", enum: LOW_RISK_FACTOR_KEYS },
          description: "Keys of the low-risk factors present (clauses 3.4-3.8).",
        },
        customer_description: {
          type: "string",
          description: "Short free-text description of the customer, for the audit record.",
        },
      },
      required: [],
    },
  },
  {
    name: "determine_cdd_level",
    description:
      "Determine whether simplified CDD is permitted (Part 4) or enhanced CDD is " +
      "mandatory (Part 5), and list the specific measures available in each case. " +
      "Call this after assessing risk, or whenever the user asks whether they can " +
      "apply simplified measures, what enhanced measures to apply, or what to do " +
      "about a PEP or a customer from a FATF call-for-action country.",
    input_schema: {
      type: "object",
      properties: {
        risk_group: {
          type: "string",
          enum: ["high", "medium", "low"],
          description: "Risk group of the customer profile, if already determined.",
        },
        is_pep_or_relative_or_associate: {
          type: "boolean",
          description: "Customer is a PEP, a close relative or a close associate of one.",
        },
        from_fatf_call_for_action_country: {
          type: "boolean",
          description:
            "Person, financial institution or legal arrangement from a state FATF has " +
            "called for action on.",
        },
        complex_unusually_large_or_no_apparent_purpose: {
          type: "boolean",
          description:
            "Transaction is complex, unusually large, or has no evident economic or " +
            "lawful purpose (clause 5.1).",
        },
        occasion: {
          type: "string",
          enum: [
            "before_business_relationship",
            "before_one_off_transaction",
            "before_electronic_transfer_or_virtual_asset",
            "ongoing_due_diligence",
          ],
          description: "The point at which the measures would be applied.",
        },
        one_off_amount_azn: {
          type: "number",
          description: "Value of the one-off transaction in AZN, if applicable.",
        },
        annual_turnover_azn: {
          type: "number",
          description: "Annual turnover of transactions under the business relationship, in AZN.",
        },
      },
      required: [],
    },
  },
  {
    name: "check_remote_onboarding",
    description:
      "Check a non-face-to-face / new-technology onboarding flow against Part 7 of the " +
      "Rules: which verification measures are mandatory, which are missing, and whether " +
      "the arrangement is outright prohibited. Call this whenever the user describes " +
      "onboarding customers remotely, digital or app-based onboarding, video " +
      "identification, e-signature verification, or onboarding through a representative.",
    input_schema: {
      type: "object",
      properties: {
        first_time_relationship: {
          type: "boolean",
          description:
            "True if this is the first time a business relationship is established with " +
            "the customer (clause 7.2 makes four measures mandatory in that case).",
        },
        measures_applied: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "enhanced_electronic_signature",
              "check_electronic_databases",
              "strong_customer_authentication",
              "obtain_documents_from_trusted_third_party",
              "correspondence_via_registered_address",
              "security_codes_tokens_to_verified_address",
              "live_video_verification",
              "other_internal_controls",
            ],
          },
          description: "Verification measures from clause 7.1 the institution applies.",
        },
        via_authorised_representative: {
          type: "boolean",
          description: "Relationship would be established through an authorised representative.",
        },
        representative_is_legal_representative_of_legal_person: {
          type: "boolean",
          description:
            "The representative is the legal representative of a legal person (the only " +
            "exception in clause 7.4).",
        },
        customer_is_non_resident_legal_person: {
          type: "boolean",
          description: "The prospective customer is a non-resident legal person.",
        },
        identity_cannot_be_established_or_doubtful: {
          type: "boolean",
          description:
            "Identification/verification does not allow the customer's identity to be " +
            "established, or the authenticity of documents is in doubt.",
        },
      },
      required: [],
    },
  },
];

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const DOC = corpus.document.id;

const handlers: Record<string, Handler> = {
  search_rules(input) {
    const query = String(input.query ?? "").trim();
    if (!query) return { ok: false, error: "query is required" };
    const limit = clamp(Number(input.limit) || 8, 1, 20);
    const hits = searchRules(query, limit);
    return {
      ok: true,
      source: DOC,
      query,
      result_count: hits.length,
      results: hits,
      note:
        hits.length === 0
          ? "No clause matched. Say so plainly rather than answering from general AML knowledge."
          : "Cite clause numbers in your answer. Clause text is Azerbaijani; translate when answering in another language.",
    };
  },

  get_clause(input) {
    const id = String(input.clause_id ?? "").trim();
    if (!id) return { ok: false, error: "clause_id is required" };

    const tree = getClauseTree(id);
    if (!tree.length) {
      return {
        ok: false,
        error: `No clause ${id} in ${DOC}.`,
        hint: "Clause numbers run 1.1 to 8.3. Use search_rules to locate the right one.",
      };
    }
    const head = getClause(id) ?? tree[0]!;
    return {
      ok: true,
      source: DOC,
      clause_id: id,
      part: head.part,
      part_title_en: head.part_title_en,
      clauses: tree.map((c) => ({ clause_id: c.id, text: c.text })),
    };
  },

  assess_customer_risk(input) {
    const highKeys = uniqueStrings(input.high_risk_factors);
    const lowKeys = uniqueStrings(input.low_risk_factors);

    const unknown: string[] = [];
    const high = resolve(highKeys, "high", unknown);
    const low = resolve(lowKeys, "low", unknown);

    // Clause 3.1: the risk group follows from the risk factors across the five
    // categories. The Rules let any listed factor "be classified as" high or
    // low, so a single high-risk factor drives the profile to high risk unless
    // the obliged entity's own assessment says otherwise (3.2, 3.3).
    let group: "high" | "medium" | "low";
    let rationale: string;
    if (high.length > 0) {
      group = "high";
      rationale =
        `${high.length} high-risk factor(s) from clauses 3.9-3.13 are present. Under clause 5.1 ` +
        `enhanced customer due diligence must be applied, and clause 4.4 excludes simplified measures.`;
    } else if (low.length > 0) {
      group = "low";
      rationale =
        `No high-risk factor identified and ${low.length} low-risk factor(s) from clauses 3.4-3.8 ` +
        `are present.`;
    } else {
      group = "medium";
      rationale =
        "No high-risk factor from clauses 3.9-3.13 and no low-risk factor from clauses 3.4-3.8 " +
        "was identified, so the profile defaults to the medium group.";
    }

    const isPep = high.some((x) => x.key === "pep_or_relative_or_associate");

    const review = isPep
      ? {
          clause: "8.1.4",
          cycle: "continuous",
          text_en: "For politically exposed persons - on a continuous basis.",
        }
      : group === "high"
        ? { clause: "8.1.1", cycle: "at least annually", text_en: "For high-risk customers - at least once a year." }
        : group === "medium"
          ? { clause: "8.1.2", cycle: "at least once every 2 years", text_en: "For medium-risk customers - at least once every two years." }
          : { clause: "8.1.3", cycle: "at least once every 3 years", text_en: "For low-risk customers - at least once every three years." };

    return {
      ok: true,
      source: DOC,
      risk_group: group,
      rationale,
      matched_high_risk_factors: high.map(describe),
      matched_low_risk_factors: low.map(describe),
      unknown_factor_keys: unknown,
      categories_triggered: summariseCategories(high),
      required_cdd_level: group === "high" ? "enhanced (Part 5)" : group === "low" ? "simplified permitted if Part 4 conditions are met" : "standard",
      ongoing_review: review,
      caveats: [
        `Clause 3.3: the obliged entity must also take account of national, sectoral and ` +
          `institutional risk assessment results, which this tool does not hold.`,
        `Clause 3.2: the risk group must be changed if any of the underlying risks change.`,
        `Clause 8.2: the 8.1 intervals may be lengthened or shortened, and intermediate risk ` +
          `categories set, depending on risk assessment results.`,
        `Clause 8.3: if the customer moves to a higher risk degree, enhanced measures apply immediately.`,
        "This is a decision-support output, not a compliance decision. The obliged entity's " +
          "MLRO/compliance function owns the final classification.",
      ],
      customer_description: input.customer_description ?? null,
    };
  },

  determine_cdd_level(input) {
    const riskGroup = input.risk_group as "high" | "medium" | "low" | undefined;
    const isPep = Boolean(input.is_pep_or_relative_or_associate);
    const fatfCall = Boolean(input.from_fatf_call_for_action_country);
    const complexTx = Boolean(input.complex_unusually_large_or_no_apparent_purpose);
    const occasion = input.occasion as string | undefined;
    const amount = numberOrNull(input.one_off_amount_azn);
    const turnover = numberOrNull(input.annual_turnover_azn);

    const eddTriggers: { clause: string; reason: string }[] = [];
    if (isPep) {
      eddTriggers.push({
        clause: "5.2",
        reason:
          "Enhanced measures are mandatory for politically exposed persons and their close " +
          "relatives or close associates.",
      });
    }
    if (fatfCall) {
      eddTriggers.push({
        clause: "5.2",
        reason:
          "Enhanced measures are mandatory for persons, financial institutions and legal " +
          "arrangements from states FATF has called for action on.",
      });
    }
    if (complexTx) {
      eddTriggers.push({
        clause: "5.1",
        reason:
          "Transactions that are complex, unusually large, or without evident economic or " +
          "lawful purpose and carry a high risk degree require enhanced measures.",
      });
    }
    if (riskGroup === "high") {
      eddTriggers.push({
        clause: "5.1",
        reason: "The risk assessment determined the risk to be high.",
      });
    }

    const eddRequired = eddTriggers.length > 0;

    // Clause 4.1: simplified measures are available only for low risk degrees
    // and only on the occasions listed. Clause 4.4 makes any EDD trigger fatal
    // to that availability.
    const sddOccasions: Record<string, string> = {
      before_business_relationship: "4.1.1",
      before_one_off_transaction: "4.1.2",
      before_electronic_transfer_or_virtual_asset: "4.1.3",
    };
    const occasionClause = occasion ? sddOccasions[occasion] : undefined;

    const sddBlockers: string[] = [];
    if (eddRequired) {
      sddBlockers.push(
        "Clause 4.4: the presence of circumstances requiring enhanced measures excludes the " +
          "application of simplified measures.",
      );
    }
    if (riskGroup && riskGroup !== "low") {
      sddBlockers.push(
        `Clause 4.1: simplified measures are available only for low risk degrees; this profile ` +
          `is ${riskGroup} risk.`,
      );
    }
    if (occasion === "ongoing_due_diligence") {
      sddBlockers.push(
        "Clause 4.2: simplified measures applied when establishing a relationship or carrying " +
          "out a one-off transaction cannot be used for ongoing due diligence.",
      );
    }
    if (occasion && !occasionClause && occasion !== "ongoing_due_diligence") {
      sddBlockers.push("Clause 4.1: the stated occasion is not one on which simplified measures may be applied.");
    }

    const sddPermitted = sddBlockers.length === 0 && riskGroup === "low";

    const thresholds: { clause: string; note: string }[] = [];
    if (amount !== null) {
      thresholds.push(
        amount >= 20000
          ? {
              clause: "4.1.2",
              note:
                `AZN ${amount.toLocaleString("en-US")} meets or exceeds the AZN 20,000 one-off ` +
                `transaction threshold. Linked transactions carried out within a limit whose ` +
                `combined value exceeds AZN 20,000 are treated the same way.`,
            }
          : {
              clause: "4.1.2",
              note:
                `AZN ${amount.toLocaleString("en-US")} is below the AZN 20,000 one-off threshold, ` +
                `but linked transactions exceeding AZN 20,000 in aggregate still fall within it.`,
            },
      );
    }
    if (turnover !== null && turnover < 100000) {
      thresholds.push({
        clause: "4.3.2",
        note:
          `Annual turnover of AZN ${turnover.toLocaleString("en-US")} is below AZN 100,000, so ` +
          `identification data may be updated at longer intervals than clause 8.1 requires - ` +
          `available only if simplified measures are otherwise permitted.`,
      });
    }

    return {
      ok: true,
      source: DOC,
      enhanced_due_diligence_required: eddRequired,
      enhanced_due_diligence_triggers: eddTriggers,
      enhanced_measures_available: eddRequired
        ? [
            { clause: "5.3.1", measure: "Obtain additional information and documents on the customer (employment and activity, size of assets, open-source information, additional income sources) and update and verify customer and beneficial owner identification data more intensively." },
            { clause: "5.3.2", measure: "Obtain additional information and documents on the nature of the business relationship." },
            { clause: "5.3.3", measure: "Obtain additional information and documents on the source of the customer's funds and wealth." },
            { clause: "5.3.4", measure: "Obtain additional information on the purpose of the executed or intended transaction." },
            { clause: "5.3.5", measure: "Establish or continue the business relationship only with senior management approval." },
            { clause: "5.3.6", measure: "Conduct ongoing monitoring of the relationship with increased duration and frequency of controls, and analyse transaction patterns further." },
            { clause: "5.3.7", measure: "Require the first payment to be made through an account in the customer's name at a bank with equivalent CDD requirements." },
          ]
        : [],
      enhanced_measures_note: eddRequired
        ? "Clause 5.4: clause 5.3 does not preclude applying further enhanced measures. Clause 5.2 requires enhanced measures to be effective and proportionate to the risks."
        : null,
      simplified_due_diligence_permitted: sddPermitted,
      simplified_blockers: sddBlockers,
      simplified_occasion_clause: occasionClause ?? null,
      simplified_measures_available: sddPermitted
        ? [
            { clause: "4.3.1", measure: "Verify the customer and beneficial owner after the business relationship has been established." },
            { clause: "4.3.2", measure: "Where annual turnover under the relationship is below AZN 100,000, update identification data at longer intervals than clause 8.1 requires." },
            { clause: "4.3.3", measure: "Determine the purpose and nature of the business relationship from the type of transaction or relationship itself, without obtaining further information or conducting enquiries." },
          ]
        : [],
      thresholds,
      caveats: [
        "Clause 4.1 applies simplified measures only in accordance with Article 4.18 of the Law.",
        "This output supports a decision; the obliged entity remains responsible for applying " +
          "measures proportionate to the risk it has assessed.",
      ],
    };
  },

  check_remote_onboarding(input) {
    const firstTime = Boolean(input.first_time_relationship);
    const applied = new Set(uniqueStrings(input.measures_applied));

    const MEASURES: Record<string, { clause: string; label: string }> = {
      enhanced_electronic_signature: { clause: "7.1.1", label: "Require the customer's application to be confirmed with their enhanced electronic signature" },
      check_electronic_databases: { clause: "7.1.2", label: "Check the information submitted against electronic databases and/or independent external sources" },
      strong_customer_authentication: { clause: "7.1.3", label: "Carry out strong customer authentication (knowledge, possession and inherence factors designed to protect the confidentiality of authentication data)" },
      obtain_documents_from_trusted_third_party: { clause: "7.1.4", label: "Obtain the customer's documents, with their consent, on request from a trusted third party or state body" },
      correspondence_via_registered_address: { clause: "7.1.5", label: "Conduct correspondence and document exchange via the customer's official registered address" },
      security_codes_tokens_to_verified_address: { clause: "7.1.6", label: "Require use of security codes, electronic signatures, tokens or similar credentials delivered to an address verified by post, telephone or other reliable means" },
      live_video_verification: { clause: "7.1.7", label: "Verify the customer's identity by real-time video call or in-system video recording" },
      other_internal_controls: { clause: "7.1.8", label: "Apply other checks and controls set out in the obliged entity's internal procedures" },
    };

    // Clause 7.2 - mandatory set for a first-time remote relationship.
    const MANDATORY = [
      "enhanced_electronic_signature",
      "check_electronic_databases",
      "strong_customer_authentication",
      "live_video_verification",
    ];

    const prohibitions: { clause: string; reason: string }[] = [];
    if (input.via_authorised_representative && !input.representative_is_legal_representative_of_legal_person) {
      prohibitions.push({
        clause: "7.4",
        reason:
          "Establishing a business relationship remotely through an authorised representative is " +
          "not permitted. The only exception is the legal representative of a legal person.",
      });
    }
    if (input.customer_is_non_resident_legal_person) {
      prohibitions.push({
        clause: "7.4",
        reason: "Remote establishment of a business relationship with a non-resident legal person is not permitted.",
      });
    }

    const missing = firstTime ? MANDATORY.filter((m) => !applied.has(m)) : [];

    const findings: { clause: string; issue: string }[] = [];
    if (input.identity_cannot_be_established_or_doubtful) {
      findings.push({
        clause: "7.3",
        issue:
          "Where the identification and verification measures do not allow the customer's " +
          "identity to be established, or the authenticity of the submitted documents is in " +
          "doubt, the clause 7.3 restriction applies - retrieve its full text with get_clause " +
          "before advising.",
      });
    }

    return {
      ok: true,
      source: DOC,
      prohibited: prohibitions.length > 0,
      prohibitions,
      first_time_relationship: firstTime,
      mandatory_measures: firstTime
        ? MANDATORY.map((k) => ({ ...MEASURES[k]!, key: k, applied: applied.has(k) }))
        : [],
      missing_mandatory_measures: missing.map((k) => ({ ...MEASURES[k]!, key: k })),
      compliant_with_7_2: firstTime ? missing.length === 0 : null,
      all_available_measures: Object.entries(MEASURES).map(([key, v]) => ({ key, ...v })),
      additional_findings: findings,
      caveats: [
        "Clause 7.2 makes measures 7.1.1, 7.1.2, 7.1.3 and 7.1.7 mandatory when a business " +
          "relationship is established with the customer for the first time.",
        "Clause 6.4: verification may be completed after the relationship is established - but " +
          "no later than 5 business days - including for relationships created using new " +
          "technologies (6.4.1), provided the clause 6.5 risk management procedures are in place.",
      ],
    };
  },
};

// ---------------------------------------------------------------------------

export function listToolNames(): string[] {
  return TOOL_DEFINITIONS.map((t) => t.name);
}

export function runTool(name: string, input: Record<string, unknown>): ToolResult {
  const handler = handlers[name];
  if (!handler) {
    return { ok: false, error: `Unknown tool: ${name}`, available: listToolNames() };
  }
  try {
    return handler(input as Record<string, any>);
  } catch (err) {
    return {
      ok: false,
      error: `Tool ${name} failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ---- helpers --------------------------------------------------------------

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function numberOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function uniqueStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is string => typeof x === "string"))];
}

function resolve(keys: string[], polarity: "high" | "low", unknown: string[]) {
  const out = [];
  for (const key of keys) {
    const factor = getFactor(key);
    if (!factor || factor.polarity !== polarity) {
      unknown.push(key);
      continue;
    }
    out.push(factor);
  }
  return out;
}

function describe(factor: (typeof FACTORS)[number]) {
  return {
    key: factor.key,
    clause: factor.clause,
    citation: citation(factor.clause),
    category: factor.category,
    label_en: factor.label_en,
    clause_text_az: getClause(factor.clause)?.text ?? null,
  };
}

function summariseCategories(factors: { category: Category }[]): Category[] {
  return [...new Set(factors.map((f) => f.category))];
}

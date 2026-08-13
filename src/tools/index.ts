import type Anthropic from "@anthropic-ai/sdk";
import { searchRules } from "../search.js";
import {
  corpus,
  getClause,
  getClauseTree,
  citation,
  clauseRef,
  childRefs,
} from "../rules.js";
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
 * The schema descriptions stay in English: they steer the model's tool choice
 * and are never shown to a user. Everything the tools *return* is Azerbaijani,
 * quoted from the Rules, because that text does reach the user through the
 * assistant's answer.
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
      "conversation; omit those you cannot determine. Returns Azerbaijani clause text.",
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
      "mandatory (Part 5), and list the specific measures available in each case, " +
      "quoted verbatim from the Rules. Call this after assessing risk, or whenever the " +
      "user asks whether they can apply simplified measures, what enhanced measures to " +
      "apply, or what to do about a PEP or a customer from a FATF call-for-action country.",
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

/** Maps a clause 7.1.x measure onto the key the model passes in. */
const REMOTE_MEASURES: Record<string, string> = {
  enhanced_electronic_signature: "7.1.1",
  check_electronic_databases: "7.1.2",
  strong_customer_authentication: "7.1.3",
  obtain_documents_from_trusted_third_party: "7.1.4",
  correspondence_via_registered_address: "7.1.5",
  security_codes_tokens_to_verified_address: "7.1.6",
  live_video_verification: "7.1.7",
  other_internal_controls: "7.1.8",
};

/** Clause 7.2 - mandatory for a first-time remote relationship. */
const MANDATORY_REMOTE = [
  "enhanced_electronic_signature",
  "check_electronic_databases",
  "strong_customer_authentication",
  "live_video_verification",
];

const handlers: Record<string, Handler> = {
  search_rules(input) {
    const query = String(input.query ?? "").trim();
    if (!query) return { ok: false, xeta: "Sorğu mətni tələb olunur." };
    const limit = clamp(Number(input.limit) || 8, 1, 20);
    const hits = searchRules(query, limit);
    return {
      ok: true,
      menbe: DOC,
      sorgu: query,
      netice_sayi: hits.length,
      neticeler: hits.map((h) => ({
        bend: h.clause_id,
        hisse: h.part,
        hisse_adi: getClause(h.clause_id)?.part_title_az ?? "",
        metn: h.text,
        uygunluq: h.score,
      })),
      qeyd:
        hits.length === 0
          ? "Heç bir bənd uyğun gəlmədi. Ümumi AML biliyinə əsaslanmaq əvəzinə bunu açıq şəkildə bildirin."
          : "Cavabda bənd nömrələrini göstərin.",
    };
  },

  get_clause(input) {
    const id = String(input.clause_id ?? "").trim();
    if (!id) return { ok: false, xeta: "Bənd nömrəsi tələb olunur." };

    const tree = getClauseTree(id);
    if (!tree.length) {
      return {
        ok: false,
        xeta: `${DOC} sənədində ${id} nömrəli bənd yoxdur.`,
        ipucu: "Bəndlər 1.1-dən 8.3-ə qədərdir. Düzgün bəndi tapmaq üçün search_rules çağırın.",
      };
    }
    const head = getClause(id) ?? tree[0]!;
    return {
      ok: true,
      menbe: DOC,
      bend: id,
      hisse: head.part,
      hisse_adi: head.part_title_az,
      bendler: tree.map((c) => ({ bend: c.id, metn: c.text })),
    };
  },

  assess_customer_risk(input) {
    const unknown: string[] = [];
    const high = resolve(uniqueStrings(input.high_risk_factors), "high", unknown);
    const low = resolve(uniqueStrings(input.low_risk_factors), "low", unknown);

    // Clause 3.1: the risk group follows from the risk factors across the five
    // categories. The Rules let any listed factor "be classified as" high or
    // low, so a single high-risk factor drives the profile to high risk unless
    // the obliged entity's own assessment says otherwise (3.2, 3.3).
    let group: "high" | "medium" | "low";
    let esaslandirma: string;
    if (high.length > 0) {
      group = "high";
      esaslandirma =
        `3.9-3.13-cü bəndlərdə nəzərdə tutulmuş ${high.length} yüksək risk faktoru mövcuddur. ` +
        `5.1-ci bəndə əsasən gücləndirilmiş müştəri uyğunluğu tədbirləri tətbiq edilməlidir; ` +
        `4.4-cü bənd isə sadələşdirilmiş tədbirlərin tətbiqini istisna edir.`;
    } else if (low.length > 0) {
      group = "low";
      esaslandirma =
        `Yüksək risk faktoru müəyyən edilməyib. 3.4-3.8-ci bəndlərdə nəzərdə tutulmuş ` +
        `${low.length} aşağı risk faktoru mövcuddur.`;
    } else {
      group = "medium";
      esaslandirma =
        "3.9-3.13-cü bəndlər üzrə yüksək risk faktoru və 3.4-3.8-ci bəndlər üzrə aşağı risk " +
        "faktoru müəyyən edilmədiyi üçün profil orta risk qrupuna aid edilir.";
    }

    const isPep = high.some((x) => x.key === "pep_or_relative_or_associate");

    // Clause 8.1 - PEPs are monitored continuously (8.1.4), which overrides the
    // annual cycle other high-risk customers fall under.
    const reviewClause = isPep
      ? "8.1.4"
      : group === "high"
        ? "8.1.1"
        : group === "medium"
          ? "8.1.2"
          : "8.1.3";

    return {
      ok: true,
      menbe: DOC,
      risk_qrupu: { kod: group, ad: RISK_GROUP_AZ[group] },
      esaslandirma,
      uygun_yuksek_risk_faktorlari: high.map(describe),
      uygun_asagi_risk_faktorlari: low.map(describe),
      taninmayan_faktorlar: unknown,
      teqsirlenen_kateqoriyalar: summariseCategories(high).map((c) => CATEGORY_AZ[c]),
      teleb_olunan_uygunluq_seviyyesi:
        group === "high"
          ? "gücləndirilmiş müştəri uyğunluğu tədbirləri (5-ci hissə)"
          : group === "low"
            ? "4-cü hissənin şərtləri ödənildikdə sadələşdirilmiş tədbirlər tətbiq edilə bilər"
            : "standart müştəri uyğunluğu tədbirləri",
      davamli_nezaret: clauseRef(reviewClause),
      qeydler: [
        clauseRef("3.3"),
        clauseRef("3.2"),
        clauseRef("8.2"),
        clauseRef("8.3"),
      ],
      xeberdarliq:
        "Bu nəticə qərar dəstəyi məqsədi daşıyır və uyğunluq qərarı deyil. Yekun təsnifat " +
        "öhdəlik daşıyan şəxsin uyğunluq bölməsinə (MLRO) aiddir. 3.3-cü bəndə əsasən milli, " +
        "sahəvi və institusional risk qiymətləndirməsinin nəticələri də nəzərə alınmalıdır; " +
        "bu alət həmin məlumatlara malik deyil.",
      musteri_tesviri: input.customer_description ?? null,
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

    const eddTriggers: { bend: string; sebeb: string; metn: string }[] = [];
    const trigger = (bend: string, sebeb: string) =>
      eddTriggers.push({ bend, sebeb, metn: getClause(bend)?.text ?? "" });

    if (isPep) {
      trigger(
        "5.2",
        "Müştəri siyasi nüfuzlu şəxs, onun yaxın qohumu və ya yaxın münasibətdə olduğu şəxsdir.",
      );
    }
    if (fatfCall) {
      trigger(
        "5.2",
        "Şəxs FATF-ın çağırış etdiyi dövlətdəndir (ərazidəndir).",
      );
    }
    if (complexTx) {
      trigger(
        "5.1",
        "Əməliyyat mürəkkəb, qeyri-adi olaraq irihəcmlidir və ya açıq-aşkar iqtisadi/qanuni məqsədi yoxdur.",
      );
    }
    if (riskGroup === "high") {
      trigger("5.1", "Risk qiymətləndirməsi nəticəsində risk yüksək müəyyən edilib.");
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

    const sddBlockers: { bend: string; sebeb: string }[] = [];
    if (eddRequired) {
      sddBlockers.push({
        bend: "4.4",
        sebeb:
          "Gücləndirilmiş müştəri uyğunluğu tədbirlərinin tətbiqini tələb edən halların " +
          "mövcudluğu sadələşdirilmiş tədbirlərin tətbiqini istisna edir.",
      });
    }
    if (riskGroup && riskGroup !== "low") {
      sddBlockers.push({
        bend: "4.1",
        sebeb:
          `Sadələşdirilmiş tədbirlər yalnız aşağı risk dərəcələri üçün tətbiq edilə bilər; ` +
          `bu profil ${RISK_GROUP_AZ[riskGroup]} qrupundadır.`,
      });
    }
    if (occasion === "ongoing_due_diligence") {
      sddBlockers.push({
        bend: "4.2",
        sebeb:
          "İşgüzar münasibətlərin yaradılması və ya birdəfəlik əməliyyat zamanı tətbiq edilən " +
          "sadələşdirilmiş tədbirlər davamlı müştəri uyğunluğu tədbirləri üçün tətbiq edilə bilməz.",
      });
    }
    if (occasion && !occasionClause && occasion !== "ongoing_due_diligence") {
      sddBlockers.push({
        bend: "4.1",
        sebeb: "Göstərilən hal sadələşdirilmiş tədbirlərin tətbiq edilə biləcəyi hallardan deyil.",
      });
    }

    const sddPermitted = sddBlockers.length === 0 && riskGroup === "low";

    const hedler: { bend: string; qeyd: string }[] = [];
    if (amount !== null) {
      hedler.push({
        bend: "4.1.2",
        qeyd:
          amount >= 20000
            ? `${formatAzn(amount)} məbləği iyirmi min manat həddinə çatır və ya onu aşır. ` +
              `Bir-biri ilə əlaqəli olan və ümumi məbləği iyirmi min manatdan artıq olan bir neçə ` +
              `əməliyyat da bu hala aiddir.`
            : `${formatAzn(amount)} məbləği iyirmi min manat həddindən aşağıdır. Lakin bir-biri ilə ` +
              `əlaqəli olub ümumi məbləği iyirmi min manatı aşan əməliyyatlar bu həddə daxildir.`,
      });
    }
    if (turnover !== null && turnover < 100000) {
      hedler.push({
        bend: "4.3.2",
        qeyd:
          `İllik dövriyyə ${formatAzn(turnover)} yüz min manatdan aşağıdır: eyniləşdirmə ` +
          `məlumatlarının yenilənməsi 8.1-ci bənddə nəzərdə tutulandan daha uzun vaxt ` +
          `intervalında həyata keçirilə bilər. Bu, yalnız sadələşdirilmiş tədbirlərə icazə ` +
          `verildiyi halda mümkündür.`,
      });
    }

    return {
      ok: true,
      menbe: DOC,
      guclendirilmis_tedbirler_mecburidir: eddRequired,
      guclendirilmis_tedbir_esaslari: eddTriggers,
      // Verbatim 5.3.1-5.3.7 rather than a paraphrase.
      guclendirilmis_tedbirler: eddRequired ? childRefs("5.3") : [],
      guclendirilmis_tedbirler_qeydi: eddRequired
        ? [clauseRef("5.4"), clauseRef("5.2")]
        : [],
      sadelesdirilmis_tedbirlere_icaze: sddPermitted,
      sadelesdirilmis_tedbirlerin_maneeleri: sddBlockers,
      sadelesdirilmis_tedbir_hali: occasionClause ? clauseRef(occasionClause) : null,
      // Verbatim 4.3.1-4.3.3.
      sadelesdirilmis_tedbirler: sddPermitted ? childRefs("4.3") : [],
      hedler,
      xeberdarliq:
        "4.1-ci bəndə əsasən sadələşdirilmiş tədbirlər yalnız Qanunun 4.18-ci maddəsinə uyğun " +
        "tətbiq edilir. Bu nəticə qərar dəstəyi məqsədi daşıyır; risklərə mütənasib tədbirlərin " +
        "tətbiqinə görə məsuliyyət öhdəlik daşıyan şəxsin üzərindədir.",
    };
  },

  check_remote_onboarding(input) {
    const firstTime = Boolean(input.first_time_relationship);
    const applied = new Set(uniqueStrings(input.measures_applied));

    const qadagalar: { bend: string; sebeb: string; metn: string }[] = [];
    if (
      input.via_authorised_representative &&
      !input.representative_is_legal_representative_of_legal_person
    ) {
      qadagalar.push({
        bend: "7.4",
        sebeb:
          "Müştərilərə səlahiyyətli nümayəndə vasitəsilə məsafədən işgüzar münasibətlərin " +
          "yaradılmasına yol verilmir. Yeganə istisna hüquqi şəxsin qanuni təmsilçisidir.",
        metn: getClause("7.4")?.text ?? "",
      });
    }
    if (input.customer_is_non_resident_legal_person) {
      qadagalar.push({
        bend: "7.4",
        sebeb:
          "Qeyri-rezident hüquqi şəxslərə məsafədən işgüzar münasibətlərin yaradılmasına yol verilmir.",
        metn: getClause("7.4")?.text ?? "",
      });
    }

    const missing = firstTime ? MANDATORY_REMOTE.filter((m) => !applied.has(m)) : [];

    const elaveTapintilar: { bend: string; mesele: string }[] = [];
    if (input.identity_cannot_be_established_or_doubtful) {
      elaveTapintilar.push({
        bend: "7.3",
        mesele:
          "Eyniləşdirmə və verifikasiya tədbirləri müştərinin kimliyinin müəyyən edilməsinə " +
          "imkan vermədikdə və ya təqdim olunmuş sənədlərin həqiqiliyi şübhə doğurduqda 7.3-cü " +
          "bəndin tələbi tətbiq olunur. Məsləhət verməzdən əvvəl get_clause ilə tam mətni oxuyun.",
      });
    }

    const measureRef = (key: string) => ({
      acar: key,
      ...clauseRef(REMOTE_MEASURES[key]!),
      tetbiq_edilib: applied.has(key),
    });

    return {
      ok: true,
      menbe: DOC,
      qadagandir: qadagalar.length > 0,
      qadagalar,
      ilk_defe_isguzar_munasibet: firstTime,
      mecburi_tedbirler: firstTime ? MANDATORY_REMOTE.map(measureRef) : [],
      catismayan_mecburi_tedbirler: missing.map((k) => ({
        acar: k,
        ...clauseRef(REMOTE_MEASURES[k]!),
      })),
      bend_7_2_uygunlugu: firstTime ? missing.length === 0 : null,
      butun_movcud_tedbirler: Object.keys(REMOTE_MEASURES).map(measureRef),
      elave_tapintilar: elaveTapintilar,
      qeydler: [clauseRef("7.2"), clauseRef("6.4"), clauseRef("6.4.1"), clauseRef("6.5")],
    };
  },
};

// ---------------------------------------------------------------------------

const RISK_GROUP_AZ: Record<"high" | "medium" | "low", string> = {
  high: "yüksək riskli",
  medium: "orta riskli",
  low: "aşağı riskli",
};

const CATEGORY_AZ: Record<Category, string> = {
  customer: "müştəri riski",
  product: "məhsul (və ya xidmət) riski",
  channel: "çatdırılma kanalı riski",
  geography: "coğrafi yerləşmə riski",
  transaction: "əməliyyat riski",
};

export function listToolNames(): string[] {
  return TOOL_DEFINITIONS.map((t) => t.name);
}

export function runTool(name: string, input: Record<string, unknown>): ToolResult {
  const handler = handlers[name];
  if (!handler) {
    return { ok: false, xeta: `Naməlum alət: ${name}`, movcud: listToolNames() };
  }
  try {
    return handler(input as Record<string, any>);
  } catch (err) {
    return {
      ok: false,
      xeta: `${name} aləti xəta verdi: ${err instanceof Error ? err.message : String(err)}`,
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

function formatAzn(amount: number): string {
  return `${amount.toLocaleString("az-AZ")} AZN`;
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

/** The label is the clause's own wording, so nothing is paraphrased. */
function describe(factor: (typeof FACTORS)[number]) {
  return {
    acar: factor.key,
    bend: factor.clause,
    istinad: citation(factor.clause),
    kateqoriya: CATEGORY_AZ[factor.category],
    metn: getClause(factor.clause)?.text ?? "",
  };
}

function summariseCategories(factors: { category: Category }[]): Category[] {
  return [...new Set(factors.map((f) => f.category))];
}

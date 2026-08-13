/**
 * The regulation is published only in Azerbaijani, but compliance teams ask
 * questions in English and Russian-influenced Azerbaijani alike. Rather than
 * machine-translating 213 legal clauses (and inheriting the translation's
 * errors as if they were law), we keep the corpus in the original language and
 * expand the *query* instead: an English term is rewritten into the exact
 * Azerbaijani wording the regulation uses.
 *
 * Every Azerbaijani expansion below is lifted verbatim from the source text.
 */
export const GLOSSARY: Record<string, string[]> = {
  // --- core AML/CFT vocabulary ---
  "money laundering": ["cinayət yolu ilə əldə edilmiş əmlakın leqallaşdırılması"],
  laundering: ["leqallaşdırılma", "leqallaşdırıldığı"],
  "terrorist financing": ["terrorçuluğun maliyyələşdirilməsi"],
  terrorism: ["terrorçuluq", "terror"],
  aml: ["cinayət yolu ilə əldə edilmiş əmlakın leqallaşdırılması"],
  cft: ["terrorçuluğun maliyyələşdirilməsi"],

  // --- due diligence ---
  "due diligence": ["müştəri uyğunluğu tədbirləri"],
  cdd: ["müştəri uyğunluğu"],
  kyc: ["müştəri uyğunluğu", "eyniləşdirmə"],
  "customer due diligence": ["müştəri uyğunluğu tədbirləri"],
  "simplified due diligence": ["sadələşdirilmiş müştəri uyğunluğu"],
  sdd: ["sadələşdirilmiş müştəri uyğunluğu"],
  "enhanced due diligence": ["gücləndirilmiş müştəri uyğunluğu"],
  edd: ["gücləndirilmiş müştəri uyğunluğu"],
  simplified: ["sadələşdirilmiş"],
  enhanced: ["gücləndirilmiş"],
  identification: ["eyniləşdirmə"],
  verification: ["verifikasiya"],
  verify: ["verifikasiya"],

  // --- parties ---
  customer: ["müştəri"],
  client: ["müştəri"],
  "beneficial owner": ["benefisiar mülkiyyətçi"],
  beneficiary: ["benefisiar"],
  "politically exposed person": ["siyasi nüfuzlu şəxs"],
  pep: ["siyasi nüfuzlu şəxs"],
  peps: ["siyasi nüfuzlu şəxs"],
  "close associate": ["yaxın münasibətdə olduğu şəxs"],
  "close relative": ["yaxın qohum"],
  "family member": ["yaxın qohum"],
  "legal person": ["hüquqi şəxs"],
  "legal entity": ["hüquqi şəxs"],
  "natural person": ["fiziki şəxs"],
  individual: ["fiziki şəxs"],
  "sole trader": ["fərdi sahibkar"],
  "sole proprietor": ["fərdi sahibkar"],
  "legal arrangement": ["xarici hüquqi təsisat"],
  trust: ["xarici hüquqi təsisat"],
  "obliged entity": ["öhdəlik daşıyan şəxs"],
  "reporting entity": ["öhdəlik daşıyan şəxs"],
  "shell company": ["şel şirkət"],
  "money mule": ["money mules", "hesablarından başqalarının məqsədləri üçün istifadə"],
  nominee: ["nominal saxlayıcı"],
  "bearer share": ["sənədli səhm"],
  "non-resident": ["qeyri-rezident"],
  nonresident: ["qeyri-rezident"],
  representative: ["səlahiyyətli nümayəndə", "təmsilçi"],

  // --- risk ---
  risk: ["risk"],
  "risk factor": ["risk faktorları"],
  "risk group": ["risk qrupu"],
  "risk assessment": ["risk qiymətləndirməsi"],
  "high risk": ["yüksək riskli"],
  "low risk": ["aşağı riskli"],
  "medium risk": ["orta riskli"],
  "customer profile": ["müştəri profili"],
  "delivery channel": ["çatdırılma kanalları"],
  channel: ["çatdırılma kanalı"],
  geography: ["coğrafi yerləşmə"],
  geographic: ["coğrafi yerləşmə"],
  country: ["dövlət", "ərazi"],
  jurisdiction: ["dövlət", "ərazi"],
  product: ["məhsul"],
  service: ["xidmət"],
  transaction: ["əməliyyat"],
  "occasional transaction": ["birdəfəlik əməliyyat"],
  "one-off transaction": ["birdəfəlik əməliyyat"],

  // --- geography / sanctions ---
  sanctions: ["sanksiya"],
  embargo: ["embarqo"],
  "united nations": ["Birləşmiş Millətlər Təşkilatı"],
  un: ["Birləşmiş Millətlər Təşkilatı"],
  fatf: ["FATF"],
  "call for action": ["FATF-ın çağırış etdiyi dövlətlər"],
  offshore: ["ofşor maliyyə mərkəzləri"],
  "high-risk country": ["yüksək riskli dövlətlər"],

  // --- products / channels ---
  "prepaid card": ["əvvəlcədən ödənilmiş kartlar"],
  "correspondent account": ["müxbir hesabı"],
  "payable-through account": ["payable-through account", "müxbir hesabından üçüncü şəxslər"],
  "transit account": ["tranzit hesablar"],
  "numbered account": ["nömrəli hesablar"],
  "trade finance": ["ticarətin maliyyələşdirilməsi"],
  "asset management": ["aktivlərin idarə edilməsi"],
  "private banking": ["yüksək gəlirli fərdi müştərilər üçün maliyyə"],
  deposit: ["depozit", "əmanət"],
  loan: ["kredit"],
  credit: ["kredit"],
  "virtual asset": ["virtual aktiv"],
  crypto: ["virtual aktiv"],
  cryptocurrency: ["virtual aktiv"],
  cash: ["nağd"],
  "wire transfer": ["maliyyə vəsaitlərinin elektron köçürülməsi"],
  "electronic transfer": ["maliyyə vəsaitlərinin elektron köçürülməsi"],
  remittance: ["pul köçürmələri"],
  insurance: ["sığorta"],
  "salary account": ["əmək haqqı hesabları"],
  pension: ["pensiya"],
  utility: ["kommunal ödənişlər"],

  // --- remote onboarding / technology ---
  "remote onboarding": ["üzbəüz olmayan", "birbaşa ünsiyyət qurmadan"],
  remote: ["birbaşa ünsiyyət qurmadan", "məsafədən"],
  "non-face-to-face": ["üzbəüz olmayan"],
  onboarding: ["işgüzar münasibətlərin yaradılması"],
  "business relationship": ["işgüzar münasibətlər"],
  "new technology": ["yeni texnologiyalar"],
  "electronic signature": ["gücləndirilmiş elektron imza"],
  "digital signature": ["gücləndirilmiş elektron imza"],
  authentication: ["gücləndirilmiş müştəri autentifikasiyası"],
  "video call": ["real vaxt rejimində video zəng"],
  video: ["video zəng", "video çəkiliş"],
  biometric: ["autentifikasiya"],
  "database check": ["elektron məlumat bazalarından"],

  // --- ongoing / reporting ---
  "ongoing monitoring": ["davamlı", "monitorinq"],
  monitoring: ["monitorinq", "nəzarət"],
  review: ["yenilənməsi", "davamlı"],
  update: ["yenilənməsi"],
  periodicity: ["dövrülük"],
  frequency: ["dövrülük"],
  "suspicious transaction": ["şübhəli əməliyyat"],
  suspicious: ["şübhəli"],
  str: ["şübhəli əməliyyat"],
  sar: ["şübhəli əməliyyat"],
  "source of funds": ["vəsaitin mənbəyi"],
  "source of wealth": ["sərvətlərinin mənbəyi"],
  "senior management": ["rəhbərliyin razılığı"],
  "identity document": ["şəxsiyyəti təsdiq edən sənəd"],
  passport: ["xarici pasport"],
  "id card": ["şəxsiyyət vəsiqəsi"],
  threshold: ["manat", "məbləğ"],
  manat: ["manat"],
  azn: ["manat"],
};

/** Longest-first so multi-word terms win over their constituent words. */
const TERMS = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length);

/**
 * English surface forms a term can appear in. People ask about "PEPs",
 * "prepaid cards" and "high-risk countries", so matching only the singular
 * dictionary form silently loses the expansion - and with it every hit, since
 * the corpus itself contains no English.
 */
function surfaceForms(term: string): string[] {
  const forms = new Set<string>([term]);
  if (term.endsWith("y")) {
    forms.add(`${term.slice(0, -1)}ies`);
  } else if (/(s|x|z|ch|sh)$/.test(term)) {
    forms.add(`${term}es`);
  } else {
    forms.add(`${term}s`);
  }
  // "non-resident" and "non resident" should behave alike.
  for (const form of [...forms]) {
    if (form.includes("-")) forms.add(form.replace(/-/g, " "));
    if (form.includes(" ")) forms.add(form.replace(/ /g, "-"));
  }
  return [...forms];
}

const PATTERNS: { pattern: RegExp; expansions: string[] }[] = TERMS.map((term) => ({
  // Word-boundary match that tolerates the punctuation around real questions.
  pattern: new RegExp(
    `(^|[^\\p{L}])(?:${surfaceForms(term).map(escapeRegExp).join("|")})([^\\p{L}]|$)`,
    "u",
  ),
  expansions: GLOSSARY[term] ?? [],
}));

/**
 * Rewrites a natural-language question into the regulation's own vocabulary.
 * The original query is always kept, so an Azerbaijani question is unaffected.
 */
export function expandQuery(query: string): string {
  const haystack = ` ${query.toLowerCase()} `;
  const additions: string[] = [];

  for (const { pattern, expansions } of PATTERNS) {
    if (pattern.test(haystack)) additions.push(...expansions);
  }

  return additions.length ? `${query} ${[...new Set(additions)].join(" ")}` : query;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

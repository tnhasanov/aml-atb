# aml-atb — AML/CFT compliance assistant (Azerbaijan)

A chatbot for compliance officers, MLROs and onboarding staff at an obliged entity
(*öhdəlik daşıyan şəxs*) supervised in Azerbaijan.

It answers from **one regulation, with clause citations** — not from the model's general
recollection of AML practice:

> **Financial Monitoring Service of the Republic of Azerbaijan** (Azərbaycan Respublikası
> Maliyyə Monitorinqi Xidməti), Decision **№ 3-21-28/3-6-4/2023** of 21 February 2023 —
> *Rules on customer due diligence and verification measures when applying new technologies, on
> the determination of risk factors, and on assigning the customer profile to risk groups*,
> issued under the Law on Combating the Legalisation of Criminally Obtained Property and the
> Financing of Terrorism (30 December 2022, № 781-VIQ), as amended by Decision
> 3-21-28/3-6-4/2024 of 14 June 2024.

The source document is committed at `data/source/`. Every answer is traceable to a clause,
and every clause number in the transcript is clickable — it opens the original Azerbaijani text.

---

## Why it is built this way

A general-purpose model asked "when can I apply simplified due diligence?" will produce a
confident, well-structured answer drawn from FATF and EU practice. In Azerbaijan the answer is
governed by clauses 4.1–4.4 of this Decision, and the differences are exactly what a compliance
officer is asking about. Three design choices follow from that:

1. **The regulation is the only source.** The corpus is generated from the source `.docx`; the
   app refuses to start without it. The system prompt instructs the model to search before
   answering and to say plainly when the Rules are silent, rather than filling the gap.
2. **Clause numbers are load-bearing.** Word keeps multilevel list numbering outside the
   paragraph text, so a naive text dump silently loses every "3.9.1". The extractor resolves the
   numbering from `numbering.xml`, which is what makes citation possible at all.
3. **The rule logic lives in code, not in the prompt.** Risk classification, CDD level and remote
   onboarding checks are tools that walk the actual clause lists, so their outputs are
   deterministic and each one carries the clause that authorises it.

---

## Quick start

```bash
npm install
python3 tools/extract_rules.py     # regenerate data/rules.json from the source .docx
cp .env.example .env               # then set ANTHROPIC_API_KEY (or run `ant auth login`)
npm test
npm run build && npm start         # http://localhost:3000
```

Requires Node ≥ 22.6 and Python 3 (extraction only — no Python at runtime).
The only runtime dependency is `@anthropic-ai/sdk`; the server, retrieval and UI are dependency-free.

---

## What it can do

Ask in **English or Azerbaijani** — questions are rewritten into the regulation's own Azerbaijani
wording before retrieval, so the corpus stays in the original language and no clause is answered
through a machine translation.

| Ask | It uses |
|---|---|
| "When can I apply simplified due diligence?" | Part 4, thresholds AZN 20,000 / 100,000 |
| "Spouse of a minister, non-resident, onboarding via our app — risk group and CDD level?" | Parts 3, 5, 7, 8 |
| "How often must I review a medium-risk customer?" | clause 8.1.2 |
| "What are the high-risk geographic factors?" | clauses 3.12.1–3.12.7 |
| "Siyasi nüfuzlu şəxslər üçün hansı tədbirlər tələb olunur?" | clauses 2.1.2, 3.9.1, 5.2, 8.1.4 |

### Tools

| Tool | Grounded in |
|---|---|
| `search_rules` | BM25 across all 213 clauses, with English→Azerbaijani query expansion |
| `get_clause` | Verbatim clause text plus its children (`3.9` → 3.9.1–3.9.13) |
| `assess_customer_risk` | Risk factors of clauses 3.4–3.13; review cycle from clause 8.1 |
| `determine_cdd_level` | Simplified measures (Part 4) vs mandatory enhanced measures (Part 5) |
| `check_remote_onboarding` | Non-face-to-face verification, clause 7.2 mandatory set, clause 7.4 prohibitions |

Some rules the tools encode directly:

- A single high-risk factor moves the profile to high risk; clause 4.4 then rules out simplified
  measures entirely.
- PEPs are reviewed **continuously** (clause 8.1.4) — not annually like other high-risk customers.
- First-time **remote** onboarding makes four measures mandatory, not optional: enhanced
  e-signature (7.1.1), database check (7.1.2), strong customer authentication (7.1.3) and live
  video verification (7.1.7).
- Remote onboarding through an authorised representative, or of a non-resident legal person, is
  **prohibited** by clause 7.4 — the sole exception being the legal representative of a legal person.
- Verification may be completed after onboarding, but **within 5 business days** (clause 6.4).

---

## Guardrails

The assistant is scoped as **decision support, not a compliance decision and not legal advice**.
Clause 3.3 requires the obliged entity to weigh national, sectoral and institutional risk
assessments the tool does not hold, and the final classification belongs to its compliance function.

It is instructed to route suspicious-activity, sanctions and reporting decisions to the MLRO; to
refuse to help disclose that a report has been or may be filed (tipping-off); and to decline help
with structuring under the AZN 20,000 / 5,000 thresholds, disguising beneficial ownership, or
engineering a profile to attract simplified measures — while still helping a compliance officer
who is asking how to *detect* those patterns.

---

## Audit trail

An AML advisory tool is itself subject to record-keeping expectations. Every question, tool call,
tool result, model answer and token count is appended to `audit/audit-YYYY-MM-DD.jsonl`, one JSON
record per line, with the clause citations used in each answer.

Each record carries the SHA-256 of the previous record, so editing or deleting a past entry breaks
the chain and is detectable (`test/audit.test.ts` verifies both cases). This is **tamper-evident,
not tamper-proof** — it does not defend against rewriting the whole file, which needs append-only
storage or off-host shipping.

---

## Layout

```
data/source/       source Decision (.docx, as supplied)
data/rules.json    generated corpus: 213 clauses, 8 parts, annex
tools/             extract_rules.py — resolves Word list numbering into clause ids
src/rules.ts       corpus loading and clause lookup
src/search.ts      BM25 with Azerbaijani-aware folding and prefix stemming
src/glossary.ts    English→Azerbaijani query expansion
src/factors.ts     risk factor catalogue, one entry per clause in 3.4–3.13
src/tools/         the five tool implementations
src/agent.ts       streaming tool loop
src/index.ts       HTTP server, SSE, static hosting
public/            chat UI (no build step, no framework)
test/              53 tests
```

### Notes on the implementation

- **Azerbaijani case folding** — `"I".toLowerCase()` must be `"ı"`, not `"i"`. JavaScript's default
  gets this wrong; `foldCase()` handles the dotted/dotless pair before lowercasing.
- **Stemming** — Azerbaijani is agglutinative (*müştəri*, *müştərilər*, *müştərinin*), so tokens are
  truncated to a common prefix rather than matched exactly.
- **Plural query expansion** — people type "PEPs" and "prepaid cards", so glossary terms match their
  plural surface forms. Missing this returned zero hits against an all-Azerbaijani corpus.
- **Prompt caching** — the system prompt is frozen (no interpolated timestamps or session ids) and
  marked `cache_control: ephemeral`, so tools plus system prompt cache together across requests.

---

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Optional if an `ant auth login` profile exists |
| `AML_MODEL` | `claude-opus-5` | Model id |
| `AML_EFFORT` | `high` | Reasoning effort: `low`…`max` |
| `PORT` | `3000` | HTTP port |
| `AUDIT_DIR` | `./audit` | Audit trail location |

---

## Limitations

- **One regulation.** The parent Law № 781-VIQ, Central Bank rules and sectoral guidance are not
  loaded. The assistant will say so rather than guess, but a complete compliance answer often needs
  them — the corpus is designed to take additional documents.
- **No screening data.** There is no sanctions, PEP or watchlist connection; the assistant reasons
  about screening obligations, it does not screen. Clause 3.12 designations (UN sanctions, FATF
  call-for-action, MMX high-risk lists) must be supplied by the user or wired to a live feed.
- **English text is a working translation.** The Azerbaijani clause text is authoritative.
- **Sessions are in-memory**, so a restart clears context and a multi-instance deployment needs a
  shared store. The audit trail is on local disk and should be shipped off-host in production.
- **Not verified against a live model in this environment** — there were no API credentials in the
  build sandbox. The tool loop, SSE streaming, tool dispatch, citation extraction and audit chain
  are covered by tests against a stub upstream that speaks the Messages API wire format; the
  quality of the model's answers has not been evaluated. Do that before relying on it.

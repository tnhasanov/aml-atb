# aml-atb — AML/CFT compliance assistant (Azerbaijan)

A chatbot for compliance officers, MLROs and onboarding staff at an obliged entity
(*öhdəlik daşıyan şəxs*) supervised in Azerbaijan.

The interface, the assistant's answers and the tool output are all in **Azerbaijani**. It answers
from **one regulation, with clause citations** — not from the model's general recollection of AML
practice:

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

## Run it locally (5 minutes)

```bash
npm install
python3 tools/extract_rules.py     # regenerate data/rules.json from the source .docx
cp .env.example .env               # set ANTHROPIC_API_KEY, or run `ant auth login`
echo "AUTH_MODE=none" >> .env      # development only - loopback bind, no login
npm test
npm run build && npm start         # http://127.0.0.1:3000
```

Requires Node >= 22.6 and Python 3 (extraction only - no Python at runtime).
The only runtime dependency is `@anthropic-ai/sdk`; the server, retrieval and UI are dependency-free.

`AUTH_MODE=none` is refused on any non-loopback bind, so this configuration cannot
accidentally become the deployed one.

---

## Just want a URL you can open?

That is a different question from production, and it has a different answer:
**`docs/HOSTING.md`** and the `render.yaml` in the repository root. Push the branch, point
Render at it, paste two values, and colleagues can try it over TLS with named logins
(`AUTH_MODE=basic`). Use it with synthetic cases — the hosted pilot exists to judge whether
the answers and the citations are any good, which has never been tested against a live model.

That document also explains why **Vercel, Netlify, Lambda and Cloudflare Workers cannot host
this**: the audit trail is an append-only hash chain on local disk with a single writer, and on
a serverless platform it would be silently discarded while the chat appeared to work normally.
`src/config.ts` detects those platforms and refuses to start rather than let that happen.

Real customer data waits for the deployment below.

---

## Putting it into production

> **Handing this to someone else?** `docs/HANDOVER.md` is a fill-in-the-blanks packet:
> Part A for infrastructure (the values to obtain, the commands to run), Part B for the MLRO
> and DPO (the seven questions that must be answered first). The completed document is the
> deployment record.

Topology: **nginx** terminates TLS and authenticates against the institution's IdP, then proxies to
the app on `127.0.0.1:3000`. The app never faces the network directly and trusts only the identity
nginx injects.

```
  officer ──TLS──▶ nginx ──auth_request──▶ oauth2-proxy ──▶ bank IdP
                     │
                     └──127.0.0.1:3000──▶ aml-atb ──▶ api.anthropic.com
                                             │
                                             └──▶ /var/lib/aml-atb/audit
```

Everything below was validated against a live nginx + app + stub-IdP stack, not written from
memory: the config passes `nginx -t`, the unit passes `systemd-analyze verify`, the release tarball
runs unpacked with no toolchain, and `scripts/smoke-test.sh` passes all ten checks against it.

### Step 0 — Decisions that are not code

Numbered zero because none of the steps above matter if these are unresolved. Each needs a named
owner and a written answer **before real customer data goes in**. Nothing in this repository can
settle them:

| Question | Owner |
|---|---|
| Lawful basis for sending customer data to a third-country processor, and the banking-secrecy analysis | DPO + MLRO |
| Whether MMX and/or the Central Bank require notification of this outsourcing | MLRO |
| The API account's data-retention and no-training position, in writing | Commercial owner + DPO |
| Local retention period for the audit trail, reconciled against the AML record-keeping duty | MLRO + DPO |
| What staff may paste (reference numbers vs customer names) — there is no redaction stage | DPO writes it, MLRO confirms it does not defeat record-keeping |
| A user-facing notice that queries are processed by a named third party abroad | DPO + MLRO |
| Who attests the committed `.docx` is the current text as amended in 2024 | MLRO |

`ANTHROPIC_BASE_URL` routes all API traffic through an institutional gateway or DLP proxy with no
code change, if the transfer analysis calls for one.

### Step 1 — Build the artefact (on a build machine)

```bash
scripts/release.sh
```

Regenerates the corpus and **fails if it no longer matches the source `.docx`**, runs typecheck and
the 60 tests, compiles, installs production-only dependencies, and emits
`release/aml-atb-<version>-<sha>.tar.gz` + `.sha256`. It carries `dist/`, `node_modules/`, `data/`,
`public/`, `deploy/`, `scripts/` and `tools/` — the target host needs no compiler, no npm registry
and no network. `VERSION` inside records the git sha, Node version, and SHA-256 of both the corpus
and the source regulation.

### Step 2 — Check the host is ready (before changing anything)

```bash
scp release/aml-atb-*.tar.gz* aml-host:/tmp/
ssh aml-host
tar -xzf /tmp/aml-atb-*.tar.gz -C /tmp && sudo /tmp/aml-atb-*/scripts/preflight.sh
```

Checks Node version and path, ports, nginx version (and whether your version needs the `http2 on;`
form), oauth2-proxy, disk, file permissions, and that the API is actually reachable from that host
with that key. Exits non-zero if not ready. **Egress policy blocking `api.anthropic.com` is the most
common first-request failure** — this catches it before install rather than in front of a user.

### Step 3 — Install

```bash
sudo /tmp/aml-atb-*/scripts/install.sh /tmp/aml-atb-*.tar.gz
```

Verifies the checksum, creates the `aml` service account, unpacks to
`/opt/aml-atb/releases/<version>/`, points `/opt/aml-atb/current` at it, writes the systemd unit
with this host's real Node path, and creates `/etc/aml-atb/aml-atb.env` (mode 600) with a generated
`AUTH_SHARED_SECRET`.

It is idempotent — safe to re-run — and **never overwrites an existing env file**, so an upgrade
cannot clobber your credentials. It refuses to start the service while `ANTHROPIC_API_KEY` is empty.

### Step 4 — Add the key, start it

```bash
sudo vi /etc/aml-atb/aml-atb.env        # set ANTHROPIC_API_KEY
sudo systemctl enable --now aml-atb
systemctl status aml-atb
```

### Step 5 — Identity and TLS (the part that actually gates access)

```bash
sudo cp /opt/aml-atb/current/deploy/oauth2-proxy.cfg /etc/oauth2-proxy.cfg
sudo chmod 600 /etc/oauth2-proxy.cfg
# fill in oidc_issuer_url, client_id, client_secret, cookie_secret
sudo systemctl enable --now oauth2-proxy

sudo cp /opt/aml-atb/current/deploy/nginx.conf /etc/nginx/conf.d/aml-atb.conf
# set server_name, ssl_certificate paths, and X-Auth-Secret to match the env file
sudo nginx -t && sudo systemctl reload nginx
```

`deploy/nginx.conf` is a **site** config for `conf.d/` — it holds `server` blocks, so it must sit
inside nginx's `http{}`. Dropped in as `nginx.conf` it fails with *"upstream directive is not allowed
here"*. It targets nginx ≤ 1.24 (`listen 443 ssl http2`); on ≥ 1.25.1 switch to `listen 443 ssl;` +
`http2 on;` — preflight tells you which you have.

Three lines carry the security of the whole deployment:

| Line | Without it |
|---|---|
| `proxy_set_header X-Forwarded-User $auth_user;` | A user names themselves; the audit trail is worthless |
| `proxy_set_header X-Auth-Secret "…";` | Anyone reaching port 3000 directly can assert an identity |
| `proxy_buffering off;` | The officer stares at a blank panel until the whole answer is ready |

An mTLS alternative is included, commented, if the bank issues client certificates.

### Step 6 — Verify before telling anyone it exists

```bash
/opt/aml-atb/current/scripts/smoke-test.sh https://aml.internal.example.az /var/lib/aml-atb/audit
```

Ten checks: liveness, readiness, that all four authenticated routes refuse an anonymous caller, that
a spoofed `X-Forwarded-User` is rejected, that the app port is loopback-only, that the audit chain
verifies, and that the audit directory is `0700`. Non-zero exit on any failure. **Run it after every
deploy** — it is what catches a proxy reloaded with the wrong config.

### Step 7 — Operate

```bash
journalctl -u aml-atb -f                                   # one JSON line per request
/opt/aml-atb/current/tools/verify-audit.mjs /var/lib/aml-atb/audit
sudo /opt/aml-atb/current/scripts/install.sh --rollback    # previous release + restart
```

Ship `/var/lib/aml-atb/audit/*.jsonl` off-host (rsyslog, filebeat, rsync) — newline-delimited JSON is
the canonical SIEM ingest format, and losing the host must not lose the record. Do **not** rotate or
truncate them: whole-file retention is compatible with the hash chain, per-record deletion is not.


---

## Language

**Azerbaijani throughout** — UI chrome, the assistant's answers, and everything the tools return.

- **Clause text** is the original Azerbaijani, never translated. Tool output quotes it verbatim
  (measure lists come straight from clauses 4.3, 5.3 and 7.1) rather than shipping a paraphrase, so
  the wording cannot drift from the regulation as the code changes.
- **Answers default to Azerbaijani.** If a user writes in another language the assistant follows
  them, so an English-speaking auditor is not locked out.
- **English questions still retrieve correctly**: they are rewritten into the regulation's own
  Azerbaijani wording before search, so the corpus stays monolingual.
- **Citations render the Azerbaijani way** — "3.9.1-ci bənd" — with the ordinal suffix preserved so
  the sentence reads properly, and the number clickable. `maddə` references are deliberately not
  linked: they point at the parent Law, which is not in this corpus.

Only the developer-facing surfaces stay in English: this README, code comments, and the tool
*schema* descriptions that steer the model's tool choice (never shown to a user).

## What it can do

| Ask | It uses |
|---|---|
| "Sadələşdirilmiş müştəri uyğunluğu tədbirlərini nə vaxt tətbiq edə bilərəm?" | Part 4, thresholds 20 000 / 100 000 AZN |
| "Nazirin həyat yoldaşı, qeyri-rezident, mobil tətbiqlə məsafədən — risk qrupu və uyğunluq səviyyəsi?" | Parts 3, 5, 7, 8 |
| "Orta riskli müştərini nə qədər müddətdən bir yoxlamalıyam?" | 8.1.2-ci bənd |
| "Yüksək riskli coğrafi yerləşmə faktorları hansılardır?" | 3.12.1–3.12.7-ci bəndlər |
| "Siyasi nüfuzlu şəxslər üçün hansı tədbirlər tələb olunur?" | 2.1.2, 3.9.1, 5.2, 8.1.4-cü bəndlər |

### Tools

| Tool | Grounded in |
|---|---|
| `search_rules` | BM25 across all 213 clauses, with English→Azerbaijani query expansion |
| `get_clause` | Verbatim clause text plus its children (`3.9` → 3.9.1–3.9.13) |
| `assess_customer_risk` | Risk factors of clauses 3.4–3.13; review cycle from clause 8.1 |
| `determine_cdd_level` | Simplified measures (Part 4) vs mandatory enhanced measures (Part 5) |
| `check_remote_onboarding` | Non-face-to-face verification, clause 7.2 mandatory set, clause 7.4 prohibitions |

All five return Azerbaijani, with clause numbers and the regulation's own text.

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

Every record names the acting officer (`actor.user`, `actor.ip`), taken from the authenticated
identity — a trail that cannot say *who* asked does not answer the question a supervisor will
actually ask.

Each record carries the SHA-256 of the previous record, so editing or deleting a past entry breaks
the chain and is detectable. The chain is seeded from what is already on disk and spans day files,
so restarts and midnight rollovers do not break it; each start writes its own `service_started`
record, making restarts explainable rather than suspicious.

```bash
npm run verify-audit -- /var/lib/aml-atb/audit
```

Exits non-zero and names the offending file and line if the chain is broken. This is
**tamper-evident, not tamper-proof** — it does not defend against rewriting the whole file, which
needs append-only storage or off-host shipping.

The trail is **fail-closed**: if it cannot be written the service refuses new questions and reports
degraded on `/readyz`, rather than quietly giving CDD advice that leaves no record.

---

## Layout

```
data/source/       source Decision (.docx, as supplied)
data/rules.json    generated corpus: 213 clauses, 8 parts, annex
tools/             extract_rules.py — resolves Word list numbering into clause ids
                   hash-password.mjs — mints AUTH_USERS entries for basic auth
                   verify-audit.mjs — re-walks the hash chain
src/rules.ts       corpus loading and clause lookup
src/search.ts      BM25 with Azerbaijani-aware folding and prefix stemming
src/glossary.ts    English→Azerbaijani query expansion
src/factors.ts     risk factor catalogue, one entry per clause in 3.4–3.13
src/tools/         the five tool implementations
src/agent.ts       streaming tool loop
src/auth.ts        identity: proxy header, HTTP Basic, or none
src/password.ts    scrypt hashing for AUTH_MODE=basic
src/server.ts      HTTP routing, SSE, static hosting
src/index.ts       process entrypoint (kept separate so tests import without binding a port)
public/            chat UI (no build step, no framework)
deploy/            nginx, oauth2-proxy and systemd for the production VM
render.yaml        hosted-pilot blueprint (see docs/HOSTING.md)
test/              72 tests
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
- **Tool output keys are Azerbaijani** (`bend`, `metn`, `risk_qrupu`, `qadagalar`), keeping the
  payload the model reads consistent with the language it answers in. Factor *keys* stay ASCII
  identifiers (`pep_or_relative_or_associate`) because they are code, not prose.

---

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Optional if an `ant auth login` profile exists. Rejected if it contains whitespace |
| `ANTHROPIC_BASE_URL` | Anthropic | Route via an institutional gateway or DLP proxy |
| `AML_MODEL` | `claude-opus-5` | Model id |
| `AML_EFFORT` | `high` | `low`…`max`; validated at startup |
| `AML_MAX_TOKENS` | `32000` | Must leave room for adaptive thinking as well as the answer |
| `PORT` | `3000` | HTTP port |
| `BIND_HOST` | `127.0.0.1` | Widen only behind a proxy |
| `AUTH_MODE` | `proxy` | `proxy`, `basic` or `none`; `none` refused on a non-loopback bind |
| `AUTH_USER_HEADER` | `x-forwarded-user` | `proxy` mode: header carrying the authenticated username |
| `AUTH_SHARED_SECRET` | — | `proxy` mode: proves a request came via the proxy |
| `AUTH_USERS` | — | `basic` mode: `user:scrypt$…` entries, comma-separated. Mint with `node tools/hash-password.mjs <user>` |
| `AUTH_REALM` | `AML Uygunluq Komekcisi` | `basic` mode: name shown in the browser sign-in dialog |
| `AML_ALLOW_EPHEMERAL_AUDIT` | `false` | Override the refusal to run on serverless platforms. Demo only — the audit trail is lost |
| `AUDIT_DIR` | `./audit` | Resolved absolute; created `0700`, files `0600` |
| `AUDIT_FAIL_CLOSED` | `true` | Refuse to answer if the trail cannot be written |
| `AML_RATE_LIMIT_PER_MINUTE` | `12` | Per authenticated user |
| `AML_MAX_CONCURRENT_TURNS` | `4` | Global ceiling on in-flight model calls |
| `AML_SESSION_IDLE_MS` | `3600000` | Idle session eviction |
| `AML_UPSTREAM_TIMEOUT_MS` | `180000` | Anthropic request timeout |

Invalid configuration fails at startup, not on the first user request.

---

## Limitations

- **One regulation.** The parent Law № 781-VIQ, Central Bank rules and sectoral guidance are not
  loaded. The assistant will say so rather than guess, but a complete compliance answer often needs
  them — the corpus is designed to take additional documents.
- **No screening data.** There is no sanctions, PEP or watchlist connection; the assistant reasons
  about screening obligations, it does not screen. Clause 3.12 designations (UN sanctions, FATF
  call-for-action, MMX high-risk lists) must be supplied by the user or wired to a live feed.
- **English text is a working translation.** The Azerbaijani clause text is authoritative. The
  English labels in `src/factors.ts` are a maintainer's gloss and are never shown to a user.
- **Sessions are in-memory**, so a restart clears context and a multi-instance deployment needs a
  shared store. This is deliberate: a load balancer would break both the session store and the
  audit chain. One process, one host. The audit trail is on local disk and should be shipped
  off-host in production.
- **No redaction stage.** Whatever an officer pastes is transmitted and written to the trail as
  typed. Minimisation is a matter of procedure, not a control this tool enforces.
- **Rate limiting is per-process and in-memory**, so it resets on restart. Adequate as a guard
  against a runaway script; not a billing control.
- **Not verified against a live model in this environment** — there were no API credentials in the
  build sandbox. The tool loop, SSE streaming, tool dispatch, citation extraction and audit chain
  are covered by tests against a stub upstream that speaks the Messages API wire format; the
  quality of the model's answers has not been evaluated. Do that before relying on it.

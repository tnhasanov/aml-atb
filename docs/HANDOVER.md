# Handover packet — aml-atb go-live

Two people have to act. Neither task can be done by whoever built this, because
both require credentials or authority that only the institution holds.

Forward **Part A** to infrastructure/IT and **Part B** to the MLRO and DPO.
Nothing in Part A should be started until Part B is signed, because Part A is
what first sends customer data to a third party.

Fill in the blanks as you go; the completed document is the deployment record.

---

## Part A — Infrastructure / IT

You need a Linux host with Node ≥ 22.6, nginx, and outbound HTTPS to the model
API (or to your own gateway). Everything else is scripted.

### A1. Values to obtain before starting

| # | Value | Where it comes from | Filled in |
|---|---|---|---|
| 1 | Anthropic API key | Commercial owner of the Anthropic account | ☐ |
| 2 | Hostname + DNS A record | Internal DNS, e.g. `aml.internal.<bank>.az` | ☐ |
| 3 | TLS certificate + key for that name | Internal CA | ☐ |
| 4 | OIDC issuer URL | The bank's IdP (Keycloak / Entra / Okta) | ☐ |
| 5 | OIDC client ID + client secret | Register `aml-atb` as a confidential client on the IdP | ☐ |
| 6 | Which directory group may use the tool | Compliance function — ask the MLRO | ☐ |

For (5), the redirect URI to register is `https://<hostname>/oauth2/callback`.

For (6): everyone who can sign in can read the assistant's answers about
customers, so this is an access control on customer data, not a convenience.

### A2. Commands

```bash
# On a build machine with the repository:
scripts/release.sh
scp release/aml-atb-*.tar.gz* <host>:/tmp/

# On the target host:
tar -xzf /tmp/aml-atb-*.tar.gz -C /tmp
sudo /tmp/aml-atb-*/scripts/preflight.sh     # must exit 0 before continuing
sudo /tmp/aml-atb-*/scripts/install.sh /tmp/aml-atb-*.tar.gz

sudo vi /etc/aml-atb/aml-atb.env             # paste value (1)
sudo systemctl enable --now aml-atb
```

### A3. Identity and TLS

```bash
sudo cp /opt/aml-atb/current/deploy/oauth2-proxy.cfg /etc/oauth2-proxy.cfg
sudo chmod 600 /etc/oauth2-proxy.cfg
```

Edit `/etc/oauth2-proxy.cfg` and set:

- `oidc_issuer_url` — value (4)
- `client_id`, `client_secret` — value (5)
- `cookie_secret` — generate with `openssl rand -base64 32`
- `allowed_groups` — value (6)

```bash
sudo systemctl enable --now oauth2-proxy

sudo cp /opt/aml-atb/current/deploy/nginx.conf /etc/nginx/conf.d/aml-atb.conf
```

Edit `/etc/nginx/conf.d/aml-atb.conf` and set:

- `server_name` — value (2), in **both** server blocks
- `ssl_certificate` / `ssl_certificate_key` — value (3)
- `X-Auth-Secret` — copy `AUTH_SHARED_SECRET` from `/etc/aml-atb/aml-atb.env`

```bash
sudo nginx -t && sudo systemctl reload nginx
```

> If `nginx -v` reports **1.25.1 or newer**, replace `listen 443 ssl http2;`
> with `listen 443 ssl;` plus `http2 on;`. `preflight.sh` tells you which you
> have.

### A4. Verify — do not announce the tool until this exits 0

```bash
/opt/aml-atb/current/scripts/smoke-test.sh https://<hostname> /var/lib/aml-atb/audit
```

Ten checks, including that an anonymous caller is refused on every route, that a
forged `X-Forwarded-User` header is rejected, and that the audit chain verifies.

### A5. Hand back to the MLRO

- [ ] Off-host shipping of `/var/lib/aml-atb/audit/*.jsonl` configured
      (rsyslog / filebeat / rsync). Whole files only — **never** rotate,
      truncate or edit them; that breaks the integrity chain.
- [ ] Restart and rollback procedure tested once:
      `sudo /opt/aml-atb/current/scripts/install.sh --rollback`
- [ ] Monitoring points at `https://<hostname>/readyz` (503 = the audit trail
      stopped being writable and the tool has stopped answering, by design).

Deployed by: ____________________  Date: ____________

---

## Part B — MLRO and DPO

Seven questions. The tool sends whatever a compliance officer types — customer
names, FINs, transaction amounts, PEP status — to a processor outside
Azerbaijan, and keeps a permanent local record of it. None of that can be
resolved in code.

| # | Question | Owner | Answer / reference | Signed |
|---|---|---|---|---|
| 1 | Lawful basis for the cross-border transfer of customer data, and the banking-secrecy analysis | DPO + MLRO | | ☐ |
| 2 | Does MMX and/or the Central Bank require notification of this outsourcing arrangement? | MLRO | | ☐ |
| 3 | The API account's data-retention period and no-training position, confirmed in writing by the provider | Commercial owner + DPO | | ☐ |
| 4 | Retention period for the local audit trail, reconciled against the AML record-keeping duty | MLRO + DPO | | ☐ |
| 5 | What staff may paste — reference numbers or customer names? There is **no redaction stage**; whatever is typed is transmitted and recorded | DPO drafts, MLRO confirms it does not defeat record-keeping | | ☐ |
| 6 | Wording of the user-facing notice that queries are processed by a named third party abroad | DPO + MLRO | | ☐ |
| 7 | Attestation that the committed source document is the current text of the Rules as amended in 2024 | MLRO | | ☐ |

Notes on two of these:

**(4)** The audit trail is hash-chained, so *whole-file* expiry is compatible
with integrity but per-record deletion is not. If the retention answer requires
deleting individual records, say so now — it changes the design.

**(5)** If the answer is "reference numbers only", that is a procedure and a
training point, not something the tool enforces. Consider whether it needs to.

**(1)** If the transfer analysis requires that traffic not leave the bank's
perimeter directly, set `ANTHROPIC_BASE_URL` in `/etc/aml-atb/aml-atb.env` to an
institutional gateway or DLP proxy. This needs no code change.

Approved for production by: ____________________  Date: ____________

---

## What this tool is, for the record

Decision support, **not** a compliance decision and not legal advice. It answers
from one regulation — MMX Decision 3-21-28/3-6-4/2023 — with clause citations,
and says so when the Rules are silent. Clause 3.3 requires the obliged entity to
weigh national, sectoral and institutional risk assessments that the tool does
not hold; the final customer classification remains the compliance function's.

It has not been evaluated against a live model for answer quality. Before
opening it to users, have a compliance officer run a set of questions with known
answers and confirm the citations are correct.

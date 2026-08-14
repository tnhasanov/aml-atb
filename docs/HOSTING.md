# Hosting: where to put this so you can open it in a browser

Short answer: **Render**, and there is a `render.yaml` in the repository root
that does the whole thing. Vercel cannot host this without breaking the audit
trail — the reason is below, because it is worth understanding rather than
taking on trust.

There are two different questions hiding in "put it live", and they have
different answers:

| | Goal | Answer |
|---|---|---|
| **Pilot** | Give it a URL so colleagues can try it and judge whether the answers are any good | Render (this document) |
| **Production** | Run it as a bank system on customer data | The VM deployment in [HANDOVER.md](HANDOVER.md) |

Do the pilot first. Nobody should sign the Part B questions in HANDOVER.md
before someone has seen whether the tool actually answers Azerbaijani AML
questions correctly — and that has never been tested, because no live model has
ever been called from this codebase.

---

## Why not Vercel

Vercel is very good at what it does. This is not that.

The app needs three things, and Vercel's model gives none of them:

**1. A durable disk with exactly one writer.** `src/audit.ts` appends every
question, tool call and answer to `audit-YYYY-MM-DD.jsonl`, each record carrying
the SHA-256 of the record before it. That chain is what lets someone prove the
record has not been edited afterwards. On Vercel every request may land in a
fresh container with an empty `/tmp`, and several may run at once. The chain
would restart constantly, records would interleave, and everything written would
be discarded minutes later.

The bad part is not that it fails. It is that it *appears to work*: the chat
would answer normally, and the absence of records would surface only when a
supervisor asked for them.

**2. One long-lived process.** Sessions are held in memory (`src/server.ts`).
Across serverless instances, the second message in a conversation lands
somewhere that has never heard of the first.

**3. A response held open for minutes.** Answers stream token by token over SSE,
with a 300-second ceiling. Serverless function timeouts sit well below that on
most plans.

So that a future deploy cannot get this wrong silently, `src/config.ts` now
detects Vercel, Lambda, Netlify and Cloud Run and **refuses to start** with an
explanation. There is an `AML_ALLOW_EPHEMERAL_AUDIT=1` override for a throwaway
demo with no real data — but the audit trail will be lost, so do not use it with
anything a customer would recognise as their own.

The same reasoning rules out Cloudflare Workers, Netlify Functions and Lambda.
It does *not* rule out a container platform: Render, Railway, Fly.io, Azure
Container Apps and a plain VM all work.

---

## Render — the recommended pilot

**Cost:** about $7/month for the instance plus $0.25/month for the 1 GB disk.
The free plan has no persistent disk, so it is not an option here.

### What you do

1. Push this branch (already done) and go to
   [dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint**.
2. Connect the `aml-atb` repository. Render finds `render.yaml` and shows one
   web service with a disk attached.
3. It asks for two values:
   - `ANTHROPIC_API_KEY` — from console.anthropic.com
   - `AUTH_USERS` — see below
4. **Apply**. First build is a few minutes. You get a
   `https://aml-atb-*.onrender.com` URL, and the browser asks for a username and
   password.

### Making AUTH_USERS

Passwords are never stored, only scrypt hashes. On your machine, in the repo:

```bash
npm install && npm run build
node tools/hash-password.mjs aygun
node tools/hash-password.mjs rashad
```

Each prints one `username:hash` entry. Join them with commas:

```
AUTH_USERS=aygun:scrypt$16384$8$1$...,rashad:scrypt$16384$8$1$...
```

Give each person their password out of band. There is no password reset — to
change one, mint a new entry and edit the environment variable.

Basic auth sends the password on every request, which is acceptable only because
Render terminates TLS in front. It is a pilot mechanism. Production uses the
bank's IdP (`AUTH_MODE=proxy` behind oauth2-proxy).

### After it is up

```bash
curl https://<your-app>.onrender.com/readyz
```

`{"status":"ready","audit_writable":true,"clauses":213}` means the corpus loaded
and the audit disk is writable. A 503 means the disk is not writable and the
tool has stopped answering — which is the intended behaviour, not a bug.

To read the audit trail, use Render's shell on the service:

```bash
ls -l /var/data/audit
node tools/verify-audit.mjs /var/data/audit
```

---

## The alternatives, briefly

**Railway** — same shape as Render: attach a volume, set `AUDIT_DIR` to its
mount path, `BIND_HOST=0.0.0.0`, `AUTH_MODE=basic`. Slightly cheaper, no
blueprint file in this repo, so you configure it by hand in the dashboard.

**Fly.io** — the only one of the three with a region close to Azerbaijan
(Frankfurt or Bucharest are the nearest realistic options either way). Needs a
Dockerfile, which this repo deliberately does not carry: one was written and
deleted rather than ship a container image that had never been built
successfully. If you want Fly, that Dockerfile is half an hour of work.

**Azure Container Apps / a plain VM** — the right answer if the bank already has
an Azure tenancy or a VM estate, because it is also the production answer. The
scripts in `scripts/` and the configs in `deploy/` target exactly this.

---

## Before real customer data goes into the hosted pilot

A Render deployment is a third party holding your audit trail, on top of the
third party already processing the queries. That changes the answers to two of
the HANDOVER.md Part B questions:

- **Question 1** (lawful basis, banking secrecy) now covers Render as well as
  Anthropic, and the disk sits in Germany.
- **Question 4** (audit retention) now depends on a hosting provider's disk
  rather than the bank's own storage.

So: run the pilot with **synthetic or anonymised cases** — reference numbers,
invented names, real scenarios. That is enough to judge whether the citations
are right and the Azerbaijani reads naturally, which is the only thing the pilot
is for. Real customer data waits for the deployment in HANDOVER.md.

If you want the pilot on the bank's own infrastructure instead, skip this
document entirely: `scripts/preflight.sh` and `scripts/install.sh` will put it
on an internal VM, and that deployment can take real data once Part B is signed.

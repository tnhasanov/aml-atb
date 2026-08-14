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

**Cost:** free. `render.yaml` ships the pilot configuration, which keeps no
audit trail (`AUDIT_MODE=off`) and therefore needs no persistent disk — and a
disk is the only thing the free plan cannot give you. A free service spins down
after a spell of inactivity, so the first request after a quiet period takes
some seconds to wake up.

The trade is deliberate, and it is the reason this deployment is for
**synthetic cases only**. See "Before real customer data" below, and the
durable configuration at the bottom of `render.yaml` for the version that costs
about $7/month and does keep records.

### What you do

1. Push this branch (already done) and go to
   [dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint**.
2. Connect the `aml-atb` repository, and pick the branch the code is on. Render
   finds `render.yaml` and shows one web service.
3. It asks for two values:
   - `ANTHROPIC_API_KEY` — from console.anthropic.com
   - `AUTH_USERS` — see below
4. **Apply**. First build is a few minutes. You get a
   `https://aml-atb-*.onrender.com` URL, and the browser asks for a username and
   password.

The app shows an Azerbaijani banner at the top saying nothing is being recorded
and not to enter real customer data. That banner is driven by `AUDIT_MODE`, so
it disappears by itself when you switch to the durable configuration.

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

`{"status":"ready","audit":"off","clauses":213}` means all 213 clauses loaded and
the service is answering.

On the durable configuration you get `"audit":"file"` and an `audit_writable`
field as well, and a 503 when the disk has stopped being writable — at which
point the tool refuses to answer rather than advise with no record. That is
intended behaviour, not a bug. To read the trail, use Render's shell:

```bash
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

Two things are true of the pilot configuration, and both point the same way.

**It keeps no record.** `AUDIT_MODE=off` means questions and answers are not
written anywhere. If a customer name goes in, there is afterwards no way to say
who asked what about whom — which is exactly the situation the audit trail
exists to prevent.

**Hosting adds a second processor.** Even with the durable configuration, the
trail would sit on a hosting provider's disk in Germany, on top of the
processor already handling the queries. That changes the answers to two
HANDOVER.md Part B questions: **Q1** (lawful basis, banking secrecy) would cover
Render as well as Anthropic, and **Q4** (audit retention) would depend on a
hosting provider's storage rather than the bank's.

So run the pilot on **invented names and real scenarios**. That is enough to
judge whether the clause citations are correct and whether the Azerbaijani reads
naturally, which is the only thing a pilot is for.

For real customer data, the answer is not a bigger Render plan — it is the
deployment in [HANDOVER.md](HANDOVER.md), on a host the bank controls, with
`AUDIT_MODE=file` and Part B signed. `scripts/preflight.sh` and
`scripts/install.sh` do that in three commands.

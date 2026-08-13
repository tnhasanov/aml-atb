const transcript = document.getElementById("transcript");
const form = document.getElementById("composer");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const resetBtn = document.getElementById("reset");
const dialog = document.getElementById("clause-dialog");
const clauseTitle = document.getElementById("clause-title");
const clauseBody = document.getElementById("clause-body");

let sessionId = null;
let busy = false;

// ---------------------------------------------------------------- source line
fetch("/api/health")
  .then((r) => r.json())
  .then((h) => {
    document.getElementById("source-line").textContent =
      `${h.source.id} · ${h.source.clauses} bənd · ${h.model}`;
  })
  .catch(() => {
    document.getElementById("source-line").textContent = "Mənbə əlçatan deyil";
  });

// ---------------------------------------------------------------- composition
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

document.getElementById("examples")?.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  input.value = btn.textContent.trim();
  form.requestSubmit();
});

resetBtn.addEventListener("click", () => {
  sessionId = null;
  transcript.innerHTML = "";
  addNotice("Yeni sessiya başladıldı. Əvvəlki kontekst silindi.");
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = "";
  input.style.height = "auto";
  void send(text);
});

// ---------------------------------------------------------------- transport
async function send(text) {
  busy = true;
  sendBtn.disabled = true;
  document.querySelector(".welcome")?.remove();

  addMessage("user", text);
  const view = createAssistantView();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, session_id: sessionId }),
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(detail || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line.
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const line = frame.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        try {
          view.handle(JSON.parse(line.slice(6)));
        } catch {
          /* ignore malformed frame */
        }
      }
    }
    view.finish();
  } catch (err) {
    view.fail(err instanceof Error ? err.message : String(err));
  } finally {
    busy = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

// ---------------------------------------------------------------- rendering
function addMessage(role, text) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${role}`;
  wrap.innerHTML = `<div class="role">${role === "user" ? "Siz" : "Köməkçi"}</div>`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  wrap.append(bubble);
  transcript.append(wrap);
  scrollToEnd();
  return bubble;
}

function addNotice(text) {
  const el = document.createElement("div");
  el.className = "msg";
  el.innerHTML = `<div class="notice"></div>`;
  el.querySelector(".notice").textContent = text;
  transcript.append(el);
  scrollToEnd();
}

function createAssistantView() {
  const wrap = document.createElement("div");
  wrap.className = "msg assistant";
  wrap.innerHTML = `<div class="role">Köməkçi</div>`;

  const activity = document.createElement("div");
  activity.className = "activity";

  const thinkingBox = document.createElement("details");
  thinkingBox.className = "thinking";
  thinkingBox.hidden = true;
  thinkingBox.innerHTML = `<summary>Təhlil</summary><div class="thought"></div>`;
  const thought = thinkingBox.querySelector(".thought");

  const bubble = document.createElement("div");
  bubble.className = "bubble cursor";

  wrap.append(activity, thinkingBox, bubble);
  transcript.append(wrap);
  scrollToEnd();

  let answer = "";
  const chips = new Map();

  return {
    handle(event) {
      switch (event.type) {
        case "session":
          sessionId = event.session_id;
          break;

        case "thinking":
          thinkingBox.hidden = false;
          thought.textContent += event.text;
          break;

        case "tool_start": {
          const chip = document.createElement("span");
          chip.className = "chip running";
          chip.textContent = describeTool(event.tool, event.input);
          activity.append(chip);
          chips.set(event.tool, chip);
          scrollToEnd();
          break;
        }

        case "tool_end": {
          const chip = chips.get(event.tool);
          if (chip) chip.className = `chip ${event.ok ? "done" : "failed"}`;
          break;
        }

        case "text":
          answer += event.text;
          bubble.innerHTML = renderMarkdown(answer);
          bubble.classList.add("cursor");
          scrollToEnd();
          break;

        case "refusal":
          bubble.classList.remove("cursor");
          bubble.innerHTML = `<div class="notice"></div>`;
          bubble.querySelector(".notice").textContent = event.message;
          break;

        case "error":
          this.fail(event.message);
          break;

        case "done":
          bubble.classList.remove("cursor");
          break;
      }
    },

    finish() {
      bubble.classList.remove("cursor");
      if (!answer.trim() && !bubble.querySelector(".notice")) {
        bubble.innerHTML = `<div class="notice">Cavab alınmadı.</div>`;
      }
    },

    fail(message) {
      bubble.classList.remove("cursor");
      const notice = document.createElement("div");
      notice.className = "notice";
      notice.textContent = message;
      bubble.append(notice);
      scrollToEnd();
    },
  };
}

function describeTool(tool, input) {
  switch (tool) {
    case "search_rules":
      return `axtarış: ${truncate(input?.query ?? "", 40)}`;
    case "get_clause":
      return `${input?.clause_id ?? "?"} bəndi`;
    case "assess_customer_risk":
      return "risk qiymətləndirməsi (3-cü hissə)";
    case "determine_cdd_level":
      return "uyğunluq səviyyəsi (4-5-ci hissələr)";
    case "check_remote_onboarding":
      return "məsafədən eyniləşdirmə (7-ci hissə)";
    default:
      return tool;
  }
}

function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function scrollToEnd() {
  transcript.scrollTop = transcript.scrollHeight;
}

// ------------------------------------------------------- minimal markdown
// Deliberately small: escape everything first, then re-introduce only the
// handful of constructs the assistant actually emits.
function renderMarkdown(src) {
  const esc = src
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const lines = esc.split("\n");
  const out = [];
  let list = null;

  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      closeList();
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);

    if (bullet) {
      if (list !== "ul") {
        closeList();
        out.push("<ul>");
        list = "ul";
      }
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }

    if (numbered) {
      if (list !== "ol") {
        closeList();
        out.push("<ol>");
        list = "ol";
      }
      out.push(`<li>${inline(numbered[1])}</li>`);
      continue;
    }

    closeList();
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    out.push(heading ? `<p><strong>${inline(heading[1])}</strong></p>` : `<p>${inline(line)}</p>`);
  }

  closeList();
  return out.join("");
}

// Azerbaijani cites a clause as "3.9.1-ci bənd" (number first, ordinal suffix
// agreeing with the final digit); English puts the word first. Both forms are
// made clickable, and the suffix is preserved so the sentence still reads
// correctly.
//
// "maddə" is deliberately excluded: it denotes an article of the parent Law,
// which is not in this corpus, so linking it would only ever 404.
const CITATION_PATTERN =
  /(?:\b(clauses?)\s+((?:\d+\.)+\d+))|(((?:\d+\.)+\d+)(-(?:ci|cı|cu|cü))?\s+(bənd\w*|yarımbənd\w*))/gi;

function inline(text) {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(
      CITATION_PATTERN,
      (_match, enWord, enId, _azWhole, azId, azSuffix, azWord) =>
        enId
          ? `${enWord} ${button(enId)}`
          : `${button(azId)}${azSuffix ?? ""} ${azWord}`,
    );
}

function button(id) {
  return `<button class="cite" data-clause="${id}">${id}</button>`;
}

// ---------------------------------------------------------------- clause view
transcript.addEventListener("click", async (e) => {
  const btn = e.target.closest(".cite");
  if (!btn) return;
  const id = btn.dataset.clause;

  clauseTitle.textContent = `${id} bəndi`;
  clauseBody.innerHTML = "<p>Yüklənir…</p>";
  dialog.showModal();

  try {
    const res = await fetch(`/api/clause?id=${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`${id} bəndi tapılmadı`);
    const data = await res.json();
    clauseTitle.textContent = `${id} bəndi — ${data.part_title_az}`;
    clauseBody.innerHTML = "";
    for (const c of data.clauses) {
      const row = document.createElement("div");
      row.className = "clause";
      const num = document.createElement("div");
      num.className = "num";
      num.textContent = c.clause_id;
      const text = document.createElement("div");
      text.textContent = c.text;
      row.append(num, text);
      clauseBody.append(row);
    }
  } catch (err) {
    clauseBody.innerHTML = "";
    const p = document.createElement("p");
    p.textContent = err instanceof Error ? err.message : String(err);
    clauseBody.append(p);
  }
});

document.getElementById("clause-close").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (e) => {
  if (e.target === dialog) dialog.close();
});

input.focus();

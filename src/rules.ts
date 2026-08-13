import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const CORPUS_PATH = join(here, "..", "..", "data", "rules.json");

export interface Clause {
  id: string;
  part: string;
  part_title_az: string;
  part_title_en: string;
  depth: number;
  text: string;
  topics: string[];
}

export interface DocumentMeta {
  id: string;
  issuer_az: string;
  issuer_en: string;
  number: string;
  date: string;
  title_az: string;
  title_en: string;
  parent_law_az: string;
  parent_law_en: string;
  amended_by: string[];
}

export interface Corpus {
  document: DocumentMeta;
  parts: { id: string; title_az: string; title_en: string }[];
  clauses: Clause[];
  annex_identity_documents: string[];
}

/**
 * The corpus is generated from the source .docx by tools/extract_rules.py.
 * If it is missing the app must not start: an AML assistant with no regulation
 * behind it would answer from the model's own recollection, which is exactly
 * the failure mode this design exists to prevent.
 */
function load(): Corpus {
  let raw: string;
  try {
    raw = readFileSync(CORPUS_PATH, "utf8");
  } catch {
    throw new Error(
      `Rules corpus not found at ${CORPUS_PATH}. ` +
        `Generate it first:  python3 tools/extract_rules.py`,
    );
  }
  const parsed = JSON.parse(raw) as Corpus;
  if (!parsed.clauses?.length) {
    throw new Error("Rules corpus is empty - re-run tools/extract_rules.py");
  }
  return parsed;
}

export const corpus: Corpus = load();

const byId = new Map<string, Clause>(corpus.clauses.map((c) => [c.id, c]));

export function getClause(id: string): Clause | undefined {
  return byId.get(id.trim().replace(/\.$/, ""));
}

/** A clause plus everything nested beneath it, e.g. "3.9" -> 3.9, 3.9.1, 3.9.2 ... */
export function getClauseTree(id: string): Clause[] {
  const root = id.trim().replace(/\.$/, "");
  return corpus.clauses.filter((c) => c.id === root || c.id.startsWith(`${root}.`));
}

export function clausesByTopic(...topics: string[]): Clause[] {
  return corpus.clauses.filter((c) => topics.every((t) => c.topics.includes(t)));
}

export function citation(id: string): string {
  return `${corpus.document.id}, ${id}-ci bənd`;
}

/**
 * A clause reference carrying the regulation's own wording.
 *
 * Tool output quotes the Rules verbatim rather than an English paraphrase, so
 * the assistant relays official terminology instead of re-translating it on
 * every run - and the wording cannot drift from the text as the code changes.
 */
export interface ClauseRef {
  bend: string;
  metn: string;
}

export function clauseRef(id: string): ClauseRef {
  return { bend: id, metn: getClause(id)?.text ?? "" };
}

export function clauseRefs(...ids: string[]): ClauseRef[] {
  return ids.map(clauseRef);
}

/** Verbatim text of every child of a clause, e.g. all of 5.3.1-5.3.7. */
export function childRefs(parentId: string): ClauseRef[] {
  return getClauseTree(parentId)
    .filter((c) => c.id !== parentId)
    .map((c) => ({ bend: c.id, metn: c.text }));
}

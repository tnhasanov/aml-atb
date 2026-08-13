import { corpus, type Clause } from "./rules.js";
import { expandQuery } from "./glossary.js";

/**
 * BM25 over the clause corpus.
 *
 * Azerbaijani is agglutinative - "müştəri", "müştərilər", "müştərilərə" and
 * "müştərinin" are the same concept with different suffixes - so exact token
 * matching recalls badly. We approximate a stemmer by truncating tokens to a
 * fixed prefix, which collapses the common case suffixes without needing a
 * morphological analyser.
 */

const K1 = 1.5;
const B = 0.75;
const STEM_LENGTH = 6;

// Frequent function words carry no discriminative signal in legal prose.
const STOPWORDS = new Set([
  "və", "ilə", "bu", "the", "and", "or", "of", "for", "in", "to", "a", "is",
  "olan", "olduğu", "olduqda", "üçün", "üzrə", "görə", "dair", "ki", "də", "da",
  "edilən", "edilmiş", "edir", "etmək", "olaraq", "digər", "hər", "ya", "yaxud",
  "habelə", "əgər", "kimi", "isə", "aid", "nəzərdə", "tutulmuş", "qeyd",
  "aşağıdakı", "aşağıdakılar", "what", "which", "when", "how", "are", "do",
  "does", "can", "should", "must", "my", "we", "i", "an", "on", "at", "by",
  "with", "from", "as", "it", "that", "this", "if", "be", "not", "no",
]);

/**
 * Azerbaijani has a dotted/dotless i distinction that JavaScript's default
 * case folding gets wrong: "I".toLowerCase() must be "ı", not "i".
 */
export function foldCase(input: string): string {
  return input
    .replace(/İ/g, "i")
    .replace(/I/g, "ı")
    .toLowerCase()
    .normalize("NFC");
}

export function tokenize(input: string): string[] {
  const folded = foldCase(input);
  const words = folded.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    if (w.length < 2 || STOPWORDS.has(w)) continue;
    out.push(w.length > STEM_LENGTH ? w.slice(0, STEM_LENGTH) : w);
  }
  return out;
}

interface IndexedDoc {
  clause: Clause;
  tf: Map<string, number>;
  length: number;
}

class Bm25Index {
  private readonly docs: IndexedDoc[] = [];
  private readonly df = new Map<string, number>();
  private avgLength = 0;

  constructor(clauses: Clause[]) {
    for (const clause of clauses) {
      // Index the part title alongside the clause text so a query like
      // "enhanced due diligence" reaches Part 5 clauses whose own text does not
      // repeat the heading.
      const tokens = tokenize(`${clause.text} ${clause.part_title_az} ${clause.topics.join(" ")}`);
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push({ clause, tf, length: tokens.length });
    }
    const total = this.docs.reduce((sum, d) => sum + d.length, 0);
    this.avgLength = this.docs.length ? total / this.docs.length : 0;
  }

  search(query: string, limit: number): { clause: Clause; score: number }[] {
    const terms = tokenize(expandQuery(query));
    if (!terms.length) return [];

    const n = this.docs.length;
    const scored: { clause: Clause; score: number }[] = [];

    for (const doc of this.docs) {
      let score = 0;
      for (const term of terms) {
        const f = doc.tf.get(term);
        if (!f) continue;
        const df = this.df.get(term) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        const norm = f * (K1 + 1);
        const denom = f + K1 * (1 - B + (B * doc.length) / (this.avgLength || 1));
        score += idf * (norm / denom);
      }
      if (score > 0) scored.push({ clause: doc.clause, score });
    }

    scored.sort((a, b) => b.score - a.score || a.clause.id.localeCompare(b.clause.id));
    return scored.slice(0, limit);
  }
}

const index = new Bm25Index(corpus.clauses);

export interface SearchHit {
  clause_id: string;
  part: string;
  part_title_en: string;
  text: string;
  topics: string[];
  score: number;
}

export function searchRules(query: string, limit = 8): SearchHit[] {
  return index.search(query, limit).map(({ clause, score }) => ({
    clause_id: clause.id,
    part: clause.part,
    part_title_en: clause.part_title_en,
    text: clause.text,
    topics: clause.topics,
    score: Number(score.toFixed(3)),
  }));
}

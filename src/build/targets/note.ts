import { splitPaywall } from "../lib/paywall.js";
import type { Article } from "../types.js";

// note does not support frontmatter — title/tags are set in the web UI.
// If the body already starts with an h1 we keep it as-is; otherwise we prepend
// meta.title as a leading h1 so the author has a reference of the intended title.
// Paywall is represented by a horizontal rule comment block note editors can
// map to the "here is the paid boundary" marker manually.
//
// note also does not render GFM tables. Authors may still write tables in the
// source (zenn / tech-note render them fine), so this target strips tables
// out of fenced code blocks' way and rewrites them as plain-text bullet lists
// before emitting. Runs only over the note output — source is untouched.
export function renderNote(article: Article): string {
  const { free, paid } = splitPaywall(article.body);
  const bodyHasH1 = /^# /.test(free);
  const header = bodyHasH1 ? "" : `# ${article.meta.title}\n\n`;
  const freeText = stripTables(free).trimEnd();
  if (paid === null) {
    return `${header}${freeText}\n`;
  }
  const boundary = "\n\n---\n\n<!-- ここから有料エリア -->\n\n";
  return `${header}${freeText}${boundary}${stripTables(paid).trimEnd()}\n`;
}

const FENCE_RE = /```[\s\S]*?```/g;
const TABLE_RE =
  /(?:^|\n)((?:[ \t]*\|[^\n]*\n)+[ \t]*\|[ \t:|-]+\|[^\n]*\n(?:[ \t]*\|[^\n]*\n?)+)/g;
const FENCE_SENTINEL_RE = /@@FENCE_(\d+)@@/g;

function stripTables(input: string): string {
  // Protect fenced code blocks so we don't touch ASCII tables inside them.
  const fences: string[] = [];
  const masked = input.replace(FENCE_RE, (m) => {
    fences.push(m);
    return `@@FENCE_${fences.length - 1}@@`;
  });

  const rewritten = masked.replace(TABLE_RE, (_match, table: string) => {
    return `\n${tableToProse(table)}\n`;
  });

  return rewritten.replace(FENCE_SENTINEL_RE, (_m, idx: string) => fences[Number(idx)] ?? "");
}

function tableToProse(raw: string): string {
  const lines = raw.split("\n").filter((l) => l.trim().startsWith("|"));
  if (lines.length < 2) return raw;
  const cells = (line: string): string[] =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

  const header = cells(lines[0] ?? "");
  // lines[1] is the alignment separator — skip it.
  const rows = lines.slice(2).map(cells);

  const out: string[] = [];
  for (const row of rows) {
    const parts: string[] = [];
    for (let i = 0; i < header.length; i++) {
      const h = header[i] ?? "";
      const v = row[i] ?? "";
      if (!v) continue;
      parts.push(h ? `${h}: ${v}` : v);
    }
    out.push(`- ${parts.join(" / ")}`);
  }
  return out.join("\n");
}

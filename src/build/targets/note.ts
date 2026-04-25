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
//
// note does not render inline code spans (`like this`) — backticks are shown
// literally. Fenced code blocks ARE supported, so we preserve those and only
// strip inline backticks.
export function renderNote(article: Article): string {
  const { free, paid } = splitPaywall(article.body);
  const bodyHasH1 = /^# /.test(free);
  const header = bodyHasH1 ? "" : `# ${article.meta.title}\n\n`;
  const freeText = transformBody(free).trimEnd();
  if (paid === null) {
    return `${header}${freeText}\n`;
  }
  const boundary = "\n\n---\n\n<!-- ここから有料エリア -->\n\n";
  return `${header}${freeText}${boundary}${transformBody(paid).trimEnd()}\n`;
}

const FENCE_RE = /(`{3,})[\s\S]*?\1/g;
const INLINE_CODE_RE = /`([^`\n]+?)`/g;
const TABLE_RE =
  /(?:^|\n)((?:[ \t]*\|[^\n]*\n)+[ \t]*\|[ \t:|-]+\|[^\n]*\n(?:[ \t]*\|[^\n]*\n?)+)/g;
const FENCE_SENTINEL_RE = /@@FENCE_(\d+)@@/g;

function transformBody(input: string): string {
  // Protect fenced code blocks so we don't touch tables or inline backticks inside them.
  const fences: string[] = [];
  let text = input.replace(FENCE_RE, (m) => {
    fences.push(m);
    return `@@FENCE_${fences.length - 1}@@`;
  });

  // GFM tables → bullet list (note does not render tables).
  text = text.replace(TABLE_RE, (_m, table: string) => `\n${tableToProse(table)}\n`);

  // Inline backticks → plain text (note does not render inline code spans).
  text = text.replace(INLINE_CODE_RE, (_m, content: string) => content);

  // Restore fenced blocks unchanged.
  return text.replace(FENCE_SENTINEL_RE, (_m, idx: string) => fences[Number(idx)] ?? "");
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

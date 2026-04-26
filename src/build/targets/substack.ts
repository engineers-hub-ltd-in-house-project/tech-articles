import { splitPaywall } from "../lib/paywall.js";
import type { Article } from "../types.js";

// Substack 向け。Substack には公式投稿 API は無く、エディタへの手動貼り付け運用を
// 前提とする。エディタはライブ入力時の Markdown ショートカット (`# ` `## ` `**`
// `> ` `- ` ``` ``` ```) を解釈するが、ペースト時の Markdown 解釈は不安定
// (~95%)。GFM テーブルはペーストでは再現されないため箇条書きへ変換する。
// ペイウォールはエディタ UI のボタンで配置するため、本文には note と同じ境界
// テキストを置いて著者が手動でボタン配置の目印にする運用。
//
// 投稿分割: 1 記事を複数投稿へ分割するため、meta.substack.splitPoints に
// 見出しを列挙すると、各見出しを境に連番ファイル
// `<slug>/01.md` `<slug>/02.md` ... を出力する (記事ごとにサブディレクトリを
// 切る)。指定無しなら単一 `<slug>/01.md` を出力する。
//
// splitPoints の書式は次のいずれか。同名見出しが複数ある記事 (TOC を載せている
// 記事など) では `## ` / `### ` の接頭辞でレベルを限定して曖昧解消する。
//   - "見出し本体"        テキスト一致 (H2 / H3 のいずれでも可)。一意でなければエラー
//   - "## 見出し本体"     H2 のみに限定して一致
//   - "### 見出し本体"    H3 のみに限定して一致

interface RenderedPart {
  name: string;
  content: string;
}

interface Heading {
  level: 2 | 3;
  text: string;
  lineStart: number;
  lineEnd: number;
}

const PAYWALL_SENTINEL = "@@SUBSTACK_PAYWALL@@";
const PAYWALL_BOUNDARY = "\n\n---\n\n<!-- ここから有料エリア -->\n\n";

export function renderSubstack(article: Article): RenderedPart[] {
  const { free, paid } = splitPaywall(article.body);
  const includePaywalled = article.meta.substack?.includePaywalled ?? false;
  const splitPoints = article.meta.substack?.splitPoints ?? [];

  if (paid !== null && !includePaywalled) {
    const paidHeading = splitPoints.find((sp) => containsHeading(paid, sp));
    if (paidHeading !== undefined) {
      throw new Error(
        `[substack:${article.slug}] split point "${paidHeading}" is inside the paywalled section. ` +
          `Set substack.includePaywalled: true or move the split point.`,
      );
    }
  }

  const source =
    paid !== null && includePaywalled ? `${free}\n\n${PAYWALL_SENTINEL}\n\n${paid}` : free;

  if (splitPoints.length === 0) {
    return [{ name: `${article.slug}/01`, content: renderSingle(article, source) }];
  }

  const headings = findHeadings(source);
  const splits = splitPoints.map((sp) => locateSplit(article.slug, headings, sp));
  const segments = cutSegments(source, splits);

  return segments.map((seg, i) => ({
    name: `${article.slug}/${String(i + 1).padStart(2, "0")}`,
    content: renderPart(article, seg, i, splits[i - 1]?.text),
  }));
}

function renderSingle(article: Article, source: string): string {
  const bodyHasH1 = /^# /.test(source);
  const header = bodyHasH1 ? "" : `# ${article.meta.title}\n\n`;
  const transformed = transformBody(source).trimEnd();
  return `${header}${replacePaywallSentinel(transformed)}\n`;
}

function renderPart(
  article: Article,
  segment: string,
  index: number,
  splitHeadingText: string | undefined,
): string {
  let body: string;
  if (index === 0) {
    const hasH1 = /^# /.test(segment);
    body = hasH1 ? segment : `# ${article.meta.title}\n\n${segment}`;
  } else {
    body = rewriteLeadingHeadingToH1(segment, splitHeadingText ?? "");
  }
  const transformed = transformBody(body).trimEnd();
  return `${replacePaywallSentinel(transformed)}\n`;
}

function rewriteLeadingHeadingToH1(segment: string, expectedText: string): string {
  const newlineIdx = segment.indexOf("\n");
  const firstLine = newlineIdx === -1 ? segment : segment.slice(0, newlineIdx);
  const rest = newlineIdx === -1 ? "" : segment.slice(newlineIdx + 1);
  const m = firstLine.match(/^(#{2,3})\s+(.+?)\s*$/);
  if (m && m[2].trim() === expectedText) {
    return `# ${expectedText}\n${rest}`;
  }
  return `# ${expectedText}\n\n${segment}`;
}

function replacePaywallSentinel(text: string): string {
  if (!text.includes(PAYWALL_SENTINEL)) return text;
  return text.replace(new RegExp(`\\n*${PAYWALL_SENTINEL}\\n*`, "g"), PAYWALL_BOUNDARY);
}

function locateSplit(slug: string, headings: Heading[], splitPoint: string): Heading {
  const prefix = splitPoint.match(/^(#{2,3})\s+/);
  const level = prefix ? (prefix[1].length as 2 | 3) : null;
  const text = prefix ? splitPoint.slice(prefix[0].length).trim() : splitPoint;

  const matches = headings.filter((h) => h.text === text && (level === null || h.level === level));
  if (matches.length === 0) {
    throw new Error(`[substack:${slug}] split point not found: "${splitPoint}"`);
  }
  if (matches.length > 1) {
    throw new Error(
      `[substack:${slug}] split point ambiguous (matched ${matches.length} headings): "${splitPoint}". ` +
        `Add a "## " or "### " prefix to disambiguate by heading level.`,
    );
  }
  return matches[0];
}

function cutSegments(source: string, splits: Heading[]): string[] {
  const segments: string[] = [];
  let cursor = 0;
  for (const s of splits) {
    segments.push(source.slice(cursor, s.lineStart));
    cursor = s.lineStart;
  }
  segments.push(source.slice(cursor));
  return segments.map((seg) => seg.replace(/^\n+/, "").replace(/\n+$/, "\n"));
}

function findHeadings(source: string): Heading[] {
  const headings: Heading[] = [];
  let offset = 0;
  let inFence = false;
  let fenceMarker = "";
  for (const line of source.split("\n")) {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    offset = lineEnd + 1;

    const fence = line.match(/^(`{3,})/);
    if (fence) {
      const marker = fence[1];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (line.startsWith(fenceMarker)) {
        inFence = false;
        fenceMarker = "";
      }
      continue;
    }
    if (inFence) continue;

    const h = line.match(/^(#{2,3})\s+(.+?)\s*$/);
    if (h) {
      headings.push({
        level: h[1].length as 2 | 3,
        text: h[2].trim(),
        lineStart,
        lineEnd,
      });
    }
  }
  return headings;
}

function containsHeading(text: string, splitPoint: string): boolean {
  const prefix = splitPoint.match(/^(#{2,3})\s+/);
  const level = prefix ? (prefix[1].length as 2 | 3) : null;
  const target = prefix ? splitPoint.slice(prefix[0].length).trim() : splitPoint;
  return findHeadings(text).some((h) => h.text === target && (level === null || h.level === level));
}

const FENCE_RE = /(`{3,})[\s\S]*?\1/g;
const INLINE_CODE_RE = /`([^`\n]+?)`/g;
const TABLE_RE =
  /(?:^|\n)((?:[ \t]*\|[^\n]*\n)+[ \t]*\|[ \t:|-]+\|[^\n]*\n(?:[ \t]*\|[^\n]*\n?)+)/g;
const FENCE_SENTINEL_RE = /@@SS_FENCE_(\d+)@@/g;

function transformBody(input: string): string {
  const fences: string[] = [];
  let text = input.replace(FENCE_RE, (m) => {
    fences.push(m);
    return `@@SS_FENCE_${fences.length - 1}@@`;
  });

  text = text.replace(TABLE_RE, (_m, table: string) => `\n${tableToProse(table)}\n`);
  text = text.replace(INLINE_CODE_RE, (_m, content: string) => content);

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

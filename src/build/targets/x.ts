import { splitPaywall } from "../lib/paywall.js";
import type { Article } from "../types.js";

// X Articles (X Premium+ の長文投稿機能、x.com/compose/articles) 向け。
// X Articles は WYSIWYG 型のエディタで、ペースト時に Markdown 構文を解釈しない。
// `##` や `**` や `---` をそのまま貼ると文字通りに表示されてしまうため、この
// ターゲットでは Markdown 装飾を全面的に剥がし、平文として貼り付けられる形に
// 変換する。書式（見出し、太字、引用、リスト等）は X 側のツールバーから手動で
// 適用する運用を想定。
//
// X Articles 側の仕様 (ASCII.jp レビュー等で確認):
// - 対応: 見出し/小見出し、太字、斜体、取り消し線、引用、番号付きリスト、
//   箇条書き (中点 ・)、リンク、メディア (画像・動画・GIF)
// - 非対応: コードブロック、インラインコード、表、水平線、HTML 埋め込み
//
// paywall: X Articles には有料記事の概念が無いため、既定では free 部分のみ出力
// する。meta.x.includePaywalled: true のときだけ paid 部分も続けて出力する
// (Zenn と同規約)。
export function renderX(article: Article): string {
  const { free, paid } = splitPaywall(article.body);
  const includePaywalled = article.meta.x?.includePaywalled ?? false;
  const source = includePaywalled && paid ? `${free}\n\n${paid}` : free;
  const bodyHasH1 = /^# /.test(source);
  const withTitle = bodyHasH1 ? source : `# ${article.meta.title}\n\n${source}`;
  return `${stripMarkdownDecorations(withTitle).trimEnd()}\n`;
}

// 3 つ以上のバッククオートで囲まれたフェンス (CommonMark 準拠)。
// `(`{3,})` で開きの本数を捕捉し、`\1` で同数のバッククオートを閉じ側に要求する。
const FENCE_RE = /(`{3,})[\s\S]*?\1/g;
const INLINE_CODE_RE = /`([^`\n]+?)`/g;
const TABLE_RE =
  /(?:^|\n)((?:[ \t]*\|[^\n]*\n)+[ \t]*\|[ \t:|-]+\|[^\n]*\n(?:[ \t]*\|[^\n]*\n?)+)/g;
const FENCE_SENTINEL_RE = /@@X_FENCE_(\d+)@@/g;
const INLINE_SENTINEL_RE = /@@X_INLINE_(\d+)@@/g;

function stripMarkdownDecorations(input: string): string {
  const fences: string[] = [];
  const inlines: string[] = [];

  // コードブロックを退避 (後段の装飾剥がしで中身を壊さないため)。アンマスク時に
  // フェンスと言語タグを落として素の中身だけ戻す。
  let text = input.replace(FENCE_RE, (m) => {
    fences.push(stripFence(m));
    return `@@X_FENCE_${fences.length - 1}@@`;
  });

  // インラインコードを退避。アンマスク時にバッククオートを外した中身を戻す。
  text = text.replace(INLINE_CODE_RE, (_m, content: string) => {
    inlines.push(content);
    return `@@X_INLINE_${inlines.length - 1}@@`;
  });

  // 表 → 箇条書き (X は GFM テーブルを持たない)
  text = text.replace(TABLE_RE, (_m, table: string) => `\n${tableToProse(table)}\n`);

  // HTML コメント
  text = text.replace(/<!--[\s\S]*?-->/g, "");

  // 画像は完全削除 (X 側で手動アップロード運用)
  text = text.replace(/!\[[^\]]*\]\([^)]+\)/g, "");

  // リンク: [text](url) → text (url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");

  // 太字: **text** → text
  text = text.replace(/\*\*([^*\n]+?)\*\*/g, "$1");

  // 斜体: *text* → text (アスタリスクのみ。`_` は識別子を壊さないため温存)
  text = text.replace(/\*([^*\n]+?)\*/g, "$1");

  // 取り消し線: ~~text~~ → text
  text = text.replace(/~~([^~\n]+?)~~/g, "$1");

  // 見出し: 行頭の `#` を除去
  text = text.replace(/^#{1,6}\s+/gm, "");

  // 引用: 行頭 `> ` を除去
  text = text.replace(/^>\s?/gm, "");

  // 水平線 (`---` / `***` / `___`): 行ごと削除 (X に水平線なし)
  text = text.replace(/^(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, "");

  // リストマーカ: `- ` / `* ` → `・ ` (X のネイティブ箇条書き表示に合わせる)
  text = text.replace(/^([ \t]*)[-*]\s+/gm, "$1・ ");

  // インラインコードをアンマスク (バッククオートを落とした中身を差し戻す)
  text = text.replace(INLINE_SENTINEL_RE, (_m, idx: string) => inlines[Number(idx)] ?? "");

  // コードブロックをアンマスク (フェンスを落とした中身を差し戻す)
  text = text.replace(FENCE_SENTINEL_RE, (_m, idx: string) => fences[Number(idx)] ?? "");

  // 最外フェンスで保護されていた中に残った内側フェンス行 (例: 4 バッククオート
  // の外側フェンスに包まれた 3 バッククオートの内側フェンス) を除去する。
  text = text.replace(/^`{3,}[^\n]*$\n?/gm, "");

  // 3 行以上の空行を 2 行に圧縮
  text = text.replace(/\n{3,}/g, "\n\n");

  return text;
}

function stripFence(block: string): string {
  const lines = block.split("\n");
  if (lines.length < 2) return block;
  const first = lines[0] ?? "";
  const last = lines[lines.length - 1] ?? "";
  if (/^`{3,}/.test(first) && /^`{3,}\s*$/.test(last)) {
    return lines.slice(1, -1).join("\n");
  }
  return block;
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
    out.push(`・ ${parts.join(" / ")}`);
  }
  return out.join("\n");
}

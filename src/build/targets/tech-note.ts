import type { Article } from "../types.js";

// Placeholder: tech note (自社開発中) の仕様が固まり次第実装する。
// 現状はフルマークダウンをそのまま流す。
export function renderTechNote(article: Article): string {
  return article.body.trimEnd() + "\n";
}

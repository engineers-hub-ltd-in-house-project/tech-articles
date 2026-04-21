import { splitPaywall } from "../lib/paywall.js";
import type { Article } from "../types.js";

// X Articles (X Premium+ の長文投稿機能) 向け。x.com/compose/articles 側で
// タイトルを設定するため、フロントマターは出力しない。本文冒頭に h1 が無い
// ときだけ meta.title を h1 として前置する（note と同じ挙動）。
//
// X Articles には paywall の概念が無いため、既定では free 部分のみ出力する。
// meta.x.includePaywalled: true のときだけ paid 部分も続けて出力する（Zenn と
// 同規約）。
//
// GFM テーブルは現状パススルーとしている。X Articles のテーブル対応が未確定
// のため、note の stripTables を当てずに素直に流す。もし描画に問題があれば
// note.ts の stripTables を共通ユーティリティに切り出して再利用する方針。
export function renderX(article: Article): string {
  const { free, paid } = splitPaywall(article.body);
  const bodyHasH1 = /^# /.test(free);
  const header = bodyHasH1 ? "" : `# ${article.meta.title}\n\n`;
  const includePaywalled = article.meta.x?.includePaywalled ?? false;
  const body = includePaywalled && paid ? `${free}\n\n${paid}` : free;
  return (header + body).trimEnd() + "\n";
}

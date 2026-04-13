import yaml from "js-yaml";
import { splitPaywall } from "../lib/paywall.js";
import type { Article } from "../types.js";

// Zenn frontmatter spec:
// title, emoji, type (tech|idea), topics (array), published (bool)
export function renderZenn(article: Article): string {
  const { meta } = article;
  const frontmatter = {
    title: meta.title,
    emoji: meta.emoji ?? "📝",
    type: meta.type ?? "tech",
    topics: meta.topics ?? [],
    published: meta.published ?? false,
  };
  const fm = `---\n${yaml.dump(frontmatter, { lineWidth: 1000 })}---\n\n`;

  const { free, paid } = splitPaywall(article.body);
  const includePaywalled = meta.zenn?.includePaywalled ?? false;
  const body = includePaywalled && paid ? `${free}\n\n${paid}` : free;
  return fm + body.trimEnd() + "\n";
}

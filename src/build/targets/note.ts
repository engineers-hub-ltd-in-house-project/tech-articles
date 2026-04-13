import { splitPaywall } from "../lib/paywall.js";
import type { Article } from "../types.js";

// note does not support frontmatter — title/tags are set in the web UI.
// We emit the title as a leading h1 for reference, then the body.
// Paywall is represented by a horizontal rule comment block note editors can
// map to the "here is the paid boundary" marker manually.
export function renderNote(article: Article): string {
  const { free, paid } = splitPaywall(article.body);
  const header = `# ${article.meta.title}\n\n`;
  if (paid === null) {
    return header + free.trimEnd() + "\n";
  }
  const boundary = "\n\n---\n\n<!-- ここから有料エリア -->\n\n";
  return header + free.trimEnd() + boundary + paid.trimEnd() + "\n";
}

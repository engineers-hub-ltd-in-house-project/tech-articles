import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";

const ARTICLES_ROOT = "src/articles";

function scaffold(slug: string): void {
  const dir = join(ARTICLES_ROOT, slug);
  if (existsSync(dir)) {
    console.error(`already exists: ${dir}`);
    process.exit(1);
  }
  mkdirSync(join(dir, "assets"), { recursive: true });

  const meta = `title: ${slug}
slug: ${slug}
emoji: 📝
type: tech
topics: []
published: false
paid: false
note:
  magazine: null
  price: null
zenn:
  publication_name: null
  includePaywalled: false
`;
  writeFileSync(join(dir, "meta.yaml"), meta);

  const body = `# ${slug}\n\nここに本文を書きます。\n\n<!-- paywall -->\n\nここから有料部分です。\n`;
  writeFileSync(join(dir, "index.md"), body);

  console.log(`scaffolded ${dir}`);
}

const program = new Command();
program.argument("<slug>", "article slug").action((slug: string) => scaffold(slug));
program.parse();

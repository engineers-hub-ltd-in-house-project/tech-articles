import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { listSlugs, loadArticle } from "./lib/load.js";
import { renderNote } from "./targets/note.js";
import { renderSubstack } from "./targets/substack.js";
import { renderTechNote } from "./targets/tech-note.js";
import { renderX } from "./targets/x.js";
import { renderZenn } from "./targets/zenn.js";
import type { Article, Target } from "./types.js";

const DIST_ROOT = "dist";
const TARGETS: Target[] = ["note", "zenn", "tech-note", "x", "substack"];

type RenderedFile = { name: string; content: string };

const RENDERERS: Record<Target, (a: Article) => RenderedFile[]> = {
  note: (a) => [{ name: a.slug, content: renderNote(a) }],
  zenn: (a) => [{ name: a.slug, content: renderZenn(a) }],
  "tech-note": (a) => [{ name: a.slug, content: renderTechNote(a) }],
  x: (a) => [{ name: a.slug, content: renderX(a) }],
  substack: renderSubstack,
};

function writeOut(target: Target, name: string, content: string): string {
  const out = join(DIST_ROOT, target, `${name}.md`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, content);
  return out;
}

function buildOne(slug: string, targets: Target[]): void {
  const article = loadArticle(slug);
  for (const target of targets) {
    const files = RENDERERS[target](article);
    for (const { name, content } of files) {
      const out = writeOut(target, name, content);
      console.log(`  ${target.padEnd(10)} → ${out}`);
    }
  }
}

const program = new Command();
program
  .argument("[slug]", "article slug; omit to build all articles")
  .option("-t, --target <target>", "only build one target (note|zenn|tech-note|x|substack)")
  .action((slug: string | undefined, opts: { target?: Target }) => {
    const slugs = slug ? [slug] : listSlugs();
    const targets: Target[] = opts.target ? [opts.target] : TARGETS;
    for (const s of slugs) {
      console.log(`building ${s}`);
      buildOne(s, targets);
    }
  });

program.parse();

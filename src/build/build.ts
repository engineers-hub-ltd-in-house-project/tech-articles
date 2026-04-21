import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { listSlugs, loadArticle } from "./lib/load.js";
import { renderNote } from "./targets/note.js";
import { renderTechNote } from "./targets/tech-note.js";
import { renderX } from "./targets/x.js";
import { renderZenn } from "./targets/zenn.js";
import type { Target } from "./types.js";

const DIST_ROOT = "dist";
const TARGETS: Target[] = ["note", "zenn", "tech-note", "x"];

const RENDERERS = {
  note: renderNote,
  zenn: renderZenn,
  "tech-note": renderTechNote,
  x: renderX,
} as const;

function writeOut(target: Target, slug: string, content: string): string {
  const out = join(DIST_ROOT, target, `${slug}.md`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, content);
  return out;
}

function buildOne(slug: string, targets: Target[]): void {
  const article = loadArticle(slug);
  for (const target of targets) {
    const content = RENDERERS[target](article);
    const out = writeOut(target, slug, content);
    console.log(`  ${target.padEnd(10)} → ${out}`);
  }
}

const program = new Command();
program
  .argument("[slug]", "article slug; omit to build all articles")
  .option("-t, --target <target>", "only build one target (note|zenn|tech-note|x)")
  .action((slug: string | undefined, opts: { target?: Target }) => {
    const slugs = slug ? [slug] : listSlugs();
    const targets: Target[] = opts.target ? [opts.target] : TARGETS;
    for (const s of slugs) {
      console.log(`building ${s}`);
      buildOne(s, targets);
    }
  });

program.parse();

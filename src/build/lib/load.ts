import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import type { Article, ArticleMeta } from "../types.js";

const ARTICLES_ROOT = "src/articles";

export function loadArticle(slug: string): Article {
  const dir = join(ARTICLES_ROOT, slug);
  const metaPath = join(dir, "meta.yaml");
  const bodyPath = join(dir, "index.md");
  const meta = yaml.load(readFileSync(metaPath, "utf8")) as ArticleMeta;
  const body = readFileSync(bodyPath, "utf8");
  if (!meta.slug) meta.slug = slug;
  return { slug, dir, meta, body };
}

export function listSlugs(): string[] {
  return readdirSync(ARTICLES_ROOT).filter((name) => {
    const p = join(ARTICLES_ROOT, name);
    return statSync(p).isDirectory();
  });
}

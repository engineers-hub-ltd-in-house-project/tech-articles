export type Target = "note" | "zenn" | "tech-note" | "x" | "substack";

export interface ArticleMeta {
  title: string;
  slug: string;
  emoji?: string;
  type?: "tech" | "idea";
  topics?: string[];
  published?: boolean;
  paid?: boolean;
  note?: {
    magazine?: string | null;
    price?: number | null;
  };
  zenn?: {
    publication_name?: string | null;
    includePaywalled?: boolean;
  };
  x?: {
    includePaywalled?: boolean;
  };
  substack?: {
    includePaywalled?: boolean;
    splitPoints?: string[];
  };
}

export interface Article {
  slug: string;
  dir: string;
  meta: ArticleMeta;
  body: string;
}

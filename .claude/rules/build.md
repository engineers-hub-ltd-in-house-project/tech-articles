# ビルド・運用

## 新規記事

- `src/articles/<slug>/{index.md, meta.yaml}` を直接作成する。`pnpm new` は雛形のみで topics や substack splitPoints を直書きできない
- 生原稿は GFM、フロントマターなし
- 画像は `./assets/xxx.png` の相対パス
- 有料区切りは `<!-- paywall -->`(必要時のみ)

## コマンド

```bash
pnpm build [<slug>] [--target note|zenn|tech-note|x|substack]
pnpm lint:md   # markdownlint-cli2
pnpm lint:ts   # Biome
```

## 媒体別後処理

- `src/build/targets/<媒体>.ts` に集約
- note は `<!-- paywall -->` を `--- <!-- ここから有料エリア -->` に変換
- Zenn は先頭にフロントマターを挿入し、`<!-- paywall -->` 以降は既定で出力しない
- X Articles はフロントマターを出さず、本文冒頭にタイトルをプレーンテキストで前置する
- Substack は `splitPoints` で記事を複数ファイルに分割

## メール本文等のサンプル

- 記事内のメール本文サンプル等にも `.claude/rules/writing.md` の規約を適用する
- エンドユーザに送る本物の文面なので、なおさら自然な日本語に開く

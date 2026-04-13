# tech-articles

技術記事の生原稿を single source of truth として管理し、媒体ごと（note / Zenn / 自社 tech note）に変換して出力するリポジトリ。

## ディレクトリ構成

```
tech-articles/
├── src/
│   ├── articles/<slug>/
│   │   ├── index.md    生原稿（GFM）
│   │   ├── meta.yaml   媒体横断メタデータ
│   │   └── assets/     画像等
│   └── build/          変換スクリプト（TypeScript）
└── dist/               ビルド成果物（git 管理外）
    ├── note/<slug>.md
    ├── zenn/<slug>.md
    └── tech-note/<slug>.md
```

## 使い方

### 新しい記事を作る

```
pnpm new my-slug
```

`src/articles/my-slug/` に雛形が作られる。

### ビルド

```
pnpm build                 全記事を全媒体向けに出力
pnpm build my-slug         特定記事のみ
pnpm build my-slug --target note
```

## 生原稿の書き方

- 生原稿は `src/articles/<slug>/index.md` に GFM で書く
- 先頭フロントマターは付けない。メタデータは `meta.yaml` に分離
- note の有料区切り位置は本文中に `<!-- paywall -->` を置いて表現する
- 画像は `./assets/xxx.png` の相対パス

### meta.yaml のスキーマ

```yaml
title: 記事タイトル
slug: my-slug
emoji: 🤖            # Zenn 用
type: tech           # Zenn 用 tech|idea
topics: [tag1, tag2] # Zenn のトピック
published: false     # Zenn 公開フラグ
paid: true           # note の有料記事フラグ
note:
  magazine: null
  price: 500
zenn:
  publication_name: null
  includePaywalled: false  # true にすると Zenn 出力にも paywall 以降を含める
```

## 媒体別の変換ルール

### note
- 先頭に meta.title を h1 として挿入
- `<!-- paywall -->` を `--- <!-- ここから有料エリア -->` に変換（note 投稿画面で手動設定するときの目印）
- タグ・マガジン・価格は note の Web UI 側で設定する

### Zenn
- Zenn 形式のフロントマター（title / emoji / type / topics / published）を先頭に挿入
- `<!-- paywall -->` 以降は既定で出力しない（`zenn.includePaywalled: true` で出力）
- Zenn 独自記法（`:::message` 等）は生原稿では使わず、必要なら媒体別後処理で入れる

### tech note（自社開発中）
- 仕様未確定。現状はパススルー出力のみ

## 開発

### Lint と整形

- TS / JSON: Biome（`pnpm lint:ts` / `pnpm format`）
- Markdown: Prettier + markdownlint-cli2（`pnpm lint:md` / `pnpm format`）

### Git フック

lefthook で pre-commit 時に以下を自動実行する。整形結果は `stage_fixed: true` により自動でステージし直されるので、再コミット不要。

- Biome check --write（src/build 配下）
- Prettier --write（src/articles 配下）
- markdownlint-cli2（src/articles 配下）

lint エラーがあるときだけコミットが中断される。整形だけの差分は黙って吸収される。

クローン直後は `postinstall` で `lefthook install` が走る。手動で入れ直すときは `pnpm exec lefthook install`。

### 環境変数

dotenvx 経由で `.env` を読む構成（将来的に note/Zenn の API トークンを扱うための土台）。現状は `.env` 不要なので `--ignore=MISSING_ENV_FILE` で警告を抑止している。

- `.env.keys` のみ `.gitignore`
- 暗号化済みの `.env`, `.env.production` 等はコミット可
- `dotenvx encrypt` で暗号化してから commit する

## 検証

```
pnpm build claude-code-practical
cat dist/note/claude-code-practical.md
cat dist/zenn/claude-code-practical.md
```

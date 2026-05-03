# tech-articles

note / Zenn / 自社 tech note / X Articles / Substack 向けの日本語技術記事の生原稿を single source of truth として管理し、媒体別に変換出力するリポジトリ。

## 守るべき規約

記事を書く・書き直す・レビューするときは、以下の規約を必ず読み込んで適用する。

- [.claude/rules/writing.md](./.claude/rules/writing.md) — 日本語の書き方(一人称、禁止語、漢語凝縮、カタカナ英語、Markdown 記法)
- [.claude/rules/structure.md](./.claude/rules/structure.md) — 記事の骨格(タイトル区切り、部・節構造、目次は書かない、`meta.yaml` 設計)
- [.claude/rules/build.md](./.claude/rules/build.md) — 新規記事の作り方、ビルドコマンド、媒体別後処理

フィードバックの経緯と判定軸の詳細は `~/.claude/projects/-home-yusuke-engineers-hub-ltd-in-house-project-tech-articles/memory/feedback_*.md` を参照する。

## 既存記事(構造・トーンのリファレンス)

- [src/articles/linear-as-agent-memory/index.md](./src/articles/linear-as-agent-memory/index.md)
- [src/articles/sub-agents-and-agent-teams/index.md](./src/articles/sub-agents-and-agent-teams/index.md)

## ディレクトリ構成

```
src/
├── articles/<slug>/
│   ├── index.md      生原稿(GFM、フロントマターなし)
│   ├── meta.yaml     媒体横断メタデータ
│   └── assets/       画像等
└── build/            変換スクリプト(TypeScript)

dist/                 ビルド成果物(git 管理外)
├── note/<slug>.md
├── zenn/<slug>.md
├── tech-note/<slug>.md
├── x/<slug>.md
└── substack/<slug>/*.md
```

## 自己点検

記事を書き上げたらビルド前に、`.claude/rules/writing.md` 末尾の grep チェックを必ず実行する。

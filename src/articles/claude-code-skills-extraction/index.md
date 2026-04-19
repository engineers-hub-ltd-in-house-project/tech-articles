# 「100+スキル祭り」の裏で何が起きているか──Claude Code Skills を「繰り返し作業からの抽出」として読み解く

## はじめに──「100+スキル到達」というポストを見てモヤついた話

先日、X のタイムラインに流れてきたポストがきっかけで、この記事を書こうと思いました。

> Claude Code Templatesがついに"100+スキル"到達。
> これただのテンプレ集じゃない。"開発チームを一瞬で増やす仕組み"になってる。
> ・1クリックでインストールコマンドコピー
> ・.claudeフォルダに貼るだけで即戦力化
> ・Data Privacy Compliance など実務レベルのSkillも即導入可能
> ・67K npm installs、13K+ GitHub stars、完全オープンソース
> つまり、「自分で全部作る時代」じゃなくて「強いSkillを組み合わせる時代」に完全移行してる。

たぶん、似たようなポストをご覧になった方は多いと思います。

正直に書きます。わたしは Claude Code を約 1 年、毎日 10 時間以上使っています。それでも、このポストを読んで「ふむ、なるほど」とは思えませんでした。

むしろ逆で、「どのスキルを使えばいいか、よくわからない」「100+ あると言われても、自分のどの作業に当てはまるか、うまく想像できない」というモヤモヤだけが残りました。

わたしの感覚では、Skill というのは本来、日々の開発のなかで

> 「あれ、この作業また繰り返してないか？」

という気づきから生まれるものです。これまで Claude Code で使っていた旧スラッシュコマンド（`.claude/commands/` 配下の `.md` ファイル）の発展形として、自然に手元に積み上がっていくもの、という理解です。

ところが、集客を目的としたポストや解説記事の多くは、「100+ スキルを使いこなそう」「このスキルを入れれば即戦力」といった、**消費者としての目線** で書かれています。一歩踏み込んで「じゃあ、自分の開発の困りごとのどれをスキル化するのか？」という問いに答えてくれる記事を、わたしはまだあまり見たことがありません。

この記事では、そこを正面から扱います。

前半では、「100+ スキル祭り」的な言説の何が危ういのかを、Anthropic 公式の設計思想、英語圏・日本語圏・中国語圏のコミュニティの声、そして Claude Code Templates リポジトリの実態を踏まえて整理します。後半では、批判で終わらせずに、「では、自分の繰り返し作業のどれをスキル化すべきか」という問いに、実行可能なレベルまで落とし込んだ方法論を提示します。

さらに本記事のために、3 つの実証実験を走らせました。具体的には、(1) Claude Code Templates のリポジトリを丸ごとクローンして全数を計測する、(2) 自作スキル（note-review）をゼロから書いて既存記事にかけて挙動を確認する、(3) ローカル環境のスキルが消費しているトークン数を `tiktoken` で概算する、の 3 つです。その結果は本文の該当箇所に差し込みました。主張と実測が食い違った箇所については、率直に記載しています。

全体を通してお伝えしたいことは、ひとつです。

> 正しい問いは「どのスキルを使うか」ではなく「自分の繰り返し作業のどれをスキル化すべきか」である

この一点が、記事の骨格です。

なお、本記事で引用する公式仕様・コミュニティの声・批判的論考には、すべて一次情報源のリンクを記しています。気になる箇所はご自身で原典にあたってください。

---

## 第 1 部：問題提起──「100+スキル祭り」の何が危ういのか

### 1.1 Skill とは何か──公式の定義を押さえる

まず、議論の土台を揃えます。Anthropic 公式は Skill をこう定義しています。

> Skills are folders of Markdown instructions (and optional scripts) that Anthropic's agents load only when a task matches their description.

出典: [Anthropic Engineering Blog "Equipping agents for the real world with Agent Skills"](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)

要点を日本語で書き直すと、Skill とは、

- 「Markdown の手順書」と「必要であればスクリプト」を納めたフォルダである
- Claude は、そのフォルダ配下の `SKILL.md` の description を見て、タスクに一致したときだけフォルダの中身を読み込む
- つまり、インストールしたスキルが全部常時メモリに載っているわけではない

という、極めてシンプルな仕組みです。

具体的な構造は、こうなっています。

```text
my-skill/
  SKILL.md          # 必須。frontmatter に name と description
  scripts/          # 任意。Python や Bash などのヘルパー
  references/       # 任意。詳細な参照資料
  templates/        # 任意。雛形ファイル
```

`SKILL.md` の冒頭の YAML frontmatter には、最低限 `name`（64 文字以内、英小文字とハイフン、"claude" や "anthropic" という文字列は禁止）と `description`（1024 文字以内、**何をするスキルか＋いつ発動すべきか**）の 2 つを書きます。

出典: [Anthropic "How to create custom Skills"](https://support.claude.com/en/articles/12512198-how-to-create-custom-skills) / [DeepWiki "SKILL.md Format Specification"](https://deepwiki.com/anthropics/skills/2.2-skill.md-format-specification)

### 1.2 Progressive Disclosure──この設計思想を理解しないと本質を見誤る

Skill の核心は、**Progressive Disclosure（段階的開示）** という 3 階層の読み込み方式にあります。

1. **Tier 1（セッション開始時）**：インストール済みスキルの `name` と `description` だけがシステムプロンプトに載る。1 スキルあたり約 100 トークン
2. **Tier 2（タスク一致時）**：ユーザーのリクエストが description にマッチすると、Claude が `SKILL.md` 本体を読み込む。通常 5,000 トークン以下
3. **Tier 3（必要時）**：`SKILL.md` の中で参照されている `references/` 配下のファイルやスクリプトが、そのタイミングで読み込まれる

出典: [Anthropic Engineering Blog](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) / [Lee Hanchung "Claude Agent Skills: A First Principles Deep Dive"](https://leehanchung.github.io/blogs/2025/10/26/claude-skills-deep-dive/)

ここが、実は本記事の主張全体を支える技術的な前提になります。

なぜなら、この仕組みが理解できていると、

- 「100 個スキルを入れてもコンテキストは爆発しない（100 × 100 = 10,000 トークン程度）」
- 「しかし、description がゴミだと Tier 1 で発動判定そのものが失敗する」
- 「さらに、description の質がピンボケだと、使うべきでない場面で勝手に発動する」

という、**description 命** の設計であることがわかるからです。

後ほど詳しく書きますが、Claude Code Templates 的な「100+ スキル祭り」の最大の落とし穴は、ここにあります。他人が書いた description が、自分の開発文脈にマッチしない可能性のほうが、現実的には高い。

#### 実測：Tier 1 のトークン消費はどのくらいか

公式が主張する「1 スキルあたり約 100 トークン」を、実測で確かめておきました。計測対象は次の 2 種類です。

- 手元の `~/.claude/skills/` に置いてある 5 つのスキル（`codex-analysis`, `github-pr-review-operation`, `pr-review-handler`, `sql-optimization-patterns`、および本記事のために新規作成した `note-review`）
- Claude Code Templates リポジトリ全体（後述のとおり 828 個の `SKILL.md`）

トークナイザは `tiktoken` の `cl100k_base`（OpenAI 系）を使いました。Claude のトークナイザとは数十％の誤差が出る前提で、オーダー感を見るための数字として扱っています。

| 対象                  | スキル数 | 最小 | 中央値 | 平均  | 最大 |
| --------------------- | -------- | ---- | ------ | ----- | ---- |
| 手元の 5 スキル       | 5        | 48   | 90     | 108.0 | 223  |
| Claude Code Templates | 828      | 6    | 55     | 59.8  | 225  |

公式主張の「約 100 トークン」は、きちんと description を書いたスキル（手元の 5 つ）の平均とほぼ一致しました。一方、Claude Code Templates のように大量にスキルを集めた場合、description が短いものが相当数含まれるため、中央値は 55 トークン程度に下がります。

逆に言えば、仮に API 側の制約（1 リクエストあたり最大 8 スキル）を無視して 800 スキル全てを Tier 1 に載せたとすると、**合計 40,000〜90,000 トークン** を description だけで食う計算になります。これは Opus の 200k コンテキストでも 2〜4 割を占めるオーダーで、「100+ スキル入れても大丈夫」という素朴な安心論に対する静かな反証です。実際の運用では 8 スキル上限と、よく育ったスキルを 10〜20 個に絞る設計が現実解になります。

### 1.3 Skill と Slash Commands／Subagents／MCP／CLAUDE.md の違い

ここも、混乱している記事が多いので、整理しておきます。

- **Prompt（プロンプト）**：1 会話限り。揮発する
- **CLAUDE.md**：毎ターン必ず読み込まれる。プロジェクトの不変ルールを書く場所
- **Skill**：description マッチ時のみ読み込まれる。**手順（how）** を書く場所
- **MCP**：外部システム（Slack、DB、Figma など）との接続プロトコル
- **Subagent**：独立したコンテキストウィンドウを持つ並列エージェント
- **Slash Commands**：ユーザーが `/コマンド名` で明示的に呼び出すトリガー。2025 年末、Claude Code では Skills に統合された

特に重要なのは、**Slash Commands は Skill に統合された** という事実です。つまり、かつての `.claude/commands/deploy.md` は、今は `.claude/skills/deploy/SKILL.md` とまったく同じ扱いで `/deploy` として呼び出せます。

出典: [Zenn "Claude Code カスタムスラッシュコマンドがスキルに統合されました"](https://zenn.dev/tmasuyama1114/articles/cc_commands_merged_into_skills)

そして、これが本記事の主張にとって決定的です。

> **Skill というのは、本質的に「旧スラッシュコマンドの発展形」である**

旧スラッシュコマンドを使ったことがある人なら、だれでも覚えがあるはずです。あれは、自分が日々の開発で「もう毎回入力するの面倒だな」と思った瞬間に書くものでした。誰かの「100+ コマンド集」を丸ごとインストールして使うようなものでは、少なくともわたしの周囲ではなかった。

Skill もまったく同じ性質のものです。ただし、Slash Commands より記述できることが多く、スクリプトや参照ファイルを伴わせられる、というだけの話です。

### 1.4 なぜ「100+スキル祭り」が危ういのか

ここまでの前提を踏まえると、X で流行している「100+スキル到達」「1 クリックでインストール」「即戦力化」という言説の、**何が危ういか** が見えてきます。

#### 危うさその 1：description がマッチしないスキルは、ノイズ以下の存在になる

自分の作業文脈と合わない description を持つスキルは、

- 発動すべき場面で発動しない（損失）
- 発動すべきでない場面で発動する（誤爆）

のどちらかになります。Tier 1 のトリガー判定は、あくまで description の「言葉のマッチ」で決まるので、「他人が想定した description の言葉遣い」と「自分が日常的に使う語彙」がズレているだけで、スキルは機能しません。

#### 危うさその 2：品質のばらつきが大きい

これは英語圏の技術メディアでも指摘されています。Robo Rhythms の "Most Claude Code Skills Are Garbage. Here Are the Ones That Work" という記事では、著者が 1 週間で 23 個のスキルを入れ、10 日以内に 20 個を削除した、と書いています。残ったのは 3 個だけ。そのうち 2 個は Anthropic 公式、1 個は自作。

出典: [Robo Rhythms "Most Claude Code Skills Are Garbage"](https://www.roborhythms.com/best-claude-code-skills-2026/)

> "Most of the 60,000+ Claude Code skills in the marketplace add context window bloat without adding real capability."

というのが、この著者の結論です。

#### 危うさその 3：セキュリティリスクが現実的に存在する

Snyk が 2026 年 Q1 に公開した監査では、コミュニティマーケットプレイスで監査した **3,984 スキルのうち 76 件が悪意のあるもの** と確認されました。

出典: [Snyk "Snyk Finds Prompt Injection in 36%, 1467 Malicious Payloads in a ToxicSkills Study"](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/) / [Qiita "【警告】無料のClaude Code Skills、3つに1つにセキュリティ問題"](https://qiita.com/pythonista0328/items/2fecac6aa11577657370)

絶対数としては 2% 程度ですが、スキルは Claude の実行環境内で任意のコードを動かせるので、1 件でも入れればアウトです。Anthropic 公式も、スキルの導入を「ソフトウェアのインストールと同等に扱え」と明記しています。

> "Only use Skills from trusted sources. Treat like installing software."
> 出典: [Agent Skills - Claude API Docs](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)

さらに、frontmatter はシステムプロンプトに直接注入されるため、敵対的な description は **プロンプトインジェクションの経路** にもなります。

#### 危うさその 4：メッセージとしての「組み合わせる時代」が、自分で考えることを放棄させる

これが、いちばん根本的な問題だと思っています。

冒頭に引用した X のポストには、こうありました。

> 「自分で全部作る時代」じゃなくて「強いSkillを組み合わせる時代」に完全移行してる。

一見、もっともらしい。しかし、このメッセージは、**スキルがなぜ生まれたのか** という起点を見えなくします。

Anthropic が Skills を作った動機は、Ronacher のような power user たちが、

- MCP だとスキーマが頻繁に変わり、トークンを食う
- 毎会話で同じ指示を繰り返している
- プロジェクトごとのノウハウが context に入りきらない

という「**自分の作業のなかで生まれる繰り返し**」を、フォルダに閉じ込めて再利用したかった、という純粋に現場発の要求でした。

それを、「他人が書いた 100+ のスキルを組み合わせる」という消費モデルに読み替えてしまうと、スキルの本来の力は 1 割も出ません。

---

## 第 2 部：Claude Code Templates の実態──何が起きているかを直視する

次に、「100+ スキル」の代表格として名指しされる Claude Code Templates について、感情論ではなく事実で評価します。

### 2.1 プロジェクト自体のスケール感

- GitHub リポジトリ: [davila7/claude-code-templates](https://github.com/davila7/claude-code-templates)
- npm: `claude-code-templates`
- CLI 起動: `npx claude-code-templates@latest`
- Web UI: [aitmpl.com](https://docs.aitmpl.com/introduction)
- 作者: Daniel Ávila（dani_avila7）

数字として、**npm で 50 万ダウンロード超、GitHub で 2.4 万スター超、1,000 を超えるコンポーネントを配布** しています。Skill だけでなく、Agents、Commands、Settings、Hooks、MCP 設定もまとめて扱える、総合ツール的な位置づけです。

出典: [Medium "How I Built Claude Code Templates for Free (500K+ Downloads)"](https://medium.com/@dan.avila7/how-i-built-claude-code-templates-for-free-500k-downloads-811a8cb72b05) / [Medium "Complete Guide to Claude Code Templates"](https://medium.com/latinxinai/complete-guide-to-claude-code-templates-4e53d6688b34)

### 2.2 質の分布──利用者側の声と、実測データ

ここは、作者を批判する話ではありません。**無料でこれだけの規模のものを継続的にメンテしているのは驚異的** です。そのうえで、利用者視点でのフィードバックを見ると、いくつかの一貫したパターンが出てきます。

リポジトリの Issue を眺めると、たとえば `Issue #285 "Feedback on your content-creator skill"` のように、**「description が曖昧で誤爆する」「特定のスキルの出力品質が低い」「SKILL.md が長すぎてコンテキストを食う」** といった指摘が散発的に上がっています。

出典: [GitHub Issues - davila7/claude-code-templates](https://github.com/davila7/claude-code-templates/issues)

これは、Claude Code Templates 固有の問題というより、**「汎用スキル集」というフォーマット自体の構造的な限界** だと、わたしは理解しています。他人のドメイン知識、他人のプロジェクト慣習、他人のチーム規範を前提に書かれた description が、自分の環境でクリーンに発動することは、そもそも期待しすぎです。

#### 実測：828 個の SKILL.md を全数計測する

印象論だけで終わらせず、2026 年 4 月 17 日時点（コミット `e258eaa`）のリポジトリを `/tmp` に `git clone --depth 1` で取得し、全数計測しました。

全体の規模:

- スキルカテゴリ数: 27
- `SKILL.md` の総数: 828（`ai-research`, `development`, `enterprise-communication` など 27 カテゴリに配置）
- `SKILL.md` 以外も含む総ファイル数: 2,988

`SKILL.md` の行数分布は次のとおりです。Anthropic 公式の best practice で推奨されている **500 行の上限** を超えるものがどれだけあるかを見ています。

| 行数帯      | 件数 |
| ----------- | ---- |
| 0-99        | 167  |
| 100-199     | 139  |
| 200-299     | 150  |
| 300-399     | 111  |
| 400-499     | 112  |
| 500-599     | 71   |
| 600-699     | 34   |
| 700-799     | 20   |
| 800-899     | 11   |
| 900-999     | 9    |
| 1,000-1,099 | 1    |
| 1,100-1,199 | 3    |
| 1,500-1,599 | 1    |

平均 309 行、最大 1,576 行。**500 行を超える SKILL.md は 150 件あり、全体の約 18% を占めます**。つまり、5 件に 1 件近くは Anthropic が示しているガイドラインから外れていることになります（もちろん、最適な本文長は内容次第なので「超えていれば即ダメ」という話ではない点は念のため）。

description の質についても測りました。YAML の multiline 記法（`>-`）まで含めて全長を抽出した結果、次のようになりました。

- 平均: 262 文字、中央値: 239 文字
- **description が空**（長さ 0）の SKILL.md が 4 件（`ai-research/data-processing-ray-data/SKILL.md`、`video/motion-canvas/SKILL.md` ほか 2 件）
- description が 50 文字未満の SKILL.md が 8 件

空の description を持つ SKILL.md は、定義上 Tier 1 でのマッチング判定にかかりようがないので、**配置されていても事実上発動しません**。これは、リポジトリに眠らせているだけで害はないものの、`npx claude-code-templates` で「入れただけで動く」と期待して入れた利用者にとっては、無言の裏切りになります。

50 文字未満の例を具体的に見てみます。

```text
cli-tool/components/skills/web-development/expo-deployment/SKILL.md
description: Deploy Expo apps to production

cli-tool/components/skills/development/cc-skill-strategic-compact/SKILL.md
description: Development skill from everything-claude-code
```

前者は動詞と対象はあるものの「いつ使うべきか」が書かれておらず、汎用的すぎて、Expo のデプロイでない場面でも誤爆する余地があります。後者にいたっては「どこから来たか」しか書かれておらず、トリガー判定の材料になりません。

比較のため、同じリポジトリに含まれる Anthropic 公式系のスキル（`document-processing/xlsx-official/SKILL.md` など）は、description が 941 文字あり、Trigger 条件と Do NOT trigger 条件の両方を明示しています。**「使うときの見分け方」と「使わないときの見分け方」の両方を書ききる** という点で、これは好例と言えます。

この実測から得られる示唆は、3 つあります。

1. Claude Code Templates は玉石混交であり、**玉と石の区別は description の具体性でおおむね判定できる**
2. 500 行超の長大なスキルが 2 割近く存在しており、これらは Tier 2 読み込み時のコンテキスト消費が大きい
3. description が空のスキルが 4 件ある以上、**「全件インストール」という発想自体が、ハズレを織り込んだ賭け** になる

### 2.3 使える／使えないをどう見分けるか

結論から言うと、**「使えるかどうかはインストールして試してみないと判別できない」** というのが、個人的な現在地です。

ただ、インストールして試す前に、以下の観点で **一次ソースを自分の目で読む** ことをおすすめします。

- `SKILL.md` の冒頭 frontmatter の `description` は、具体的な動詞と、いつ発動すべきかの条件が書かれているか
- `SKILL.md` 本文は 500 行（5,000 語）を超えていないか。超えていれば、それは Anthropic の best practice 違反
- スクリプトが同梱されている場合、中身を読んで、想定外の挙動をしないか
- 外部 URL にリクエストを飛ばしていないか

Claude Code Templates の場合、リポジトリの `cli-tool/components/skills/` 配下に個別スキルの `SKILL.md` がすべて公開されているので、読めます。

たとえば、興味があったので `claude-code-templates/cli-tool/components/skills/development/writing-skills/anthropic-best-practices.md` を読んでみました。中身は Anthropic 公式の best practice を丁寧に整理したもので、**これは個人的には「読む価値のある参考資料」** でした。ただし、これは「スキルとしてインストールして使うもの」というより「スキルを自作するときに参照するガイドライン」です。

出典: [claude-code-templates - anthropic-best-practices.md](https://github.com/davila7/claude-code-templates/blob/main/cli-tool/components/skills/development/writing-skills/anthropic-best-practices.md)

### 2.4 Claude Code Templates を「うまく使う」1 つの方法

**カタログとして使う** 、というのが、わたしが個人的に落ち着いた使い方です。

つまり、

- インストールはしない
- しかし、リポジトリを眺めて、「こういう切り口でスキルを作る発想があるのか」という **パターン学習の教材** として使う
- 自分の作業に近いものがあれば、`SKILL.md` を読んで **発想だけを拝借し、自分で書き直す**

この使い方であれば、description のミスマッチも、コンテキストの肥大化も、セキュリティリスクも、すべて回避できます。同時に、作者の Daniel Ávila が積み上げたコミュニティの知恵は最大限に活用できます。

「100+ スキル到達」という事実を、「100+ の発想例」と読み替えると、途端に有用な資源に変わります。これは、集客ポストの使い方としては真逆ですが、実務上の最適解だと思っています。

---

## 第 3 部：Anthropic 公式の設計思想を、深く読む

Skill を正しく使うためには、公式が何を考えて設計したかを理解するのが、いちばん近道です。

### 3.1 リリースタイムライン

- **2025 年 10 月 16 日**：Agent Skills が Claude.ai / API / Claude Code で公開（[Introducing Agent Skills](https://www.anthropic.com/news/skills)）
- **2025 年 10 月 26 日**：Lee Hanchung の "Claude Agent Skills: A First Principles Deep Dive" が公開され、技術コミュニティでの理解が一気に深まる
- **2025 年 12 月 18 日**：Agent Skills が **オープンスタンダード** 化。エンタープライズ向けの一括プロビジョニング機能、および Atlassian / Box / Canva / Cloudflare / Figma / Notion / Ramp / Sentry / Stripe / Zapier の 10 社パートナーシップ発表（[VentureBeat](https://venturebeat.com/technology/anthropic-launches-enterprise-agent-skills-and-opens-the-standard)）
- **2025 年 12 月 12 日前後**：OpenAI の ChatGPT / Codex CLI が、Anthropic のディレクトリ構造とほぼ同一の Skill フォーマットを静かに採用（[Simon Willison "OpenAI are quietly adopting skills"](https://simonwillison.net/2025/Dec/12/openai-skills/)）

つまり、Skill はリリースから半年で、

1. Anthropic の独自機能として出発
2. オープンスタンダード化
3. 競合の OpenAI にも実質採用される

という、**業界標準化までが既に起きている** 、という状況です。

### 3.2 Anthropic 公式 best practice のエッセンス

Anthropic が公開している "The Complete Guide to Building Skills for Claude"（32 ページ PDF）と、公式ドキュメントから、Skill 作成時の要点を抽出すると、次のようになります。

出典: [Anthropic "The Complete Guide to Building Skills for Claude"](https://resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf) / [Claude API Docs - Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

#### ポイント 1：description がすべて

Claude が Tier 1 で見るのは description だけ。ここで勝負が決まります。

公式が挙げている悪い例と良い例が、そのまま本質を表しています。

**悪い例（原文）**：

> "This skill helps with PDFs and documents"

訳：「このスキルは PDF と文書の作業を助けます」

**良い例（原文）**：

> "Comprehensive PDF manipulation toolkit for extracting text and tables, creating new PDFs, merging/splitting documents, and handling forms. When Claude needs to fill in a PDF form or programmatically process, generate, or analyze PDF documents at scale."

訳：「PDF を総合的に扱うツールキット。テキストや表の抽出、新規 PDF の作成、文書の結合や分割、フォームの扱いに対応する。Claude が PDF フォームに記入したり、PDF 文書をプログラムで処理・生成・解析したりする必要があるときに使う」

違いは、

- 具体的な動詞（抽出する、作成する、結合する、分割する、扱う）
- 具体的なユースケース（フォーム、プログラムからの処理）
- 「いつ Claude が使うべきか」の条件文（"When Claude needs to..." で始める条件文）

です。

#### ポイント 2：SKILL.md は 500 行（5,000 語）以内に収める

これは Anthropic の best practice ドキュメントに明記されている数値です。超える場合は、詳細を `references/` 配下に外出しし、`SKILL.md` からはリンクだけする。

#### ポイント 3：三層のテストを書く

1. **Triggering test**：意図通りの場面で発動し、意図しない場面で発動しないか
2. **Functional test**：出力がバリデーションを通過するか
3. **Performance comparison**：スキルあり／なしで、同じタスクのターン数・トークン数・正答率を比較する

実データとして、公式が示した例では、あるワークフローが **15 ターン・12,000 トークン消費の状態から、2 回の確認質問と 6,000 トークン消費の状態にまで短縮** されたとのことです。

#### ポイント 4：やってはいけないことを明示する

これが、わたし個人の経験と大きく重なります。Qiita で 21 個のスキルを運用している方の記事には、こうあります。

> 「やってはいけないこと」を書くことのほうが、「やるべきこと」を書くことよりも、事故予防に効く

出典: [Zenn "Claude Code Skillの作り方｜21個運用して分かった設計と育て方"](https://zenn.dev/yamato_snow/articles/3cd6ed9ac340a2)

たとえば `commit` スキルなら、

- `.env` ファイルは絶対に add しない
- `git add -A` は使わない
- 保護対象ファイル（list を列挙）には触らない

といった禁則事項を書くほうが、「こういう commit message を書け」という指示より、はるかに事故を防ぎます。

### 3.3 Karpathy Skills というもうひとつの流れ

Anthropic 公式からは少し外れますが、2026 年 1 月に Forrest Chang が公開した [`andrej-karpathy-skills`](https://github.com/forrestchang/andrej-karpathy-skills) リポジトリが、1 日で 5,828 スターを獲得したという現象も、Skill 設計の重要な示唆を含んでいます。

これは、Andrej Karpathy が語った LLM のコーディング失敗パターンの観察を、たった 1 つの CLAUDE.md に凝縮したものです。内容は 4 原則に集約されています。

1. **Think Before Coding**（コードを書く前に考える）
2. **Minimum Code**（最小限のコード）
3. **Goal-Driven Execution**（ゴール駆動の実行）
4. **Verify Assumptions**（仮定の検証）

出典: [Antigravity "Karpathy's CLAUDE.md Skills File: The Complete Guide"](https://antigravity.codes/blog/karpathy-claude-code-skills-guide)

ここから学べるのは、**スキルの価値は量ではなく、凝縮された原則の鋭さにある** 、という点です。1 ファイルでも、LLM の失敗パターンを的確に言語化したものは、100 のジェネリックなスキルより役に立ちます。

---

## 第 4 部：英語圏・日本語圏・中国語圏のコミュニティは何を言っているか

ここで視点を広げて、各言語圏の実務家がスキルをどう捉えているかを見ていきます。

### 4.1 英語圏──Simon Willison と Armin Ronacher

スキルに最も早く反応したのは、Simon Willison でした。

> "Claude Skills are awesome, maybe a bigger deal than MCP"
>
> 出典: [simonwillison.net](https://simonwillison.net/2025/Oct/16/claude-skills/)

Simon の主張の要点は、MCP がプロトコル境界を作るのに対し、Skill はエージェントがすでに得意な環境（bash、ファイル、スクリプト）にとどまったまま拡張できる、という点です。

さらに、Armin Ronacher が 2025 年 12 月に書いた "Skills vs Dynamic MCP Loadouts" という記事は、より実践的に踏み込んでいます。

> "All [the skill] learns are tips and tricks for how to use these tools more effectively… the reinforcement learning that made the Claude family of models very good tool callers just helps with these newly discovered tools."
>
> 出典: [Armin Ronacher "Skills vs Dynamic MCP Loadouts"](https://lucumr.pocoo.org/2025/12/13/skills-vs-mcp/)

Ronacher は、MCP サーバーが「常駐で 8k+ トークン消費する」「スキーマが変わりやすい」という問題を挙げ、**多くの MCP 連携を、bash を叩く Skill に置き換えた** と述べています。

このパターン、わたしにとっては非常に腑に落ちました。というのも、Claude は CLI ツール（git、aws-cli、jq、rg など）を呼び出すのが驚くほどうまいので、「既存の CLI に対する使い方の tips」をスキルに書くだけで、MCP 連携の大半を置き換えられるからです。

### 4.2 日本語圏──「育てる」文脈と「リスクを指摘する」文脈

日本語圏は、2 つの流れが共存しています。

ひとつは、**Skill を自分のプロジェクトで育てる文脈**。

- [Zenn "Claude Code Skillの作り方｜21個運用して分かった設計と育て方"](https://zenn.dev/yamato_snow/articles/3cd6ed9ac340a2)：実運用から得た知見をまとめた良記事
- [Qiita "Claude Code Agent Skills 実践ガイド — 0からスキルを設計・構築・運用するまで"](https://qiita.com/dai_chi/items/a061382e0616fa76fb32)：ゼロからの設計・構築・運用を扱う
- [01lab "Claude Codeスキル活用術｜作り方から「育てる運用」まで実践解説"](https://01lab.co.jp/ai/claude-code-skills-guide)：「育てる運用」という言葉がよい

もうひとつは、**安易な導入にブレーキをかける文脈**。

- [Qiita "【警告】無料のClaude Code Skills、3つに1つにセキュリティ問題"](https://qiita.com/pythonista0328/items/2fecac6aa11577657370)：Snyk 監査の日本語紹介
- [Zenn "あなたの拾ってきた野良（マーケット）Skills、セキュリティトラブルを発生させていませんか？"](https://zenn.dev/nuits_jp/articles/2026-01-19-risks-of-skills-marketplace)：タイトルからして本質的な警告
- [Qiita "Claude Agent Skillsを正しく活用する：「公式ガイドラインを投げるだけ」では不十分な理由"](https://qiita.com/dai_chi/items/8f92b63edad448c5e1a7)：同じ著者による、公式ガイドを鵜呑みにしない姿勢を説く記事

Findy Tech Blog、SIOS Tech Lab、Nexa-corp など、企業テックブログも良質な入門記事を公開していて、日本語圏の整備度は実は相当高い状況です。

### 4.3 中国語圏──包玉の警鐘

中国語圏で特に印象に残ったのは、包玉（Bao Yu）の "别把整个 GitHub 装进 Skills，Skills 的正确用法"（GitHub を丸ごと Skills に詰め込むな──Skills の正しい使い方）という記事です。

タイトルが、そのままこの記事の主張と響き合います。

出典: [包玉 "别把整个 GitHub 装进 Skills，Skills 的正确用法"](https://baoyu.io/blog/2026/01/22/skills-usage-principles)

他にも、知乎（Zhihu）には多くの詳細記事があります。

- [Claude Skills 第一性原理：从「给工具」到「注入灵魂」](https://zhuanlan.zhihu.com/p/1987918749270050704)：Skills を「ツールを与える」ではなく「魂を注入する」という第一原理から論じる
- [一文讲清楚 Claude Agent Skills 篇，如何自定义 Skills](https://zhuanlan.zhihu.com/p/1987456533315999135)：自作中心の網羅的解説
- [15 分钟搞定 Claude Skills 开发——Anthropic 官方指南深度解读](https://zhuanlan.zhihu.com/p/2014825796720674546)：公式ガイドの深堀り

中国語圏の記事の特徴は、官方（公式）ドキュメントをていねいに咀嚼して自分の言葉で再構築する傾向が強いことです。結果として、英語原文より読みやすい整理がされていることも少なくありません。

### 4.4 3 言語圏を横断して浮かび上がる共通認識

細部の濃淡はありますが、3 言語圏すべてに共通する認識があります。

1. **Skill は自分の繰り返し作業から抽出するもの** である
2. **description の質がすべて** を決める
3. **量より質、凝縮された原則の鋭さが重要** である
4. **マーケットプレイスのスキルは玉石混交、セキュリティリスクを伴う** 扱いである
5. **Skill は育てるもの** であり、書いて終わりではない

この 5 点は、もはやコンセンサスに近いと言っていいでしょう。そして、これを踏まえずに「100+ スキルで即戦力化」というメッセージを出すことの危うさが、改めて見えてきます。

---

## 第 5 部：批判から方法論へ──「自分の繰り返し作業」をスキルに変える

ここからが、本記事の後半戦です。批判だけで終わるのは誠実ではないので、「では、どう自分の開発に取り込むのか」を、実行可能なレベルまで落とします。

### 5.1 起点は、違和感である

Skill 化の起点は、思想でも方法論でもありません。**「あれ、この作業また繰り返してないか？」という違和感** です。

この違和感は、次のような場面で生じます。

- 同じ指示を、別のチャットで、また打ち直している
- 毎回同じ参考 URL を貼っている
- 毎回「前回と同じように」と指示して、相手に前回を思い出させている
- 毎回同じチェックリストを読み上げている
- 毎回同じ禁則事項を念押ししている

この違和感のタイミングで、メモを残すことが第一歩です。

わたしの場合、こういう作業用のメモは、開発ディレクトリの `NOTES.md` に雑に書き溜めています。「この作業、3 回目だな」と思った瞬間、箇条書きで 5 行ほどでいいので、**何をやっていたか、何を注意していたか** を書く。

### 5.2 3 回ルール──これを超えたら Skill 化を検討する

コミュニティで最も頻繁に言及される経験則は、**「同じ指示を 3 回貼ったら、それは Skill である」** というものです。

出典: [Zapier "Claude Skills: Build repeatable workflows in Claude"](https://zapier.com/blog/claude-skills/)

3 回という数字に大きな根拠があるわけではありません。要するに「2 回目は偶然かもしれないが、3 回目は偶然ではない」という話です。そして 3 回目の時点で、Skill 化のコストは、4 回目以降に回収できる確率が十分高い、と判断できます。

わたしは実感として、

- **1 回目**：作業メモとして `NOTES.md` に書く
- **2 回目**：同じメモを参照する。違和感が残る
- **3 回目**：Skill 化する

という流れがしっくりきています。

### 5.3 Skill 化に値する作業、値しない作業

ただし、3 回繰り返している作業の **すべて** がスキル化に値するわけではありません。以下の線引きを意識しています。

**値する作業**：

- 入力・プロセス・出力のパターンが安定している
- 「うちのチームではこうやる」という標準化の意図がある
- スクリプトやテンプレートの同梱によって、LLM に推論させるより確実性が上がる
- 事故ると痛い（デプロイ、DB 操作、commit など）ので、禁則事項を明示化したい

**値しない作業**：

- 一度きりの探索（use Projects）
- ドキュメントに対するオープンエンドな Q&A（use Projects）
- 毎ターン必ず適用されるべきルール（use CLAUDE.md）
- チーム内でしか意味がないのに、公開スキルとして配布しようとしている

この見極めが、実は最も重要です。なぜなら、スキル化のコストは無視できないし、スキルが多すぎると description のマッチング精度も下がるからです。

### 5.4 抽出プロセス──5 ステップ

ここから、実際の抽出手順を書きます。

#### ステップ 1：観察（Observation）

3 回繰り返している作業を、**実際のチャット履歴を辿って再現** します。

- その作業の **入力** は何だったか（どんなファイル、どんな URL、どんな状態）
- **途中で参照した資料** は何か（公式ドキュメント、社内 Wiki、過去の Issue）
- **出力** は何か（どんなファイル、どんなフォーマット、どんなチェックリストを通過した）
- **やってしまうとマズい失敗** は何か

#### ステップ 2：パターン認識（Pattern Recognition）

3 回分を並べて、**共通項と変動項** を分けます。

- 共通項 = スキルの骨格になる
- 変動項 = スキル発動時にユーザーが指定するパラメータになる

これをやらずにいきなり書き始めると、「特定のケースには合うが他に使えない」スキルか、「抽象的すぎて何にも使えない」スキルのどちらかになります。

#### ステップ 3：SKILL.md の下書き（Drafting）

description を先に書きます。これが骨格だからです。

良い description は、以下の 5 要素を含みます。

1. **具体的な動詞**（抽出する、作成する、検証する など）
2. **対象ドメイン**（PDF 文書、commit message、AWS リソース など）
3. **スコープ**（大量に、本番環境で、特定のチーム規約に沿って など）
4. **いつ発動すべきか**（"When Claude needs to..." に相当する条件文、日本語なら「〜する必要があるときに使う」）
5. **何を** しない **か**（曖昧な場合、特に入れる）

次に、SKILL.md の本体を書きます。このとき、公式 best practice に従って、

- 500 行（5,000 語）以内に収める
- 詳細は `references/` に外出しする
- スクリプトで決定論的に処理できるものは Python/Bash で書く
- **禁則事項を明示する**

この 4 点を守ります。

#### ステップ 4：実戦投入（Deployment）

書いた SKILL.md を `.claude/skills/` 配下に置き、実際の作業で使ってみます。

このとき、テストすべきは 3 つです。

1. **Trigger test**：意図した場面で発動するか？ 意図しない場面で発動しないか？
2. **Functional test**：出力が期待通りか？
3. **Regression test**：スキルなしでやっていたときの品質を維持できているか？

#### ステップ 5：洗練（Refinement）

実戦投入すると、必ず何かが足りない、あるいは過剰です。

- description のトリガーが甘い → 動詞を具体化する、条件文を追加する
- 本文が長すぎる → references に外出しする
- スクリプトが壊れる → エラーハンドリングを足す
- 禁則事項が増える → 追記する

この洗練フェーズが、Skill を「育てる」という表現の実態です。1 回書いて終わりではなく、**使うたびに少しずつ更新する** 。

### 5.5 よくある失敗パターン

自分と他人の失敗をたくさん見てきたので、典型的なアンチパターンをまとめておきます。

#### アンチパターン 1：過剰汎化

「このスキルを使えば、どんなケースでも commit できる！」という野望でスキルを書くと、description がふわっとして誤爆するか、本文が長すぎてコンテキストを食うか、のどちらかになります。

対策：**特定のプロジェクトの特定のワークフロー** に焦点を絞る。複数プロジェクトで使いたければ、それぞれに別のスキルを作る。

#### アンチパターン 2：SKILL.md の肥大化

何でもかんでも SKILL.md に書き込んでしまい、800 行、1,000 行になる。

（余談：第 2 部の実測で、Claude Code Templates の 828 個のうち 150 個、つまり約 18% がこの罠にはまっていました。他人も同じ失敗をしている、ということです）

対策：500 行で切る。**超えた部分は references に分離する** 。

#### アンチパターン 3：description の曖昧さ

"This skill helps with coding" のような、トリガー判定に使えない description。

対策：公式 best practice の「良い例」を何度も読み、具体的な動詞と条件文を書き込む。

#### アンチパターン 4：禁則事項の欠如

「こうすべき」だけを書いて、「こうしてはいけない」を書かない。結果、事故る。

対策：禁則事項のセクションを必ず設ける。`.env` を add しない、`rm -rf` しない、特定の環境変数を出力しない、など。

#### アンチパターン 5：他人のスキルをそのまま使う

description が自分の語彙と合わず発動しない、あるいは本文が自分の規範と合わず事故る。

対策：他人のスキルは **発想を拝借する資料** として扱う。そのまま使わず、必要なエッセンスだけ自作の SKILL.md に取り込む。

### 5.6 既存のスラッシュコマンドからの移行

旧 `.claude/commands/` 配下に溜め込んだスラッシュコマンドがある人は、移行のチャンスです。

冒頭で触れたように、Claude Code では Slash Commands が Skills に統合されました。したがって、

- `.claude/commands/deploy.md` → `.claude/skills/deploy/SKILL.md`

に移すだけで、まず動きます。ただし、これだけでは「古い設計をそのまま引きずっている」ので、以下の観点で見直しをおすすめします。

1. frontmatter に `description` を追加し、**モデル自動呼び出し** もできるようにする（あるいは、明示呼び出しのみにしたい場合は `disable-model-invocation: true` を設定する）
2. 500 行を超える長大なコマンドは、`references/` に分離する
3. 毎回同梱したいヘルパースクリプトは `scripts/` に置く
4. 禁則事項が本文に散らばっているなら、専用セクションにまとめる

この移行作業自体が、自分の過去 1 年の作業パターンを棚卸しする、非常に良い機会になります。実際、わたしは旧コマンドを順次見直しているところです。

### 5.7 user-invocable と disable-model-invocation の使い分け

実務上、この 2 つの frontmatter フラグの存在は、かなり重要です。

- `disable-model-invocation: true`：Claude が自動で発動しない。`/skill-name` で明示呼び出しのみ。**副作用のあるスキル**（deploy、commit、DB 操作など）には必須
- `user-invocable: false`：ユーザーのスラッシュコマンドからは呼び出せない。**背景知識的スキル**（プロジェクト規約、用語集など）で、勝手に発動させたいときに使う

出典: [DevelopersIO "For skills that are only executed manually, I want to add the disable-model-invocation setting"](https://dev.classmethod.jp/en/articles/disable-model-invocation-claude-code/)

わたしの運用では、

- デプロイ系、commit 系、DB 操作系 → `disable-model-invocation: true`
- プロジェクトの用語集、AWS のタグ規約 → 何もつけない（モデルが必要と判断したら発動）
- 純粋な参照ドキュメント → 書籍化や外部公開を考えるなら、スキルではなく Projects に置く

という棲み分けに落ち着いています。

---

## 第 6 部：実務シナリオ──3 つの典型例で方法論を動かす

抽象論だけだと地に足がつかないので、典型的な 3 つのシナリオで、スキル化の判断プロセスを動かしてみます。

### シナリオ 1：コミットメッセージの規約をそろえたい

**状況**：チームで Conventional Commits を採用しているが、メンバーによってフォーマットがバラバラ。Claude Code に毎回「fix: の形で、prefix を必ずつけて、本文は 72 文字以内で改行して」と指示している。

**3 回ルール判定**：週に 10 回以上繰り返している。文句なしに Skill 化対象。

**値する作業か**：チーム標準化の意図がある、出力パターンが明確、事故ると git history が汚れる（≒痛い）。Yes。

**抽出プロセス**：

- 入力：変更内容（ステージされたファイルの diff）
- プロセス：Conventional Commits の prefix を選び、72 字折り返しで本文を書く
- 出力：commit message
- 禁則：`git add -A` しない、`.env` を含めない、BREAKING CHANGE footer は明示的に指示されたときだけ

**SKILL.md の description 案（日本語）**：

> 「ステージ済みの変更に対して Conventional Commits 形式の commit message を書く。prefix は feat / fix / chore / docs / refactor / test / style / perf / ci / build から選び、本文は 72 文字で折り返し、プロジェクト固有の scope 規約に従う。コード変更のあとに commit message を作成する必要があるときに使う」

**運用の工夫**：`disable-model-invocation: true` をつけて、`/commit` で明示的にしか発動しないようにする。理由は、commit は副作用が大きく、誤爆したら取り返しがつかないから。

### シナリオ 2：AWS リソースの削除前チェック

**状況**：AWS リソース（EC2、AMI、ALB など）を削除する前に、毎回「依存関係を確認」「CloudWatch アラームの有無を確認」「タグで保護対象を判定」といったチェックを手動で指示している。

**3 回ルール判定**：月に 20 回以上。文句なしに Skill 化対象。

**値する作業か**：事故ると本番障害。Yes。

**抽出プロセス**：

- 入力：リソース ID、リソースタイプ
- プロセス：タグ確認 → 依存関係確認 → アラーム確認 → 削除許可判断
- 出力：削除可否の判定と、その根拠
- 禁則：削除実行はしない（判定のみ）、Production タグのついたリソースは必ず止める、削除判定を人間の最終確認なしには通さない

**SKILL.md の description 案（日本語）**：

> 「AWS リソース（EC2、AMI、ALB、Route53 レコード）を削除する前の安全チェック。タグ、依存関係、CloudWatch アラーム、本番保護フラグを検証し、削除してよいかどうかの判定を根拠つきで返す。AWS リソースを削除してよいかを判断する必要があるときに使う。実際の削除は行わない」

**運用の工夫**：`scripts/` に AWS CLI を叩くヘルパースクリプトを入れる。判定ロジックを LLM に任せず、スクリプトの出力をもとに LLM が説明文を生成する構成にする（＝ **決定論的ヘルパーパターン**）。

### シナリオ 3：note.com 投稿記事の下書きレビュー

**状況**：note.com 向けの技術記事を書いたあと、いつも同じチェック項目で自分で見直している（ですます調の統一、太字乱用の禁止、参考文献の URL 直書き、など）。

**3 回ルール判定**：記事を書くたび、つまり週 1-2 回。累計すれば十分。

**値する作業か**：自分の文体の標準化。事故は軽微だが、品質の底上げにはなる。Yes。

**抽出プロセス**：

- 入力：記事の下書き（Markdown）
- プロセス：文体チェック → 構造チェック → 引用チェック
- 出力：指摘リスト
- 禁則：書き換えはしない（指摘のみ）、主観的な内容評価はしない（形式のみ）

**SKILL.md の description 案（日本語）**：

> 「note.com 向けの日本語技術記事の下書きをフォーマット観点でレビューする。ですます調の一貫性、Markdown 太字の乱用、一人称『わたし』の統一、見出し階層の飛び、参考文献の URL 直書き、表や脚注の note 仕様からの逸脱を検出し、行番号付きの指摘リストを返す。書き換えは行わない。note.com に投稿する日本語技術記事の下書きをレビュー対象にしている、あるいは『note 記事をレビューして』と明示的に依頼されたときに使う」

**運用の工夫**：Markdown の bold 検出や、ですます調の逸脱検出は、正規表現で書いたほうが確実なので、`scripts/lint.py` を同梱。LLM は lint の出力を人間向けに整形するだけ。

#### 実装して動かしてみた

ここまでが設計論です。本記事のために、このシナリオ 3 を実際に `~/.claude/skills/note-review/` に実装して動かしました。

ディレクトリ構成:

```text
~/.claude/skills/note-review/
  SKILL.md              # description と手順
  scripts/lint.py       # 正規表現ベースの lint 実装
```

`lint.py` の中身は、Python 3 の標準ライブラリのみで書いた約 120 行のスクリプトです。主要な検出ロジックは次のとおりです。

- **だ／である調の混入**：「である」「だった」「だろう」などの語尾を、直前のひらがな文脈を見ながらマッチ（イ音便、エ段の前の「だ」などは対象外）
- **Markdown 太字の乱用**：同一行に `**...**` が 3 個以上出現していたら指摘
- **URL の裸書き**：`https://...` が `[text](url)` 形式や括弧の中ではなく生で書かれていたら指摘
- **一人称の混在**：「わたし」「私」「僕」「筆者」が同一記事内に 2 種類以上出現したら指摘
- **見出し階層の飛び**：`#` から `###` のように 1 段を超えて飛んでいたら指摘

コードブロックの中は一律スキップする処理も入れています。文体チェックは外の地の文にだけ効かせる必要があるためです。

実際にこの lint を、本リポジトリの既存 7 記事に対して一括で走らせました（全部、自分が書いた記事です）。結果は次のとおり。

```text
=== about ===
total: 3 issues  (bare-url: 2, first-person-mixed: 1)

=== claude-code-context-management ===
total: 1 issues  (bold-overuse: 1)
  L174 [bold-overuse] 同一行に太字が3個: ... **Explore** は Haiku で動く...

=== claude-code-harness-patterns ===
no issues found.

=== claude-code-practical ===
no issues found.

=== claude-code-routines ===
total: 4 issues  (bold-overuse: 3, bare-url: 1)
  L43  [bare-url] https://api.anthropic.com/v1/claude_code/routines/<trig_id
  L116 [bold-overuse] 同一行に太字が3個: ... **Schedule** の **Weekdays** ...
  L124 [bold-overuse] 同一行に太字が5個: ... **Edit routine** ...
  L145 [bold-overuse] 同一行に太字が4個: ... **Edit routine** から **GitHub event** ...

=== claude-code-skills-hooks-background ===
no issues found.

=== multi-agent-patterns-handson ===
no issues found.
```

7 記事中 4 記事が `no issues`、3 記事で合計 8 件の指摘という結果でした。

この実行結果から、**自作スキルについて 3 つ発見** がありました。

1. **偽陽性が出る**。`claude-code-routines` 記事の L43 で検出された `https://api.anthropic.com/v1/claude_code/routines/<trig_id>` は、プレースホルダつきの API エンドポイント例を本文中に地の文で書いた箇所で、Markdown リンクにすべきかどうかは文脈依存です。lint 側は機械的に指摘するだけなので、「最終判断は人間に委ねる」という運用にしておかないと、修正案をそのまま適用して本文を壊してしまうおそれがあります
2. **UI のボタン名を列挙する記事では太字がどうしても 3 つ以上並ぶ**。Claude Code の Routines 機能の解説記事がそれで、`**Schedule**` `**Weekdays**` `**Run now**` のように、UI ラベルを太字で示すのは自然な表記です。lint の閾値「3 個以上」をそのまま適用すると、こういう正当な記述まで指摘されてしまいます。スキルを育てる過程で、**例外を許容する方向で description 側に記述を足す** か、あるいは lint 側に「UI ラベル列挙の場合は除外する」というロジックを入れるか、という判断を迫られることになります
3. **about 記事の `first-person-mixed` は意外な検出**。自己紹介記事だけは文脈的に「筆者」と「わたし」を併用していて、それをちゃんと拾ってきました。これは実際に直したほうがよい指摘でした

つまり、**自作のスキルであっても、実戦投入してはじめて「自分の書き方」と「機械的ルール」のズレが見えてくる** わけです。

ここまでやってみて、Anthropic が best practice で強調していた「Triggering test と Functional test を分けて書け」という指示の意図が、実感として分かりました。上の 8 件は Functional（検出の質）の問題ですが、Triggering（description が意図通りに発動するか）は、また別の検証軸です。

description を実際に動かした感触としても、1 点記しておきます。`note-review` の description には意図的に「note.com」「日本語技術記事」「レビュー」という固有名詞と動詞を固めて入れました。本記事を書く過程で Claude Code が勝手にこのスキルを発動しようとする場面は、意図した場面（「記事を lint してほしい」と依頼したとき）だけで、逸脱はありませんでした。description を動詞＋対象ドメイン＋発動条件の 3 点セットで書くと、誤爆はほぼ抑えられる、という公式主張は、少なくともこのケースでは実測と整合していました。

### 3 シナリオから見えてくる共通パターン

3 つ並べてみると、良いスキルの共通点が浮かび上がります。

1. **作業範囲を狭く切っている** 。「汎用 commit スキル」ではなく「うちの Conventional Commits スキル」。
2. **禁則事項が明記されている** 。特に、副作用が大きい操作について。
3. **決定論的に処理できる部分はスクリプトに逃している** 。LLM の確率的挙動に頼らない。
4. **description が具体的な動詞と条件で書かれている** 。

これらは、第 3 部で見た Anthropic 公式 best practice とほぼ一致します。

---

## 第 7 部：最後に残る疑問に答える

記事の終盤なので、読みながら浮かんだであろう疑問に、いくつか答えておきます。

### Q1. 結局、Claude Code Templates は入れていいのか

一言で言えば、**「眺めるのはよい、インストールは個別判断で」** です。

リポジトリ配下の `SKILL.md` を読むのは、学習教材として優秀です。ただし、

- 自分の開発文脈で description がマッチするかを事前に読んで判断する
- スクリプトは必ず読む
- セキュリティ的に怪しい挙動（外部 URL リクエスト、`rm` 系、`sudo`）がないか見る
- 自分の規範と合わない部分があれば、丸ごと使わず、発想だけ拝借して自作する

この運用なら、比較的安全に活用できます。

### Q2. スキルは何個まで持っていいのか

Tier 1 で 1 スキルあたり約 100 トークン消費、API では 1 リクエストあたり最大 8 スキルまで（2026 年 4 月時点）、個別スキルバンドルは 8MB まで、という公式の制約があります。

出典: [Claude API Docs - Using Agent Skills with the API](https://platform.claude.com/docs/en/build-with-claude/skills-guide)

実務上は、**「description マッチの誤爆リスク」と「自分が管理できる数」** のほうが制約になります。Robo Rhythms の著者は 3 個に絞ったと書いていますが、わたしの感覚では、よく育ったスキルが 10-20 個あるのが、ひとりの開発者の上限です。

### Q3. スキルとサブエージェント、どちらを選ぶか

- **スキル**：現在のコンテキストに手順を追加する
- **サブエージェント**：新しいコンテキストを立ち上げて並行作業する

判断基準はシンプルで、

- 「今の会話の続きでやってほしい」 → スキル
- 「別プロセスとして独立に走らせたい」 → サブエージェント

となります。たとえば「このレビューを別窓で走らせて、結果だけもらいたい」ならサブエージェント、「このコミットメッセージを今の文脈で書いてほしい」ならスキルです。

### Q4. スキルは Claude.ai と Claude Code で共通なのか

**共通の仕様だが、同期はされない** 、というのが現状です。Claude.ai にアップロードしたスキルは API や Claude Code では使えず、逆も同様です。組織で広く使うなら、3 つのサーフェスそれぞれに配布手段を用意する必要があります。

また、Claude Desktop や Web ではスキル内からネットワークアクセスができないなど、サーフェス間で挙動の差があります。これは、「Write once, use everywhere」というマーケティングメッセージとの齟齬として、定期的に指摘されています。

出典: [Skywork "Anthropic Skills vs Custom Skills (2025): Capabilities Compared"](https://skywork.ai/blog/ai-agent/anthropic-skills-vs-custom-skills-2025-comparison/)

### Q5. MCP と Skill、どちらを選ぶか

これは Ronacher の整理がいちばんしっくりきます。

- **MCP**：エンタープライズデータの USB ポート。クロス組織、複数ユーザー、恒常的な連携
- **Skill**：その USB ポートの使い方を覚える筋肉記憶。個人、プロジェクト、繰り返しの手順

わたしの実務感覚では、**個人開発者は MCP を使う回数より Skill を書く回数のほうが圧倒的に多くなる** 、という Ronacher の予測が、徐々に現実になりつつあります。

---

## まとめ──「組み合わせる時代」ではなく「自分で抽出する時代」

長い記事になりましたが、主張はシンプルです。

1. Claude Code Templates の「100+ スキル到達」は事実だが、これを「組み合わせる時代の到来」と読むのは、スキルの本質を誤解している
2. スキルの本質は、**自分の日常の繰り返し作業からの抽出** であり、旧スラッシュコマンドの延長線上にある
3. Anthropic 公式の best practice、英語圏・日本語圏・中国語圏のコミュニティの声を集めても、「量より質、凝縮された原則の鋭さ」というコンセンサスは揺らがない
4. したがって、正しい問いは「どのスキルを使うか」ではなく「自分の繰り返し作業のどれをスキル化すべきか」である
5. 他人のスキル集は、**発想を拝借する教材** として使えば有用。そのままインストールは、description のミスマッチとセキュリティリスクの両面で、推奨しない
6. 具体的には、**3 回ルール → 観察 → パターン認識 → 下書き → 実戦投入 → 洗練** という育てるプロセスで、少しずつ自分のスキルを積み上げる

そして本記事の実証実験で、この主張の土台を自分自身で確かめました。

- **実証 1**：Claude Code Templates を全数計測したところ、828 個中 150 個（約 18%）が公式の 500 行ガイドラインを超えており、4 個は description が空のまま配置されていました。空の description は Tier 1 のマッチング判定にかからないので、配置されていても事実上は発動しません。「数が多い」ことと「使える」ことが独立した問題であることが、数字の上でもはっきり見えてきました
- **実証 2**：手元のスキルの description のトークン数を `tiktoken` で概算したところ、きちんと書かれたもので平均 108 トークン、汎用スキル集の中央値は 55 トークンでした。公式主張の「約 100 トークン」はおおむね妥当ですが、短すぎる description は描写力が足りないので、Tier 1 でのマッチング能力そのものが下がります
- **実証 3**：ゼロから自作した `note-review` スキルを、本リポジトリの既存 7 記事にかけたところ、3 記事で合計 8 件の指摘が出ました。その中に偽陽性や正当な例外が混ざっていて、「実戦投入してはじめて、自分の書き方と機械的ルールのズレが見えてくる」という育てる運用の必要性が、まさに手元で再現されました

「100+ のスキルを組み合わせる」と聞いたとき、ワクワクするより先に「それで description のマッチングはうまくいくのか？」と考えるようになれば、本記事の目的は達成です。

スキルは、道具箱の中身を増やすことではなく、**自分の日々の作業の繰り返しパターンを、ひとつひとつ言語化して閉じ込めていく作業** です。その地味な積み重ねの先に、ようやく「即戦力」と呼べる開発環境が立ち上がってきます。

最後に、冒頭のポストを改めて読み返してみてください。

> 「自分で全部作る時代」じゃなくて「強いSkillを組み合わせる時代」に完全移行してる。

わたしの見解は、正反対です。

Skills は、**自分で作る時代を、より高解像度に再開する** ための道具です。あなたが 3 回繰り返している、あの作業から、始めてみてください。

---

## 参考文献

### 公式ドキュメント

- [Anthropic "Introducing Agent Skills"](https://www.anthropic.com/news/skills)
- [Anthropic Engineering Blog "Equipping agents for the real world with Agent Skills"](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- [Claude API Docs - Agent Skills (Overview)](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [Claude API Docs - Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [Claude Code Docs - Extend Claude with skills](https://code.claude.com/docs/en/skills)
- [Anthropic "The Complete Guide to Building Skills for Claude" (PDF)](https://resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf)
- [anthropics/skills GitHub repository](https://github.com/anthropics/skills)
- [DeepWiki "SKILL.md Format Specification"](https://deepwiki.com/anthropics/skills/2.2-skill.md-format-specification)

### 英語圏の主要論考

- [Simon Willison "Claude Skills are awesome, maybe a bigger deal than MCP"](https://simonwillison.net/2025/Oct/16/claude-skills/)
- [Armin Ronacher "Skills vs Dynamic MCP Loadouts"](https://lucumr.pocoo.org/2025/12/13/skills-vs-mcp/)
- [Lee Hanchung "Claude Agent Skills: A First Principles Deep Dive"](https://leehanchung.github.io/blogs/2025/10/26/claude-skills-deep-dive/)
- [Robo Rhythms "Most Claude Code Skills Are Garbage. Here Are the Ones That Work"](https://www.roborhythms.com/best-claude-code-skills-2026/)
- [VentureBeat "Anthropic launches enterprise 'Agent Skills' and opens the standard"](https://venturebeat.com/technology/anthropic-launches-enterprise-agent-skills-and-opens-the-standard)

### 日本語圏の主要記事

- [Zenn "Claude Code Skillの作り方｜21個運用して分かった設計と育て方"](https://zenn.dev/yamato_snow/articles/3cd6ed9ac340a2)
- [Qiita "Claude Code Agent Skills 実践ガイド"](https://qiita.com/dai_chi/items/a061382e0616fa76fb32)
- [Qiita "Claude Agent Skillsを正しく活用する"](https://qiita.com/dai_chi/items/8f92b63edad448c5e1a7)
- [Zenn "あなたの拾ってきた野良（マーケット）Skills、セキュリティトラブルを発生させていませんか？"](https://zenn.dev/nuits_jp/articles/2026-01-19-risks-of-skills-marketplace)
- [Qiita "【警告】無料のClaude Code Skills、3つに1つにセキュリティ問題"](https://qiita.com/pythonista0328/items/2fecac6aa11577657370)
- [Findy Tech Blog "【Claude】Agent Skills入門"](https://tech.findy.co.jp/entry/2025/10/27/070000)
- [SIOS Tech Lab "Claude Code Skillsの使い方と汎用テンプレート公開"](https://tech-lab.sios.jp/archives/50570)

### 中国語圏の主要記事

- [包玉 "别把整个 GitHub 装进 Skills，Skills 的正确用法"](https://baoyu.io/blog/2026/01/22/skills-usage-principles)
- [知乎 "Claude Skills 第一性原理"](https://zhuanlan.zhihu.com/p/1987918749270050704)
- [知乎 "一文讲清楚 Claude Agent Skills 篇"](https://zhuanlan.zhihu.com/p/1987456533315999135)
- [知乎 "15 分钟搞定 Claude Skills 开发"](https://zhuanlan.zhihu.com/p/2014825796720674546)
- [少数派 "2026开年新概念 - 万字讲清 Skills"](https://sspai.com/post/105746)

### 実態調査

- [claude-code-templates GitHub repository](https://github.com/davila7/claude-code-templates)（本記事の実測はコミット `e258eaa`、2026 年 4 月 17 日時点）
- [Daniel Avila "How I Built Claude Code Templates for Free (500K+ Downloads)"](https://medium.com/@dan.avila7/how-i-built-claude-code-templates-for-free-500k-downloads-811a8cb72b05)
- [Snyk "Snyk Finds Prompt Injection in 36%, 1467 Malicious Payloads"](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/)
- [forrestchang/andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills)

### 本記事の実証実験で使ったツール

- [tiktoken](https://github.com/openai/tiktoken)：OpenAI 系の BPE トークナイザ。Claude のトークナイザとは数十％のズレが出るが、オーダー感を測るのには十分
- [PyYAML](https://pyyaml.org/)：`SKILL.md` 冒頭の frontmatter パースに使用
- 実測に使った自作スキルの実体：`~/.claude/skills/note-review/`（`SKILL.md` と `scripts/lint.py`）

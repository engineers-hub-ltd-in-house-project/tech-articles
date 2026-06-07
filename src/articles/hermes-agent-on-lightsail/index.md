# Claude Code に毎朝同じ指示を貼り付けるのに飽きた ── Hermes Agent を Lightsail に実際に導入してみた

## 1. なぜ Lightsail なのか

Claude Code を立ち上げて、また同じプロンプトを貼り付けます。「最新の AI/エージェント界隈の動きを調べて、上位 5 件をマークダウンで出して」。ほぼ同じ指示を、先週も先月も、書いている気がします。

1 年使い込んでいる Claude Code には大きな不満はないです。コードを書く、レビューする、リファクタする、その手のことには十分すぎる。

ただ、毎朝の情報収集を Claude Code でやり続けるのは、なんだかもったいない。Claude Code は IDE の中で動く道具で、サーバーに常駐して勝手に動くようには作られていません。

Hermes Agent という名前を見たのは、4 月の終わり頃でした。Nous Research が出している、サーバーに常駐するエージェント。GitHub のスター数は数ヶ月で 10 万を超えていて、これは普通じゃない伸び方です。

MIT ライセンス、`run_agent.py` という 1 本の Python ファイルが約 10,700 行。Telegram、Discord、Slack、メール、CLI のすべてからアクセスできる。Cron で毎朝動いて、過去のセッションを SQLite + FTS5 で全文検索できる。スキルを Markdown ファイルとして `~/.hermes/skills/` に蓄えていく。

これは Claude Code の代わりではなく、Claude Code の隣に立てるべきものでした。

なぜ Amazon Lightsail に立てるのか。理由は 3 つあります。

1. 月額固定で予算が読めるから。Hermes は cron と delegation と curator がバックグラウンドで動き続けるので、従量課金の VPS だと請求書が読めなくなります。Lightsail は $5、$7、$12、$24、$44 と階段で、転送量も込み込み。これは安心感が大きいです。

2. AWS アカウントの中で完結するから。Tailscale、SES、S3、CloudWatch との接続が後から効いてきます。Hermes は v0.11 で AWS Bedrock のネイティブサポートを入れていて、IAM ロールでモデルプロバイダを束ねる選択肢が残せる。

3. 再現性が高いから。Lightsail のスナップショットで、動いている状態をそのままコピーして別リージョンへ持っていけます。Hermes が育てたスキルとメモリは `~/.hermes/` 配下に集まっているので、スナップショットがそのままバックアップになる。

本記事は、実際に導入してみた手順と運用感の記録です。Hermes Agent を Lightsail に立てて、Claude Code と並行して毎朝のリサーチを切り出してみたら、何が `~/.hermes/skills/` に積み上がって、何が積み上がらなかったか。Markdown ファイルが何個増えたか。月額コストはどこに刻まれたか。実装の細部は公式 docs に譲るとして、設計の判断と運用の手触りに焦点を当てます。

## 2. Hermes は何を学習するのか ── 4 層の学習ループ

`run_agent.py` という 1 本のファイルがあります。約 10,700 行の Python で、Hermes Agent の中核 `AIAgent` クラスがここにいます。CLI、Telegram、cron、どこから起動しても同じ `AIAgent` が動きます。入り口が違うだけで、本体は 1 つです。

その `AIAgent` の周りに、状態を永続化する層が 4 つ積まれています。

```text
┌────────────────────────────────────────────┐
│  Entry Points (CLI / Gateway / API / ACP)  │
└──────────────────┬─────────────────────────┘
                   ▼
┌────────────────────────────────────────────┐
│           AIAgent (run_agent.py)           │
│  Prompt Builder │ Provider Resolver │ Tool │
│  Compression    │ 3 API Modes       │ Disp │
└────────┬──────────────┬────────────────────┘
         ▼              ▼
   ┌──────────┐   ┌──────────────┐
   │ Memory   │   │  Tool        │
   │ Skills   │   │  Backends    │
   │ Session  │   │  (7種)       │
   │ Curator  │   └──────────────┘
   └──────────┘
   ↑ ここが学習ループ
```

「学習ループ」という言葉は曖昧なので、4 つの層がそれぞれ何を保存しているのか、ひとつずつ見ていきます。

### 第1層：Memory（事実層）

Claude にも記憶の仕組みはあります。Claude.ai の Memories 機能は最近実装されました。Claude Code には `CLAUDE.md` というプロジェクトメモがある。Claude Projects はプロジェクト単位でファイルを抱えられる。

ただ、これらはどれも IDE か Web UI のセッションに紐づいた記憶です。サーバー側に常駐して、cron で動いて、Telegram からも触れる、という横串では使えない。Hermes の Memory はその横串の場所に置かれます。

`~/.hermes/memories/` に 2 つの Markdown ファイルが置かれます。

`MEMORY.md` はエージェント自身の環境メモです。OS、よく使うエディタ、プロジェクト構造、過去に当たった障害とその回避策、運用上の慣習。文字数の上限は 2,200 文字、トークン換算で約 800 です。

`USER.md` はユーザーのプロファイル。名前、ロール、タイムゾーン、コミュニケーション好み、嫌いな表現、技術レベル。1,375 文字、約 500 トークン。

上限はわざと小さくしてあります。Hermes はセッション開始時にこの 2 ファイルをシステムプロンプトに frozen snapshot として注入し、途中で書き換えません。

Anthropic 系の API ではプロンプトキャッシュが効くので、システムプロンプトを安定させることが直接コスト削減になる。途中で書き換えるとキャッシュが飛びます。だから書き込みはディスクに即時反映するけど、参照は次のセッションから、という割り切りです。

実際にメモリに何が貯まるか、公式 docs にある例を引きます。

```text
══════════════════════════════════════════════
MEMORY (your personal notes) [67% — 1,474/2,200 chars]
══════════════════════════════════════════════
User's project is a Rust web service at ~/code/myapi using Axum + SQLx
§
This machine runs Ubuntu 24.04, has Docker and Podman installed
§
User prefers concise responses, dislikes verbose explanations
```

`§`（セクション記号）でエントリが区切られ、ヘッダに使用率が表示される。エージェントはこれを読みながら、満杯に近いから古いものを統合しようと判断して、`memory(action="replace", old_text="…", content="…")` で書き換える。

`memory` ツールには `read` アクションがありません。読むのはシステムプロンプト経由だけ、という割り切りになっている。

書き込み前にはセキュリティスキャンが入ります。プロンプトインジェクション、認証情報窃取パターン、不可視 Unicode、SSH バックドア、これらが検出されると拒否される。memory がシステムプロンプトに直接注入されるので、悪意あるツール出力経由でシステムプロンプトが書き換わる事故を防いでいます。

`CLAUDE.md` との違いを並べてみます。`CLAUDE.md` はプロジェクトルートに置かれて、Claude Code がそのプロジェクトを開くたびに読み込む。プロジェクト固有の規約、コマンド、注意事項を書く場所です。

一方 Hermes の `MEMORY.md` はマシン全体で共有される。どのプロジェクトを触っているときも知っておくべき事実が入る場所です。粒度が違うので、棲み分けは素直にできます。Claude Code で開発するときは `CLAUDE.md`、Hermes で運用タスクを動かすときは `MEMORY.md`、という使い分けで矛盾しない。

明示的に覚えさせたいときは、CLI から直接お願いするだけで足ります。

```bash
hermes -z "Remember that I'm running Hermes on a dedicated Lightsail Ubuntu instance."
```

書き込み自体はその場で `~/.hermes/memories/MEMORY.md` に反映されますが、エージェントが参照するのは次セッションから。即時反映ではなく次回からの注入、というのが前述の frozen snapshot 設計の意味です。

ハードリミットを設けて、満杯になったら古いものを統合させる。地味ですが、これは効きます。memory が 10 万トークンに膨れ上がって毎ターン膨大なトークン代を払う、というよくある事故が起きません。

### 第2層：Skills（手順層）

メモリには事実が記録される。skills には手順と方法が入る。skills は手順をひとつのフォルダにまとめた箱です。`~/.hermes/skills/` 配下に Markdown ファイルとして置かれる。

ここで Claude Code を使っている人は引っかかるはずです。Anthropic は 2025 年 10 月に Agent Skills を発表していて、Claude Code でも同じく `~/.claude/skills/` 配下にスキルが入る。

SKILL.md の YAML frontmatter、progressive disclosure の仕組み、`name` と `description` で発動条件を書く設計、これらは Hermes と Claude Code で共通です。agentskills.io というオープン標準として整備されていて、Hermes のスキルを Claude Code に持っていける、逆もできる。スキルはそのまま使い回せます。

違いは 2 つあります。

1. Claude Code のスキルは IDE のセッション内で発動するもので、人間が `claude` を起動して指示を出した文脈で読み込まれる。Hermes のスキルは cron や Telegram からの起動でも同じように読まれます。サーバー常駐の文脈で動く。

2. Hermes には agent-created skills の自動生成機能があります。Claude Code でもユーザーが手で書くか `skill-creator` で半自動的に作るかですが、Hermes ではエージェント自身が動作中に「このワークフローはスキル化に値する」と判断して `skill_manage(action="create")` で書き出す。これがスキルが育つということの中身です。

Skills は 3 種類あります。

1. bundled skills が約 70〜90 個（v0.12 時点で 89 個）。Hermes 本体に同梱されていて、インストール時に `~/.hermes/skills/` 配下へ 24 カテゴリで展開される。

2. hub-installed skills。`hermes skills install` で公式・コミュニティのハブから追加できる。

3. agent-created skills。エージェント自身が生成し、改善する。

`skill_manage` ツールには `create / patch / edit / delete / write_file / remove_file` のアクションがあって、エージェントが複雑タスクを完了したり、行き詰まりから抜け道を見つけたり、ユーザーに修正されたりしたとき、その手順を SKILL.md として保存する。

公式 docs が明示している自動生成のトリガー条件は 4 つあります。

- 5 回以上のツール呼び出しを伴う複雑タスクを成功裏に完了したとき
- エラーや行き止まりで動く道を見つけたとき
- ユーザーがアプローチを修正したとき
- 非自明なワークフローを発見したとき

「ツール 15 回ごと」のような周期ではありません。質的な判断条件で発動する。これは Hermes の学習ループを単純な集計ではなく、文脈に依存したメタ認知として実装している、という意味で重要です。

スキルを増やしたいときの選択肢は 3 つに整理できます。手で `~/.hermes/skills/<name>/SKILL.md` を書く、ハブから取る、エージェントが自動生成するのを待つ。ハブを覗くコマンドは次のとおり。

```bash
hermes skills list                    # 既存スキル一覧
hermes skills hub                     # ハブから探す
hermes skills install <skill-name>    # 公式/コミュニティ skill 追加
```

SKILL.md のフォーマットは agentskills.io オープン標準準拠で、たとえばこういう形になります。

```markdown
---
name: ai-funding-daily-report
description: AI funding ニュースを web_search で集めて 6 bullets に圧縮するワークフロー
version: 1.0.0
metadata:
  hermes:
    tags: [research, daily, funding]
    category: research
---

# AI Funding Daily Report

## When to Use

Daily research brief for AI funding, acquisitions, IPOs over $100M.

## Procedure

1. web_search で過去 24 時間の "AI funding", "AI acquisition", "AI IPO" を検索
2. 結果のうち $100M 以上を web_extract で本文取得
3. 各案件を 2 文以内で要約、企業名・金額・出資者を必ず含める
4. 6 bullets 以内に絞り、URL は必ず付与
5. Markdown で出力、出力末尾に "Sources searched: N" を追加

## Pitfalls

- "M&A rumored" のような未確定情報は除外
- 同一案件を複数ソースが報じている場合は最も詳しいものだけ採用

## Verification

出力に最低 3 案件あるか、各案件に金額が記載されているかを確認
```

このスキルは、エージェントが書いたかもしれないし、わたしが手で書いたかもしれないし、`hermes skills install` でハブから取ったかもしれない。エージェントから見れば全部 `~/.hermes/skills/` 配下のファイルで、扱いは同じ。

スキルの読み込みは progressive disclosure で行われます。

```text
Level 0: skills_list()         → 全スキル名と説明だけ（~3K tokens）
Level 1: skill_view(name)      → SKILL.md 全文を読む
Level 2: skill_view(name, path) → references/ 配下の追加ファイル
```

毎ターン全スキルをシステムプロンプトに積むのではなく、必要になったときだけ階層的に読む。100 スキル持っていても、1 スキルあたりの初期コストは 30 トークン弱で済みます。

### 第3層：Curator（メタ管理層）

これは Claude にはない仕組みです。

Claude Code でも `~/.claude/skills/` にスキルが溜まりますが、整理は人間がやります。Hermes はそこを自動化する。

agent-created skills が増えてくると、似たようなスキルが乱立する事象が起きます。AI ニュース要約、テック系ブリーフ、研究動向まとめ、のように、目的が似ているのに少しずつ違うスキルがたまっていく。

これを片付けるのが Curator です。Hermes v0.12 系で大幅に強化された機構で、本体プロセスではない、独立したバックグラウンドエージェントとして動きます。

トリガー条件は 2 つ。前回 Curator 実行から `interval_hours`（既定 168 時間 = 7 日）以上経過。エージェントが `min_idle_hours`（既定 2 時間）以上アイドル。両方満たされたとき、`AIAgent` の fork として Curator が起動します。

フェーズは 2 段階。第 1 段階は決定的な状態遷移、LLM を呼ばない。30 日未使用のスキルは `stale` に変更、90 日未使用のスキルは `~/.hermes/skills/.archive/` へ移動する。

第 2 段階は LLM レビュー、補助モデルを使って最大 8 イテレーション、agent-created skills を `skill_view` で読んで、重複・冗長・古いものを検出し、`skill_manage` でパッチや統合をかける。

重要な制約が 4 つあります。

- bundled / hub-installed skills には触れない。Curator が触るのは agent-created のみ
- 自動削除はしない。最悪でも `.archive/` への移動。`hermes curator restore` で巻き戻せる
- `hermes curator pin <name>` で書き換え不可にできる。pin したスキルは Curator も `skill_manage` も書き換えない
- 使用統計を `~/.hermes/skills/.usage.json` に蓄積。`view_count`、`use_count`、`patch_count`、`last_used_at` などの指標で stale 判定が安定する

Curator の各実行は `~/.hermes/logs/curator/<timestamp>/REPORT.md` にレポートが書き出されます。監査用に有効。

設定はシンプル。

```yaml
curator:
  enabled: true
  interval_hours: 168
  min_idle_hours: 2
  stale_after_days: 30
  archive_after_days: 90
  auxiliary:
    provider: openrouter
    model: google/gemini-3-flash-preview
```

メイン LLM ではなく Gemini Flash クラスの安価モデルで Curator を動かせるのが助かる。月額コストへの影響を最小化できます。

ひとつ正直に書いておくと、Curator の最初のサイクルは 7 日です。本記事は導入直後の観測なので、Curator はまだ一度も走らない。スキルが整理されるところまでは、本記事では見届けられません。これは 7 日目以降の宿題として残ります。

### 第4層：Session DB（過去ログ層）

Claude.ai は過去の会話を一覧から探せるけど、全文検索ではない。Claude Code は `--resume` で直前のセッションを再開できるけど、複数セッションをまたいで「2 週間前にこの API のレートリミットの話したよね？」と検索する仕組みはない。

Hermes は SQLite + FTS5 で全部持ちます。`~/.hermes/state.db` に全セッションが蓄積され、`session_search` ツールで全文検索できる。

Memory が小さい理由のもう半分はここにあります。Memory は最重要な事実だけをシステムプロンプトに貼り、それ以外の過去会話は SQLite + FTS5 で全文検索可能な形で蓄積する、という分担です。

`session_search` ツールで、エージェントは過去のセッションを検索できる。「2 週間前にこの API のレートリミットの話したよね？」「先月の Q3 ブリーフでカバーしたトピックは？」のようなクエリに、SQLite FTS5 で高速にヒットさせ、Gemini Flash クラスの補助モデルが要約してエージェント本体に返す、という構造です。

セッションには lineage tracking がついています。コンテキスト圧縮が起きたときに子セッションが生成され、どのセッションから派生したかを DB が追える。圧縮された過去会話のサマリと、その元の生会話の両方にアクセスできる。

### 4 層をまとめる

| 層         | 何を保存           | サイズ上限             | 書き込み主体                      | 読まれ方                                   | Claude 側の対応                    |
| ---------- | ------------------ | ---------------------- | --------------------------------- | ------------------------------------------ | ---------------------------------- |
| Memory     | 重要な事実         | 約 1,300 トークン      | memory ツール                     | frozen snapshot としてシステムプロンプトに | Claude.ai Memories / CLAUDE.md     |
| Skills     | 手順と方法         | スキル 20Kchar、無制限 | skill_manage、手書き、hub install | progressive disclosure で必要時            | Claude Code Agent Skills           |
| Curator    | スキルの統計と整理 | usage.json             | バックグラウンドエージェント      | スキル整理時の判断材料                     | （対応なし）                       |
| Session DB | 全会話履歴         | 無制限（SQLite）       | 全セッション自動保存              | session_search で全文検索                  | Claude.ai 履歴一覧（全文検索なし） |

Memory が小さいからシステムプロンプトが膨らまない。Skills が無制限だからノウハウは溜め放題。Curator が片付けるからスキルライブラリが古びても残らない。Session DB があるからメモリにない過去も拾える。

それぞれの層が役割を分担して、お互いを補い合うように設計されています。「使うほど賢くなる」という言葉は、こうやって分解すると、雰囲気ではなく構造の話だと分かる。

Claude Code を使い続けてきた人にとって、Hermes は競合ではなく拡張です。Skills という共通の仕組みが両者をつないでいて、片方で書いたスキルをもう片方に持ち出せる。Memory と Curator は Hermes 側にしかないので、サーバー常駐で動かす場面だけ Hermes に流す、という棲み分けが素直にできる。

次の章では、この基盤を Lightsail という具体的な土地に下ろしていきます。

## 3. Lightsail の選定

Lightsail の管理画面を開くと、プラン一覧が階段状に並んでいます。$5、$7、$12、$24、$44、$84、$164。この階段を上から下まで眺めて、Hermes をどこに置くか、しばらく考えました。

最初の感触で言えば、$5 か $7 で済めばそれが一番です。月の固定費は安いに越したことはない。

ただ、Hermes は gateway daemon が systemd で常駐し、Telegram と Discord と Slack を同時に捌き、cron が朝 8 時に発火し、delegation で子セッションが並列で走り、curator が 7 日に 1 度バックグラウンドで動く。これを 0.5GB RAM に押し込むのは、ちょっと無理があります。

価格表を写しておきます。Linux/Unix Bundle、public IPv4 つき、2026 年 5 月時点。

| 価格 | RAM   | vCPU | SSD   | 月転送 |
| ---- | ----- | ---- | ----- | ------ |
| $5   | 0.5GB | 2    | 20GB  | 1TB    |
| $7   | 1GB   | 2    | 40GB  | 2TB    |
| $12  | 2GB   | 2    | 60GB  | 3TB    |
| $24  | 4GB   | 2    | 80GB  | 4TB    |
| $44  | 8GB   | 2    | 160GB | 5TB    |
| $84  | 16GB  | 4    | 320GB | 6TB    |
| $164 | 32GB  | 8    | 640GB | 7TB    |

vCPU は $84 まで上がらないと 2 のままで、RAM だけが倍々で増えていく構造です。Hermes はマルチコアで殴る処理ではなく、I/O と LLM 呼び出しの待ち時間で支配される設計なので、vCPU 2 でも詰まるところは少ない。RAM が効きます。

Memory-Optimized プランも別系統で並んでいます。RAM を多く積みたいけど SSD はそこまで要らない、というケース向け。$74 / 16GB / 2 vCPU / 160GB SSD、$144 / 32GB / 4 vCPU / 320GB SSD の 2 段。Memory provider を self-host する場合に視野に入ります。

IPv6-only Linux プランは IPv4 を捨てる代わりに約 30% 安くなります。$3.5 / 0.5GB から $40 / 8GB まで同じ階段。IPv4 inbound を必要としないなら検討に入りますが、Hermes は IPv6-only でも CLI / cron / Telegram は問題なし。一方で外部から webhook を受ける構成では IPv6 経路が読めないことがあるので、最初は IPv4 つきから入る方が無難です。

### どのプランを選ぶか

公式 docs と他の運用ストーリーを照らし合わせて、3 つの線引きで考えました。

CLI からだけ叩く、cron も最低限、配信は Telegram のみ。これなら $7 / 1GB で動きます。free tier も 3 ヶ月使えるので、検証はゼロ円で始められる。

gateway daemon に Telegram と Discord と Slack を全部 1 つで捌かせて、cron で daily brief を回す。新規で立てるならここは $24 / 4GB を選ぶのが落としどころです。

Docker terminal backend を有効にして、エージェントが書いたコードをコンテナに隔離する。Memory provider を self-host する。Honcho のような外部サービスを足す。ここまで来ると $44 / 8GB を選んだ方が後悔がない。

本記事の実機は $24 / 4GB / Ubuntu 24.04 LTS を選びました。配信は Telegram と Discord、cron で 1 日 2 本（朝のリサーチと夜の振り返り）、Docker は当面入れない。これで gateway daemon と並列の delegation を回しても、メモリは半分以上余ります。

足りなくなれば $44 / 8GB にスケールアップすればいい。$24 のスナップショットを取って $44 で復元するのは数分で済みます。これが Lightsail を選ぶ理由のひとつでもありました。

### スナップショットの経済

スナップショットは GB あたり月 $0.05 です。80GB SSD のインスタンスを 7 日 retention で回すと、累計 100GB に達することがある。月 5 ドル。見落とすと地味に効いてきます。

retention を 3 日に絞って、週次のフルバックアップは別途 S3 に投げる運用にすると 1〜2 ドルで収まります。Hermes が学習した `~/.hermes/` 配下の Markdown と SQLite だけ S3 に rsync する手もある（具体的なコマンドは 9 章で書きます）。

スナップショットはマシンごと固める用途、S3 はファイル単位で過去に戻したいとき用、と棲み分けるのが現実的です。

### Lightsail で見落としやすい所

3 つあります。

1. static IP の orphan 課金。インスタンスから外して放置すると 1 時間後から $0.005/h が発生し、月額換算で $3.60 になる。インスタンスを作り直したときに古い IP を破棄し忘れて、翌月の請求を見て気づくパターンです。

2. AWS Organizations 配下では free tier が 1 アカウントだけ。本番アカウントで使い切っていると、検証用アカウントで free tier が拾えない。事前に確認しておかないと、ゼロ円検証の前提が崩れます。

3. Asia Pacific のうち Mumbai、Sydney、Jakarta は data transfer allowance が半分に削られるリージョン。東京（ap-northeast-1）と大阪（ap-northeast-3）は通常通り 4TB です。Hermes 自体は数 GB / 月程度しか使わないので超過する場面は稀ですが、Obsidian Vault を Syncthing で複数デバイスへ同期する構成にすると、バックグラウンドの転送量がじわじわ積み上がっていきます。

リージョンの選定は、転送量よりレイテンシで決めて構いません。日本国内で運用するなら ap-northeast-1（東京）。Anthropic API のエンドポイントが us 寄りなのでレイテンシは多少乗りますが、Hermes は LLM 呼び出し自体が律速なので、ネットワークのオーバーヘッドは体感に乗りません。

これで、Lightsail のプランを選び、スナップショットの予算を見積もり、気をつけたい所を把握できました。次の章からは、Ubuntu 24.04 LTS の実機で、Hermes を systemd user service として常駐させ、cron を雛形登録し、トークンとクレジットを揃えて疎通確認するまでを、コマンド単位で追っていきます。

ここから先は、実機で叩いた手順、`config.yaml` の編集箇所、systemd unit の細かい調整、cron の運用と引っかかった所、コストの積み上げ方、セキュリティ運用とバックアップ、導入時に当たった既知バグの一覧を順に書いていきます。

<!-- paywall -->

## 4. インストールと systemd 化

ここからは、実機で叩いた順にコマンドを並べていきます。前提環境を整理しておくと、こうなります。

- インスタンス: Lightsail Ubuntu 24.04 LTS, $24 / 4GB RAM / 2 vCPU / 80GB SSD
- ユーザー: `ubuntu`（Lightsail Ubuntu イメージの既定）
- 入れる Hermes: v0.12.0（2026 年 4 月 30 日リリース）

`/home/ubuntu/.hermes/` の中で完結させます。

### Ubuntu 24.04 の下ごしらえ

Ubuntu 24.04 の Python 3.12 は PEP 668 で apt と pip の混在を拒否します。pipx と venv を先に入れて、Python のグローバル汚染を避けます。

```bash
sudo apt update
sudo apt install -y python3-venv pipx git curl
pipx ensurepath
source ~/.bashrc

# SSH 切断後も systemd --user を維持する
sudo loginctl enable-linger ubuntu
```

`pipx` を入れる理由は前提パッケージのためで、Hermes 本体は後段で uv (Astral) が venv ごと整えてくれます。

`loginctl enable-linger ubuntu` を打っておかないと、`ubuntu` ユーザーで動かしている systemd user service が SSH を切った瞬間に止まる。Lightsail は SSH を切ってもインスタンス自体は動き続けるので、systemd user service だけ取り残されると気付きにくい。`linger` を立てておくと、セッションに紐づかずに走り続けてくれます。

### install.sh は curl で取って、目視確認してから叩く

`curl ... | bash` で一発インストールする手順がドキュメントに書いてありますが、本番で動かす以上、何が走るか中身を読んでから叩きたい。

```bash
curl -fsSL -o /tmp/hermes-install.sh \
  https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh

# 中身を読む（main() の流れ、sudo を打つ箇所、書き込み先パスを確認）
less /tmp/hermes-install.sh

bash /tmp/hermes-install.sh --skip-setup
```

`--skip-setup` を付けたのは、ウィザードを別途叩きたかったから。スクリプトの main() を読むと、内部で次のことをやっています。

- OS 判別 (ubuntu と認識)
- uv (Astral 製パッケージマネージャ) を `~/.local/bin/uv` に導入
- Python / Node / Git の前提確認
- ripgrep と ffmpeg を sudo apt 経由でインストール
- `https://github.com/NousResearch/hermes-agent.git` を `~/.hermes/hermes-agent/` にクローン
- uv で `~/.hermes/hermes-agent/venv` を作成、Python 依存をインストール
- npm 依存をインストール
- `~/.local/bin/hermes` シムを作成
- `~/.hermes/config.yaml` と `~/.hermes/.env` を生成
- 89 個の bundled skills を `~/.hermes/skills/` 配下に展開（24 カテゴリ）

完了後の確認。

```bash
which hermes                  # /home/ubuntu/.local/bin/hermes
hermes --version              # Hermes Agent v0.12.0
ls ~/.hermes/skills | wc -l   # 89
```

### .env は chmod 600 にする（インストール直後は 0644）

ここで気付いた点を 1 つ。生成された `~/.hermes/.env` のパーミッションは初期状態 `0644` でした。OPENROUTER_API_KEY や TELEGRAM_BOT_TOKEN を平文で持つファイルが 0644 のままなのは避けたい。

```bash
chmod 600 ~/.hermes/.env
ls -la ~/.hermes/.env
# -rw------- 1 ubuntu ubuntu 19679 .env
```

`~/.hermes/` 自体は 0700 で生成されるので攻撃対象は限られますが、明示で 600 にしておくのが事故防止になります。

### config.yaml の調整：3 箇所だけ

インストール直後の `~/.hermes/config.yaml` を見て、本番運用前に直したいのは 3 箇所でした。

1. `model.provider` が `auto` になっている。`auto` のまま動かすと、credentials 検出ロジックが、AWS インスタンス上では IMDS / IAM Role を見て Bedrock を優先候補にする。`hermes status` の Provider 表示が AWS Bedrock になり、OpenRouter のキーが読まれません。明示で `openrouter` 固定にしておきます。

2. `model.default` がインストール直後は `anthropic/claude-opus-4.6` になっています。これを Sonnet 4 に下げます。Opus は Sonnet の約 5 倍のコストで、daily brief 用途には過剰。コスト戦略は 8 章で詳しく書きますが、ここで踏むかどうかが月額の桁を変えます。

3. `delegation` セクションを書き起こす。subagent は cheap モデル（Gemini Flash）に振るのが定石なので、最初から書いておきます。

差分を当てる前に必ずバックアップを取ります。1 文字打ち間違えたら戻せる安心感が要ります。

```bash
cp ~/.hermes/config.yaml ~/.hermes/config.yaml.before-setup
```

編集後の差分。

```yaml
model:
  provider: "openrouter" # auto → 明示固定
  default: "anthropic/claude-sonnet-4" # opus-4.6 → sonnet-4

delegation:
  max_iterations: 50
  max_concurrent_children: 3
  max_spawn_depth: 1
  model: "google/gemini-3-flash-preview"
  provider: "openrouter"
```

### .env に OBSIDIAN_VAULT_PATH と Discord スタブを足す

Obsidian skill を後で使うので、Vault パスを追記します。Discord は今すぐ立てないけれど、後で開く予定なのでスタブをコメントアウトで置いておきます。

```env
# Obsidian Vault Path
OBSIDIAN_VAULT_PATH=/home/ubuntu/Obsidian

# Discord Bot (まだ未設定)
# DISCORD_BOT_TOKEN=
# DISCORD_ALLOWED_USERS=
# DISCORD_HOME_CHANNEL=
# DISCORD_FREE_RESPONSE_CHANNELS=
```

```bash
mkdir -p ~/Obsidian/inbox
```

### systemd --user で gateway 常駐化

`hermes gateway install --system` で system-wide の unit を入れる手もありますが、`ubuntu` ユーザーで完結させるなら user mode が素直です。

```bash
hermes gateway install
```

これで `/home/ubuntu/.config/systemd/user/hermes-gateway.service` が生成され、`default.target.wants/` 配下にシンボリックリンクが張られます。`systemctl --user is-enabled hermes-gateway` で `enabled` を確認。

```bash
systemctl --user daemon-reload
systemctl --user start hermes-gateway
systemctl --user is-active hermes-gateway   # active
```

$24 / 4GB の素のインスタンスでは MemoryMax のような細かい上限は不要です。Hermes は通常 100MB 前後しか使わず、delegation で並列が走っても 4GB を埋めることはありません。気になるなら `MemoryMax=2G` を `[Service]` に追記しておけば、想定外の暴走時の保険になります。

Ubuntu 24.04 の systemd は 255 で、`hermes gateway install` が生成する unit の記述子（`RestartMaxDelaySec` や `RestartSteps`）はすべて認識されます。古い Ubuntu 22.04（systemd 249）や Debian 12（systemd 252）では unknown key の警告が出ますが、無視して構わない挙動です。

### 起動ログでの確認

```bash
journalctl --user -u hermes-gateway -n 30 --no-pager
```

期待する出力。

```text
Started hermes-gateway.service
WARNING gateway.run: No user allowlists configured.
WARNING gateway.run: No messaging platforms enabled.
Memory: 105.9M (high: 1.1G max: 1.4G available: 1.0G)
```

警告 2 つは Telegram / Discord トークンが未投入なので想定どおり。次の章でトークンを入れたら消えます。`Memory:` の行で 105.9M 使用、4GB のインスタンスメモリのうち消費は 3% 程度。delegation や cron の並列が走っても、ここから大きく増えることはありません。

### LLM 疎通確認の 1 行と、HTTP 402 という洗礼

OpenRouter の API key を `~/.hermes/.env` に投入したら、最初の疎通確認をします。ここで 1 つ知っておくべき作法があります。

`hermes` コマンドのトップレベル引数は `chat / status / cron / gateway / ...` のような subcommand として解釈されます。`hermes "ping"` のようにフリーフォームで投げると、`invalid choice: 'ping'` と弾かれる。プロンプトを 1 発で投げたいときは `-z` フラグです。

```bash
hermes -z "Reply with just the word: pong"
```

ここで初回はほぼ確実に `HTTP 402` が返ってきます。

```text
API call failed after 3 retries: HTTP 402:
This request requires more credits, or fewer max_tokens.
You requested up to 128000 tokens, but can only afford 1600.
```

OpenRouter の無料枠は 1 日 1,600 token。Sonnet も Opus も 128K context window を要求するので、確保できずに弾かれます。$5 以上のクレジット入金が事実上の前提です。入金後に再試行すると `pong` が返ってきます。

```bash
hermes -z "Reply with just the word: pong"
# → pong
```

これで gateway が常駐し、LLM 疎通も確認できました。次の章では cron を載せて、毎朝のリサーチを回します。

## 5. Cron 設計

Hermes の cron は、よくある「シェルから crontab を編集する」とは違う形をしています。`cronjob` という 1 つのツールを通して、`create / list / update / pause / resume / run / remove` のアクションを叩く。スケジューラ自体は gateway daemon が 60 秒ごとに tick する内部 ticker です。`~/.hermes/cron/.tick.lock` で多重実行を防いでいます。

これが意味するのは、gateway を落としていると cron は 1 ミリも動かない、ということです。CLI から `hermes` を叩いただけのセッションでは tick しない。systemd で gateway を立てるのが、cron 運用の前提になっています。

### Fresh session という制約

Cron job が発火すると、ゼロから始まる新しいセッションが立ち上がります。会話履歴ゼロ、prompt と attached skills だけが文脈です。

これを掴んでいないと、Cron の prompt 設計でハマります。「いつもの daily brief を出して」と書いても、cron からは「いつも」が何だったか参照する手段がない。`MEMORY.md` と `USER.md` は frozen snapshot として注入されるけど、過去のセッションの内容はそこには入らない。

cron prompt は self-contained に書く。手順、入力、出力先、判断基準、すべて prompt 本文に書く。スキルとして抽出できる手順は `--skill` で添付して、prompt 本文は依頼内容に絞る。これが基本姿勢になります。

ついでに、cron 内で cron を作成することはできません。`cronjob` ツール自体が cron セッションでは無効化されているので、エージェントが暴走して再帰的に cron を増殖させる事故は構造として起きない。これは安心材料です。

### Schedule 形式

cron の schedule 文字列にはいくつかの書き方が許されます。

- 相対時刻: `30m`、`2h`、`1d`
- 間隔: `every 30m`、`every 2h`
- 標準 cron expression: `0 9 * * *`
- ISO 形式: `2026-03-15T09:00:00`

注意点が 1 つあって、自然言語の `daily at 9am` のような書き方には対応していません。日本語 docs にもサンプルが出てきますが、これは `0 9 * * *` を使ってください。

### 配信先の指定

`--deliver` フラグで配信先を選びます。設定可能なターゲットは、原文 docs の表現で並べると次のようになります。

`origin / local / telegram / discord / slack / whatsapp / signal / matrix / mattermost / email / sms / homeassistant / dingtalk / feishu / wecom / weixin / bluebubbles / qqbot / webhook`

複数指定できる。`telegram:-100xxxx:thread_id` のような形で、Telegram のスーパーグループのスレッド指定もできる。`platform:chat_id` の文法は全プラットフォーム共通です。

### 重要な制御フラグ

cron 運用で頻繁に使う制御フラグを並べておきます。

- `[SILENT]` プレフィックス: prompt の頭に書くと、配信を抑制する。`local` には残る。「何も新しいことがなければ通知不要」というケースで使う
- `cron.wrap_response: false`: 通常 cron 出力には「Cronjob Response: …」というヘッダが付く。これを無効化する
- `--skill <name>`: スキル添付。複数指定可、順序保持。スキル単位で発動条件と手順を切り出す
- `--script <path>`: Python スクリプトを実行し、stdout を prompt に inject する。timeout 既定 120 秒
- スクリプト末尾で `{"wakeAgent": false}` を出力すると、LLM 起動をスキップ。データ収集だけしたいときに使える
- `--context-from <job_name>`: 他ジョブの最新成功出力を inject する。DAG 風の組み合わせができる
- `--enabled-toolsets web,file,skills`: ジョブ単位で toolset を縮小する。コスト削減のレバーとして強い
- inactivity timeout: 600 秒（環境変数 `HERMES_CRON_TIMEOUT`、0 で無制限）

### Daily Brief 用の cron テンプレ

実際にわたしが朝のリサーチに使っている cron はこういう形です。

```bash
hermes cron create "0 8 * * 1-5" \
"あなたはわたしの朝のリサーチアシスタントです。以下の手順で動いてください：

1. web_search で過去 24h のキーワード（AI agents, open-source LLM, tool-calling）の上位 5 件を取得
2. 各記事を web_extract で本文取得
3. 結論を 6 bullets 以内、各 2 文以内に圧縮、URL 必須
4. \$HOME/Obsidian/inbox/\$(date +%Y-%m-%d).md に保存
5. 最終応答をマークダウンで返す

何も見つからなければ [SILENT]。" \
--name "daily-research-brief" \
--deliver telegram
```

ポイントは 4 つ。`--enabled-toolsets` で web/file/skills だけに絞ってツール棚を縮める。`--skill` で必要分だけ添付して prompt 本文を短くする。`[SILENT]` で空ヒット日の通知を抑える。`--name` を付けて後で `hermes cron list` から identify できるようにする。

### 雛形は paused で登録、トークンが揃ってから resume

最初に登録するときは、まだ Telegram トークンも入れていないし、本当に意図したとおりの出力をするか不安です。`hermes cron create` には `--paused` フラグがありません。create したらすぐ動き出すので、別コマンドで pause します。

```bash
hermes cron create "0 8 * * 1-5" "<prompt>" \
  --name daily-research-brief --deliver telegram

# ID は create 時の出力か list で確認
hermes cron list --all
# baee76bcb812 [active]  daily-research-brief

hermes cron pause baee76bcb812
```

`hermes cron pause daily-research-brief` のように name で叩くと、`Job with ID 'daily-research-brief' not found` で蹴られます。pause / resume / remove はすべて job ID 限定です。

`hermes cron list` の既定動作も注意点で、active なジョブしか出しません。paused を含めて全部見たいときは `--all` を付けます。

```bash
hermes cron list           # active のみ
hermes cron list --all     # paused 含めて全部
```

### 手動で 1 回だけ動かす

新しい cron を登録して動作確認したいけど、毎朝 8 時まで待ちたくない、という場面が頻繁にあります。`hermes cron run <id>` で次の tick（最大 60 秒）で 1 回だけ手動実行できます。

```bash
hermes cron run baee76bcb812

# 出力先を確認
ls ~/.hermes/cron/output/
ls ~/Obsidian/inbox/
```

paused 状態のジョブでも `run` は効きます。動作確認して、出力先が想定どおりだったら、`hermes cron resume <id>` で paused を外して本番化、という流れが安全です。

```bash
hermes cron resume baee76bcb812
hermes cron list                 # active で daily-research-brief が並ぶ
```

### Cron で気をつけたい所

立ち上げ作業で引っかかりかけた所を 3 つ。

1. gateway を再起動すると、in-flight の cron job が中断される。`hermes cron list` で `pending` 状態のジョブを確認してから restart した方が安全です。

2. prompt-injection scan が cron 作成・更新時に走ります。invisible Unicode、SSH バックドア、明示的 exfiltration を検出するとブロックされる。これ自体は良い挙動ですが、prompt 本文に外部から取ってきた文字列を貼ると、思わぬところで蹴られることがある。長文 prompt はテキストエディタで作って `--prompt-file` で渡す方がトラブルが少ない。

3. fallback chain が credential 解決前のエラーに対しては発火しないバグ（GitHub Issue #7230、#17929、#15914 で議論中）。OpenRouter で 401 が返ったとき、想定では Anthropic 直叩きへ fallback するはずが、credential 取得段階のエラーは別経路を通るので fallback chain にすら到達しない。primary provider の credential はテストしてから本番投入すべきです。

これで cron が回るようになりました。次は配信先を 6 つ並べて、それぞれの設定差を見ていきます。

## 6. 配信先を 6 つ並べてみる

Hermes の配信先は、文字どおり 20 種類以上あります。docs に並んでいる名前を写すと、`telegram / discord / slack / whatsapp / signal / matrix / mattermost / email / sms / homeassistant / dingtalk / feishu / wecom / weixin / bluebubbles / qqbot / webhook` といった具合。

このうち、Lightsail に立てて日本国内の個人運用で現実的に使うのは Telegram、Discord、Slack、Email、Notion（スキル経由）、Obsidian（スキル + Syncthing）の 6 つに絞られます。WhatsApp や WeChat は対応プラットフォームこそあるけれど、ビジネス API の取得や中華圏の認証が前提になるので、ここでは触れません。

### 6 つを並べて見比べる

| Platform         | 双方向                | Bot トークン取得                          | レート制限       | サブスク           | Lightsail Inbound   |
| ---------------- | --------------------- | ----------------------------------------- | ---------------- | ------------------ | ------------------- |
| Telegram         | 可                    | 低（BotFather 30 秒）                     | 緩（30/sec）     | 無料               | 不要（long-poll）   |
| Discord          | 可                    | 中（Dev Portal + Intents + invite URL）   | 中               | 無料               | 不要（WebSocket）   |
| Slack            | 可                    | 高（Workspace Admin + scopes + manifest） | 厳（1/sec/chan） | Free OK / Pro 推奨 | 不要（Socket Mode） |
| Email            | 片方向（送信）        | SMTP 任意                                 | プロバイダ依存   | 任意               | 不要（outbound）    |
| Notion (skill)   | 片方向（書き込み）    | API token                                 | 公開 3 req/sec   | 無料               | 不要                |
| Obsidian (skill) | 片方向（FS 書き出し） | 不要                                      | 制限なし         | 不要               | 不要                |

注目したい欄は「Lightsail Inbound」です。6 つすべて、Lightsail の Firewall に inbound port を開ける必要がない。Telegram は long-poll、Discord と Slack は WebSocket / Socket Mode、Email / Notion / Obsidian は outbound 書き込みなので、サーバー側は外向き通信だけで済みます。

これは Lightsail に立てる構成として大きい意味を持ちます。inbound を閉じたまま運用できるなら、Cloudflare Tunnel やリバースプロキシをかます必要がない。攻撃面が限りなく狭く保てる。

### Lightsail 最小構成のおすすめ

今回の構成では、Telegram + Discord + Obsidian skill + Email outbound の 4 段に絞りました。

- Telegram: 即時配信、スマホで受け取る、即返信できる
- Discord: チャンネル分けて種類別に流す（朝のリサーチ、夜の振り返り、エラー通知）
- Obsidian: ローカル Vault に Markdown を蓄積、Syncthing で手元の PC とスマホへ同期
- Email: 重要な通知だけ outbound、SES 経由

Notion も最初に検討しましたが、Obsidian Vault と二重管理になりそうだったので、導入時点では入れていません。Hermes の `session_search` で Obsidian Vault の中身も grep できるので、出力の置き場は 1 本に絞った方が運用が楽だろう、という判断です。

Slack は職場用に別途立てる構想がありますが、Workspace Admin の権限と manifest 提出が必要で、個人 Lightsail 運用の最小構成からは外れます。

### Telegram のセットアップ

3 つの環境変数を `~/.hermes/.env` に書きます。

```env
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_ALLOWED_USERS=123456789
TELEGRAM_HOME_CHANNEL=123456789
```

`TELEGRAM_BOT_TOKEN` は BotFather に話しかけて `/newbot` から取れる。bot 名と username を決めると token が返ってきます。`TELEGRAM_ALLOWED_USERS` は自分の Telegram user ID で、`@userinfobot` に話しかけると教えてくれる。`TELEGRAM_HOME_CHANNEL` は cron の既定配信先になります。

`ALLOWED_USERS` を空にすると誰からのメッセージにも応答してしまうので、必ず指定する。これを忘れると、bot 名が漏れた瞬間に他人から API key を間接的に消費されるリスクがあります。

`.env` を編集したら gateway を再起動して反映します。

```bash
systemctl --user restart hermes-gateway
journalctl --user -u hermes-gateway -n 30 --no-pager
```

`Telegram bot started` のような行が出れば認識成功。Telegram で bot に `/start` か任意の文を送って応答が返ってくれば疎通完了です。

### Discord のセットアップ

```env
DISCORD_BOT_TOKEN=...
DISCORD_ALLOWED_USERS=987654321
DISCORD_HOME_CHANNEL=...
DISCORD_FREE_RESPONSE_CHANNELS=...
```

Discord は Telegram より一手間多い。手順を順に置きます。

1. [https://discord.com/developers/applications](https://discord.com/developers/applications) で New Application
2. 左メニュー Bot → Add Bot → Token をコピー
3. 同画面で Privileged Gateway Intents の Message Content Intent を ON
4. OAuth2 → URL Generator で scope に `bot` を選び、permissions で「Send Messages」「Read Message History」等を選択 → 生成された URL でサーバー招待
5. 自分の Discord user ID は Discord の開発者モード ON にして自分を右クリック → ユーザー ID をコピー
6. 配信先チャンネル ID も同様に右クリック → チャンネル ID をコピー
7. 上記 4 つの環境変数に値を入れて gateway 再起動

`DISCORD_FREE_RESPONSE_CHANNELS` に指定したチャンネルでは、bot は @mention されなくても全メッセージに応答します。`DISCORD_HOME_CHANNEL` は cron の既定配信先。bot のメンションのデフォルト動作では `@everyone / @here / @role` の ping は自動でブロックされます。

### Slack のセットアップ

Slack は Socket Mode で立てます。これが Lightsail 運用に効く理由は、外部公開 URL が不要だから。Slack 側から Lightsail のインスタンスに WebSocket を張ってきてくれるので、Lightsail Firewall は閉じたまま運用できる。

```env
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_ALLOWED_USERS=U01ABC...
SLACK_HOME_CHANNEL=...
```

`SLACK_APP_TOKEN` は Socket Mode 用の app-level token で、`connections:write` スコープが必要。bot scopes は `chat:write, channels:history, groups:history, im:history, app_mentions:read, files:read` を最低限揃えます。

App manifest を YAML で書いて Slack の Web UI に貼る方が、scopes と event subscriptions の漏れが減って楽です。`hermes` の docs に manifest テンプレが載っています。

### Notion / Obsidian / Email

Notion はスキル経由なので、`NOTION_API_TOKEN` と `NOTION_DATABASE_ID` を `~/.hermes/.env` に追加して、`bundled` の `notion` skill を有効化するだけで動きます。

Obsidian も同様で、`OBSIDIAN_VAULT_PATH=/home/ubuntu/Obsidian` を指定し、`obsidian` skill を有効化。Lightsail 上の `~/Obsidian/` を Syncthing で手元の PC とスマホに同期すれば、サーバーで動いた cron の出力がそのまま手元の Obsidian で開けます。

Email は SMTP 設定だけ。SES、Brevo、Mailgun などが選べます。SMTP_HOST、SMTP_PORT、SMTP_USER、SMTP_PASS、SMTP_FROM を入れて、`email` skill から送る。

これで朝のリサーチが、Telegram に即時、Discord にチャンネル分け、Obsidian に Markdown ファイル、必要なら Email に展開、という形で配られていきます。

### 検索ツールを後から足す

`hermes status` で `not set` と出ているツール系 API は、必要に応じて追加できます。代表的なものを並べます。

- Firecrawl: `FIRECRAWL_API_KEY=` — 高品質な web extract
- Tavily: `TAVILY_API_KEY=` — 検索特化、LLM フレンドリー
- Exa: `EXA_API_KEY=` — semantic search
- Browserbase / Browser Use: `BROWSERBASE_API_KEY=` / `BROWSER_USE_API_KEY=` — ブラウザ自動化が要るとき

OpenRouter の web_search が動かないモデルや、専用 search API を使いたい場合に追加します。最初は OpenRouter の標準 web_search だけで様子を見て、品質が物足りなくなった時点で足す、で十分です。

## 7. Delegation で並列化する

cron で daily brief を回すなら、最初は単一プロセスで十分です。3 トピック程度なら順番に web_search → web_extract → 要約で完結します。

トピック数を増やしたり、各トピックに複数ソースを当てたくなったときに、`delegate_task` で並列化を入れる選択肢が出てきます。その仕組みを書きます。

### Delegation の設定

`~/.hermes/config.yaml` に書く。

```yaml
delegation:
  max_iterations: 50
  max_concurrent_children: 3
  max_spawn_depth: 1
  orchestrator_enabled: true
```

各パラメータの意味は次のとおり。

- `max_iterations`: 子セッション 1 つあたりの最大ターン数
- `max_concurrent_children`: 同時実行する子の上限。ThreadPoolExecutor で並列化される
- `max_spawn_depth`: 親 → 子 → 孫の段数。1 で flat、2 や 3 で orchestrator パターンが解禁
- `orchestrator_enabled`: spawn_depth > 1 のときに orchestrator role を有効化

### role: leaf と orchestrator

Hermes の delegation には role が 2 つあります。

- `leaf`: 既定。`delegate_task` ツールが無効化されている。これ以上の子は作れない
- `orchestrator`: spawn_depth > 1 のときに使える。`delegate_task` だけは復活する

leaf からブロックされるツールは `delegate_task / clarify / memory / send_message / execute_code` の 5 つ。これは「子セッションは tool 実行に専念し、親に報告だけ返す」という設計を強制する仕組みです。

orchestrator は中間管理職のようなもので、自分はツールを叩かず、孫に分配して結果を集約する役回り。3 段以上の組織図が必要なときだけ持ち出します。

### 27 子に膨らむケース

`max_spawn_depth: 3` と `max_concurrent_children: 3` を素朴に組み合わせると、最大で 3 × 3 × 3 = 27 子セッションが同時に走る計算になる。LLM 課金が一気に膨らむのはここです。

実際には親 turn 内でブロックされる同期実行なので、コンテキストとレートリミットでも詰まる。けれど API 課金は走った分だけ加算されるので、見えないところで請求書が育つ。

無難な落としどころは、`max_spawn_depth: 1`（flat）で `max_concurrent_children: 3〜5`。orchestrator パターンを使いたくなる場面は、6 トピック以上を扱う日次レポートくらい。それ未満なら flat で十分です。

### Daily Brief の並列化スイートスポット

3〜5 トピックを並列で web_search するなら、`max_concurrent_children: 3`（既定）のままで十分。3 トピックなら全部同時、5 トピックなら 3 + 2 で 2 回戦になる。

6 トピック以上で、各トピックに 2 つのソースを当てたい、というケースで orchestrator が活きます。orchestrator が 6 子を分配し、各子（leaf）が 2 つの web_search を順次実行する形。spawn_depth は 2 で足ります。

各 orchestrator child に異なる `delegation.model` を渡せる仕組みもあります。研究記事の収集は cheap モデル（Gemini Flash）、論文要約は expensive モデル（Sonnet）、と使い分けると、コストと品質のバランスが取りやすい。

### subagent default toolset を縮める

GitHub Issue #11431 で議論されている劣化問題があります。多周回 subagent で oversized toolsets が文脈を圧迫し、blocking shutdown と重い session persistence で全体が遅くなる、というもの。

軽減策は明快で、leaf には toolset を絞って渡す。研究タスクなら `terminal/file/web` だけで十分。`memory` も `delegate_task` も leaf には不要なので、明示的に外しておく。

```yaml
delegation:
  provider: openrouter
  model: google/gemini-3-flash-preview
  max_concurrent_children: 5
  enabled_toolsets:
    - web
    - file
```

これで親と子で別モデル、子は web/file だけ、という構成になる。月の API 課金が見えやすくなります。

## 8. コスト戦略

立ち上げ段階での実消費は、疎通確認の `hermes -z "ping"` を数回叩いた程度で、LLM 課金は 1 ドル未満。Lightsail $24 のインスタンス代と OpenRouter のクレジット最低入金 $5 が固定費です。本番運用に乗せる前にコスト構造を整理しておきます。

その上で、設定次第で月 $400 まで膨らむ構成も簡単に組めます。コストレバーをどこに置けばいいか、運用観点で書きます。

### インストール直後に踏みやすい所

`hermes setup` 直後の `model.default` は、Hermes v0.12.x では `anthropic/claude-opus-4.6` が入ります。これを変えずに cron を回し始めると、daily brief 1 回が Sonnet の約 5 倍のコストになる。これが「月 $400 シナリオ」の入り口です。`config.yaml` の最初の編集で Sonnet 4 か Sonnet 4.6 に下げる、これが最初に効くレバーです。

OpenRouter 側の前提も書いておきます。OpenRouter のキーには無料枠で 1 日 1,600 token の上限があります。Sonnet も Opus も 128K context window を要求するので、最初の `hermes -z "ping"` が HTTP 402 (`requires more credits`) で落ちる。$5 以上のクレジット入金が事実上の前提です。

### 月次コスト見積

代表的な 4 構成。

| 構成                                               | Lightsail | LLM(月) | Tools          | 合計目安 |
| -------------------------------------------------- | --------- | ------- | -------------- | -------- |
| ミニマル: $7 + OpenRouter (gemini-flash) only      | $7        | ~$10    | Firecrawl free | $17–25   |
| 標準: $24 / Anthropic Sonnet via API + Firecrawl   | $24       | $40–80  | $0             | $70–110  |
| Pro: $44 / Nous Portal subscription + Tool Gateway | $44       | $20     | inc.           | $65      |
| 初期設定のままだと月 $400 になる構成               | $44       | $300+   | $30            | $370+    |

最後の行が「踏むつもりはなかったけど踏んだ」典型です。default delegation model が Anthropic Opus、auxiliary（compression / vision / web_extract / approval）も全部 Opus、cron も verbose に毎日 5〜6 トピックを Opus で処理、しかも `[SILENT]` を使わず空ヒット日も毎回応答を生成、という構成。何も触らないと、こうなる潜在性があります。

### 削減レバーは 6 つ

設計段階で効きそうな順に並べます。

1. `enabled_toolsets` で cron toolset を縮める。これが最大のレバーで、不要な toolset を消すだけで token 消費が 30〜50% 減ります。`web,file,skills` あたりに絞れば、ほとんどの daily brief は十分動く。

2. `delegation.model` を cheap モデル（Gemini Flash）に切り替える。親 LLM と子 LLM を分けると、並列実行が膨らんでもコストが抑えられる。

3. `auxiliary.*` の補助モデルを安価モデルへ。compression、vision、approval、web_extract のそれぞれに別 provider/model を指定できます。Sonnet で Opus 級の品質を出さなくて良い場面では、軽量モデルに振る。

4. `[SILENT]` プレフィックスを多用する。「何も新しいことがなければ無音」を貫くだけで、無駄なターンが減る。`{"wakeAgent": false}` をスクリプト末尾に置いて、データ収集だけのターンで LLM を叩かないようにするのも同じ系列。

5. Nous Portal subscription に乗せる。Tool Gateway の web/image/TTS/browser が含まれて、月 $20 で済む構成も組める。Anthropic API 直叩きだと web_search 1 回でも token を食うので、tool 部分を別プランに寄せる選択肢があります。

6. prompt caching を効かせる。Anthropic は 5 分既定キャッシュ、1 時間 opt-in。同じシステムプロンプトで何回も叩く cron は、cache hit 率が高いほどコストが下がる。`MEMORY.md` を頻繁に書き換えないのは、ここで効きます。

### コスト追跡

`hermes insights` で過去 N 日の token 消費とコスト推定が確認できます。OpenRouter のダッシュボード（[https://openrouter.ai/activity](https://openrouter.ai/activity)）と突き合わせる、というのが日次の確認です。

```bash
hermes insights --days 7    # 直近 7 日のトークン消費
hermes logs --days 1        # 直近 1 日のセッションログ
```

cron が想定外のターン数を回していないか、auxiliary モデルが想定どおりの安価モデルで動いているか、を週次で見るだけで月額の伸びは抑えられます。

### config.yaml の推奨ベース

実際にわたしが今回した設定がこれです。

```yaml
model:
  provider: openrouter
  default: anthropic/claude-sonnet-4

fallback_providers:
  - provider: openrouter
    model: google/gemini-3-flash-preview

delegation:
  model: google/gemini-3-flash-preview
  provider: openrouter
  max_concurrent_children: 4
  max_spawn_depth: 1

auxiliary:
  vision: { provider: openrouter, model: openai/gpt-4o-mini }
  web_extract: { provider: openrouter, model: google/gemini-3-flash-preview, timeout: 360 }
  approval: { provider: openrouter, model: google/gemini-3-flash-preview, timeout: 30 }
  compression: { provider: openrouter, model: google/gemini-3-flash-preview, timeout: 120 }

approvals:
  mode: smart
  timeout: 60

terminal:
  backend: docker
  docker_image: nikolaik/python-nodejs:python3.11-nodejs20
  docker_forward_env: []
  container_cpu: 1
  container_memory: 5120
  container_persistent: true

cron:
  wrap_response: false
  script_timeout_seconds: 300

memory:
  memory_enabled: true
  user_profile_enabled: true
  memory_char_limit: 2200
  user_char_limit: 1375

display:
  runtime_metadata_footer: false
```

メインを Sonnet、delegation と auxiliary を Gemini Flash、Docker 隔離 on、approvals は smart mode。この構成で daily brief を平日 1 本回した試算で、月 $80 前後を想定しています。実際の数字は運用が回ってから別記事にまとめる予定です。

## 9. セキュリティ運用

Hermes のセキュリティは、approvals と Tirith の 2 段で組まれています。Lightsail 単体運用なら、これに加えて SSH と Tailscale の 2 段で攻撃面を絞ります。

### Approvals: 3 modes と YOLO

`approvals.mode` には 3 つあります。`manual` は全ツールで毎回確認、`smart` は危険操作だけ確認、`off` は確認なし。timeout は既定 60 秒、fail-closed（タイムアウトしたらブロック）。

`hermes --yolo` を起動時に渡すか、セッション内で `/yolo` を叩くか、`HERMES_YOLO_MODE=true` 環境変数を立てると、approvals がすべてスキップされます。これは検証セッション以外では使わない方が良い。

ただし YOLO でも素通りしないコマンド群があります。UNRECOVERABLE_BLOCKLIST と呼ばれる集合で、フォークボム、ブロックデバイスへの直接書き込み、root ファイルシステム全削除、これらは YOLO 下でも必ずブロックされる。最後の砦です。

承認の選択肢は 4 つ。`once`（このターンだけ）、`session`（このセッション中ずっと許可）、`always`（永続化、`~/.hermes/approvals.json` に保存）、`deny`（拒否）。`session` を多用すると 1 セッションで疲れにくい。

container backend を有効化すると、Docker や gVisor の中で実行されるシェルコマンドは approvals がスキップされます。Docker そのものが信頼境界とみなされる扱い。`terminal.backend: docker` を入れている前提で、container_persistent: true にして 1 つの container を使い回す形が、cron 運用には合う。

### Tirith: 二次スキャナ

approvals の手前に、Tirith という静的スキャナを挟む選択肢があります。`tirith_enabled: true`、`tirith_path: /usr/local/bin/tirith`、`tirith_timeout: 30`、`tirith_fail_open: false`。

`fail_open: false` がポイントで、Tirith が起動しない、応答しない、といった状況ではコマンドをブロックする方向に倒します。fail_open: true だと、スキャナが死んだ瞬間に普段ブロックされていたコマンドが通り抜ける。production では fail_open: false が安全側です。

### Lightsail での攻撃面縮小

立ち上げ時に固めた防御の組み合わせは次のとおり。

- SSH パスワード認証は無効化、key 認証だけ。`/etc/ssh/sshd_config` の `PasswordAuthentication no`、`PubkeyAuthentication yes`
- Tailscale を入れて、SSH の inbound を tailnet 限定にする。`tailscale up` の後、Lightsail Firewall の SSH を `100.0.0.0/8` 相当に絞れば、外部からの 22 ポートが事実上閉じる
- Webhook を受ける必要が出てきたら、Cloudflare Tunnel か Caddy + TLS で `:8644` を保護し、`X-Hub-Signature-256` を必ず検証。素の port 開放はしない
- systemd unit に `ProtectSystem=strict`、`PrivateTmp=true`、`NoNewPrivileges=true` を入れる
- `~/.hermes/.env` は `chmod 600`。Bot トークン、API key、SMTP 認証情報を平文で持つので、ここの扱いは特に注意

### バックアップ

運用が回り始めると、`~/.hermes/` 配下にバックアップしたいファイル群が見えてきます。

- `.env`: API key と bot トークン（最重要、漏らせない）
- `config.yaml`: 設定（編集前後を取っておく）
- `memories/MEMORY.md` `memories/USER.md`: 育てたメモリ
- `skills/`: 89 個の bundled + agent-created skills
- `cron/jobs.json`: cron 定義
- `sessions/state.db`: SQLite 全セッション履歴

これを 1 ファイルに固めて S3 に投げるのが、わたしの日次バックアップです。

```bash
tar czf ~/hermes-backup-$(date +%F).tar.gz \
  ~/.hermes/.env \
  ~/.hermes/config.yaml \
  ~/.hermes/memories/ \
  ~/.hermes/skills/ \
  ~/.hermes/cron/jobs.json \
  ~/.hermes/sessions/

aws s3 cp ~/hermes-backup-$(date +%F).tar.gz \
  s3://my-hermes-backups/ --storage-class STANDARD_IA
```

cron で日次に動かすか、AWS Backup の Lightsail スナップショットと組み合わせるかは、復旧粒度の好みです。スナップショットはマシンごと固める用途、tar + S3 はファイル単位で過去に戻したいとき用、と棲み分けます。

### リカバリと初期化

`config.yaml` を編集して動かなくなったら、4 章で取ったバックアップに戻します。

```bash
cp ~/.hermes/config.yaml.before-setup ~/.hermes/config.yaml
systemctl --user restart hermes-gateway
```

`.env` を編集して反映されないときも、gateway を再起動するだけで済みます。

```bash
systemctl --user restart hermes-gateway
```

残らず消したいときは `hermes uninstall` か、手動で次の 2 行。

```bash
systemctl --user disable --now hermes-gateway
rm -rf ~/.hermes ~/.config/systemd/user/hermes-gateway.service
```

`~/.hermes/` 以外には触らないので、Lightsail インスタンス自体の他の部分には影響しません。

### production 推奨セット

最小限の安全構成として、次の 4 つを揃えれば事故は減ります。

- `terminal.backend: docker`、`terminal.docker_forward_env: []`（環境変数の漏出を防ぐ）
- `approvals.mode: smart`（危険操作だけ確認、daily brief くらいの一般タスクは止まらない）
- `tirith_enabled: true`、`tirith_fail_open: false`
- Tailscale + SSH key only、Lightsail Firewall は SSH を tailnet 限定、それ以外閉じる

立ち上げ確認の範囲では、不審なログは出ていません。`journalctl --user -u hermes-gateway -p warning` を朝の cron に組み込んでおけば、warning 以上が出たら通知が飛ぶ仕掛けにできます。

## 10. 既知バグと回避

導入作業の中で踏んだ、または事前に把握した既知 issue を並べます。GitHub の Issue 番号を付けます。

- Issue #5200: `SOUL.md` は cwd を見ず `HERMES_HOME` のみ参照する。`AGENTS.md` も再帰展開しない。gateway / messaging の cwd は home に強制される。プロジェクト固有の `AGENTS.md` を期待していると振る舞いが噛み合わない
- Issue #13301: Setup wizard が `use_gateway: true` を読まず「not configured」と表示する UX バグ。runtime は正しく動くので機能上の問題はないが、setup を 2 回叩く事故につながる
- Issue #7230: primary OAuth 401 で `fallback_model` が credential 解決前に発火しないバグ。OpenRouter の API key を間違えて入れると、Anthropic 直叩きへの fallback が走らないまま落ちる
- Issue #17929: 単一キー pool で 429 cooldown が発生すると、init-time RuntimeError を返し、fallback chain にすら到達しない。pool に 2 キー以上入れておくのが回避策
- Issue #11431: 多周回 subagent で oversized toolsets / blocking shutdown / 重い session persistence による劣化。7 章で触れた `enabled_toolsets` の縮小が緩和策

cron の制約と docs 表現の差も 1 つ書いておきます。docs のサンプルに「daily at 9am」のような自然言語サンプルが混ざっていますが、これは未対応。`0 9 * * *` の cron expression を書く。これで GitHub Issues に 3 件くらい同じ内容が立っている。

### 導入作業で実際に当たった挙動

GitHub Issue にまだ立てていないが、運用中に当たった点を書き残します。Lightsail Ubuntu 24.04 LTS 環境で観測したものです。

- インストール直後の `~/.hermes/.env` のパーミッションが `0644` で生成される。手動で `chmod 600` を打つ必要がある（`~/.hermes/` 自体は 0700 なので攻撃面は限定的だが、明示で 600 にすべき）
- `hermes "ping"` のように直接プロンプトを渡そうとすると `invalid choice: 'ping'` で蹴られる。トップ引数は subcommand 解釈なので、フリーフォームを投げるときは `hermes -z "ping"` で渡す
- `hermes cron create` に `--paused` フラグはない。最初から停止状態にしたいときは create → pause の 2 段階
- `hermes cron pause/resume` は job ID のみ受け付ける。`--name` 引数で叩くと `Job with ID '<name>' not found` で蹴られる
- `hermes cron list` は paused ジョブを表示しない。`hermes cron list --all` を使う
- `hermes setup --non-interactive` は「TTY が無いので wizard 実行不可」と返す。`HERMES_*` 環境変数か `hermes config set` で代替
- `model.provider: auto` は AWS インスタンス上で IMDS / IAM Role を見て Bedrock を優先候補にする。OpenRouter のキーが読まれず、`hermes status` の Provider 表示が AWS Bedrock になる。明示で `openrouter` 等に固定する方が安全
- systemd 254 未満（Ubuntu 22.04 の systemd 249 など）では、`hermes gateway install` が出す unit に含まれる `RestartMaxDelaySec` と `RestartSteps` が unknown key として警告ログに出る。Ubuntu 24.04 の systemd 255 では出ない
- OpenRouter の無料枠は 1 日 1,600 token のみ。Sonnet/Opus の 128K context window が確保できないので、最初のクエリが HTTP 402 で落ちる。$5 以上の入金が事実上の前提
- Telegram bot が応答しないときは、`TELEGRAM_ALLOWED_USERS` が空になっていないか、gateway が再起動されているかをまず確認。空だと「全員拒否」がデフォルト挙動

### バージョン差を 3 つ

最近のリリースで動きが変わった所も置いておきます。

- v0.10: Tool Gateway が公式化、Daytona の terminal backend が追加された
- v0.11: Ink ベースの TUI、Bedrock transport ネイティブ対応、Vercel Sandbox の terminal backend、shell hooks、redaction の既定が OFF に変更、cold start −57%
- v0.12 系: Curator と memory review pass の改善（議論段階、書き換えが続いている）

今回入れたのは v0.12.0 です。Curator は前述のとおり 7 日サイクルなので、立ち上げ直後には動きません。memory review pass の挙動と合わせて、運用が回り始めてからの観測は別記事で追う予定です。

### 立ち上げ時の教訓を 6 つ

立ち上げで踏み固めた、次回以降の自分への伝言。

- install.sh は `curl | bash` しない、目視確認してから実行する。60KB のスクリプトで何が走るかは、本番インスタンスで動かす前に読む
- provider は明示的に固定する。`auto` は環境依存で挙動が変わる、特に AWS 上では Bedrock を拾いにいく
- OpenRouter は最初に少額入金しておく。無料枠の 1,600 token/day では実用にならない
- systemd は `--user` で立てる。`--system` を使う場面は限定的で、ユーザー HOME に閉じる構成のほうが権限と起動順を読みやすい
- `MemoryMax` は素のインスタンスでは不要だが、他のサービスを載せる予定があるなら早めに入れておく方が事故が減る
- cron の操作は ID ベース。name でハマる前に `list --all` を癖にする

## 11. 結び

立ち上げ段階で確認できたことを並べます。

- Hermes v0.12.0 を Lightsail Ubuntu 24.04 LTS の素のインスタンスに、systemd user service として立ち上げられた
- 4GB のメモリのうち、gateway 起動直後は 100MB 前後の消費にとどまる
- 89 個の bundled skills が `~/.hermes/skills/` に展開済み、24 カテゴリで揃っている
- cron は paused で雛形登録、トークンが揃ってから resume する手順が組めた
- OpenRouter のキーで Sonnet 4 + Gemini Flash 振り分けの構成が動き、`hermes -z "ping"` で疎通成功

立ち上げ段階では確認できなかったこと。これらは運用が回り始めてからの宿題として残ります。

- agent-created skill が実際にどんなペースで生えるか
- Curator のサイクルは 7 日で、まだ走っていない。スキル整理が実際に効くかは 7 日目以降
- 長期運用でのスキルの古び方。30 日 stale、90 日 archive のしきい値が運用に合っているかは 1 ヶ月後にしか分からない
- 月次コスト。$80 前後の試算だが、prompt caching の cache hit 率が安定するのは 2 週間ほどかかる
- 5〜10 トピックに増やしたときの delegation の挙動と速度

本記事は、Lightsail に Hermes を立て終えるまでの手触りに焦点を当てました。実運用の数字や挙動は、ここからの観察で別記事にまとめる予定です。

Hermes は Claude Code の競合ではなく拡張です。Skills 仕様が共通なので、片方で書いた手順をもう片方に持ち出せる。Claude Code は IDE の中で人間が呼び出して使う、Hermes はサーバーに常駐して cron や Telegram から動く。同じスキルを別の入り口から呼ぶ、という使い分けで素直に並びます。

Lightsail は予算の読みやすさと AWS 統合と再現性で、Hermes 常駐先として適しています。$24 / 4GB の Ubuntu 24.04 LTS を素のまま使えば、gateway daemon と cron と delegation の枠は十分。スナップショットでマシンごとバックアップ、tar + S3 でファイル単位の差分復旧、両方残せます。

導入はここまで。7 日目以降の Curator サイクル、1 ヶ月運用後のコストとスキル整理の実績は、続編で書く予定です。土台は `~/.hermes/` に Markdown と SQLite として積み上がり始めた、というところまで来ています。

## 参考・関連リンク

- [Hermes Agent (NousResearch/hermes-agent)](https://github.com/NousResearch/hermes-agent)
- [Amazon Lightsail Pricing](https://aws.amazon.com/lightsail/pricing/)
- [agentskills.io](https://agentskills.io)
- [Claude Code Agent Skills](https://docs.anthropic.com/en/docs/claude-code/skills)
- [OpenRouter Models](https://openrouter.ai/models)
- [Tailscale](https://tailscale.com/)
- [Syncthing](https://syncthing.net/)

# Claude Code Routines 実装ノート

この記事でわかること

- routines が Claude Code の既存機能（CLI・Web・Actions）とどう違うのか
- スケジュール・API・GitHub の三種トリガーに固有の落とし穴
- 「自分名義で無人に動く」自動化をどう狭く括るか

## はじめに

Claude Code に routines が入ったのは 2026 年 4 月 14 日のことです。この記事を書いているのは翌日で、一晩置いて公式ドキュメントと発表記事、The Register の批評を並べ直してから、設計で迷いそうな箇所を書き起こしました。網羅的なリファレンスは `code.claude.com/docs/en/routines` にすでにあるので、ここでは「読む順」と「実装するときに詰まる箇所」を絞って補います。

routines を一行で説明すると、プロンプトとリポジトリとコネクターを一組にまとめて、Anthropic が管理するクラウドで自動起動させる仕掛けです。実行の場はあなたのノート PC ではなく、Claude Code on the web の後ろにある共有インフラです。だから PC の電源を落としても動きます。しかし動くということは、誰かの権限で動くということでもあります。その「誰か」はあなた自身です。

この一点が腑に落ちると、routines の設計勘所の半分は通ります。残り半分はトリガーごとの仕様差で、そこに読み違えが集中します。以下、構成要素から順に辿っていきます。

## 第1章　構成要素と実行モデル

最初にこの章を置くのは、routines を「強化された cron」として読み進めるとスコープ設計を間違えやすいからです。

routine は五つの要素で決まります。プロンプト、リポジトリ、環境、コネクター、そしてトリガーです。プロンプトは毎回実行される自然言語の指示、リポジトリは clone 対象、環境はネットワーク設定と環境変数と setup script のセット、コネクターは MCP 経由で触れる外部サービス、トリガーは起動条件です。この五つはそれぞれ独立したスコープを持ち、routine が「できること」の外枠を決めます。

実行時のいちばん重要な挙動は、permission プロンプトが出ないことです。対話セッションなら `Allow?` で止まるシェル実行や書き込みが、routine では一切止まりません。公式ドキュメントの表現を引けば "routines run autonomously as full Claude Code cloud sessions: there is no permission-mode picker and no approval prompts during a run" です。skills も connectors も shell も、事前に与えられた範囲で黙って叩かれます。

もう一つ見落としやすい仕様があります。routines は個人の claude.ai アカウントに紐づくので、チームメンバーと共有できません。そしてコミットや PR はあなたの GitHub ユーザー名義で、Slack 投稿はあなたの Slack 連携で、Linear のチケットはあなたの Linear 連携で行われます。ドキュメントにも "Anything a routine does through your connected GitHub identity or connectors appears as you" と明記されています。つまり routine が間違えたとき、最初に疑われるのもあなたです。

この章の気づきはここにあります。routines は「強化された cron」ではなく「あなた自身のセッションを無人で再生する装置」だと思って読み進めると、後の章の権限設計がまっすぐ入ってきます。

## 第2章　三種トリガーの挙動仕様

この章を置くのは、トリガーごとに制約が違い、型をまたぐとはまるからです。ここは公式ドキュメントを一度読んだ人にも読み直してほしい部分です。

### 2-1　Schedule

スケジュールトリガーのプリセットは hourly / daily / weekdays / weekly の四つです。時刻はローカルタイムで入力し、壁時計に追随します。カスタム cron 式を使いたいときは、Web フォームで近いプリセットを選んで routine を保存したあと、CLI で `/schedule update` を叩いて書き換えます。ただし **最短間隔は 1 時間** で、それより細かい式は拒否されます。毎分や毎 5 分で何かを監視したい用途は routine では無理で、別の仕組みに寄せる必要があります。

さらに、ドキュメントにさらっと書かれていて後で刺さる仕様があります。スタガーです。routine ごとに数分のオフセットが入り、指定時刻ぴったりには走りません。オフセットは routine ごとに一定なので「毎日 09 時 03 分前後」のような予測は立ちますが、厳密な同期タイミング（たとえば CI の直後 1 分以内）を担保したい場合は schedule ではなく API トリガーでパイプラインから叩きに行きます。

CLI で routine を管理するときのコマンドは `/schedule`（作成）、`/schedule list`（一覧）、`/schedule update`（編集）、`/schedule run`（即時実行）の四つです。`/schedule` は作成時にスケジュールトリガーしか付けられません。API や GitHub トリガーを足すには Web 管理画面 `claude.ai/code/routines` に行く必要があります。

### 2-2　API

API トリガーは routine ごとに専用 URL と bearer token を発行します。URL は `https://api.anthropic.com/v1/claude_code/routines/<trig_id>/fire` の形で、POST 時には三つのヘッダを付けます。

```bash
curl -X POST https://api.anthropic.com/v1/claude_code/routines/trig_01ABCDEFGHJKLMNOPQRSTUVW/fire \
  -H "Authorization: Bearer sk-ant-oat01-xxxxx" \
  -H "anthropic-beta: experimental-cc-routine-2026-04-01" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"text": "Sentry alert SEN-4521 fired in prod. Stack trace attached."}'
```

成功時のレスポンスは次の形です。

```json
{
  "type": "routine_fire",
  "claude_code_session_id": "session_01HJKLMNOPQRSTUVWXYZ",
  "claude_code_session_url": "https://claude.ai/code/session_01HJKLMNOPQRSTUVWXYZ"
}
```

リクエストボディの `text` フィールドに癖があります。ドキュメントいわく "The value is freeform text and is not parsed: if you send JSON or another structured payload, the routine receives it as a literal string" です。構造化したデータを送っても routine 側では文字列として現れるので、Claude 側で JSON としてパースさせたいなら「以下は JSON 文字列です」とプロンプトで明示するか、フィールド名と値のプレーンな箇条書きで渡すほうが堅牢です。

トークンの扱いで気をつけるべきは、生成時に **一度しか表示されない** ことです。発行したら即座に監視ツールの secret store に貼り付けます。同じ routine に対して後から regenerate や revoke はできますが、前に発行したトークンは死にます。

beta ヘッダのバージョニング方針も押さえておく価値があります。ドキュメントには "Breaking changes ship behind new dated beta header versions, and the two most recent previous header versions continue to work" とあり、互換の窓は三世代分です。research preview を本番パイプラインに組み込むなら、アラートやデプロイの自動化よりも先に、beta ヘッダの更新運用のほうを決めておいたほうが安全です。

### 2-3　GitHub

GitHub トリガーは Webhook の受け口として働きます。購読できるイベントカテゴリは **18 種** あり、Pull request / Pull request review / Pull request review comment / Push / Release / Issues / Issue comment / Sub issues / Commit comment / Discussion / Discussion comment / Check run / Check suite / Merge queue entry / Workflow run / Workflow job / Workflow dispatch / Repository dispatch を含みます。各カテゴリの中で `pull_request.opened` のように個別アクションを選ぶこともできますし、カテゴリ全体を拾うこともできます。

PR イベントにはフィルターが九つ用意されています。Author、Title、Body、Base branch、Head branch、Labels、Is draft、Is merged、From fork です。これらは AND 条件で評価され、すべてがマッチしたときにだけ routine が起動します。たとえば「draft でない PR の opened」だけを拾いたければ `Is draft: false` を一本入れておきます。

設置にあたって踏みやすい罠が一つあります。CLI の `/web-setup` だけでは GitHub webhook は届きません。Claude Code が GitHub リポジトリを clone するための OAuth 認可と、webhook を受けるための Claude GitHub App のインストールは別物だからです。ドキュメントにも "Running `/web-setup` in the CLI grants repository access for cloning, but it does not install the Claude GitHub App and does not enable webhook delivery" と注釈があります。トリガー作成フォームから案内に従って App を入れます。

もう一つ、設計上の重要な性質があります。各イベントは独立したセッションを生成します。Push が二回来たら二本のセッションが、PR 更新が連続したら連続したセッションが走ります。同じ routine を共有する「長命のステート」はありません。routine は原則としてステートレスで、前回の run が何をしたかは、リポジトリのコミット履歴か claude.ai のセッション一覧からしか辿れません。

この章の気づきはここにあります。schedule が「時刻の約束」、API が「外部からの呼び出し口」、GitHub が「リポジトリ上のイベントバス」だとすれば、三つは用途で使い分けるもので、どれか一つに寄せて全部やろうとすると仕様の縁でつまずきます。

## 第3章　スコープ設計 ─ 自分名義で動く自動化の最小権限

この章を置くのは、routines の事故は「権限を広く取りすぎたとき」にだけ起こるからです。

routine は実行中に確認を求めません。だからこそ、起動前に「何ができるか」をこちらが先に決めておく必要があります。決める場所は四つあります。

まずリポジトリ選択です。routine は選んだリポジトリを毎回 default branch から clone します。そして書き込みはデフォルトで `claude/` プレフィックスのブランチにしか通りません。この制約は想像以上に効きます。routine が main を壊そうとしても push 側で弾かれます。**Allow unrestricted branch pushes** のトグルは、外すべき理由が明確なときにだけ外します。外す前に自問しておきたい問いは一つだけです。「これは routine に main を触らせる価値があるタスクか」。

次に環境です。ネットワーク設定でアクセス可能なドメインを絞り、環境変数には routine が必要とする秘密情報だけを置きます。setup script で必要なツールを先に入れておくと、プロンプトを「依存を入れてください」で埋めずに済みます。

三つ目がコネクターです。claude.ai で接続済みの MCP コネクターは、routine 作成時にデフォルトで全部が有効になります。ここは危険な初期値で、たとえば個人で Slack と Google Drive と Linear を繋いでいる場合、レビュー用の routine が意図せず Drive に書けてしまいます。routine ごとに必要な一つか二つだけを残し、あとは外します。ドキュメントにも "all of your currently connected connectors are included by default. Remove any that aren't needed" とあり、削る側の操作だけがこちらの責任になります。

四つ目がプロンプトです。ここには「やってほしいこと」と同じ比重で「やってほしくないこと」を書きます。たとえば PR レビュー routine なら「コメントのみ残すこと。コミット・ブランチ作成・main への push は行わないこと」と明示的に禁じます。技術的な境界はリポジトリ設定が担保しますが、プロンプトで重ねて書くことで「そもそも試さない」を選ばせられます。

副作用の連鎖についても一つ触れておきます。複数の routine を組み合わせると、ある routine の出力が別の routine のトリガーになります。たとえば「PR レビュー routine」が PR にコメントし、その PR を「PR コメントに反応する routine」が拾って別の何かを走らせる、という連鎖は仕様上あり得ます。Head branch フィルタで `claude/` プレフィックスを除外するか、`From fork` を使うか、Author を自分以外に限定するなど、起動側で最小限のガードをかけます。

この章の気づきはここにあります。routines の安全は、実行時の監視ではなく、起動条件と権限スコープの設計で決まります。動かし始めてから直すものではなく、動かす前に狭めておくものです。

## 第4章　三種トリガーのウォークスルー

この章を置くのは、公式ドキュメントを一周しただけだと「どう組むか」が頭に残らないからです。ここでは作成フォームの手順をなぞり、それぞれで選ぶべき選択肢と、よくある迷いどころに注釈をつけます。実動作は各自の環境で確認してください。

### 4-1　スケジュール ─ 毎朝の issue 棚卸しを自動化する

目的は単純です。毎朝 9 時に指定リポジトリの open 状態の issue を読み、タイトル・番号・作成者を `issue-digest/YYYY-MM-DD.md` に書き出して `claude/daily-issue-digest` ブランチにコミットする、という routine を作ります。

`claude.ai/code/routines` で **New routine** を押し、次の五つを埋めます。

- **Name**: `daily-issue-digest`
- **Prompt**: 「リポジトリの open 状態の issue をすべて取得し、タイトル・番号・作成者を `issue-digest/YYYY-MM-DD.md` に UTC の取得日時とともに書き出してコミットしてください。ファイルが既にあれば上書きしてください。PR は作成しないでください。」
- **Repository**: 対象リポジトリを一つ選ぶ
- **Environment**: Default のまま
- **Connectors**: GitHub 以外は全部外す

トリガーは **Schedule** の **Weekdays**、時刻は 09:00 を選びます。保存したら routine 詳細ページの **Run now** で一度だけ走らせ、結果を確認します。成功していれば `claude/daily-issue-digest` ブランチに新しいファイルが入っているので、必要なら手動で PR を作ります。routine 側からは PR は作りません。プロンプトで禁じているからです。

この例のポイントは二つです。第一に、routine はデフォルトで `claude/` プレフィックスのブランチにしかコミットできないので、明示的な PR 作成をプロンプトに書かない限り main は触られません。第二に、ファイル命名を Claude に決めさせず、プロンプト側で `issue-digest/YYYY-MM-DD.md` と固定してあります。命名を自由にすると翌日のファイルが衝突するか別名で共存してしまうので、テンプレートは人間側で決めておきます。

### 4-2　API ─ 監視ツールからアラートを転送する

監視基盤（Datadog、PagerDuty、Sentry、どれでもかまいません）のインシデント発火を受けて、routine にスタックトレースと直近コミットを突き合わせてもらうケースです。

routine 側の準備は次の通りです。既存 routine を **Edit routine** で開き、**Select a trigger** から **Add another trigger** で **API** を選びます。保存すると URL が出るので、**Generate token** で token を発行して即座に控えます。あとは監視ツール側から次のような POST を飛ばすだけです。

```bash
curl -X POST https://api.anthropic.com/v1/claude_code/routines/trig_01ABCDEFGHJKLMNOPQRSTUVW/fire \
  -H "Authorization: Bearer sk-ant-oat01-xxxxx" \
  -H "anthropic-beta: experimental-cc-routine-2026-04-01" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"text": "本番環境でエラーレート急上昇。直近コミットと照合して候補を3件挙げてください。"}'
```

成功するとレスポンスに `claude_code_session_url` が入ります。監視ツールのインシデント詳細欄にこの URL を書き戻すワークフローを組んでおくと、当番が開いたときには Claude がすでに調査途中まで進めている画面が見える、という運用になります。

プロンプトは routine 本体にベース部分を固定で書き、`text` で毎回の差分だけを渡します。`text` はリテラル文字列として扱われるので、JSON を送ってもそのまま文字列として Claude に渡ります。構造化したい場合は routine 側のプロンプトに「以下は JSON 文字列です」と一行足すと扱いやすくなります。

トークンの秘匿はこの仕組み全体の要です。一度しか表示されないので、発行直後に監視ツールの secret store か社内の secrets 管理に載せます。漏れたら claude.ai 上で revoke して再発行します。

### 4-3　GitHub ─ PR レビューを自動で回す

PR が opened されたときに、指定した観点でレビューコメントを残す routine です。対象は draft でない PR に限定します。

設置手順はこうです。**Edit routine** から **GitHub event** を追加し、リポジトリを選び、イベントに **Pull request → opened** を指定します。フィルターで **Is draft** に `false` を設定します。もしまだ Claude GitHub App を入れていなければ、この時点で App インストールの画面に飛ばされます。`/web-setup` だけでは webhook は届かないので、ここは必ず App 側を入れます。

プロンプトは次のように書きます。

```text
差分を確認し、次の三観点でレビューしてください:
1. セキュリティ上の懸念点
2. パフォーマンス上の懸念点
3. 命名・コードスタイル上の改善点

各観点について、該当する箇所にインラインコメントを残してください。
該当がない観点は「該当なし」と明記し、観点を飛ばさないでください。
最後に総評を PR 本体にコメントしてください。

やらないこと:
- コミットや push を行わない
- ブランチを作成しない
- 他の PR に触らない
- 人間のレビューコメントに返信しない
```

「やらないこと」節をはっきり書くことには理由があります。routine は実行時に止まれないので、「曖昧な指示から拡張的に動く」余地を事前に絞っておく必要があります。プロンプトが短いほど Claude は自分で判断の隙間を埋めます。埋めてほしくない場所には、明示的に壁を置きます。

コメントはあなたの GitHub ユーザー名義で残ります。同じリポジトリで人間のレビュアーとしても立っているなら、自分のレビューと routine のレビューが混じって見えるので、routine が書くコメントには冒頭に `[routine:pr-review]` のような prefix を付けるようプロンプトで指示しておくと、あとで区別しやすくなります。

## 第5章　日次上限と運用設計

この章を置くのは、research preview の現時点でいちばん読み違えやすいのが **使用量の設計** だからです。

routine の実行は通常のセッション使用量に加えて、**1 日あたりの routine 起動数** という独立した上限がかかります。プランごとの現状値は Pro が 5 回、Max が 15 回、Team と Enterprise が 25 回です。この数字は発表日（2026-04-14）の The Register と 9to5Mac の記事で確認できます。URL は末尾にまとめます。

実数を運用に当てはめると、Pro プランでスケジュール routine を二本（平日朝と週次）、API routine を一本（deploy 後の smoke check）動かすだけで、GitHub の PR レビューに割ける枠がほぼ残りません。Pro で GitHub トリガーを中心に組みたいなら他の二種は極限まで削るか、Max 以上を検討することになります。extra usage を有効にすれば追加分は従量課金で続行できますが、これはスコープが広がる選択肢なので、組織アカウントでだけ有効にするのが穏当です。

The Register の記事はこの点を少し辛口に書いています。複数 routine を並行で走らせると、それぞれが独立した Claude Code cloud session を立てるので、**token 消費がまとまって膨らみ**、interactive session を節約してきた従来の使い方より先に枯れる可能性がある、というものです。これは routine が独立性と引き換えに払うコストで、設計レベルで避けにくい性質です。

実務的な防衛策は三つあります。一つ目は、routine ごとに「終了条件」をプロンプトで明示して、だらだら探索を続けさせないこと。二つ目は、スケジュールの粒度を思い切って粗くすること（毎日を平日のみに、平日を週 2 日に）。三つ目は、routine のセッションログを事後的に眺める習慣です。各 run は claude.ai 側で独立したセッションとして残り、Claude が何を叩いてどこに時間を使ったかが全部見えます。高コストな run を一本見つけたら、プロンプトを削るか対象ファイルを絞る根拠になります。

## 第6章　cron でも GitHub Actions でもない位置

この章を置くのは、routines を「何の代わりに使うか」を決めておかないと、既存の自動化と二重管理になるからです。

routines を一言で特徴づけるなら、The Register の表現を借りて "dynamic cron jobs / trigger-driven short-lived agents" です。決定論的に同じコマンドを繰り返す cron とも、固定の YAML を上から実行する GitHub Actions とも性質が違います。

三者の使い分けを表にします。

| 種別                    | 向いている用途                                              | 向かない用途                                           |
| :---------------------- | :---------------------------------------------------------- | :----------------------------------------------------- |
| cron（OS / Kubernetes） | 固定コマンド、秒以下の実行、決定論が必須                    | 判断を伴う処理、状況に応じたコマンド選択               |
| GitHub Actions          | CI/CD、固定の test/lint/build、外部サービス連携             | 文脈を読んで判断する処理、自然言語の指示               |
| Claude Code routines    | 判断を伴う繰り返し作業（トリアージ・ドラフト PR・レビュー） | 秒以下の実行、厳密に再現したい処理、チーム共有の自動化 |

右列の最後が肝心です。routines はチームで共有できないので、チーム全体の CI パイプラインを routines に寄せるのは設計ミスになります。逆に「自分のタスクを自分で自動化する」方向、つまり個人のバックログ整理や個人宛メールの仕分け、個人のリポジトリでのドラフト PR 生成には、既存の道具より素直にはまります。

もう一つ、routines の挙動は **確率論的** です。同じプロンプト・同じリポジトリでも、差分の状態が変われば Claude が選ぶ手順は変わります。これは「毎回同じコマンドが動く」ことを信頼の根拠にしている cron / Actions 系の文化とは噛み合いません。決定論的な安全弁（たとえば本番 DB のスキーマ変更のトリガー）に routines を置いてはいけない、というのがこの違いから導かれる一行です。

この章の気づきはここにあります。routines に置くべきは「判断の価値が速度より高いタスク」です。cron と Actions の守備範囲はそのままに、両者の下で零れ落ちていた「毎朝の 15 分の手作業」を引き受けさせるのが、現時点でもっとも失敗しにくい置き方だと思います。

## あとがき

routines は research preview です。API のエンドポイントは `experimental-cc-routine-2026-04-01` という beta ヘッダの下にあり、今後破壊的変更が入るたびに新しい日付のヘッダが立ち、古い二世代までが互換で残る、という方針になっています。本番のアラート経路に組み込む前に、ヘッダ更新の運用手順を社内に一枚書いておくことを勧めます。

最後に、明日試すべき最小の routine を一つだけ指定します。あなたが毎朝やっている 15 分の手作業を一つ選んでください。それを自然言語で 10 行以内に書き、対象リポジトリとコネクターを一つずつ選び、schedule トリガーだけを付けて、平日 9 時に `Run now` で走らせます。結果のセッションログを見て、プロンプトを削れる箇所を探します。routines の評価はこの小さな一本から始めるのが、いまのところ一番誤りにくい入り方です。

## 参考・関連リンク

- Anthropic [Automate work with routines](https://code.claude.com/docs/en/routines)（2026-04-14）
- Anthropic [Introducing routines in Claude Code](https://claude.com/blog/introducing-routines-in-claude-code)（2026-04-14）
- The Register [Claude Code routines promise mildly clever cron jobs](https://www.theregister.com/2026/04/14/claude_code_routines/)（2026-04-14）
- 9to5Mac [Anthropic adds routines to redesigned Claude Code, here's how it works](https://9to5mac.com/2026/04/14/anthropic-adds-repeatable-routines-feature-to-claude-code-heres-how-it-works/)（2026-04-14）

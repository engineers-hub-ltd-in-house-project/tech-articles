# 自分の Claude Code は削れるはず ── CLAUDE.md、slash command、MCP、Subagent、Hooks を棚卸しするハンズオン

この記事でわかること

- 自分の Claude Code 周辺資産(`CLAUDE.md`、slash command、MCP、Subagent、Hooks)を「削る目」で棚卸しする具体的な手順
- モデル能力に依存する scaffolding と、チーム運用に由来する scaffolding を切り分ける判断基準
- stdio + JSON-RPC の最小 MCP server を 30 行ほどで書いて、薄い protocol の感触を手元で体感する方法

## はじめに

この記事は、姉妹記事「[流れるものは変わった、土台は変わっていない ── Multics の失敗から Claude Code まで、設計思想を辿る](https://note.com/)」(以降、親記事と呼びます)の実践編です。親記事では、UNIX と Plan 9 の設計思想がどのように 2026 年の LLM エージェントに流れ込んでいるかを歴史的に辿り、最後の第四部で「削る目」という考え方を提示しました。

- scaffolding は松葉杖である
- 骨折(=モデルの能力不足)が治れば、松葉杖は外す
- 残すべきは、モデルが変わっても変わらないもの(プロジェクト固有の慣習、チーム運用のルール)

この「削る」を、頭だけで理解しても手は動きません。本記事では、自分の `CLAUDE.md`、slash command、MCP、Subagent、Hooks を、一つずつターミナルで棚卸ししていきます。親記事を先に読まなくても、この記事だけで実作業はできます。ただ、「なぜ削るのか」の背景を知りたいときは、親記事に戻ってください。

本記事で扱う作業はすべて、手元の環境を壊さずに可逆で進められる手順に揃えています。削除する前に必ずバックアップを取り、1 週間ほど運用してから本反映する、という進め方にしてあります。

執筆時点の前提バージョン:

- Claude Code 2.x 系(2026 年 4 月時点)
- Python 3.10 以上
- `git` が使える状態

では始めます。

## 第 0 章　準備

### 0-1. 作業の前にバックアップ

Claude Code に関わる設定は、主に二箇所にあります。

- `~/.claude/`(グローバル設定。`CLAUDE.md`、`agents/`、`commands/`、`settings.json`、`mcp.json` などが入る)
- プロジェクト配下の `.claude/`(プロジェクト固有設定)

棚卸しの前に、両方のディレクトリをスナップショットとして別の場所にコピーしておきます。こうしておくと、削った結果が気に入らなかった場合に、ファイル単位で戻せます。

```bash
STAMP=$(date +%Y%m%d-%H%M)
mkdir -p ~/tmp/claude-code-audit/$STAMP

# グローバル
cp -r ~/.claude ~/tmp/claude-code-audit/$STAMP/home-claude

# プロジェクト配下(本棚卸しの対象プロジェクトに cd してから)
cd /path/to/your/project
if [ -d .claude ]; then
  cp -r .claude ~/tmp/claude-code-audit/$STAMP/project-claude
fi
```

バックアップができたら、棚卸し対象のブランチを切ります。

```bash
git checkout -b claude-code-audit-$(date +%Y%m%d)
```

このブランチは本流にマージしません。棚卸しのための一時ブランチで、削除した結果を 1 週間ほど試して、問題がなかったら main ブランチで改めて同等の変更を入れる、という使い方をします。

### 0-2. 現状の把握

自分の Claude Code 周りに何があるかを、ざっと眺めておきます。以降の章で何を棚卸しするか、全体像を掴むためです。

```bash
# 各ファイルの有無とサイズ
ls -la ~/.claude/CLAUDE.md ~/.claude/settings.json ~/.claude/mcp.json 2>/dev/null
ls -la .claude/CLAUDE.md .claude/settings.json .claude/mcp.json 2>/dev/null

# commands と agents の個数
ls ~/.claude/commands/ 2>/dev/null | wc -l
ls .claude/commands/ 2>/dev/null | wc -l
ls ~/.claude/agents/ 2>/dev/null | wc -l
ls .claude/agents/ 2>/dev/null | wc -l

# MCP server の登録数(mcp.json があれば)
if [ -f ~/.claude/mcp.json ]; then jq '.mcpServers | keys | length' ~/.claude/mcp.json; fi
```

わたしの手元では、半年前の時点で slash command が 30 個以上、agent が 8 個、MCP server が 15 個登録されていました。これが多いか少ないかは一概に言えません。ただ、自分が最後に見直したのがいつかを思い出せないものは、だいたい棚卸しの対象になります。

### 0-3. ノートの用意

棚卸しの過程で、「これは削る」「これは残す」「これは迷う」といった判断が大量に出てきます。頭の中だけで進めると必ず漏れるので、作業ログを markdown で残します。

```bash
cat > ~/tmp/claude-code-audit/$STAMP/audit-log.md <<'EOF'
# Claude Code 棚卸しログ

- 開始日:
- 対象プロジェクト:

## CLAUDE.md

## slash commands

## MCP servers

## Subagents

## Hooks

## 判断に迷ったもの
EOF
```

この空っぽのテンプレートに、各章の作業で気づいたことを書き足していきます。準備はこれで終わりです。

---

## 第 1 章　CLAUDE.md の棚卸し

### 1-1. 今ある項目を吐き出す

まず自分の `CLAUDE.md` を読み直します。グローバル側とプロジェクト側の両方です。

```bash
cat ~/.claude/CLAUDE.md
echo "---"
cat .claude/CLAUDE.md 2>/dev/null || echo "(no project CLAUDE.md)"
```

この時点で、「あれ、これ何のために入れたんだっけ」という項目が必ず出てきます。それが削る候補の第一号です。見覚えのない項目、追加した日を思い出せない項目、というのは、もう必要ないことがほとんどです。

### 1-2. Claude 自身にレビューさせる

次に、Claude Code を起動して、自分の `CLAUDE.md` を Claude 自身にレビューさせます。メタな使い方ですが、モデル能力に対して今の指示が過剰かどうかを一番よく知っているのは、当のモデルです。

Claude Code を起動します。

```bash
cd /path/to/your/project
claude
```

そして、以下のプロンプトを投げます。

```text
あなたは Claude Code として動いているので、自分自身の指示ファイルである ~/.claude/CLAUDE.md を
Read ツールで読み、以下の観点で項目ごとに評価してください。

1. モデル能力に依存する指示(古いモデルの弱点を補うもの。今のモデルでは不要の疑いあり)
2. プロジェクト固有の慣習(モデルが変わっても必要なもの)
3. ドメイン知識(モデルが変わっても必要なもの)
4. 重複している項目、矛盾している項目、古くなった情報

各項目について「残す / 削除候補 / 要再検討」の判定と、その理由を返してください。
判定のしやすさのため、CLAUDE.md を一度 bullet に整理してから評価すると助かります。
```

返ってきた評価を、`audit-log.md` の該当セクションにコピーします。ここで重要なのは、Claude の判定をそのまま実行しない、という点です。あくまで「第三者の目」として参考にする。削除するかどうかの最終判断は、自分で下します。

### 1-3. 切り分けの基準

わたしが採用している切り分けの基準は、以下の三つの問いです。

- **Q1**: この指示を消した状態で、今のモデルに同じタスクを投げたら、期待する結果が出るか
- **Q2**: この指示は、チームの他のメンバーが読んだときに「ああ、わたしたちのルールだ」と腑に落ちるか
- **Q3**: この指示は、半年後のモデルにも同じ形で有効そうか

Q1 が「Yes」のものは、削除候補です。Q2 が「Yes」かつ Q3 も「Yes」のものは、残します。Q1 が「No」だが Q3 が「No」のものは、短期的に残すが定期的に見直す対象にマークします。

具体例で言えば、わたしの `CLAUDE.md` にかつてあった以下の項目は、いまは削除済みです。

- 「ファイルの末尾に改行を入れること」 → モデル 4.6 以降は言わなくてもそうする
- 「import 文はアルファベット順に並べる」 → 同上
- 「テストは pytest の fixture を使う」 → プロジェクトを見れば自明、モデルは自分で読み取る

一方、以下は残しています。

- 「このリポジトリの言語は日本語、一人称はわたし、ですます調」 — プロジェクト固有の慣習
- 「本サービスはフリーランス向け SaaS」 — ドメイン知識
- 「commit 前に `pnpm lint:md` を通す」 — チーム運用のルール

### 1-4. 削除→観察→再評価

削除候補が決まったら、コメントアウトではなく行ごと削除します。コメントアウトで残すと、いつまで経っても本当に不要かどうかの判定がつきません。思い切って削って、git に差分として残す方がよいです。

削除した `CLAUDE.md` の例(diff の抜粋):

```diff
 # グローバル指示

 - 言語: 日本語
 - 一人称: わたし
 - 文末: ですます調

-## コーディング規約
-
-- ファイル末尾に改行を入れる
-- import 文はアルファベット順
-- テストは pytest の fixture を使う
-
 ## プロジェクト
```

削除した後は、普段の作業でしばらく Claude Code を使ってみます。目安は 1 週間です。この間に「あれ、以前はこれ言わなくてもやってくれたのに」という違和感が出たら、該当の指示を復活させます。違和感が出なかった指示は、本流にマージして恒久的に削除です。

### 1-5. わたしの最近の結果

参考までに、わたし自身の棚卸しの数字を書いておきます。半年前の `CLAUDE.md`(グローバル)は 180 行ありました。先月の棚卸し後は 85 行です。半分以下になりました。機能が減ったかというと、逆で、Claude の動きは半年前より明らかに自分の好みに合っています。モデルが賢くなり、scaffolding が不要になったぶん、残った指示が「本当に自分のルール」だけになったからです。

---

## 第 2 章　`.claude/commands/` の削減

### 2-1. 今ある slash command を眺める

slash command は、短い prompt を名前付きで保存しておき、`/command-name` で呼び出す仕組みです。`.claude/commands/` ディレクトリに markdown を置くだけで登録されます。

```bash
ls ~/.claude/commands/
ls .claude/commands/ 2>/dev/null
```

わたしの場合、ここには過去半年でいろいろ溜まっていました。`pr-review.md`、`commit-message.md`、`retro.md`、`refactor-plan.md`、などなど。多くは当時のモデルが pr review を頼んでも薄い結果しか返してこなかったので、詳細な prompt を書いて定型化したものです。

### 2-2. 各 command の寿命を判定する

今のモデルで、slash command を使わずに自然言語で同じタスクを頼んだら、品質はどのくらい変わるか。これを一つずつ実測します。

手順:

1. 対象の slash command を選ぶ(例: `pr-review`)
2. 内容を `cat` で確認する
3. 同じ意図のタスクを、自然言語で Claude Code に頼む(slash command を使わない)
4. 出力を比較する
5. 差がなければ削除候補、差があればなぜ差が出たかを分析する

たとえば `pr-review.md` の中身が以下のような内容だったとします。

```markdown
あなたはコードレビュアーです。このプルリクエストを以下の観点で見てください:

- セキュリティ(SQL インジェクション、XSS、権限チェック漏れ)
- パフォーマンス(N+1 問題、ループ内の重い処理)
- 可読性(命名、コメント、関数分割)
- テスト(カバレッジ、エッジケース)

各観点ごとに、指摘がある箇所を「ファイル名:行番号」で示して、
具体的な修正提案を添えてください。
```

今のモデルで、自然言語でこう頼んでみます。

```text
この PR を、セキュリティ・パフォーマンス・可読性・テストの観点でレビューして。
指摘は「ファイル名:行番号」の形式で、具体的な修正提案つきで。
```

そして両方の出力を並べます。もしも違いが (a) slash command のほうが網羅性がわずかに高い程度、(b) 両方とも同じレベルで使える、のどちらかであれば、slash command は削除して構わないです。

わたしの手元では、30 個あった slash command のうち、17 個を削除しました。残したのは以下のようなものです。

- プロジェクト固有のワークフロー(例: `/release-notes` — このリポジトリの release notes の書式は特殊なので、書式定義を保存しておく価値がある)
- 頻繁に再利用するドメイン知識(例: `/query-stripe-test-data` — 自社の Stripe テストモード上で決済状態を調べるときの決まり文句)
- 長すぎて毎回タイプしたくないもの(例: `/full-deploy-checklist` — デプロイ前の確認 20 項目。これは「リスト」として価値があるので残す)

### 2-3. 削除の手順

削除は単純です。

```bash
cd ~/.claude/commands
mv pr-review.md ~/tmp/claude-code-audit/$STAMP/commands-removed/
```

`.claude/commands/` から「別ディレクトリに退避」する形で「削除」します。完全に消さないのは、1 週間の観察期間中に復活させたくなる可能性があるからです。観察期間が終わって問題なければ、退避ディレクトリごと消します。

退避先に移した command は、`audit-log.md` にも記録しておきます。

```markdown
## slash commands 削除ログ

- pr-review.md (2026-04-19): 自然言語で同等品質。削除。
- commit-message.md (2026-04-19): モデルが git log を自分で読んで文体を合わせるので不要。削除。
- refactor-plan.md (2026-04-19): plan mode で代替可能。削除。
```

### 2-4. 観察後の最終反映

1 週間後に違和感がなかったものは、`git rm` で永久削除します。退避ディレクトリも空にします。これで棚卸しの 2 章は完了です。

---

## 第 3 章　最小の MCP server を書く

### 3-1. 目的と動機

MCP(Model Context Protocol)は、LLM エージェントが外部ツールを呼び出すための薄い protocol です。親記事では「MCP の薄さ」を繰り返し強調しました。ただ、薄いと言われても、実装を書いてみないと薄さの感触は掴めません。

この章では、Python で 30 行ほどの MCP server を書いて、`~/.claude.json` に登録し、Claude Code から呼び出すところまでをやります。何か高度なツールを作るのが目的ではなく、「こんなに少ないコードで Claude に新しい能力を与えられる」という感触を持ち帰ることが目的です。

### 3-2. 依存のインストール

Anthropic は MCP の Python SDK を公開しています。`mcp` パッケージをインストールします。

```bash
python -m venv ~/tmp/mcp-echo
source ~/tmp/mcp-echo/bin/activate
pip install 'mcp[cli]'
```

venv を切っているのは、ハンズオン用に分けておくと後片付けが楽だからです。本番のエージェントに組み込むときは、運用方針に合わせて置き場所を決めてください。

### 3-3. echo server の実装

適当な場所に `echo_server.py` を作ります。

```python
# echo_server.py
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("echo")


@mcp.tool()
def echo(message: str) -> str:
    """渡された文字列をそのまま返す"""
    return message


@mcp.tool()
def reverse(text: str) -> str:
    """渡された文字列を反転して返す"""
    return text[::-1]


@mcp.tool()
def shout(message: str) -> str:
    """渡された文字列を大文字にして末尾に ! を付ける"""
    return message.upper() + "!"


if __name__ == "__main__":
    mcp.run()
```

これが全体です。30 行に届きません。`FastMCP` というヘルパーが、stdio 経由の JSON-RPC の受け口をすべて用意してくれます。関数を `@mcp.tool()` で飾るだけで、その関数が Claude Code から呼べる tool になります。

docstring は、Claude Code が tool の description として読みます。つまりここで「この tool を何に使うのか」を自然言語で伝えるわけです。親記事で触れた「text が universal interface」という話の、もっとも直接的な体現です。

### 3-4. 手で動くか試す

Claude Code に繋ぐ前に、まず単体で動くかを確認します。

```bash
python echo_server.py
```

起動すると、サーバーは stdin から JSON-RPC を待ち受けます。別のターミナルから、または `npx @modelcontextprotocol/inspector` を使うと、手軽に対話できます。Inspector が面倒なら、次の手順に進んでください。

### 3-5. Claude Code への登録

`~/.claude.json` または対象プロジェクトの `.claude.json` に、以下を追加します(既に `mcpServers` セクションがあれば、その中に追記します)。

```json
{
  "mcpServers": {
    "echo": {
      "command": "/home/you/tmp/mcp-echo/bin/python",
      "args": ["/home/you/path/to/echo_server.py"]
    }
  }
}
```

`command` と `args` は絶対パスにします。相対パスにすると、Claude Code の起動位置に依存してしまうからです。venv の Python を直接指している点も重要で、こうしておくと他のプロジェクトで `mcp` パッケージを入れていなくても動きます。

### 3-6. 疎通確認

Claude Code を再起動します。

```bash
claude
```

起動後、`/mcp` と打つと MCP server の一覧が見えます。`echo` が認識されていれば成功です。

次に、Claude にこう頼みます。

```text
echo MCP server の `shout` ツールを使って、"hello world" を変換してみて。
```

`HELLO WORLD!` が返ってくれば、疎通は完了です。たったこれだけで、Claude Code に新しい能力を追加できます。

### 3-7. ここで体感すべきこと

実装量と効果を比べてみてください。`echo_server.py` は 30 行もない Python ファイル一つです。それだけで、Claude Code が呼び出せる新しい tool が 3 つ増えました。

親記事で「薄い protocol、厚い機能」と書いたのは、この構造のことです。protocol(MCP)は薄い。tool の実装(echo_server.py)も薄い。ただ、その上に、Claude Code の会話から自然言語で呼び出せる機能が、軽量に積み上がっていく。1970 年代の UNIX で、`cat` と `grep` と `sort` を組み合わせて新しい道具を作っていたのと、発想が地続きです。

ここで書いた echo server を置き換えて、本当に自分の仕事に必要な tool に書き直すと、それが自分専用の MCP server になります。わたしは実際に、自社プロダクトの管理画面 API を叩く MCP server を 150 行ほどで書き、Claude Code から直接ユーザー情報を検索できるようにしています。

### 3-8. 後片付け

ハンズオンのためだけに作った echo server は、使い終わったら `~/.claude.json` から `echo` の登録を外すだけで無効化できます。ファイル自体はバックアップディレクトリに移しておけば、また必要になったときに復活できます。

---

## 第 4 章　Subagent と Hooks の最小雛形

### 4-1. Subagent の定義

Subagent は、親の Claude Code とは独立した context を持つ子エージェントです。`.claude/agents/` に markdown を置くだけで定義できます。この章では、「markdown ファイルの構造をレビューするだけ」の最小 agent を書いてみます。

```bash
mkdir -p .claude/agents
```

`.claude/agents/md-reviewer.md` を作成します。

```markdown
---
name: md-reviewer
description: markdown ファイルの構造的な問題(見出し階層飛び、太字過多、箇条書きの粒度)を指摘する
---

あなたは markdown レビュアーです。

渡されたファイルを Read で読み、以下の点を指摘してください。

- 見出し階層が飛んでいる箇所(例: `##` の直後に `####` が来る)
- 同一段落内に太字(`**...**`)が 3 つ以上あるケース
- 箇条書きの粒度が不揃いな箇所(一項目だけ極端に長い、など)

指摘は「行番号: 指摘内容」の形式で箇条書きにしてください。
修正は行わず、指摘のみを返してください。
```

### 4-2. Subagent を呼び出す

Claude Code に対して、以下のように頼みます。

```text
md-reviewer agent を起動して、./README.md をレビューさせて。
```

Claude Code は `md-reviewer` という名前の subagent を起動し、親とは別の context で `README.md` を読み、指摘を返します。親の Claude は、その指摘を受け取って、必要ならさらなるアクションを決めます。

ここで重要なのは、subagent が失敗しても親の context が壊れないこと、です。親の context は subagent の存在を知っているだけで、subagent 内部の詳細(読んだファイル、試行錯誤の過程)は親に流れません。親に返るのは、圧縮された結果だけです。これは親記事の第二部 9 章で扱った「UNIX のパイプ型サブエージェント」の、実装上の形です。

### 4-3. Hooks の最小雛形

Hooks は、Claude がツールを呼ぶ前後に、ユーザー定義のシェルコマンドを走らせる仕組みです。`.claude/settings.json` に書きます。

まずは、副作用のない観測だけの Hook から入ります。ファイルを書いた後に、差分の統計だけ表示する、というシンプルな例です。

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "git diff --stat"
          }
        ]
      }
    ]
  }
}
```

これを置いた状態で Claude Code を使うと、Claude がファイルを編集するたびに `git diff --stat` が表示されます。どのファイルが何行変わったかが毎回見えるので、「知らないうちに巨大な変更が入っていた」を防げます。

### 4-4. Hook の判断基準

ここで、親記事で書いた「Claude を信用しない Hook にしない」という話を実地に引きつけます。

「残す Hook」の条件は、以下のどちらかです。

- **チーム運用のルール**: 「コミット前に lefthook を通す」「PR に特定のラベルを自動で付ける」など、Claude の性能とは独立な運用ルール
- **観測が目的の Hook**: 上の `git diff --stat` のように、副作用はなく、ただ人間に情報を見せる Hook

「削る(書かない) Hook」の条件は、以下のどれかです。

- モデル能力の不足を補う Hook(例: Claude が lint を忘れるから毎回自動で lint する。今のモデルは言えば通常は自分でやる)
- 過度な安全装置(例: 書き込みのたびに rollback 準備、など)

線引きは、自分の `.claude/settings.json` を見たときに、どの Hook が「運用上の儀式」で、どの Hook が「Claude への不信」から来ているかを区別することです。後者は、削ります。

### 4-5. Subagent と Hooks の棚卸しログ

最後に、`audit-log.md` の該当セクションを埋めます。

```markdown
## Subagents

- md-reviewer (新規追加): 本ハンズオンで作成。残す。
- old-reviewer (削除): md-reviewer と機能が重複していた。削除。

## Hooks

- PostToolUse: Write|Edit → git diff --stat (新規追加): 観測目的。残す。
- PreToolUse: Bash → 承認待ち (削除): Claude が危険コマンドを判別できる前提で不要。削除。
```

どれを残してどれを削ったか、理由つきで記録しておきます。半年後の自分や、チームメンバーがこのログを読んで、「なるほどこういう考えで棚卸ししたのか」と再現できるようにするためです。

---

## まとめ

ここまでで、`CLAUDE.md`、slash command、MCP、Subagent、Hooks を一通り「削る目」で棚卸ししました。わたしの手元の場合、作業を通じて以下のように圧縮されました。

- `CLAUDE.md`: 180 行 → 85 行
- slash commands: 30 個 → 13 個
- Hooks: 8 個 → 3 個
- MCP: ハンズオン用に 1 個追加、古いものを 2 個削除

数字だけ見ると「減っている」のですが、大事なのは数字ではなく、残ったものが「今の自分にとって本当に必要な scaffolding」になったことです。削ったあとの Claude Code の動きは、半年前より自分の好みに合っています。モデルが賢くなった分、scaffolding を削ってよい余地が増えた、ということに他なりません。

### 四半期に一度、棚卸しの儀式にする

このハンズオンを、四半期に一度、または新しい Claude モデルが出たタイミングで、儀式として回すことをおすすめします。カレンダーに `claude-code-audit` というイベントを毎年 4 回入れておくとよいです。

やることは毎回同じで、

1. バックアップを取る
2. `CLAUDE.md` を Claude にレビューさせる
3. slash command を A/B で見直す
4. Subagent と Hooks を「運用ルール」と「scaffolding」に分ける
5. 不要になった scaffolding を退避ディレクトリに移す
6. 1 週間運用して、戻したいものがあれば戻す
7. 残りを `git rm` で永久削除する

これだけです。1 回の所要時間は、わたしの場合で 2 時間ほどです。

### 親記事に戻る

なぜこの作業が意味を持つのか、の背景は、姉妹記事「[流れるものは変わった、土台は変わっていない ── Multics の失敗から Claude Code まで、設計思想を辿る](https://note.com/)」にあります。Multics が全部入りで失敗した 1965 年から、`grep` と `glob` に戻った 2025 年までの半世紀の流れを追うと、「削ることが進歩である」という感覚が身体に入ります。本記事のハンズオンは、その感覚を自分の手元で一度でも体験してもらうためのものです。

それでは、みなさまの次の判断が、削る側の判断でありますように。

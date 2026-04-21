# 自分の Claude Code を覗く ── mitmproxy、~/.claude/、/doctor、OpenTelemetry で動いている姿を見る

## この記事でわかること

- `~/.claude/` 配下のファイルを `jq` で覗いて、自分のセッションが何を保持しているかを自分の目で確認する手順
- `/doctor`、`/context`、`/cost`、`--debug` を使い分けて Claude Code の自己診断を取る方法
- mitmproxy を reverse proxy として挟み、`/v1/messages` の送信内容と SSE ストリームを観測する最小手順
- OpenTelemetry を有効化し、メトリクスを自分の PC の stdout に流して眺めるまでの流れ
- PostToolUse Hook で Claude の挙動を観測可能な形で変える例

## はじめに

この記事は、姉妹記事 [Claude Code を解体してみる ── バイナリ、エージェントループ、通信層、その構造の観察記](https://note.com/)（以降、親記事と呼びます）のハンズオン編です。親記事で書いた「3 層（tools → system → messages）の送信構造」「21 のライフサイクルイベント」「OpenTelemetry 観測」といった概念を、自分の手元で動いている Claude Code で実際に確かめていきます。

親記事を読まずに本記事だけを読んでもハンズオン自体は進められます。ただ、「なぜこの観察が面白いのか」の背景が気になったら、親記事に戻っていただければ文脈がつながると思います。

作業のなかには、mitmproxy で Anthropic API への通信を見るといった、やや踏み込んだ手順が含まれます。実施前に、次の 3 点を確認してください。

1. ここで使うのは自分の個人アカウントのトークンだけにする。会社支給のサブスクや共有アカウントでは実行しない
2. 実験用の空プロジェクトを 1 つ用意し、機密を含むリポジトリや本番環境では操作しない
3. 手順の途中でバックアップを取る段取りを用意し、手戻りできる形で進める

前提にしているバージョンは次の通りです。

- Claude Code 2.x 系（記事執筆時点の latest は v2.1.116、stable tag は v2.1.104）
- Node.js 20 以上
- Python 3.10 以上
- `jq`、`git`、`mitmproxy`、`curl`

macOS、Linux、WSL2 のいずれでも進められます。コマンド例は bash/zsh を想定しています。

では始めましょう。

---

## 第 0 章　準備

### 0-1. バックアップを取る

`~/.claude/` 配下は、設定、履歴、OAuth トークン、プロジェクト別のトランスクリプトが入り混じる大事な場所です。観察だけのつもりでも、誤ってファイルを書き換えてしまうことは起こりえます。作業前に、ホームディレクトリ全体のスナップショットを別の場所に 1 つ作ります。

```bash
STAMP=$(date +%Y%m%d-%H%M)
mkdir -p ~/tmp/claude-code-anatomy-audit/$STAMP
cp -R ~/.claude ~/tmp/claude-code-anatomy-audit/$STAMP/home-claude
cp ~/.claude.json ~/tmp/claude-code-anatomy-audit/$STAMP/claude.json
```

戻したいときは、`cp -R ~/tmp/claude-code-anatomy-audit/<STAMP>/home-claude ~/.claude` で置き換えられます。また、`~/.claude.json` は OAuth トークンが入っているファイルなので、スナップショットの保管場所（`~/tmp` 以下）がクラウド同期対象になっていないか確認しておいてください。同期対象ならば、保管先を `~/.cache/` 以下など同期対象外の場所に変えます。

### 0-2. 実験用ディレクトリを作る

親記事で触れた通り、`/doctor` は MCP サーバを起動してしまうため、信頼できないディレクトリで実行するリスクがあります。ハンズオンでは専用の空ディレクトリを 1 つ用意しておきます。

```bash
mkdir -p ~/sandbox/claude-code-anatomy
cd ~/sandbox/claude-code-anatomy
git init -q
echo "# anatomy sandbox" > README.md
git add README.md && git commit -qm "init"
```

以降の作業は、このディレクトリで Claude Code を起動することを前提にします。

### 0-3. 現状の棚卸し

いま手元にある Claude Code 環境の輪郭を、簡単なコマンドで見ておきます。

```bash
claude --version
npm view @anthropic-ai/claude-code version
ls -la ~/.claude/ | head -30
du -sh ~/.claude/ ~/.claude.json
```

1 行目は自分の手元にインストールされている版、2 行目は npm レジストリの最新安定版です。版にずれがあれば、最新に追いつくか、あえて古いまま観察するかを選びます（観察の目的によります）。3 行目と 4 行目で、配下のファイル一覧とディレクトリの容量を眺めておきます。容量が数百 MB を超えている場合、過去のセッション履歴や file-history が溜まっている可能性があるので、必要に応じて整理を検討してもよい時期かもしれません。

---

## 第 1 章　`~/.claude/` を覗く

### 1-1. `~/.claude.json` の中身を確認する

ホームディレクトリ直下の `~/.claude.json` は、OAuth トークンと MCP サーバ認証情報を含む、最も要注意のファイルです。中身を `jq` で眺めるときは、トークンを誤って表示しないようにマスキングを挟みます。

```bash
jq '
  del(.oauthAccount)
  | del(.subscriptionNoticeCount)
  | .mcpServers |= with_entries(.value.env |= map_values("<REDACTED>"))
' ~/.claude.json | head -80
```

`del(.oauthAccount)` で OAuth 関連オブジェクトを削り、MCP サーバの `env` フィールドをすべて `<REDACTED>` に置き換えます。これで画面にトークンが出ないまま、構造だけを観察できます。

確認できる主要フィールドは次のようなものです。

- `projects`: プロジェクトパスごとのセッション状態、最終使用日、mcp 使用状況
- `mcpServers`: 登録済み MCP サーバの一覧と起動コマンド
- `shiftEnterKeyBindingInstalled`: ターミナル設定の記録
- `lastOnboardingVersion`: 初回セットアップの完了バージョン

「最近どのプロジェクトで Claude Code を使っていたか」「どの MCP サーバが登録されているか」の全体像が、このファイル 1 つに凝縮されているのが見えます。

### 1-2. トランスクリプト JSONL を読む

`~/.claude/projects/` 配下には、プロジェクトパスをエンコードしたディレクトリが作られ、その中にセッションごとの `.jsonl` ファイルが積まれていきます。最近のセッションを 1 つ開いてみます。

```bash
LATEST=$(ls -t ~/.claude/projects/*/*.jsonl | head -1)
echo "Latest transcript: $LATEST"
wc -l "$LATEST"
```

1 つのセッションで数百から数千行の JSONL になっているはずです。`type` フィールドの分布を見ると、セッション構造がおおよそ掴めます。

```bash
jq -r '.type' "$LATEST" | sort | uniq -c | sort -rn
```

出力は次のようになります（セッション内容により比率は変わります）。

```text
  142 assistant
  138 user
   67 file-history-snapshot
    1 queue-operation
```

user と assistant がほぼ同数で、間に file-history-snapshot が挟まっているのがわかります。ターンごとに 1 回のユーザー入力があり、それに応じたアシスタント応答があり、書き換えのたびにスナップショットが追加される、というリズムです。

自分の発言だけを抽出したいときは、こうします。

```bash
jq -r 'select(.type == "user") | .message.content' "$LATEST" | head -20
```

逆に、Claude が使ったツール呼び出しを列挙したいときは、こうです。

```bash
jq -r '
  select(.type == "assistant") |
  .message.content[]? |
  select(.type == "tool_use") |
  "\(.name): \(.input | keys | join(", "))"
' "$LATEST" | head -30
```

ツール名と、そのときに渡された入力フィールドの名前だけが並びます。「このセッションで Bash と Edit と Read がどのくらいの比率で使われていたか」「Task（subagent）を何回呼んだか」といった分析が、コマンド 1 行でできます。

### 1-3. ファイル履歴を見る

`~/.claude/file-history/<sessionId>/` の中には、`--rewind-files` のためのファイルスナップショットが保存されています。ファイル名は `<fileHash>@v<ver>` という形式です。試しに最新セッションの file-history を覗いてみます。

```bash
SID=$(jq -r '.sessionId' "$LATEST" | head -1)
ls ~/.claude/file-history/$SID/ 2>/dev/null | head
```

`59e0b9c43163e850@v1`、`59e0b9c43163e850@v2` のようにバージョン番号が積まれているのがわかります。元ファイルが何だったかは、トランスクリプト側の `file-history-snapshot` レコードを見ると対応が取れます。

```bash
jq -r '
  select(.type == "file-history-snapshot") |
  .snapshot.trackedFileBackups |
  to_entries[] |
  "\(.key) -> \(.value.backupFileName) (v\(.value.version))"
' "$LATEST" | head
```

どのターンでどのファイルがバックアップされたか、が一覧できます。`/rewind` を使ったことがなくても、裏ではこうして差分が積まれているのです。

### 1-4. プロンプト履歴を辿る

`~/.claude/history.jsonl` は、セッション横断のプロンプト履歴です。自分が過去に Claude に何を尋ねてきたか、大まかな傾向を観察できます。

```bash
jq -r '.prompt' ~/.claude/history.jsonl | tail -30
```

長期間使っているとファイルが大きくなります。1 日単位の集計を取ると、自分の使用傾向が見えます。

```bash
jq -r '.timestamp[:10]' ~/.claude/history.jsonl | sort | uniq -c | tail -14
```

日付ごとのプロンプト数が並びます。週末に一気に使って平日は少ない、連休明けに増える、といった傾向が、Claude Code の使い方の「クセ」として見えてきます。

---

## 第 2 章　`/doctor` と `/context` と `/cost` で自己診断

### 2-1. `/doctor` を打って読む

第 0 章で用意した `~/sandbox/claude-code-anatomy` で Claude Code を起動し、`/doctor` を打ちます。

```bash
cd ~/sandbox/claude-code-anatomy
claude
```

プロンプトで `/doctor` と入力すると、チェック結果が色分けされて表示されます。典型的な出力はこうなります。

```text
Claude Code Doctor Report
  ✓ Installation: native (/home/yusuke/.local/bin/claude) [green]
  ✓ Version: 2.1.116 (up to date) [green]
  ✓ Configuration consistency [green]
  ✓ Ripgrep: found at /usr/bin/rg [green]
  ! MCP servers: 2 healthy, 1 slow (github-mcp took 3.2s) [yellow]
  ✓ CLAUDE.md size: 12.4k / 40k [green]
  ✓ Agent descriptions: 4 agents, 1.2k tokens total [green]
  ✓ Keychain access [green]
  ✓ API connectivity: 142ms to api.anthropic.com [green]
```

黄色警告が出る場合の代表例は次のようなものです。

- MCP server が起動に時間を取っている: 起動コマンドそのものが遅いか、初回のキャッシュが埋まっていない
- CLAUDE.md サイズが上限に近づいている: 40k chars を超えると red になります
- 複数バージョンが検出される: nvm や homebrew、native installer が混在している状態

どれも手動で解決できる範囲ですが、「普段気づかないまま使っている警告」を可視化してくれるのが `/doctor` の良さです。

### 2-2. `/context` で資源の残量を見る

`/context` は、いまのセッションがトークンウィンドウをどう使っているかの内訳です。

```text
⛁ ⛁ ⛀ ⛀ ⛶ ⛶ ⛶ ⛶   Opus 4.6 (200k context)
                      17.7k/200k tokens (8.9%)
Estimated usage by category
⛁ System prompt:       6.3k tokens (3.2%)
⛁ System tools:        8.2k tokens (4.1%)
⛁ Custom agents:       408 tokens (0.2%)
⛁ Memory files:        433 tokens (0.2%)
⛁ Skills:              2.3k tokens (1.2%)
⛁ Messages:              8 tokens (0.0%)
⛁ Compact buffer:      3.0k tokens (1.5%)
⛶ Free space:       179.3k       (89.7%)
```

特筆に値するのは、起動直後でも System tools と System prompt が合わせて 15k トークン近くを占めている点です。200k ウィンドウ環境では 7% 強、1M ウィンドウ環境でも 1.5% 強。このオーバーヘッドが、`/context` を見てはじめて実感できます。

Skills を多く登録している場合、Skills の行が 10k トークンを超えることがあります。その時点で「あれ、使わない Skill を登録しすぎていないか」と気付くきっかけになります。

### 2-3. `/cost` と `/status`

```text
> /cost
Total tokens: input=142k, output=8.3k, cache_read=1.2M, cache_write=46k
Total cost: $0.84 (estimated)
Session started: 2026-04-21 10:12:03 (+00:00)
```

cache_read が 1.2M にも達していることに注目してください。これが第 7 章（親記事）で書いた prompt caching の経済効果です。cache_read はキャッシュヒットしたトークンで、通常入力トークンの 10 分の 1 のコストで扱われます。結果として $0.84 という最終コストに収まっています。

`/status` は、active model、permission mode、MCP servers、tool state の現在値を表示するだけで、計測や診断は行いません。状態を素早く確認したいときに打ちます。

### 2-4. `--debug` でより深いログを取る

問題を追うときは、`--debug` でセッションを起動し、詳細ログをファイルに落とします。

```bash
CLAUDE_CODE_LOG_FILE=/tmp/claude-debug.log claude --debug
```

ログは JSON 形式で、1 ツール呼び出しあたり数 KB 流れます。後から `jq` で集計すると、ツール呼び出しのタイミングと所要時間がわかります。

```bash
jq 'select(.event == "tool_call_end") | {tool: .tool, duration_ms: .duration_ms}' \
  /tmp/claude-debug.log | head
```

デバッグが終わったらログファイルは消しておきます。debug ログには tool の入出力が生で含まれるため、後から Git リポジトリにコミットしてしまわないように扱います。

---

## 第 3 章　mitmproxy で通信を覗く

### 3-1. mitmproxy の準備

macOS と Linux で同じ流儀でインストールできます。

```bash
# macOS
brew install mitmproxy

# Linux / WSL2
pip install --user mitmproxy
```

初回起動時に CA 証明書が `~/.mitmproxy/mitmproxy-ca-cert.pem` として生成されます。この証明書を Node.js に信頼させれば、HTTPS の中身が読めます。OS 全体の信頼ストアには入れません。環境変数の `NODE_EXTRA_CA_CERTS` で Node にだけ信頼させるのが、認証層を汚さずに済む手です。

```bash
mitmweb --mode reverse:https://api.anthropic.com --listen-port 8000 &
sleep 1   # 証明書が生成されるのを待つ
ls ~/.mitmproxy/mitmproxy-ca-cert.pem
```

### 3-2. Claude Code を自前プロキシ経由で起動

```bash
export NODE_EXTRA_CA_CERTS=~/.mitmproxy/mitmproxy-ca-cert.pem
export ANTHROPIC_BASE_URL=http://localhost:8000/
cd ~/sandbox/claude-code-anatomy
claude
```

ブラウザで `http://127.0.0.1:8081` を開くと、mitmweb のダッシュボードが見えます。Claude Code にプロンプトを 1 回投げると、リクエストが流れ始めます。

### 3-3. `/v1/messages` の構造を実見する

最初のリクエストの詳細を開くと、ヘッダと JSON ボディが見えます。ヘッダの主要な項目は次のようなものです。

- `x-api-key` または `authorization: Bearer ...`
- `anthropic-version: 2023-06-01`
- `anthropic-beta: context-management-2025-06-27, ...`
- `user-agent: claude-cli/2.1.116 (...)`

ボディは親記事の第 7 章で示した通り、`system`、`tools`、`messages`、`metadata`、`anthropic_beta` からなる JSON です。`cache_control` フィールドが `system` の末尾と `tools` の末尾にそれぞれ 1 つずつ置かれていることを、自分の目で確認してください。

```text
POST /v1/messages
{
  "model": "claude-sonnet-4-6",
  "stream": true,
  "system": [
    {"type": "text", "text": "You are Claude Code, ...",
     "cache_control": {"type": "ephemeral"}}
  ],
  "tools": [
    {"name": "Bash", ...},
    {"name": "Read", ...},
    ...
    {"name": "TodoWrite", ..., "cache_control": {"type": "ephemeral"}}
  ],
  "messages": [...]
}
```

### 3-4. SSE イベントを 1 ターン分読む

`stream: true` のレスポンスは、Server-Sent Events で返ってきます。mitmweb の response タブで「Raw」にすると、`event:` と `data:` の行が連続して流れているのが見えます。

```text
event: message_start
data: {"type":"message_start", "message":{...}}

event: content_block_start
data: {"type":"content_block_start", "index":0, "content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta", "index":0, "delta":{"type":"text_delta","text":"I'll"}}

event: content_block_delta
data: {"type":"content_block_delta", "index":0, "delta":{"type":"text_delta","text":" read"}}

...

event: content_block_start
data: {"type":"content_block_start", "index":1, "content_block":{"type":"tool_use","id":"toolu_...","name":"Read","input":{}}}

event: content_block_delta
data: {"type":"content_block_delta", "index":1, "delta":{"type":"input_json_delta","partial_json":"{\"file"}}

event: content_block_delta
data: {"type":"content_block_delta", "index":1, "delta":{"type":"input_json_delta","partial_json":"_path\":\"README.md\"}"}}

event: message_delta
data: {"type":"message_delta", "delta":{"stop_reason":"tool_use"}, "usage":{"output_tokens":42}}

event: message_stop
data: {"type":"message_stop"}
```

`tool_use` の `input` が JSON の断片として積み重なっていく様子、`stop_reason: tool_use` で止まる瞬間、どれも親記事で文章として読んだものが、自分の目で見えます。このターンが終わったあと、Claude Code が Read ツールを実行し、`tool_result` を新しい `messages[]` に追加して、次のリクエストを投げる、という流れが続きます。

### 3-5. 2 ターン目以降のキャッシュヒットを確認する

2 ターン目のリクエストボディを開くと、`system` と `tools` はほとんど同じ内容のままです。ヘッダか `message_start` の usage を見ると、`cache_read_input_tokens` の値が大きく増えているはずです。

```text
"usage": {
  "input_tokens": 42,
  "cache_read_input_tokens": 14832,
  "cache_creation_input_tokens": 0,
  "output_tokens": 28
}
```

1 ターン目と比べて、`input_tokens` が激減し、`cache_read_input_tokens` に移っているのが観察できます。これが親記事で書いた「cache hit rate 96%」の実体です。自分の手元で、自分のセッションで、これが本当に起きていることを確かめられます。

### 3-6. 片付ける

観察が終わったら、mitmproxy を落とし、環境変数を外します。

```bash
pkill -f mitmweb
unset NODE_EXTRA_CA_CERTS
unset ANTHROPIC_BASE_URL
```

通常利用に戻したあと、再度 `claude` を起動して、Anthropic API にまっすぐ通信することを確認しておきます。

---

## 第 4 章　OpenTelemetry で組織メトリクスを流す

### 4-1. ローカル otel-collector を立てる

組織運用でどんなメトリクスが流れるかを自分の PC で確認するため、otel-collector を 1 つローカルに立てて、受信したメトリクスを stdout に吐かせます。docker-compose で最小構成を組みます。

```yaml
# ~/sandbox/claude-code-anatomy/otel/docker-compose.yml
services:
  otel-collector:
    image: otel/opentelemetry-collector:0.93.0
    command: ["--config=/etc/otel/config.yaml"]
    volumes:
      - ./config.yaml:/etc/otel/config.yaml:ro
    ports:
      - "4317:4317"
      - "4318:4318"
```

```yaml
# ~/sandbox/claude-code-anatomy/otel/config.yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

exporters:
  debug:
    verbosity: detailed

service:
  pipelines:
    metrics:
      receivers: [otlp]
      exporters: [debug]
    logs:
      receivers: [otlp]
      exporters: [debug]
```

起動。

```bash
cd ~/sandbox/claude-code-anatomy/otel
docker compose up -d
docker compose logs -f otel-collector &
```

### 4-2. Claude Code にテレメトリを送らせる

別ターミナルで Claude Code を起動するときに、環境変数を設定します。

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
export OTEL_METRIC_EXPORT_INTERVAL=10000
export OTEL_RESOURCE_ATTRIBUTES="service.name=claude-code,team=anatomy-lab"
cd ~/sandbox/claude-code-anatomy
claude
```

セッションで何回か Claude とやり取りすると、otel-collector のログに数秒おきにメトリクスが流れ込むのが見えます。典型的にはこういう項目です。

- `claude_code.session.count`: セッション数
- `claude_code.tool.count`: ツール呼び出し回数（tool 名を attribute で分類）
- `claude_code.token.input`: 入力トークン数
- `claude_code.token.output`: 出力トークン数
- `claude_code.cost.usd`: コスト（ドル）
- `claude_code.lines.changed`: 変更行数
- `claude_code.api.error`: API エラー数

ログに `tool_name: "Bash"`、`tool_name: "Read"` といった属性が付いているのが見えれば、「誰がどのツールをどれだけ使ったか」が集計できるダッシュボードの土台になります。

### 4-3. 本番基盤への接続イメージ

ローカル otel-collector はあくまで動作確認のためのものです。本番運用では、collector を組織の監視基盤（Grafana Cloud、Datadog、Honeycomb、Prometheus + Loki など）に向けた exporter に差し替えます。`OTEL_EXPORTER_OTLP_ENDPOINT` に本番 collector の URL を、`OTEL_EXPORTER_OTLP_HEADERS` に `Authorization=Bearer <token>` を設定すれば、個々のエンジニアの PC から本番基盤に直接メトリクスが流れます。

組織で導入するなら、環境変数を `managed-settings.d/` で配布し、メンバーの手元で個別に設定しなくても有効化される設計が現実的です。

### 4-4. 片付ける

実験が終わったら、環境変数を外して otel-collector を落とします。

```bash
unset CLAUDE_CODE_ENABLE_TELEMETRY OTEL_METRICS_EXPORTER OTEL_LOGS_EXPORTER
unset OTEL_EXPORTER_OTLP_ENDPOINT OTEL_EXPORTER_OTLP_PROTOCOL
unset OTEL_METRIC_EXPORT_INTERVAL OTEL_RESOURCE_ATTRIBUTES
cd ~/sandbox/claude-code-anatomy/otel && docker compose down
```

---

## 第 5 章　Hook を書いて挙動を変える

### 5-1. PostToolUse で自動整形

Claude がファイルを書き換えたあとに、prettier でフォーマットをかける Hook を書いてみます。`~/sandbox/claude-code-anatomy/.claude/settings.json` に次を書きます。

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "npx --no-install prettier --write \"$CLAUDE_TOOL_INPUT_FILE_PATH\" 2>/dev/null || true"
          }
        ]
      }
    ]
  }
}
```

Claude Code を再起動すると、Claude がファイルを書くたびに prettier が走るようになります。動作の確認は、`README.md` を改行の不揃いな形で書かせてから、保存後に整っていることを見るのが手軽です。

注意点として、prettier が解釈できないファイル（`.sql` や binary）で失敗してもブロックしないように `|| true` を付けてあります。これを外すと、prettier が非ゼロで落ちたときに Hook がブロック判定になり、Claude 側に「ツール実行が失敗した」と伝わります。

### 5-2. exit code 2 でブロックする例

もう 1 つ、禁止ワードが入ったらファイル書き込みをブロックする Hook を書きます。`~/sandbox/claude-code-anatomy/.claude/hooks/forbid-secret.sh` を作成します。

```bash
#!/usr/bin/env bash
set -euo pipefail
CONTENT=$(jq -r '.content // ""' 2>/dev/null || echo "")
if echo "$CONTENT" | grep -E '(AKIA[0-9A-Z]{16}|xoxb-[0-9a-zA-Z-]{50,})' > /dev/null; then
  echo "書き込み内容に AWS アクセスキーまたは Slack トークンらしき文字列が含まれています" >&2
  exit 2
fi
```

```bash
chmod +x ~/sandbox/claude-code-anatomy/.claude/hooks/forbid-secret.sh
```

`settings.json` に Hook を追加します。

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "~/sandbox/claude-code-anatomy/.claude/hooks/forbid-secret.sh"
          }
        ]
      }
    ]
  }
}
```

Claude に「AKIAEXAMPLEKEY1234567 というアクセスキーを README に書いておいて」と頼んでみると、Hook が exit code 2 で終わり、stderr の日本語メッセージが Claude に戻ります。Claude は「書き込みがブロックされたので、代替案を考えます」という挙動に移ります。

この仕組みを組織で応用すると、シークレットのコード流出を予防する最小のガードレールが作れます。取り逃しがないわけではありませんが、正規表現で捕まえる 2 〜 3 種類のトークン形式に対しては有効です。

### 5-3. 片付け

ハンズオンを終えて通常運用に戻すには、`.claude/settings.json` の Hook 定義を削除するか、`.claude/settings.local.json` に移して gitignore に任せるか、方針を決めておくとよいです。組織で同じ Hook を共有したいなら、`managed-settings.d/` に配置します。

---

## おわりに

ここまでで、親記事に書いた内容のうち、手を動かして確かめたい場所をひと通り観察してきました。`~/.claude/` 配下のファイルが「自分のセッションの台帳」であること、`/doctor` が 9 項目を淡々とチェックしてくれること、mitmproxy を 5 分挟めば `/v1/messages` の構造が自分の目で見られること、OpenTelemetry が数行の環境変数で立ち上がること、Hook が exit code 2 で Claude の手を止められること。どれも、概念として読んでいたものが、コマンド数行で目の前に現れます。

作業の最後に、バックアップを戻す手順を確認しておきます。第 0 章で取ったスナップショットから、`~/.claude/` と `~/.claude.json` を元に戻す場合は次の通りです。

```bash
# まず現状を別名で退避
mv ~/.claude ~/.claude.handson-end
mv ~/.claude.json ~/.claude.json.handson-end

# スナップショットから戻す
cp -R ~/tmp/claude-code-anatomy-audit/<STAMP>/home-claude ~/.claude
cp ~/tmp/claude-code-anatomy-audit/<STAMP>/claude.json ~/.claude.json

# 再起動して確認
claude /doctor
```

問題がなければ、退避したディレクトリは削除して構いません。

そして、ここで得た観察は、「もう一段踏み込んで見たい」と思ったときにまた開ける形で手元に残しています。半年後にまた同じ手順を辿ってみれば、その頃の Claude Code が何をどう変えているかが、自分の物差しで測れます。流れるものは変わっていきます。それを自分の目で見続けられる観察の道具を、手の中に持ち続けることが、長く Claude Code と付き合うためのいちばん確かな構えだと、わたしは思っています。

構造の観察に興味を持っていただけたら、親記事 [Claude Code を解体してみる ── バイナリ、エージェントループ、通信層、その構造の観察記](https://note.com/) に戻って、設計思想の側からも読み直していただければ幸いです。

# Claude Code を解体してみる ── バイナリ、エージェントループ、通信層、その構造の観察記

## はじめに

2026 年 3 月 31 日、Claude Code の npm パッケージ `@anthropic-ai/claude-code` の v2.1.88 が公開されました。その数時間後、ひとりの開発者が Twitter/X でこう投稿しました。「このバージョンの `cli.js` には source map が同梱されている」。結果として、通常は難読化されたバンドルの向こう側にある 1,906 個の TypeScript ファイルが、世界中の開発者から一時的に覗ける状態になりました。Anthropic は同日中にプレスコメントを出し「セキュリティ侵害ではなく、人為的ミスである」と説明したうえで、流出物を公開した GitHub リポジトリに対して DMCA takedown を送付しました。事件としてはそれで決着したのですが、あの日を境に、Claude Code の内部構造についての議論が、業界全体で一段深いところで行われるようになりました。

わたしはこの事件の前も後も、Claude Code を日常的に使い続けています。ただ、事件以前は「動くからそれでいい」という使い方をしていた自分が、事件以降は「これはどういう構造で動いているのだろう」と考える場面が増えました。公開された情報、サードパーティが独立に観測して公開した挙動、そして自分の手元のインストールから得られる事実を突き合わせていくと、Claude Code の姿は意外なほど明瞭に浮かび上がってきます。

この記事は、その過程で集めた素材を、ひとつの「解体記」としてまとめたものです。

書くにあたって決めた自分の中のルールがあります。参照するのは次の三層だけに限る、というものです。第一層は Anthropic の公開ドキュメント。第二層は、複数のサードパーティが独立に観測して公開した挙動。第三層は、自分の手元のインストールで再現できる事実。流出版 `src.zip` の中身、第三者が流出コードから cleanroom で翻訳したプロジェクトの内部コード、そういったグレー領域の素材は、この記事では参照しません。Anthropic の商用利用規約 D.4(b) が「the Services のリバースエンジニアリング」を禁じている以上、流出コードの再配布や転載はそれだけで規約違反になります。そしてなによりも、三層だけで観測できる事実が、驚くほど豊かなのです。

読者として想定しているのは、Claude Code をしばらく使っていて、そろそろ「中で何が起きているか」を気にし始めた方です。使い方カタログではなく、構造観察を求めている方に向けて書いています。途中で「これは姉妹記事で手を動かして確かめられますよ」と案内が出てきたら、それは末尾でお知らせする [自分の Claude Code を覗く ── mitmproxy、~/.claude/、/doctor、OpenTelemetry で動いている姿を見る](https://note.com/) のことです。本記事で概念を押さえ、姉妹記事で実際に自分の手で観測していただく、という二段構えを想定しています。

本記事は 9 つの章でできています。第 1 章で npm パッケージとバンドルの輪郭を掴み、第 2 章で `~/.claude/` ディレクトリの中身を棚卸しし、第 3 章でエージェントループの最小単位を描き、第 4 章で 24 以上あるツール群とシステムプロンプトの組み立てを見ます。第 5 章で記憶（CLAUDE.md と auto memory）、第 6 章で関所（permission mode と Hooks）、第 7 章で通信層（`/v1/messages` と prompt caching）、第 8 章で観測（OpenTelemetry と `/doctor`）を扱います。最後の第 9 章で、冒頭で触れた 3 月 31 日の流出事件を、ふたたび法的・倫理的な枠組みで捉え直します。結びで、ここまで見てきた構造から読み取れる設計思想を一言でまとめます。

では、いちばん外側の輪郭から始めましょう。

---

## 第 1 章　輪郭 ── npm パッケージと native binary の 2 層構成

### `@anthropic-ai/claude-code` を数字で見る

Claude Code の実体は、npm のパブリックレジストリに登録されている `@anthropic-ai/claude-code` という wrapper パッケージと、プラットフォームごとの native binary パッケージ群の 2 層でできています。記事執筆時点で、週間ダウンロード数はおよそ 1,083 万回、最新は v2.1.116（2026-04-20 公開）、`stable` dist-tag が指している版は v2.1.104 です。ライセンス欄は `SEE LICENSE IN README.md` とだけ書かれていて、README を開くと Anthropic のプロプライエタリライセンスである旨が記されています。MIT でも Apache でもなく、Anthropic 社の商用条件下で配布されているソフトウェアです。

wrapper パッケージ本体は 132 KB、7 ファイルだけの軽量な bootstrap になっています。

- `install.cjs`: postinstall で走る配置スクリプト
- `cli-wrapper.cjs`: postinstall が走らなかったときの fallback launcher（`node cli-wrapper.cjs` で起動できる）
- `bin/claude.exe`: 1 KB の ASCII スタブ。postinstall が成功すると、native binary でこの場所が置き換えられる
- `sdk-tools.d.ts`: TypeScript の型定義
- `package.json` / `LICENSE.md` / `README.md`

`package.json` の `optionalDependencies` には、プラットフォーム別の native binary パッケージが 8 つ並びます。`@anthropic-ai/claude-code-darwin-arm64`、`darwin-x64`、`linux-x64`、`linux-arm64`、`linux-x64-musl`、`linux-arm64-musl`、`win32-x64`、`win32-arm64` の 8 種類です。npm は実行環境に合ったものだけを自動的にインストールし、`install.cjs` がそれを `bin/claude.exe` にハードリンクします。linux-x64 版の実体を見ると、unpacked size は約 227 MB の ELF 64-bit 実行バイナリでした。

結果として、`claude` コマンドは「npm 経由でインストールしたあとは、Node.js を介さずに直接 exec される native binary」として動きます。`install.cjs` のコメントにも "After this runs, claude execs the native binary directly — no Node.js process stays resident." と明記されています。

### Bun でコンパイルされた標準実行ファイル

native binary に `strings` をかけてみると、`oven-sh/bun` や `Bun's debugger`、`Bun.serve` といった文字列が大量に残っているのが見えます。これは Bun の standalone executable 機能（`bun build --compile`）で、JavaScript ソースコードと Bun ランタイムをひとつの ELF/Mach-O/PE ファイルにまとめた成果物であることの証拠です。`.js` バンドルを Node が解釈する旧来のモデルから、Bun ランタイムが同梱された標準実行ファイルを OS が直接実行するモデルへ、配布形態が変わっているわけです。

旧来の `cli.js`（Bun バンドル単体を Node が実行する形）時代には、スタックトレースに `B:/~BUN/root/src/entrypoints/cli.js` のようなパスが残り、モジュール境界を推定する手がかりになっていました。native binary になった現在も React Compiler の痕跡（`_c(81)` のようなメモ化キャッシュ）や、モジュール名の文字列（`QueryEngine`、`ToolRegistry`、`PermissionSystem` 等）は strings で拾えます。ただし、バンドル境界の手がかりは旧版よりわずかに薄くなりました。

難読化のレベルも旧来と同程度の軽いものにとどまっています。変数名は 1〜2 文字のハッシュに圧縮され、制御フロー難読化のような重い変換はかかっていません。アンチデバッグも控えめで、Node.js のデバッガフラグを検出したときに `process.exit()` する分岐が観測されていた程度（XPN InfoSec のブログが 2025 年時点で報告）で、それ以上の防御は確認できません。

### なぜ native binary 配布に移行したのか

この 2 層構成が導入されたのは、記事執筆時点からさかのぼってそう遠くない時期です。公式のアナウンスは出ていませんが、結果として得られる利点は明快です。

1. Node.js のプロセスが常駐しない。起動のオーバーヘッドが数十ミリ秒単位で削減される
2. 実行に Node.js のインストールが不要になる。wrapper パッケージ自体は Node ≥18 に依存しているが、`install.cjs` が走ったあとは使われない
3. 依存ライブラリの解決や `node_modules` のロードを避けられる。postinstall 1 回の代価で、以後の起動はすべて直接 exec
4. クロスプラットフォームの配布を optionalDependencies に任せられる。不要なアーキテクチャのバイナリはダウンロードされない

旧来の `cli.js` バンドルモデルの時代に書かれた解析記事やブログを読むときは、この構造変化を頭に入れて読んでください。とくに「`cli.js` は 13MB の単一ファイル」という記述は、いまの v2.1.116 には当てはまりません。

一方で、ネイティブインストーラー（`~/.local/bin/claude` にバイナリを配置する curl 経由の公式インストール方式）も引き続き推奨されています。こちらは npm を介さず、同じ native binary を直接置く形式です。v2.1.116 の npm wrapper モデルと、公式ネイティブインストーラーの差は、配布経路の違いにほぼ収束しています。

### v2 系の主要な節目

Claude Code は週に数回のペースでリリースが続いており、マイナーバージョンの節目ごとに挙動が変わります。観測に影響する主要な節目をいくつか挙げておきます。

- v2.0.10: PreToolUse Hook が stdout の JSON でツール入力そのものを改変できるようになりました。この変更で、透過的なサンドボックス化やシークレット除去といった設計が可能になりました
- v2.0.45: PermissionRequest Hook が追加され、権限確認の瞬間を外部プロセスで横取りできるようになりました
- v2.1.10: SessionStart と別に Setup Hook が増え、初期化の段取りが細分化されました
- v2.1.59: auto memory が導入され、Claude 自身が `MEMORY.md` に書き込んで自己記述する仕組みが既定で有効化されました
- v2.1.76: Elicitation Hook が追加され、Claude からの追加情報要求を外部で仲介できるようになりました
- v2.1.83: `managed-settings.d/` という分散ポリシー管理のディレクトリが新設されました
- v2.1.88: 3 月 31 日の source map 流出事件のバージョン。即日 unpublish され、v2.1.89 に置き換えられました
- v2.1.104: `stable` dist-tag が指している版（記事執筆時点）
- v2.1.110: `/focus` スラッシュコマンドが追加
- v2.1.111: `/effort` がスライダー UI 化
- v2.1.116: `latest` dist-tag が指している版（記事執筆時点、2026-04-20 公開）。wrapper + native binary の 2 層配布モデルが定着

記事公開時点では、この節目の一覧がすでに古くなっている可能性があります。読者の方が手元の版を確認したいときは、`npm view @anthropic-ai/claude-code version` で最新安定版が、`claude --version` で手元にインストールされている版が、それぞれ取得できます。

### 解析コミュニティという水位計

Claude Code の内部構造が外側から論じられるようになったのは、英語圏と中国語圏、一部日本語圏で、この 1 年ほど活発な解析コミュニティが育ってきたからです。記事のなかで言及する観測は、そのほとんどが次のようなコミュニティに由来します。

- MinusX の「What makes Claude Code so damn good」: エージェントループの観測記として、英語圏で最も引用される一本です。いま手元で動いている Claude Code の挙動を逆算的に記述しています
- VILA-Lab の「Dive into Claude Code」: arXiv に上がった学術論文で、5 層の subsystem 構成と「98.4% がインフラ／1.6% が AI 判断」という定量分析を提示しました
- Piebald-AI の `claude-code-system-prompts` リポジトリ: 毎リリースごとに公式バンドルからプロンプト断片を抽出・公開し続けているプロジェクトです。110 を超える断片の構造を、バージョン横断で追跡できます
- `ccunpacked.dev`: QueryEngine、Tool Registry、Agent Loop、Architecture Explorer といった抽象単位を可視化した Web サイト。2026 年 4 月に GIGAZINE が記事で紹介したことで、日本語圏でも認知が広がりました
- shareAI-lab の `learn-claude-code` リポジトリ: Claude Code 「風」のエージェントハーネスを Python で 0 から再構築する教材です。MIT ライセンスで公開されていて、実装を追体験できます

注意しておきたいのは、これらのコミュニティの成果物の一部が、流出版のコードを素材にしている点です。どれを参照するかは、読み手の判断に委ねられます。わたしは、本記事の文脈では「観測の結果だけを引用し、参照元の内部コードは引かない」という線引きで使っています。

---

## 第 2 章　配置 ── `~/.claude/` という小宇宙

### 公式化されたディレクトリ仕様

Claude Code を初めて起動すると、ホームディレクトリに `~/.claude/` というフォルダが作られます。わたしが最初にこのフォルダを開けたとき、正直に書けば「ずいぶん雑多だな」という印象でした。ところが、2026 年に `code.claude.com/docs/en/claude-directory` という公式ドキュメントが新設され、このフォルダの構成要素ひとつひとつに公式の位置づけが与えられました。雑多なのではなく、用途ごとに分類された資産置き場だったわけです。

記事執筆時点で、`~/.claude/` の中身は概ね次のような構成です。

- `CLAUDE.md`: ユーザー全体で共有される記憶
- `settings.json`: グローバル設定
- `history.jsonl`: 全セッション横断のプロンプト履歴
- `stats-cache.json`: 使用統計の集計キャッシュ
- `.credentials.json`: Linux 環境時の資格情報（macOS は Keychain）
- `projects/<projectPath>/<sessionId>.jsonl`: プロジェクト配下のセッション・トランスクリプト
- `projects/<projectPath>/agent-<shortId>.jsonl`: サブエージェントのトランスクリプト
- `plans/`: Plan mode で生成されたプランのマークダウン
- `file-history/<sessionId>/<fileHash>@v<ver>`: `--rewind-files` のためのファイル履歴
- `todos/<sessionId>-agent-<agentId>.json`: TodoWrite の保存
- `session-env/<sessionId>/`: セッションごとの環境スナップショット
- `shell-snapshots/`: Bash の履歴
- `debug/<sessionId>.txt`: `--debug` の出力先
- `commands/`: ユーザー定義のスラッシュコマンド（legacy）
- `skills/<skillName>/SKILL.md`: ユーザー Skills
- `agents/<agentName>.md`: ユーザー Subagents
- `plugins/{config.json, repos/}`: プラグイン関連
- `rules/`: `paths:` frontmatter で条件付けされる `.md` ルール
- `ide/`: IDE のロックファイル
- `statsig/`: Feature flag のキャッシュと Stable ID
- `telemetry/`: テレメトリ関連のローカルファイル

そして、ホームディレクトリの直下に `~/.claude.json` と `~/.claude.json.backup` が置かれます。わたしはこの 2 ファイルの存在を最初に見たとき、ちょっとしたざわつきを覚えました。なぜなら、ここには OAuth トークン、MCP サーバの認証情報、プロジェクト別のセッション状態が、すべて平文の JSON で入っているからです。ファイルシステムのパーミッション（macOS であれば ACL、Linux であれば 600 ないし 640）に頼ってのみ保護されている、という状態です。

### `~/.claude.json` を扱うときの注意

平文だからといってセキュリティ設計が甘いわけではなく、設計の選択として「OS のパーミッションに委ねる」を選んでいる、と読むのが妥当です。ただ、運用上の注意点はいくつかあります。

ひとつは、バックアップ対象からの除外です。Time Machine や rsync、クラウド同期の対象に `~/.claude.json` が含まれていないか、一度確認しておく価値があります。とくに会社の PC で利用している場合、会社のバックアップ基盤が個人の OAuth トークンを吸い上げていないか、という点は気にしておきたいところです。

もうひとつは、マシン間でのファイル共有です。`~/.claude.json` を別マシンに dotfiles としてコピーしてはいけません。OAuth トークンはマシン固有であるべきで、そのまま共有すると、不正利用の痕跡を追えなくなります。

3 番目は、3 月 31 日事件の遠因です。npm が `.npmignore` を `files` フィールドよりも後で適用する、という仕様のため、`.npmignore` に書いていなかったファイルがパッケージに紛れ込む事故が発生しうることが、事件の原因のひとつとして事後解析で指摘されました。ONE WEDGE の ykbone さんが Zenn で詳しく解説しています。自分で npm パッケージを配布している読者の方は、他山の石として配布物の最終内容を `npm pack --dry-run` で確認しておくことをおすすめします。

### トランスクリプト `.jsonl` を読む

`projects/<projectPath>/<sessionId>.jsonl` は、1 行 1 レコードの JSONL 形式です。このファイルを読むと、1 セッションで Claude が何を受け取り何を返したかが、ほぼそのまま追えます。1 レコードのスキーマを観察すると、`type` フィールドが `user | assistant | file-history-snapshot | queue-operation` のいずれかを取り、それに応じた構造の本体が続きます。

たとえば `type: "user"` のレコードには、`cwd`、`sessionId`、`version`、`gitBranch`、`message`、`uuid`、`timestamp`、`thinkingMetadata`、`todos` といったフィールドが入ります。`type: "assistant"` のレコードは、`message`、`toolUseMessages`、`parentUuid`、`uuid`、`timestamp` といった構造です。`type: "file-history-snapshot"` には、そのターンで Claude が書き換えたファイルのバックアップパスが記録されます。

このスキーマの素晴らしいところは、1 セッションが自己完結した台帳になっている点です。どのターンで何のファイルが書き変わったか、どの tool_use がどの tool_result に対応するか、どのメッセージがどの親メッセージから派生したか、すべての関係がレコード内に埋まっています。Simon Willison 氏の `claude-code-transcripts` というツールは、この JSONL を HTML タイムラインに整形して公開できるもので、URL を共有すれば他人に自分のセッションを見せることができます。

わたしがこのスキーマを見て最初に思ったのは、「これは dump ではなく journal だ」ということでした。Claude Code は、セッションの最終結果をスナップショットとして記録するのではなく、すべての変更を append-only のログとして残しています。結果として、あとから `jq` のような素朴なツールでクエリができる。手元で試す手順は姉妹記事にまとめてありますので、実際に自分のセッションを眺めてみたい方はそちらをご覧ください。

---

## 第 3 章　ループ ── Agent loop の最小単位

### 5 段階で回る単一の while

Claude Code のエージェントループは、公式の Agent SDK ドキュメントが `agent-loop` という表題で明示的に書き下している通り、次の 5 段階です。

1. Receive: プロンプト、システムプロンプト、ツール定義、履歴をまとめて Anthropic API へ送る
2. Evaluate: Claude が `AssistantMessage`（text と tool_use のブロック列）を返す
3. Execute tools: SDK または CLI がツールを実行し、`UserMessage`（tool_result）を履歴に足す
4. Loop: `stop_reason` が `tool_use` の間、1 に戻る
5. Result: `end_turn | max_tokens | stop_sequence | refusal` のいずれかになったら、`ResultMessage` を返して終わる

ひとつの対話が終わるまでに、このループが何回も回ります。`stop_reason` の分岐がそのまま制御フローで、`tool_use` なら続行、それ以外ならターン終了、という明快さです。わたしは最初にこの設計を読んだとき、「シンプルすぎて拍子抜けするくらいだ」と感じました。複雑なワークフローエンジンも、状態遷移機械も、何もないのです。ただの while ループです。

### MinusX が観測した「単一メインスレッド、最大 1 ブランチ、フラット履歴」

MinusX というスタートアップのブログ「What makes Claude Code so damn good」は、英語圏で最も引用される Claude Code 観測記のひとつです。彼らの中心的な発見は、「Claude Code のエージェントは、単一メインスレッドで回る、最大 1 ブランチしか持たない、メッセージ履歴はフラットに保たれる」という 3 つの制約でした。

単一メインスレッド、という部分から見ていきます。Claude Code には `Task` というツールがあって、これを呼ぶと自分自身を子エージェントとして再帰的に起動できます。ここまでは、よくあるマルチエージェント設計に見えます。ところが、Claude Code の `Task` には、重要な制約が 1 つかかっています。子はさらに子を産めないのです。呼び出せるのは親から子への 1 段だけで、孫は作れません。これが「最大 1 ブランチ」の意味です。

メッセージ履歴がフラットに保たれる、というのも重要です。親エージェントから見ると、子エージェントが返してきたのは「`Task` ツールの実行結果」という 1 つの tool_result に過ぎません。子の中で何が起きたかは、親の履歴には展開されません。結果として、親の履歴は子の存在によって爆発的に複雑化することがありません。

この 3 つの制約が、Claude Code のデバッグ可能性を支えています。わたしは以前、マルチエージェントフレームワークで書かれたシステムのデバッグに苦労した経験があります。どのエージェントがどのエージェントに何を頼んだのか、どのメッセージがどのスレッドに属しているのか、すべてを追うのが最初の難関でした。Claude Code ではその難関がそもそも発生しません。「複雑さで勝つ」のではなく「複雑さを避けることで勝つ」という設計です。

### 内部コードに残っていた命名の痕跡

解析コミュニティで共有された観測のひとつに、「main loop が `nO`、非同期キューが `h2A`、sub-agent が `I2A` と命名されていた」というものがあります。shareAI-lab の `analysis_claude_code` リポジトリが 2025 年の v1.0.33 時点で報告した内容です。これは難読化後の変数名ですから、もとの名前が何だったかは外側からはわかりません。ただ、「main loop」「非同期キュー」「sub-agent」という 3 つの抽象単位が、独立したシンボルとして確かに存在している、ということだけは確認できます。

わたしがこの観測で興味深く思ったのは、この 3 つの抽象だけで、Claude Code の主要な制御フローが記述できてしまうらしい、という点です。複雑なステートマシンも、優先度付きキューも、複数段のパイプラインも必要ない。main loop が 1 本と、非同期キューが 1 本と、sub-agent という再帰呼び出し機構が 1 つ。その 3 つの組み合わせで、ここまで多様な振る舞いが実現できている、というのは、「削れるものは削る」という設計原理の鮮やかな実例だと思います。

### ターン上限をどう決めるか

エージェントループは、放っておけば `end_turn` が返るまで回り続けます。対話モードでは通常、コンテキスト上限か、Ctrl+C か、モデル自身の自発停止か、エラーのいずれかでしか止まりません。Headless モード（`claude -p`）では、`--max-turns` と `--max-budget-usd` で明示的なキャップがかけられます。

ターン上限の決め方は、用途で分かれます。CI の中で決定論的に走らせたいなら、`--max-turns 10` のような小さな数字にして、途中で止まったら人間が判断する設計にするのが安全です。逆に、バックグラウンドで自律的に長く考えさせたいなら、`--max-budget-usd 5` のようにコスト側でキャップするのが現実的です。このあたりの実務感覚は、姉妹記事で具体例を示します。

---

## 第 4 章　道具箱 ── 24+ のツールと条件付きプロンプト

### 組込ツールの一覧

Claude Code が起動時に Claude に提示する組込ツールは、記事執筆時点で 24 個以上あります。概観として分類すると、次のようになります。

- ファイル系: `Read`、`Write`、`Edit`、`MultiEdit`、`NotebookEdit`
- 検索系: `Glob`、`Grep`
- 実行系: `Bash`、`KillBash`
- Web 系: `WebFetch`、`WebSearch`
- 計画・管理系: `TodoWrite`、`ExitPlanMode`、`EnterPlanMode`、`EnterWorktree`、`ExitWorktree`
- 委譲・拡張系: `Task`（subagent）、`Skill`、`AskUserQuestion`
- 特殊系: `Sleep`、`Computer`、`LSP`、`CronCreate`、`TaskCreate`、`TeammateTool`、`TeamDelete`、`SendMessageTool`

Piebald-AI の `claude-code-system-prompts` リポジトリは、毎リリースごとに公式バンドルからこれらのツール定義を抽出して、バージョン間の差分を追える状態にしてあります。わたしは新しいバージョンがリリースされるたび、このリポジトリの diff を眺める習慣をつけています。「どのツールがいつ生まれ、いつ description が書き換わり、いつ廃止されたか」を追っていると、Claude Code の設計者が何を重視しているかが透けて見えます。

### なぜ `Grep` は ripgrep を直接呼ぶのか

組込ツールのなかで、わたしが最も設計思想を象徴していると思うのが `Grep` です。このツールは、ripgrep（`rg` コマンド）を直接呼び出すラッパーです。ベクトル埋め込みでもなければ、独自のインデックスでもありません。人間が `rg` をターミナルで叩くときとほぼ同じ動作をしています。

一見すると、これは「古い」設計に見えるかもしれません。2023 年頃の AI ツールチェーン論では、「コード検索にはベクトル DB が必要だ」という主張が支配的でした。GitHub Copilot Chat の初期版は、プロジェクトにベクトルインデックスを構築していました。ところが 2026 年の Claude Code は、その層をまったく持ちません。なぜか。

答えは、ripgrep のほうが単純に速くて正確だからです。モダンな SSD 上では、数十万ファイルのプロジェクトでも `rg` は秒単位で全文検索を完了します。ベクトル埋め込みはセマンティックな近さを扱える一方で、変数名やファイルパスといった「正確な文字列マッチ」を求められる場面では、むしろ不正確になります。コーディングエージェントが必要とする検索は、多くが後者です。

この設計の背景を、もっと広い文脈で掘り下げた記事を過去に書きました。気になる方は [流れるものは変わった、土台は変わっていない ── Multics の失敗から Claude Code まで、設計思想を辿る](https://note.com/) を併せてお読みください。この記事では設計観察にとどめ、哲学的な背景には踏み込みません。

### システムプロンプトは単一モノリスではない

Claude Code のシステムプロンプトは、多くの方が想像するような「長いひとつのマークダウン」ではありません。Piebald-AI の観測によれば、110 を超える断片が、条件付きで組み立てられています。主要な断片の種類を挙げると、次のようになります。

1. メインシステムプロンプト: `"You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK."` で始まる、識別子・セキュリティ姿勢・URL ポリシー・トーン・ファイル慣例・ツール呼び出し文法を述べた本体
2. ツール記述: 24 個を超えるツールそれぞれの独立した description
3. Sub-agent プロンプト: Explore、Plan mode enhanced、Plan mode iterative、general-purpose それぞれに専用のプロンプトが用意されています
4. ユーティリティ系: Agent creation architect、CLAUDE.md creation、Status-line setup、Conversation summarization、Security monitor、Verification specialist、Bash command prefix detection、Session title generator、Dream memory consolidation など
5. スラッシュコマンドプロンプト: `/batch`、`/schedule`、`/security-review`、`/init` などのコマンド固有プロンプト
6. システムリマインダー: `<system-reminder>` タグで動的に注入される 40 以上のヒント
7. 埋込リファレンス: Agent SDK references（Python/TypeScript）、Claude API references（複数言語）、モデルカタログ、HTTP error codes、Tool use concepts、GitHub Actions template、Streaming references、Message Batches API、Files API

これらの断片は、「いまの状況で必要なもの」だけが条件付きでプロンプトに注入されます。たとえば Plan mode に入ったときだけ Plan mode enhanced が付き、`/batch` を実行したときだけ `/batch` 専用プロンプトが前置されます。本文中の `<system-reminder>` タグは、状況に応じて異なるヒントが挿入される仕組みで、モード切替や token 残量、ファイル改変の検知などを Claude に伝えます。

「110+ の断片を条件付きで組み立てる」と聞くと複雑そうに聞こえるのですが、設計原理はむしろ逆で、使わないときは載せないという省エネ志向の表れです。Claude は起動時からすべてのモードのプロンプトを読んでいるわけではなく、いまの文脈で必要なものだけを与えられる。その分、コンテキストウィンドウが浮きます。

### スラッシュコマンドと Skills が合流した 2026 年

2024 年から 2025 年にかけて、Claude Code でユーザーが拡張機能を書く場所は `.claude/commands/*.md` という「スラッシュコマンド」でした。2025 年後半に「Agent Skills」が Claude.ai 側から先行して導入され、2026 年の前半で Claude Code 側にも合流しました。その過程で、`.claude/commands/` は「legacy」とされ、`~/.claude/skills/` または `.claude/skills/` が推奨される配置になりました。

Skills の最大の特徴は progressive disclosure、つまり段階的開示です。起動時にはフォルダ配下の `SKILL.md` の YAML frontmatter（`name` と `description`）だけがシステムプロンプトに載り、本体はタスクが一致したときに初めて読み込まれます。さらに `references/` や `scripts/` 配下のファイルは、その次の段階で必要になったタイミングで Bash ツール経由で動的に読まれます。

この仕組みを深掘りした記事を以前書きましたので、Skills の設計を詳しく見たい方は [「100+スキル祭り」の裏で何が起きているか──Claude Code Skills を「繰り返し作業からの抽出」として読み解く](https://note.com/) を併読してみてください。本記事では、Skills が Claude Code のツール呼び出し機構と同じレイヤに載っている、という構造観察だけに絞ります。

Skills のスラッシュコマンド化は、`SKILL.md` に `disable-model-invocation: true` を書くことで明示できます。これを入れると、Claude が自発的に skill を呼ぶことができなくなり、ユーザーが `/` でタイプした時にだけ起動する、旧来のスラッシュコマンド的な挙動になります。予算キャップとして `SLASH_COMMAND_TOOL_CHAR_BUDGET`（既定はコンテキストの 1%、フォールバック 8,000 chars）や、1 エントリ上限 1,536 chars といった制約も設けられています。

---

## 第 5 章　記憶 ── CLAUDE.md 階層と auto memory

### 6 階層の優先順位

Claude Code の「記憶」は、次の 6 階層で構成されています。後ろほど優先度が高くなり、上書きができる関係です。

1. エンタープライズ管理ポリシー: `/etc/claude-code/CLAUDE.md`、あるいはプラットフォームごとの所定位置。管理者が設定し、ユーザー側で除外できない
2. ユーザー全体: `~/.claude/CLAUDE.md`
3. プロジェクト: `CLAUDE.md` または `.claude/CLAUDE.md`
4. サブツリー: プロジェクト配下のサブディレクトリごとの `CLAUDE.md`（遅延ロード）
5. ローカル: `CLAUDE.local.md`（gitignore される前提）
6. auto memory: `MEMORY.md`（v2.1.59+、Claude が自己記述）

この階層の設計は、`/etc/` → `~/.config/` → プロジェクトローカル、という POSIX のレイヤリングと構造的に同じです。エンタープライズ管理ポリシーが最下層、最上層が auto memory、という並びになっているのがポイントで、下にあるほど全体ルール、上にあるほど文脈依存のルールという配置です。

`@path/to/file` というインポート構文が使えて、他のマークダウンファイルを取り込めます。最大 5 階層まで深くでき、コードブロックの中に書かれた `@path` は取り込み対象にならない、という細かいルールがあります。推奨される上限は合計 40,000 chars（`MAX_MEMORY_CHARACTER_COUNT` という環境変数で既定されています）。観測上、200 行を超えたあたりから遵守率が落ちる、という報告が複数のコミュニティから出ています。

### auto memory が入ったことの意味

v2.1.59 で `MEMORY.md` の auto memory が既定有効になったことは、設計上の大きな変化でした。このファイルは、Claude 自身が「この会話で得た恒久的な学び」を書き込む場所で、Claude Code が起動するたびに先頭 200 行が `MEMORY.md` を通してプロンプトに自動的に載ります。

この機構が興味深いのは、「セッション記憶（揮発性）」と「人間が書いた恒久ルール（不揮発性）」という従来の 2 分法に、AI が書いた恒久的な学びという 3 番目のレイヤが追加された点です。わたしはこの仕組みを使い始めた最初の 1 週間、気まぐれに Claude が自分のプロフィールを書き足したり書き換えたりするのを眺めていました。たとえば「user is a data scientist, currently focused on observability/logging」のような短いメモが増えていきます。

auto memory を無効にしたい場合は `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` で停止できます。エンタープライズ環境で、ユーザーごとの学習を残したくないという要件がある場合は、この環境変数をマネージド設定で全社的に立てる運用が現実的です。

### 記憶が壊れるときの話

CLAUDE.md や MEMORY.md に丁寧に書いたルールが、セッションの進行とともに徐々に無視されていく、という現象は、Claude Code を長く使っている方なら一度は経験されているはずです。これは context rot と呼ばれる現象で、Anthropic 自身が公式ドキュメントで言及している、注意機構の構造的な限界に由来します。

この話は独立して扱ったほうがよいテーマなので、わたしは別記事 [Claude Code が指示を忘れるとき、何が起きているのか](https://note.com/) を書きました。興味のある方は、そちらで `/compact`、`/clear`、Document & Clear といった対処法を詳しく見ていただけます。本記事では、「記憶階層があれば万能というわけではなく、コンテキスト容量に応じた揮発が起きる」という構造的な事実だけを押さえておきます。

---

## 第 6 章　関所 ── 権限モデルと Hooks

### 5 つの permission mode

Claude Code は、ツール実行の前に権限確認を挟むことができるエージェントです。そして、「どのくらい確認するか」を表すのが permission mode で、記事執筆時点で 5 つのモードがあります。

- `default`: ファイル編集や Bash 実行のたびに毎回確認ダイアログが出る
- `acceptEdits`: ファイル編集は自動承認、それ以外は確認
- `plan`: 読み取り専用モード。最後にプランをまとめて提示するが、直接の編集はしない
- `auto`: 2026 年に新設された Team/Enterprise 向けモード。分類器で自動判定
- `bypassPermissions` / `--dangerously-skip-permissions`: すべてスキップ

対話モードでは、Shift+Tab を押すと default → acceptEdits → plan の 3 つをサイクルで切り替えられます。このキーバインドは頻繁に使うので、最初の 1 日で指に覚え込ませるとよいでしょう。

### Auto mode という新しい発想

2026 年に追加された Auto mode は、`--dangerously-skip-permissions` の代替として設計されました。Anthropic のエンジニアリングブログが詳しく書いている通り、このモードは 2 段の分類器で動きます。

1 段目は fast single-token filter という軽量な分類器で、明らかに安全な操作（読み取り、情報取得）と、明らかに危険な操作（`rm -rf`、外部への書き込み）をまず振り分けます。2 段目は Chain-of-Thought reasoning を使う重い分類器で、1 段目でグレーに残ったものを判定します。公称の False Positive Rate は 0.4% で、Team/Enterprise 契約でのみ利用可能です。

Auto mode の設計で興味深いのが、「reasoning-blind by design」という方針です。つまり、Claude 自身がその操作を正当化するメッセージを分類器の入力からあえて除去してから判定する、ということです。これは、悪意のあるプロンプトインジェクションに対して Claude 自身が「言いくるめられて」危険な操作を容認してしまうリスクを下げるための設計です。分類器は Claude の判断を信用せず、生の操作内容だけで判定する。この設計は、安全機構と自律性の分離という点で、きれいだとわたしは思います。

3 連続否認または累積 20 回否認で、Auto mode は自動停止します。これも、ループが暴走しないためのセーフガードです。

### `--dangerously-skip-permissions` の事故例

Auto mode が作られた背景には、従来の `--dangerously-skip-permissions` による事故がありました。2025 年 10 月の Issue #10077 では、Ubuntu/WSL2 環境で `rm -rf /` が実行されてしまう事故が報告されました。permission system そのものが失敗したケースです。2025 年 11 月の Issue #12637 では、`rm -rf *` でチルダ（`~`）が literal として展開され、意図しないファイルが消える事故が起きました。

eesel という組織が 2025 年にユーザー調査を行なったところ、`--dangerously-skip-permissions` を常用する利用者の 32% が意図外の変更を経験、9% が実際のデータ損失を経験していた、と報告されています。「危険モードは必要悪だが、安全機構として完結してはいない」という事実を、記事で読者にお伝えしておきたいです。

現場での推奨は、コンテナや sandbox でラップしたうえで `--dangerously-skip-permissions` を使う、というものです。手元のファイルシステムにそのまま適用するのは、テスト用の使い捨て環境以外では避けた方が安全です。

### 21 のライフサイクルイベント

Hooks は、Claude Code のライフサイクルの特定の瞬間に、外部プロセスを挟み込む仕組みです。記事執筆時点で、フックできるイベントは 21 種類あります。主要なものを挙げると、次のようになります。

- セッション系: `SessionStart`、`SessionEnd`、`Setup`
- ターン系: `UserPromptSubmit`、`Stop`、`StopFailure`、`Notification`、`InstructionsLoaded`
- ツール系: `PreToolUse`、`PostToolUse`、`PostToolUseFailure`、`PermissionRequest`、`Elicitation`、`ElicitationResult`
- Subagent 系: `SubagentStart`、`SubagentStop`
- Worktree/Compact 系: `Worktree lifecycle`、`Compact boundary`

ハンドラは 4 種類あります。`command`（shell コマンド、stdin に JSON が流れる）、`http`（POST URL を叩く）、`prompt`（単ターンの LLM 評価、`$ARGUMENTS` で引数を受ける）、`agent`（サブエージェントを生成して Read/Grep/Glob などを使う）。Hook が exit code 2 を返すとそのツール実行はブロックされ、stderr の内容が Claude に戻されます。

### PreToolUse の入力改変という発想

v2.0.10 で PreToolUse Hook が stdout の JSON でツール入力そのものを改変できるようになった、という変更は、地味に見えて設計上の重大な進歩でした。たとえば、Bash ツールへの入力コマンドを hook が書き換えて、`docker exec my-sandbox ...` でラップする、というような透過的なサンドボックス化が可能になります。シークレット除去、dry-run 注入、コマンドログの取得、といった SRE 的ユースケースがすべて同じ仕組みで実現できます。

Elicitation Hook（v2.1.76+）も同様の思想で、Claude からユーザーへの追加情報要求（「このファイルは削除していいですか」等）を外部プロセスが仲介できます。自動テストでは、この hook でユーザー応答を人工的に返すことで、対話部分のない CI 的な実行が組めます。

### エンタープライズ環境でのポリシー管理

組織で Claude Code を導入するとき、Hook や Permission の設定を個々のユーザーに任せきりにはできません。v2.1.83 で `managed-settings.d/` というディレクトリが新設され、管理者が分散ポリシーとして設定を置けるようになりました。`allowManagedHooksOnly` という設定を有効にすると、組織承認済みの hook 以外は動かなくなります。

組織運用の最小構成としては、次のようなスタックが定石になりつつあります。

- `managed-settings.d/` で承認済み Hook セットを配布
- OpenTelemetry でメトリクスを中央集権的に収集（第 8 章参照）
- `CLAUDE.md` の組織テンプレートを配布
- mitmproxy を自前のプロキシとして挟み、`NODE_EXTRA_CA_CERTS` で CA を通す（第 7 章・姉妹記事参照）

この 4 つを組み合わせると、Claude Code をエンタープライズ環境に安全に載せる骨格ができます。

---

## 第 7 章　通信 ── `/v1/messages` の構造と prompt caching

### リクエストは 3 層で届く

Claude Code が Anthropic の `/v1/messages` エンドポイントに送るリクエストボディは、観測すると 3 層構造になっています。`tools` → `system` → `messages` の順で、それぞれのレイヤに `cache_control` を配置して prompt caching の境界を作っています。

最小ケースでも次のような形です。ここでは記事内の引用として、概観に必要な構造だけを書きます。

```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 32000,
  "stream": true,
  "system": [
    {
      "type": "text",
      "text": "<メインシステムプロンプト>",
      "cache_control": { "type": "ephemeral" }
    },
    { "type": "text", "text": "<環境情報>", "cache_control": { "type": "ephemeral" } }
  ],
  "tools": [
    { "name": "Bash", "description": "...", "input_schema": {} },
    { "name": "Read", "description": "...", "input_schema": {} },
    {
      "name": "TodoWrite",
      "description": "...",
      "input_schema": {},
      "cache_control": { "type": "ephemeral" }
    }
  ],
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": [{ "type": "tool_use" }] },
    { "role": "user", "content": [{ "type": "tool_result" }] }
  ],
  "metadata": { "user_id": "..." },
  "anthropic_beta": ["context-management-2025-06-27"]
}
```

`tools` の末尾と `system` の末尾に `cache_control: {"type": "ephemeral"}` が置かれていることに注目してください。この 2 つの breakpoint が、prompt caching の境界を定義しています。Anthropic の prompt caching は、リクエスト単位で「どこから先がキャッシュ可能か」を明示する必要があって、その境界が cache_control です。

### 3 階層で無駄を削るキャッシュ経済学

Claude Code の送るリクエストは、キャッシュの観点から 3 階層に分けて考えられます。

1. 全ユーザ共有: メインシステムプロンプト、ツール定義。基本的には全 Claude Code ユーザで同じ内容です。Anthropic 側でエッジキャッシュされている可能性が高く、ヒットしたときの読み込みは非常に高速です
2. プロジェクト共有: `CLAUDE.md` の内容。プロジェクト内で開発する複数人のメンバー、あるいは同一開発者の複数セッションで共有されます
3. セッション固有: 実際の会話履歴、tool 実行結果。このセッションでしか使えません

claudecodecamp.com というサイトの「How Prompt Caching Actually Works in Claude Code」という記事が、この 3 階層を最も精緻に解説しています。彼らの計測によれば、初ターンを過ぎたあとはキャッシュヒット率が 96% 前後まで上がり、ルートセッションあたり 80 ドル級のコスト削減効果が観測されるとのことです。Pro プランが月 20 ドルで成立している経済的な土台のひとつが、この 3 階層キャッシュだと言えます。

わたしがこの計測を見て感心したのは、ユーザー側が特別な工夫をしなくても、この経済が回るように設計されている点です。Claude Code を使うだけで、送信内容は自動的にキャッシュ効率の高い構造で組み立てられます。ユーザーからは透明で、しかし裏では重要な最適化が回っている。こういう設計を見ると、「優れた道具とは、こういうものだ」と改めて思います。

### Streaming SSE を 1 ターン分読む

`stream: true` でリクエストを送ると、レスポンスは Server-Sent Events の形で返ってきます。イベント種別は次の通りです。

- `message_start`: セッション開始、usage の初期値
- `content_block_start`: 新しいブロック開始（text / tool_use / thinking）
- `content_block_delta`: ブロック内容の差分。`text_delta`、`input_json_delta`（tool_use の部分 JSON）、`thinking_delta` のサブタイプがあります
- `content_block_stop`: ブロック終了
- `message_delta`: `stop_reason` と `usage` の差分
- `message_stop`: メッセージ全体の終了
- `ping`: keepalive
- `error`: エラー

tool_use の `input` は `input_json_delta` で部分 JSON が流れてくるので、クライアント側は蓄積してパースする必要があります。JSON が途中で切れた段階では当然 parse できないので、`content_block_stop` を待ってから構造として使う、という制御になります。Claude Code の内部では `QueryEngine` というモジュールがこのストリームを受けて、`Tool Registry` に渡す、という流れになっていると推測できます（解析コミュニティの観測と一致します）。

thinking ブロックは、cache_control で直接キャッシュはできないのですが、以前のアシスタントターンに他のブロックと一緒に含まれている場合は、入力トークンとしてカウントされキャッシュ対象にはなります。この細かい挙動は公式の prompt caching ドキュメントに記載されています。

### mitmproxy で覗くと見えるもの

この章で書いた 3 層構造や SSE イベントは、mitmproxy を Claude Code と Anthropic API の間に挟むと、すべて自分の目で見られます。`brew install mitmproxy` でインストール、`mitmweb --mode reverse:https://api.anthropic.com --listen-port 8000` で起動、`NODE_EXTRA_CA_CERTS` と `ANTHROPIC_BASE_URL` を環境変数で設定、という 4 ステップだけです。

具体的な手順、画面のスクリーンショット、実際のリクエストを見たときの気づき、などは、姉妹記事 [自分の Claude Code を覗く](https://note.com/) で扱います。本記事では、構造の概観だけで止めておきます。

安全上の注意だけ書き添えておきます。mitmproxy を挟むとき、業務用のサブスクトークンや、機密情報を含むプロジェクトで実行するのは避けてください。自分のトークンで、自分の実験用プロジェクトで、自分の責任範囲で行う、という 3 点を守っていれば、これは観察のための優れたツールです。

---

## 第 8 章　観測 ── テレメトリと `/doctor`

### OpenTelemetry 対応の最小設定

Claude Code は OpenTelemetry を第一級の観測インタフェースとして採用しています。有効化するには、次のような環境変数を設定します。

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_ENDPOINT=https://otel-collector.example.com:4317
export OTEL_EXPORTER_OTLP_PROTOCOL=grpc
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <token>"
export OTEL_METRIC_EXPORT_INTERVAL=60000
export OTEL_RESOURCE_ATTRIBUTES="service.name=claude-code,team=backend"
```

送信されるメトリクスとログには、セッション数、変更行数、コスト、トークン数、ツール呼び出し回数、失敗率などが含まれます。Prometheus、Datadog、Grafana Cloud といった既存の観測基盤と、OTLP プロトコル経由でそのまま繋がります。

組織で Claude Code を導入するなら、この OTel 連携を最初に整えるのが実務的には一番コスパが良いとわたしは思っています。誰がどれだけ使っているか、どのプロジェクトが一番重いか、API コストの総額がいくらか、といった指標が、ダッシュボードで継続的に見えるからです。

### opt-out の階層

OpenTelemetry を有効にしていない状態でも、Claude Code は少量のテレメトリを Anthropic のエンドポイントに送っています。feature flag を司る Statsig や、エラー報告を受ける Sentry 相当のサービスが、既定で呼ばれます。opt-out したい場合は、環境変数で段階的に止められます。

- `DISABLE_TELEMETRY=1`: Statsig への送信を止める
- `DISABLE_ERROR_REPORTING=1`: エラー報告を止める
- `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`: 上記 2 つに加え、自動アップデートチェックなどの非必須トラフィックを止める

組織デプロイの場合、最後の 1 つをマネージド設定で有効にするのが実務的です。メンバーの手元のマシンから非必須トラフィックが一切出ないことを管理者が保証できます。

### `/doctor` が見ている 8 項目

`/doctor` は、Claude Code の自己診断コマンドです。実行すると、おおよそ次の 8 項目がチェックされ、green（正常）、yellow（警告）、red（エラー）の 3 段階で結果が返ります。

1. インストール種別（native / npm-global / npm-local / homebrew）とパス
2. バージョンと複数インストール検出
3. 設定の一貫性（設定ファイルの記録と実インストールの一致）
4. Ripgrep availability（検索機能の前提）
5. MCP サーバの健全性（tool トークン数も含む、非同期）
6. CLAUDE.md のサイズ警告（40,000 chars 超で警告）
7. Agent descriptions の総量
8. Keychain access（macOS、OAuth 連携）
9. API connectivity

公式トラブルシューティングページにも書かれていることなのですが、`/doctor` は workspace trust dialog をスキップして MCP サーバを起動するので、信頼できないディレクトリで実行してはいけません。新規に clone したリポジトリや、Git submodule でインポートしたフォルダの中で `/doctor` を打つのは、悪意のある MCP 設定があった場合に危険です。

この自己診断は、自分の環境で Claude Code が期待通り動いていることを確認する最初のチェックポイントとして、使う価値があります。わたしは環境変更（Node のバージョン更新、新しい MCP サーバの追加、CLAUDE.md の改訂）のあとは必ず `/doctor` を打つ習慣にしています。

### `/status` と `/context` と `/cost`

`/doctor` と似て非なるコマンドに、`/status`、`/context`、`/cost` の 3 つがあります。

- `/status`: 現在の設定を読み取って表示するだけ。active model、permission mode、MCP servers、tool state など
- `/context`: セッション内のトークン使用量の内訳。system prompt、system tools、custom agents、memory files、skills、messages、autocompact buffer の各カテゴリごとの消費量
- `/cost`: セッションの API コスト累積

`/doctor` は「診断」、`/status` は「表示」、`/context` は「資源の残量」、`/cost` は「累積コスト」。用途が微妙に異なるので、組み合わせて使います。

### デバッグログの吐かせ方

問題が起きたとき、もう一歩踏み込んで内部の挙動を見たい場合は、`claude --debug` で詳細ログを stderr に吐かせられます。JSON 形式で、tool 呼び出し、API リクエスト ID、タイミング情報などが逐次流れます。

セッション全体に適用したい場合は `CLAUDE_CODE_DEBUG=1`、ファイルに落としたい場合は `CLAUDE_CODE_LOG_FILE=/tmp/claude-debug.log` を併用します。`CLAUDE_CODE_DEBUG_LOG_LEVEL` で詳細度を絞ることもできます。

手元で問題の再現条件を特定するときは、これらのログを `jq` で整形しながら読むのが定石です。第 2 章で触れたトランスクリプト JSONL と合わせて読むと、「あのタイミングで何が起きていたか」をかなりの精度で再構成できます。

---

## 第 9 章　流出 ── v2.1.88 事件と法的線引き

### タイムラインをもう一度

冒頭で触れた 2026 年 3 月 31 日の流出事件を、ここで時系列に沿ってもう一度整理しておきます。

- 04:23 ET: Chaofan Shou 氏（@Fried_rice、Solayer Labs）が v2.1.88 の npm パッケージに source map が同梱されていることを発見し X に投稿
- 同日午前中: Anthropic が公式声明を発表。「human error であり、セキュリティ侵害ではない」
- 同日: 流出物を公開した GitHub リポジトリに対して Anthropic が DMCA takedown を送付（記録は `github.com/github/dmca/blob/master/2026/03/2026-03-31-anthropic.md` に残っています）
- 同日: v2.1.88 は npm からアンパブリッシュされ、v2.1.89 が代わりに公開

source map には、約 51 万行にわたる TypeScript ソースが、1,906 のファイルに分けて含まれていました。バンドル前の姿が、数時間のあいだ、世界中の開発者から見える状態になった、ということです。

皮肉なことに、同じ時間帯（00:21〜03:29 UTC）に、axios の npm パッケージで悪意のある 1.14.1 と 0.30.4 が一時的に配信された事件も並行して起きていました。Trend Micro と Zscaler がこの 2 事件を連動して分析した報告書を後日公開しています。2026 年 3 月 31 日は、npm の配布インフラ全体が狭い時間窓のなかで波乱に見舞われた日として、後年の振り返りで引用されることになるでしょう。

### 流出物から読み取れることと、書いてはいけないこと

v2.1.88 の source map から読み取れた事実は多くあります。バンドラーが Bun であること、React Compiler が通っていること、モジュール境界の命名がどうなっていたか、feature flag でオフにされた実験的モジュールが存在していたこと。これらの観測結果は、shareAI-lab、ccunpacked.dev、Engineer's Codex など複数のコミュニティで分析記事として公開されました。

しかし、ソースコードそのものを再配布すること、大きなコードブロックを転載すること、流出版を素材にした第三者 harness の内部コードを引用すること、これらはそれぞれ Anthropic の商用利用規約 D.4(b)（リバースエンジニアリング禁止）、DMCA、そしてプロプライエタリライセンスの下で違反となります。わたしはこれらを記事では扱わず、観測結果として報告された事実の引用にとどめました。

短い象徴的な引用（1〜2 文）は fair use の範疇で記述できると考えています。たとえば、メインシステムプロンプトの冒頭 `"You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK."` のような、識別子としての役割を持つ 1 文の引用です。これは流出事件の前から、Claude 自身に「あなたは誰ですか」と尋ねれば教えてくれる情報でもありました。

### VILA-Lab arXiv 論文の観察

流出事件後、学術界から最初に出てきたまとまった分析が、VILA-Lab による arXiv 論文「Dive into Claude Code」（arXiv:2604.14228）でした。この論文の観察のうち、わたしが最も強い印象を受けたのは次のひと行です。

> Claude Code のコードベースのうち、98.4% は古典的なソフトウェアエンジニアリングのインフラであり、AI 判断に関わる本質的な新規性は 1.6% に過ぎない

この数字が何を意味しているかを考えると、ちょっと怖くなるくらいです。一般に Claude Code は「最先端の AI エージェント」と呼ばれています。ところが、実装の 98.4% は古典的なコード、つまり 20 世紀から存在した道具の組み合わせです。AI 固有の部分は 1.6%。この割合は、裏を返せば、残り 98.4% の古典的エンジニアリングを疎かにすれば、どんなに優れた AI を載せても使い物にならない、という警句でもあります。

わたしはこの数字を、Claude Code の競合プロダクトを評価するときの尺度として使うようになりました。「この競合は、古典的な部分（ファイル I/O、プロセス管理、エラーハンドリング、設定階層、テレメトリ、認証、ログ）をきちんと作り込んでいるか」という問いに置き換えて考えると、プロダクトの土台の強さが見えやすくなります。

### `claw-code` 論争とサブスクトークン流用

流出事件のあと、`claw-code` という第三者プロジェクトが話題になりました。Sigrid Jin 氏が始めたこのプロジェクトは、流出版のコードを素材に cleanroom で Python と Rust に翻訳し直す、という試みでした。Anthropic から DMCA 対応が入ったものの、議論は今も続いています。

もうひとつ、2026 年 3 月から 4 月にかけて大きく問題になったのが、第三者 harness から Claude の Pro/Max サブスクリプショントークンを流用する行為です。Anthropic はこれを TOS 違反として検知し、遮断する対応を取りました。VentureBeat が同時期に報じています。

わたしが読者の方にお伝えしたいのは、これらの「グレー」な選択肢に踏み込まないでも、Claude Code の内部構造を理解することは十分に可能だ、ということです。公開ドキュメントと、複数のコミュニティの独立観測と、自分の手元での再現実験。この 3 層で得られる情報だけで、本記事のような解体記は書けます。グレーに踏み込まずに、深い理解を得る道は残されています。

### この章の結び

Claude Code は、Anthropic のプロプライエタリソフトウェアです。規約上のリバースエンジニアリング禁止は明示されています。ただ、同時に、外側から観測できる情報は豊富で、コミュニティの独立検証も充実しています。本記事の姿勢は、この「公開情報と独立観測」の層で深く潜る、というものでした。

流出事件は、この層の下にさらに深い構造があることを垣間見せてくれた出来事です。垣間見た構造を利用して記事を書くか、垣間見る前からあった層だけで書くか、という選択は、書き手ごとに違う答えが出る問いだと思います。わたしの選択は、後者でした。それで十分に、Claude Code の姿は立ち上がってきました。

---

## 結び ── 単純さで勝つ設計を読み取る

ここまで 9 章かけて、Claude Code の外側から見える構造を追いかけてきました。最後に、全体を通して浮かび上がった設計原理を、一言で書き留めておきます。

Claude Code は、複雑さで勝つのではなく、単純さで勝つように設計されているエージェントです。

この単純さは、3 つの要素で支えられています。第一に、Anthropic 側が意図的に選択した哲学です。作者の Boris Cherny が公言している「do the simple thing first」という方針が、単一の while ループ、単一メインスレッド、最大 1 ブランチ、フラットなメッセージ履歴、という設計判断に直結しています。

第二に、UNIX 的なツールの合成です。ripgrep、stdin/stdout、exec で呼ばれる外部プロセス、環境変数、ファイルシステム。Claude Code の中核で動いている道具立ては、1970 年代の Bell Labs と構造的にほぼ同じです。この系譜を別記事で詳しく書きましたので、興味のある方は [流れるものは変わった、土台は変わっていない](https://note.com/) を併読してください。

第三に、透明で観測可能な制御フローです。mitmproxy を 5 分挟めば、すべてのリクエストが自分の目で見られます。`/doctor` を打てば自己診断が返ります。`~/.claude/` を開けば設定と履歴が丸ごと置いてあります。OpenTelemetry を有効にすれば、組織全体で何が起きているかが可視化できます。「動いている AI エージェントのなかで何が起きているかを、外側から確認できる」というこの透明性が、Claude Code を長く使うなかでの信頼感の正体だと、わたしは思っています。

2026 年 3 月 31 日の流出事件は、この透明性を一時的に「深い層まで」押し広げた出来事でした。皮肉にも、流出事件が起きたのは、Claude Code が単一ファイルの明快なバンドルだったからです。難読化を重くすることも、モジュールを複雑に入り組ませることもできたはずなのに、そうしなかった。そのつけを払う形で 1 回の流出が起きた、と読むこともできます。ただ、それでもこの設計を変えない、という判断を Anthropic が続けているとすれば、それは「透明であることの価値」を彼らが計り知っているからだ、と思います。

本記事の姉妹記事として、ここまでの内容を自分の手元で実際に観測していただく [自分の Claude Code を覗く ── mitmproxy、~/.claude/、/doctor、OpenTelemetry で動いている姿を見る](https://note.com/) を用意しました。概念だけでは腹落ちしきらない部分が、手を動かすと急に明瞭になる瞬間があります。本記事と合わせてお読みいただければ、構造の観察が読者自身の道具に変わると思います。

最後に、本記事を支えているのは、ここまで引用してきた多数の一次情報源と、独立観測を公開し続けているコミュニティの方々です。参考文献を以下に残します。いまの Claude Code の姿は、記事公開の翌週にはすでに変わっている可能性があります。`npm view @anthropic-ai/claude-code version` で最新版を確認しつつ、原典にも当たっていただくのが、いちばん確実です。

それでは、みなさまの次のセッションが、観察の目で向き合う時間になりますように。

---

## 参考文献

### Anthropic 公式ドキュメント

- [Claude Code 概要（日本語）](https://code.claude.com/docs/ja/overview)
- [Claude Code Setup](https://code.claude.com/docs/en/setup)
- [Claude Code Hooks](https://code.claude.com/docs/en/hooks)
- [Claude Code Subagents](https://code.claude.com/docs/en/sub-agents)
- [Claude Code Memory](https://code.claude.com/docs/en/memory)
- [Claude Code Permission Modes](https://code.claude.com/docs/en/permission-modes)
- [Claude Code Slash Commands](https://code.claude.com/docs/en/slash-commands)
- [Claude Code Environment Variables](https://code.claude.com/docs/en/env-vars)
- [Claude Code Troubleshooting](https://code.claude.com/docs/en/troubleshooting)
- [`~/.claude/` Directory Specification](https://code.claude.com/docs/en/claude-directory)
- [Corporate Proxy Configuration](https://docs.anthropic.com/en/docs/claude-code/corporate-proxy)
- [Agent SDK Agent Loop](https://platform.claude.com/docs/en/agent-sdk/agent-loop)
- [Agent SDK Hooks](https://platform.claude.com/docs/en/agent-sdk/hooks)
- [Secure Agent Deployment](https://platform.claude.com/docs/en/agent-sdk/secure-deployment)
- [Prompt Caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Claude Code Auto Mode（Engineering Blog）](https://www.anthropic.com/engineering/claude-code-auto-mode)
- [Equipping agents for the real world with Agent Skills（Engineering Blog）](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)

### 英語圏の主要論考

- [MinusX "What makes Claude Code so damn good"](https://minusx.ai/blog/decoding-claude-code/)
- [Kir Shatrov "Reverse engineering Claude Code"](https://kirshatrov.com/posts/claude-code-internals)
- [dev.to rigby\_ "What actually happens when you run /compact in Claude Code"](https://dev.to/rigby_/what-actually-happens-when-you-run-compact-in-claude-code-3kl9)
- [claudecodecamp.com "How Prompt Caching Actually Works in Claude Code"](https://claudecodecamp.com/p/how-prompt-caching-actually-works-in-claude-code)
- [Simon Willison "Claude Code tag"](https://simonwillison.net/tags/claude-code/)
- [Blake Crosley "Codex CLI と Claude Code を 2026 年で比較する"](https://blakecrosley.com/blog/codex-vs-claude-code-2026)
- [Formal.ai "Using Proxies to Hide Secrets in Claude Code"](https://formal.ai/blog/using-proxies-claude-code/)
- [Vector8 "The Simplicity of Success"](https://vector8.com/en/articles/lessons-from-ai-tooling-the-simplicity-of-success)
- [WaveSpeedAI "Claude Code Architecture Deep Dive"](https://wavespeed.ai/blog/posts/claude-code-architecture-leaked-source-deep-dive/)
- [Nerd Level Tech "Capture Claude Code with mitmproxy"](https://nerdleveltech.com/Capture-Claude-Code-with-mitmproxy-step-by-step-guide-with-addons-analysis-scripts)

### 学術論文・解析コミュニティ

- [VILA-Lab "Dive into Claude Code"（arXiv:2604.14228）](https://arxiv.org/html/2604.14228v1)
- [shareAI-lab/analysis_claude_code](https://github.com/shareAI-lab/analysis_claude_code)
- [shareAI-lab/learn-claude-code](https://github.com/shareAI-lab/learn-claude-code)
- [ghuntley/claude-code-source-code-deobfuscation](https://github.com/ghuntley/claude-code-source-code-deobfuscation)
- [Piebald-AI/claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts)
- [asgeirtj/system_prompts_leaks](https://github.com/asgeirtj/system_prompts_leaks)
- [ccunpacked.dev（Claude Code 可視化サイト）](https://ccunpacked.dev)

### 日本語圏の主要記事

- [森本洋平「Claude Code 日本語ドキュメント（note）」](https://note.com/samurai_worker/n/n02b081408d39)
- [TAKA「Skills/Commands/Subagents/Rules 解説（note）」](https://note.com/taka8109/n/nd3ba15a9f723)
- [AIworker「Boris Cherny 発言集と Agent Skills 活用（note）」](https://note.com/ai__worker/n/n2c30ee488677)
- [ニケちゃん「Claude Code 実践テクニック（note）」](https://note.com/nike_cha_n/n/nee3503e7a617)
- [FabyΔ「Skills/Hooks/Subagents/MCP/Plugins ガイド（note）」](https://note.com/fabymetal/n/n3f0f2873b56c)
- [クロージャー「流出ソースから抽出した設計パターン（note）」](https://note.com/qrozier/n/n5d7a37fde54a)
- [saiki「流出コードから 6 つの未公開機能（claudecodenavi.jp）」](https://claudecodenavi.jp/saiki/articles/claude-code-6-ed94be41)
- [junko_ai「v2.1.88 流出事件経緯（Zenn）」](https://zenn.dev/junko_ai/articles/3123badb508b5d)
- [tuzuminami「ランタイム視点の sub-agents/skills/hooks（Zenn）」](https://zenn.dev/tuzuminami/articles/02f4dc0aa25889)
- [ykbone（ONE WEDGE）「`.npmignore` 仕様と流出原理（Zenn）」](https://zenn.dev/ykbone/articles/71f5a58d29a180)
- [LostMyCode「claw-code 著作権回避ロジック（Qiita）」](https://qiita.com/LostMyCode/items/a867e1954b80e78cf146)

### 環境変数・設定リファレンス

- [unkn0wncode「Claude Code 環境変数一覧（gist）」](https://gist.github.com/unkn0wncode/f87295d055dd0f0e8082358a0b5cc467)
- [mculp「Claude Code env vars binary-verified（gist）」](https://gist.github.com/mculp/e6a573f2a45ef7dbbf30f6a8574c7351)
- [jedisct1「Claude Code env vars（gist）」](https://gist.github.com/jedisct1/9627644cda1c3929affe9b1ce8eaf714)
- [claudelab.net「環境変数 configuration flags ガイド」](https://claudelab.net/en/articles/claude-code/claude-code-environment-variables-configuration-flags-guide)

### OSS ツール

- [seifghazi/claude-code-proxy](https://github.com/seifghazi/claude-code-proxy)
- [dyshay/proxyclawd](https://github.com/dyshay/proxyclawd)
- [fuergaosi233/claude-code-proxy](https://github.com/fuergaosi233/claude-code-proxy)
- [Simon Willison "claude-code-transcripts"](https://tools.simonwillison.net/claude-code-timeline)

### 著者の関連記事

- [流れるものは変わった、土台は変わっていない ── Multics の失敗から Claude Code まで、設計思想を辿る](https://note.com/)
- [「100+スキル祭り」の裏で何が起きているか ── Claude Code Skills を「繰り返し作業からの抽出」として読み解く](https://note.com/)
- [Claude Code が指示を忘れるとき、何が起きているのか](https://note.com/)
- [自分の Claude Code を覗く ── mitmproxy、~/.claude/、/doctor、OpenTelemetry で動いている姿を見る（本記事の姉妹記事）](https://note.com/)

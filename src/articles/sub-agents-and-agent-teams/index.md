# サブエージェントは「速さ」のためにあるのではない ── Claude Agent SDK の設計判断を、コンテキスト圧縮という視点から読み直す

## 目次

### 第一部　なぜマルチエージェントという言葉は壊れているのか

- 1． 二つの並列化が同じ言葉で語られている問題
- 2． Anthropic が示した 5 パターンを原典で確認する
- 3． 役割で分けると、なぜサブエージェントは壊れるのか

### 第二部　Anthropic と Cognition は本当に対立しているのか

- 4． 同じ週に出た二本の記事を、時系列で読み直す
- 5． サブエージェントの本当の役割は、速さではなく圧縮にある
- 6． 等トークン予算で比較したら、差は本当に残るのか

### 第三部　Claude Agent SDK の現在地

- 7． 他フレームワークと並べて、Claude Agent SDK の位置を確認する
- 8． Claude Agent SDK の最新仕様を、わたしの環境で確かめる
- 9． Skills、Slash Commands、Subagent を使い分ける三つの軸
- 10． Hooks と MCP の使いどころ

### 第四部　設計判断に戻る

- 11． 実証データを、立場の違いごとに並べておく
- 12． 結び ── 設計開始前に、わたしがいつも立ち止まる三つの問い

---

## 第一部　なぜマルチエージェントという言葉は壊れているのか

### 1. 二つの並列化が同じ言葉で語られている問題

ある SaaS の運用支援を任されている案件で、メンバーから「マルチエージェントで組み直したい」という相談を受けたのが、わたしがこのテーマを真面目に考え直す入口でした。話を聞いていくと、彼が「マルチエージェント」という言葉で指していたのは、サブエージェントの並列実行のことでした。一方で隣のチームの設計レビューでは、同じ言葉が、ピアツーピアで会話するエージェント群のことを指していました。同じ語が、質の違うアーキテクチャをひとつのカテゴリに押し込んでしまっている。この違和感を解きほぐすのが、本記事の出発点です。

Anthropic の公式ドキュメント「Subagents in the SDK」は、サブエージェントを次のように説明しています。

> Each subagent runs in its own fresh conversation. Intermediate tool calls and results stay inside the subagent; only its final message returns to the parent.

各サブエージェントは、自身のフレッシュな会話のなかで動く。中間のツール呼び出しと結果はサブエージェントの内側にとどまり、親に戻るのは最終メッセージだけ。同じドキュメントは、サブエージェントが新たにサブエージェントを spawn できないこと、サブエージェント同士で直接通信する経路がないことも、注として明記しています。

これに対して Agent Teams は、Claude Code 側に位置づけられる、複数の Claude Code インスタンスが共有タスクリストと相互メッセージングで協調する仕組みです。永続的な状態を外部メモリに置き、エージェントが同僚のように振る舞うことを前提とした設計で、SDK の `agents` パラメータが提供するサブエージェントとは別の系列です。並列化という同じ言葉でひとくくりにされる二つの設計は、設計思想として対極にあります。

わたしが冒頭で違和感を覚えたのは、ここを区別せずに「マルチエージェント」と呼ぶことで、設計判断の場面で起きる事故が見えにくくなるからです。次の章から、その事故がどこで起きるのかを、原典に戻って順に確認していきます。

### 2. Anthropic が示した 5 パターンを原典で確認する

2024 年 12 月 19 日に Anthropic Engineering の Erik Schluntz と Barry Zhang が公開した「Building effective agents」は、エージェント設計を語るうえでいまも参照される原典です。彼らはまず Workflow とエージェントを区別します。Workflow は、事前に定義されたコードパスのなかで LLM とツールを統制するシステム。エージェントは、LLM が自律的に進路とツール使用を決定するシステム。よく語られる 5 パターンは、すべて Workflow 側の話で、自律エージェントは別物として扱われています。この区別は、しばしば誤解されたまま広まっています。

5 パターンを順に並べておきます。Prompt chaining は、タスクを直列の小さなステップに分解し、各 LLM 呼び出しが前段の出力を処理する型です。中間に programmatic な検証ゲートを挟めるのが特徴で、精度のためにレイテンシを犠牲にする選択が明示されています。Routing は、入力を分類して専門経路へ振り分ける型で、たとえば易しい質問は Haiku、難問は Sonnet という形で、コストの最適化にも効きます。前提として、分類が正確に行えることが必要です。

Parallelization には二つの派生があります。Sectioning は独立サブタスクの並列実行、Voting は同一タスクを複数回走らせて多様な結果を集める形です。Anthropic は「複数の考慮事項がある複雑タスクでは、各考慮を別 LLM コールに分けるとパフォーマンスが上がる」という経験則を併記しています。Orchestrator-workers は、Parallelization と図上は似ていますが、サブタスクが事前定義ではなく orchestrator が動的に決める点が決定的に違います。「複数ファイルへの変更を伴うコーディング」「複数情報源からの調査」が公式適用例で、後述するマルチエージェント・リサーチの中核パターンでもあります。最後の Evaluator-optimizer は Generator と Evaluator を分け、Evaluator が accept するまで反復する型です。

5 パターンの実装コードはすべて、Anthropic 公式のリポジトリ `anthropics/claude-cookbooks` の `patterns/agents/` に Python ノートブックとして公開されています。`FlexibleOrchestrator.process()` のような、orchestrator が orchestrator プロンプトを呼び、その出力を XML パースして worker に分配する素朴な実装が示されており、「フレームワークではなく直書きで始めよ」という記事の主張がそのまま実装されています。

> We suggest that developers start by using LLM APIs directly: many patterns can be implemented in a few lines of code.

開発者は LLM API を直接使うところから始めるのを推奨し、多くのパターンは数行で実装できる、というのが彼らの主張です。LangGraph、Amazon Bedrock、Rivet、Vellum などのフレームワークについて Anthropic は「便利ではあるが、抽象層が underlying prompts を隠してデバッグを難しくし、不要な複雑さを呼び込みやすい」と書き、推奨していません。わたしが Solaris 8 で 100 万ノードの LDAP 検証を 1.5 ヶ月で回したときに痛感したのは、層を剥がさないと判断ができないということでした。フレームワークが裏で何を組み立てているかを把握しないまま、その上で意思決定を続けると、いざ問題が起きたときに、どの層が壊れているのか特定できない状態に陥ります。Anthropic の警告は、その肌感覚と一致しています。

### 3. 役割で分けると、なぜサブエージェントは壊れるのか

マルチエージェントの設計が崩れる第一の原因は、役割で分割することです。planner、developer、tester、reviewer のように分けたくなる気持ちはわかります。組織の役割分担をそのまま写せば、設計したつもりになれます。ただ、その写し方が事故を起こします。

2025 年 6 月 12 日、Cognition AI の共同創業者 Walden Yan は「Don't Build Multi-Agents」を公開し、Flappy Bird クローン作成の具体例で失敗の構造を示しました。親エージェントがタスクを「Subtask 1: 緑のパイプ背景と当たり判定」「Subtask 2: 上下に動く鳥」と分割した結果、Subtask 1 はスーパーマリオ風の背景を作り、Subtask 2 は Flappy Bird らしくない鳥を作って、統合できないものができあがる。Yan は、二つのサブエージェントが互いの作業を見られないために、出来上がるものがちぐはぐになる、と指摘します。

彼が立てた二原則は短いですが本質をついています。「context を共有し、メッセージ単位ではなくエージェントトレースの全体を共有せよ」。「行動には暗黙の意思決定が含まれており、衝突する意思決定は悪い結果をもたらす」。各サブエージェントの行動には、色の選定や物理パラメータといった、明示されない意思決定がほぼ毎回含まれます。別文脈で動いている兄弟エージェントの暗黙の決定とぶつかったとき、元タスクの説明文だけをコピペで配っても解決しません。情報が言語化される前の「暗黙の前提」が、共有されないからです。

わたしがインフラの現場で何度も見てきた場面が、これと重なります。ネットワーク担当が「ここの帯域は十分」と判断し、サーバー担当が「ここのキューは詰まらない」と判断し、アプリ担当が「ここのリトライは安全」と判断したあとに、本番でだけ起きるレイテンシ事故。各担当の判断はそれぞれ正しいのに、暗黙に置いている前提が衝突した結果、システム全体としては破綻します。レイヤーで切ると、レイヤー間の暗黙の決定が見えなくなる。サブエージェントを役割で切るときに起きるのは、これと同じ構造の事故です。

正解は、役割ではなく「コンテキスト境界」で分割することです。Cognition の二原則が示しているのもこの考え方で、その後 Andrej Karpathy が 2025 年 6 月 25 日に広めた「context engineering」という言葉とも整合します。彼の言い方が要点をついています。「context engineering は、次のステップに必要な正しい情報だけで context window を埋める繊細な技芸であり科学である」。実装者の Shrivu Shankar は、役割ではなく「subdomain-specific subagent」、たとえば「テストランナーの実行に詳しいサブエージェント」「特定 API の挙動に詳しいサブエージェント」で切れと整理しました。これは Anthropic のマルチエージェント・リサーチが示す Lead Researcher からサブエージェントへの委任パターンと一貫していて、objective、output format、tools、task boundaries の四要素を明示的に渡すという設計指針につながります。

サブエージェントを設計するときの分割線は、組織図ではなく、コンテキストの境目です。組織で分けたくなったら、その分割が暗黙の決定を共有できる単位かどうかをまず疑う。これが、telephone game を起こさないための実務上の判定基準です。

---

## 第二部　Anthropic と Cognition は本当に対立しているのか

### 4. 同じ週に出た二本の記事を、時系列で読み直す

Cognition の Yan が「Don't Build Multi-Agents」を出したのは 2025 年 6 月 12 日でした。その翌日、6 月 13 日に Anthropic は「How we built our multi-agent research system」を公開します。タイトルだけ並べると、両者は正反対の主張をしているように見えます。「マルチエージェントは作るな」と「わたしたちはマルチエージェントを作ってこんなに成果を出した」。ただ、両方を丁寧に読むと、対立しているのは表面だけで、タスクの種類によって両者の主張は重ならないことが見えてきます。

Anthropic 記事が示す数字は印象的です。Opus 4 リードに Sonnet 4 サブエージェントを組み合わせる構成が、単独の Opus 4 を社内 research eval で 90.2% 上回ったこと。BrowseComp の性能分散の 80% がトークン使用量だけで説明できること。並列化によって複雑な調査時間が最大 90% 短縮できること。これらはすべて、リサーチ系で breadth-first、つまり並列化が成立するタスクで観測された数値です。同時に、トークン消費は通常チャット比で約 15 倍、シングルエージェント比で約 4 倍に膨らむことも併記されています。マルチエージェントは速くなるための仕組みでも安くなるための仕組みでもなく、特定の条件が揃ったときにだけ性能が伸びる仕組みとして位置づけられている、ということです。

そして同じ Anthropic 記事のなかに、Cognition の主張と整合する一文が含まれています。

> most coding tasks involve fewer truly parallelizable tasks than research, and LLM agents are not yet great at coordinating and delegating to other agents in real time.

ほとんどのコーディングタスクは、リサーチほど真に並列化可能なタスクが少なく、LLM エージェントは他のエージェントへのリアルタイムな調整と委任がまだ得意ではない。Anthropic 自身が「コーディングはマルチエージェント向きでない」と認めており、これは Cognition が Devin の開発で得た結論と一致します。HackerNews コメンターの整理を借りれば、二つの記事は同じことを言っていて、ただ「マルチエージェント」の定義が違うだけです。

実装者コミュニティの収束した結論は次のように整理できます。Read 寄りで breadth-first、つまり独立して並列に動かせるタスク、リサーチ、情報収集、複数視点での評価には、マルチエージェントが効きます。Write 寄りで依存関係が多く、一貫性を要するタスク、つまりコード生成や長文書作成には、シングルスレッドに context engineering を載せた構成が向いています。この線引きを意識せずに「マルチエージェント」を選ぶと、コーディング案件で 15 倍のトークンを払って telephone game に巻き込まれる、という最悪の組み合わせが起きます。

### 5. サブエージェントの本当の役割は、速さではなく圧縮にある

「マルチエージェントは並列で速い」という説明は、半分しか合っていません。Anthropic 公式の「Effective context engineering for AI agents」(2025 年 9 月 29 日)はこう書いています。

> Each subagent might explore extensively, using tens of thousands of tokens or more, but returns only a condensed, distilled summary of its work.

各サブエージェントは数万トークン以上を使って広く探索しうるが、親に返すのは凝縮され蒸留されたサマリだけ、というのが Anthropic 自身の定義です。サブエージェントの本質は「探索 → 圧縮 → 親に凝縮を返す」という情報構造の操作にあります。並列実行による速度向上は、その副産物にすぎません。同記事に書かれている「essence of search is compression」という表現は、検索という行為を「巨大な情報空間から決定に必要な少量のシグナルだけを残す行為」と再定義しています。サブエージェントは、この圧縮を独立コンテキストで実行する仕組みです。

わたしがこの「圧縮」という語に引っかかるのは、自分のキャリアの最初に muClibc と BusyBox で組んだ 400KB の Linux があるからです。1.44MB のフロッピー一枚に、ブートローダーと最小カーネルとユーザーランドの全部を載せる。glibc を捨てて muClibc を選ぶ、`init` から `ls` まで BusyBox 一本のシンボリックリンクで置き換える、不要なドライバを `make menuconfig` で一つずつ削っていく。残ったものだけが、その目的に必要な「signal」で、削った全部は「noise」です。サブエージェントが親に返す 1,000〜2,000 トークンのサマリと、フロッピー一枚に納めた 400KB のシステムは、発想として同じ系列にあります。必要なものだけを残して、それ以外は子の context のなかで使い切る。

実装者の codewithmukesh の実測値が、この非対称性を裏付けます。Claude Code セッションでは、システムプロンプト、ツール、CLAUDE.md、`git status` で約 8,700 トークンの初期オーバーヘッドが発生し、200K のコンテキストの 4.5% を初手で消費します。サブエージェントは親の context を使わずフレッシュで起動するため、「50 ファイルを読み込んで内部で 100K トークン以上を消費しても、1,500 トークンのサマリだけを親に返す」という構造を作り出せます。Shrivu Shankar の式が直感的です。サブエージェントを使わずすべて main で読むと `(X+Y+Z)*N` トークンが main を圧迫しますが、サブエージェントに委ねると `(X+Y)*N` は子の context で消費され、main は最終回答 `Z` だけを保持できます。

この構造を数字で並べると、概算がすぐにできます。サブエージェントが内部で 50K トークンを消費し、親にサマリ 1,500 トークンを返す場合、その委任ひとつでの圧縮比は約 33 倍です。Claude Code の初期オーバーヘッド 8,700 トークンを差し引いた残り 191K の親 context に対して、5 つの委任を直列で積み上げても、親に追加される入力は 7,500 トークン、残量の約 4% に収まります。サブエージェントを単発の呼び出しと見るのではなく、context window の総量に対する圧縮設計の単位として見直すと、こうした粗い概算がすぐに引けるようになります。

サブエージェントを「速くするための道具」として導入すると、トークン消費の増加に見合う性能差が出ない場面で投資判断を間違えます。「圧縮するための道具」として導入すれば、main の context を埋め尽くさずに探索を子に閉じ込めるという、別の価値軸で評価できます。この読み替えが、本記事でわたしが最も強く伝えたい一点です。

### 6. 等トークン予算で比較したら、差は本当に残るのか

ここで、両論併記のためにもう一つの視点を入れておきます。2026 年 4 月、Tran と Kiela は arXiv に投稿した論文で、FRAMES と MuSiQue データセットを使い、五種類のマルチエージェント構成、つまり Sequential、Debate、Ensemble、Parallel-roles、Subtask-parallel を、等しい思考トークン予算でシングルエージェントと比較しました。結論は刺激的です。

> Single-Agent Systems match or outperform Multi-Agent Systems when computation is normalized.

計算量を正規化して比較すれば、シングルエージェントはマルチエージェントに匹敵するか上回る。彼らは「報告されている多くのマルチエージェントの優位性は、固有のアーキテクチャ的優位ではなく、計算とコンテキストの効果でよりよく説明できる」とまで述べています。

UC Berkeley の Cemri らが 2025 年 3 月に出した「Why Do Multi-Agent LLM Systems Fail?」は、CrewAI、AutoGen、MetaGPT、LangGraph、AG2、ChatDev、Manus の 1,600 以上のトレースを分析し、14 の失敗モードを抽出しています。失敗の 41.8% が System Design、36.9% が Inter-Agent Misalignment、21.3% が Task Verification に分類され、context collapse、format mismatches、conflicting objectives といった具体例が並びます。プロンプトエンジニアリングと topology 改善で ChatDev に +14% の改善は得られましたが、すべての失敗を解決はしませんでした。

わたしは sh 縛りで仕事をしていた時期に、入力と出力と環境変数だけで全部を表現する、という規律を身につけました。あの訓練で学んだのは「測れるものだけが、最適化の対象にできる」という単純な原則です。エージェントを増やすかどうかの判断も、同じ原則で測るべきです。マルチエージェントを採用する前に、同じトークン予算をシングルエージェントに投じたか。投じた結果、性能に差が出たか。出ていないのなら、構成を増やす理由はありません。Tran と Kiela の論文と Cemri らの分析は、この測定をスキップしたまま「マルチエージェントだから速いはずだ」「マルチエージェントだから賢いはずだ」と思い込むことが、いかに広く起きているかを示しています。

Chip Huyen が「Agents」(2025 年 1 月 7 日)で示した複合誤差の警告も、同じ系列の話です。ステップごとの精度が 95% でも、10 ステップで 60%、100 ステップで 0.6% に落ちる。エージェントを増やせば増やすほど、各ステップの精度が 100% でないかぎり、精度は乗算で落ちていきます。ここでもまた、増やす前に、減らせないかを考える順序が必要です。

---

## 第三部　Claude Agent SDK の現在地

### 7. 他フレームワークと並べて、Claude Agent SDK の位置を確認する

Claude Agent SDK のサブエージェントモデルがどんな位置にあるかを把握するには、他のフレームワークと並べて見るのが早道です。整理の鍵は二軸あります。状態を共有するか隔離するか。ネスト、つまり子から孫を許すか。

| フレームワーク    | 状態管理                                        | ネスト       | 代表パターン                                | 特徴                               |
| ----------------- | ----------------------------------------------- | ------------ | ------------------------------------------- | ---------------------------------- |
| Claude Agent SDK  | 隔離(fresh context、最終 message のみ親へ)      | 不可         | Orchestrator-worker                         | 圧縮指向、context engineering 中心 |
| OpenAI Agents SDK | Manager は隔離 / Handoffs は共有                | Beta(opt-in) | Manager / Handoffs                          | 最小プリミティブ、Sandbox          |
| LangGraph         | 共有 state(reducer 制御)、checkpointer で永続化 | 可           | Supervisor / Swarm / Hierarchical           | low-level、HITL に強い             |
| AutoGen           | 各 agent 独立、message passing                  | 可           | GroupChat / Magentic-One                    | maintenance mode に移行中          |
| CrewAI            | hybrid(task context で連鎖)                     | 可           | Sequential / Hierarchical                   | role-based、学習曲線が緩い         |
| Google ADK        | 共有 session state(`output_key`)                | 可           | Sequential / Parallel / Loop の各専用 Agent | A2A protocol 対応、enterprise 向け |

二極化が見えます。shared state を採る LangGraph、ADK、CrewAI 系は協調と一貫性を取る側、isolated/message-passing を採る AutoGen、Claude Agent SDK 系は圧縮と独立性を取る側です。OpenAI Agents SDK はその中間に位置し、`agent.as_tool()` の Manager パターンが Claude Agent SDK のサブエージェントに最も近い形です。

注意しておきたい変化が二つあります。1 つ、AutoGen は 2025 年以降 maintenance mode に入り、Microsoft は新規プロジェクトに後継の Agent Framework(Semantic Kernel との統合)を勧めています。2 つ、OpenAI Swarm は educational 扱いで非推奨となり、Agents SDK が後継です。Anthropic が「Building effective agents」で LangGraph や Bedrock の名前を挙げて警告した「抽象が underlying を隠す」リスクは、これらのフレームワーク全体に広く当てはまります。

### 8. Claude Agent SDK の最新仕様を、わたしの環境で確かめる

2025 年 9 月 29 日、Claude Code SDK は Claude Agent SDK に名称が変わりました。Anthropic の「Building agents with the Claude Agent SDK」がこの変更の公式アナウンスです。破壊的変更は三点あります。

1 つ、Python パッケージ名が `claude-code-sdk` から `claude-agent-sdk` に、npm パッケージ名が `@anthropic-ai/claude-code` から `@anthropic-ai/claude-agent-sdk` に変わりました。2 つ、`ClaudeCodeOptions` が `ClaudeAgentOptions` に改称されました。3 つ、デフォルト挙動が変わり、Claude Code のシステムプロンプトが自動適用されなくなり、`CLAUDE.md` や `settings.json` などの設定ファイルが自動でロードされなくなりました。これらは `setting_sources=["project"]` のように明示しないと有効になりません。

もうひとつ重要な変更として、Claude Code v2.1.63 で Agent ツールの名前が `Task` から `Agent` に変わっています。古いブログ記事のコード例で `Task` ツールを呼んでいるものは更新が必要です。`system:init` のツールリストや `permission_denials` では依然 `Task` の名が残るため、両方を検査すると堅実です。

`AgentDefinition` の主要フィールドを公式の TypeScript 型から拾います。

```ts
type AgentDefinition = {
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: string;
  mcpServers?: AgentMcpServerSpec[];
  skills?: string[];
  initialPrompt?: string;
  maxTurns?: number;
  background?: boolean;
  memory?: "user" | "project" | "local";
  effort?: "low" | "medium" | "high" | "xhigh" | "max" | number;
  permissionMode?: PermissionMode;
};
```

Python 側の `AgentDefinition` dataclass はフィールドが TypeScript 版より絞られていて、`description / prompt / tools / model / skills / memory / mcpServers` が公式に明記されています。Python 側で `mcpServers` のみ camelCase のまま、というのは wire format 互換のための意図的な設計です。`tools` は許可リスト方式で、省略すると親の全ツールを継承し、指定すると限定されます。`model` の `'inherit'` は親と同じモデルを明示する値です。

Python での最小実装を載せます。手元で最初にこれを動かしたとき、`setting_sources` の指定忘れで `CLAUDE.md` が読まれず、30 分ほど原因を探しました。デフォルト挙動の変更は、地味に運用での落とし穴になります。

```python
import asyncio
from claude_agent_sdk import query, ClaudeAgentOptions, AgentDefinition


async def main():
    async for message in query(
        prompt="Review the authentication module for security issues",
        options=ClaudeAgentOptions(
            allowed_tools=["Read", "Grep", "Glob", "Agent"],
            agents={
                "code-reviewer": AgentDefinition(
                    description=(
                        "Expert code review specialist. "
                        "Use for quality, security, and maintainability reviews."
                    ),
                    prompt=(
                        "You are a code review specialist with expertise "
                        "in security, performance, and best practices."
                    ),
                    tools=["Read", "Grep", "Glob"],
                    model="sonnet",
                ),
            },
            setting_sources=["project"],
        ),
    ):
        if hasattr(message, "result"):
            print(message.result)


asyncio.run(main())
```

`pip install claude-agent-sdk` でインストールでき、Python 3.10 以上が要件です。`query()` は async generator で、`Message` を順に yield します。継続会話には `ClaudeSDKClient` クラスを使います。`options.agents` に渡したサブエージェントは、メインエージェントが description に基づいて自律的に呼び出します。

TypeScript での最小実装も併記します。

```ts
import { query, type AgentDefinition } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Review the authentication module for security issues",
  options: {
    allowedTools: ["Read", "Grep", "Glob", "Agent"],
    agents: {
      "code-reviewer": {
        description:
          "Expert code review specialist. Use for quality, security, and maintainability reviews.",
        prompt:
          "You are a code review specialist with expertise in security, performance, and best practices.",
        tools: ["Read", "Grep", "Glob"],
        model: "sonnet",
      } satisfies AgentDefinition,
    },
    settingSources: ["project"],
  },
})) {
  if ("result" in message) console.log(message.result);
}
```

`npm install @anthropic-ai/claude-agent-sdk`、Node.js 18 以上が必要です。Python は snake_case、TypeScript は camelCase という命名規約の違い以外は構造がほぼ同じです。ネイティブの Claude Code バイナリは optional dependency としてバンドルされるので、Claude Code の別途インストールは不要です。

プログラム的定義の代わりに、`.claude/agents/code-reviewer.md` というファイルを置く方法もあります。

```markdown
---
name: code-reviewer
description: Expert code review specialist. Use for quality, security, and maintainability reviews.
tools: Read, Grep, Glob, Bash
---

You are a code review specialist with expertise in security, performance, and best practices.
```

公式の優先順位は「プログラム定義 > ファイルシステム定義」です。SDK でファイル定義を読み込ませるには `setting_sources=["project"]` または `["user"]` の明示が必要です。これを忘れると、ファイルの存在すら SDK から見えません。

### 9. Skills、Slash Commands、Subagent を使い分ける三つの軸

Claude Agent SDK には三つの拡張機構があります。それぞれの起動方式とコンテキスト共有の仕方が異なるので、判断軸を明確にしておきます。

| 拡張機構      | 起動方式                               | コンテキスト                       | 用途                                       |
| ------------- | -------------------------------------- | ---------------------------------- | ------------------------------------------ |
| Slash Command | ユーザが `/cmd` で明示的に起動         | メイン共有                         | 繰り返し使う、人が起動するエントリポイント |
| Skill         | description マッチで Claude が自動起動 | メイン共有(progressive disclosure) | 自動適用ワークフロー、サポートファイル付き |
| Subagent      | 親が Agent ツール経由で起動            | 隔離(フレッシュ context window)    | 並列化、tool 制限、コンテキスト圧縮        |

公式は Skills について重要な制約を明記しています。「Skills は filesystem artifact としてしか作れない。SDK は Skill を登録するための programmatic API を提供しない」。一方で progressive disclosure が効きます。起動時はメタデータだけがロードされ、トリガーされたときに全文がロードされます。auto-compaction 後に再アタッチされる際は、各 skill の最初の 5,000 トークンが保持され、再アタッチされる skill 群は合計 25,000 トークンの予算を共有します。

実装者の Shrivu Shankar は、カスタムサブエージェントを brittle と批判します。`PythonTests` のような専用サブエージェントは、メインから context をゲートキープしてしまい、メインがテスト結果を holistic に推論できなくなる、という副作用を生む。さらに、人間が定義した硬直したワークフローをモデルに強制してしまう。彼の推奨は Master-Clone パターン、つまりメインエージェントが自身のクローンを Agent ツールで spawn する形で、これは `general-purpose` のサブエージェントを暗黙的に呼ばせるやり方に近いです。

判断軸を実務に落とすと、こうなります。ユーザが明示的に走らせたい繰り返し作業は Slash Command。Claude に判断させたい自動適用ワークフローは Skill。メインのコンテキストを使い切らずに探索させたい局所タスクは Subagent。三つは排他ではなく、組み合わせて使うのが普通です。

### 10. Hooks と MCP の使いどころ

Hooks はエージェントのライフサイクルに介入する仕組みで、Python SDK では `HookEvent` リテラルとして公式に列挙されています。`PreToolUse / PostToolUse / PostToolUseFailure / UserPromptSubmit / Stop / SubagentStop / PreCompact / Notification / SubagentStart / PermissionRequest` の十種類です。TypeScript 版はこれに `SessionStart / SessionEnd / TaskCompleted` などが加わります。実用的に効くのは、`PreToolUse` で Bash コマンドを検証する、`PostToolUse` で全ツール実行をロギングする、`PreCompact` で compaction の挙動をカスタマイズする、の三つです。

```python
from claude_agent_sdk import HookMatcher, ClaudeAgentOptions

options = ClaudeAgentOptions(
    hooks={
        "PreToolUse": [
            HookMatcher(matcher="Bash", hooks=[validate_bash_command], timeout=120),
        ],
        "PostToolUse": [HookMatcher(hooks=[log_tool_use])],
    }
)
```

MCP(Model Context Protocol)は外部サービスを標準化された形でエージェントに接続する仕組みで、SDK は stdio、SSE、HTTP、SDK(in-process)の四種をサポートします。Python では `mcp_servers`、TypeScript では `mcpServers` で構成します。設計上の鍵は、`AgentDefinition.mcpServers` でサブエージェントごとに利用可能な MCP サーバーを限定できる、という点です。これにより「Slack MCP は通信専用サブエージェントだけが使える」「DB MCP はクエリサブエージェントだけ」といった、権限の分離が実現します。

Compaction(コンテキスト圧縮)は SDK レベルで自動的に動き、`PreCompact` フックで介入できます。Claude Code の内部実装では三層の compaction、つまり tool result clearing、conversation summarization で 60〜80% 圧縮、手動の `/compact [focus]` が、コンテキスト容量の約 92〜95% 到達時にトリガーされます。`CLAUDE.md` はどの段階でも保持されます。サブエージェントのトランスクリプトはメイン会話の compaction に影響を受けません。これは公式に明記されている挙動で、長期作業ではサブエージェントが事実上の永続記憶として機能します。

---

## 第四部　設計判断に戻る

### 11. 実証データを、立場の違いごとに並べておく

ここまでで参照した数値を、立場の違いを隠さずに一度並べておきます。社内 eval、公開ベンチマーク、学術論文を区別して読むのが、判断を間違えないための最低条件です。

| 数値                  | 内容                                                                           | 出典・条件                                 |
| --------------------- | ------------------------------------------------------------------------------ | ------------------------------------------ |
| 90.2%                 | マルチエージェント(Opus 4 lead + Sonnet 4 sub)が単独 Opus 4 に対する性能向上   | Anthropic 社内 research eval(外部検証なし) |
| 80%                   | BrowseComp 性能分散をトークン使用量だけで説明                                  | Anthropic 回帰分析                         |
| 約 4 倍               | エージェントが通常チャットに対して持つトークン消費比                           | Anthropic                                  |
| 約 15 倍              | マルチエージェントが通常チャットに対して持つトークン消費比                     | Anthropic                                  |
| 最大 90%              | 並列化による調査時間短縮                                                       | Anthropic(複雑クエリ)                      |
| 86.8%                 | BrowseComp の Opus 4.6 + multi-agent harness スコア                            | Anthropic 公式ブログ                       |
| 40%                   | tool-testing agent によるタスク完了までの時間短縮                              | Anthropic 社内での実証                     |
| 30→80%                | プロンプト一変更での成功率向上例                                               | Anthropic                                  |
| +14%                  | プロンプトエンジニアリング介入で ChatDev 改善                                  | Cemri et al.(UC Berkeley)                  |
| 41.8% / 36.9% / 21.3% | マルチエージェント失敗モードの分布(System Design / Inter-Agent / Verification) | Cemri et al. 1,600 以上のトレース          |
| SAS が MAS と同等以上 | 等トークン予算ではシングルエージェントがマッチまたは上回る                     | Tran と Kiela 2026 年 4 月                 |
| 1,000〜2,000 tokens   | サブエージェントが親に返す凝縮サマリのサイズ                                   | Anthropic context engineering              |
| 約 8,700 tokens       | Claude Code セッション初期オーバーヘッド                                       | codewithmukesh 実測                        |
| 0.6%                  | ステップ精度 95% が 100 ステップ後に劣化する複合誤差                           | Chip Huyen                                 |

5 章で示した 33 倍という圧縮比の概算も、表の上半分(社内 eval の数値)よりは、下半分(1,000〜2,000 トークンのサマリと、8,700 トークンの初期オーバーヘッド)を組み合わせて引いた結果として読むほうが、自分の運用の概算に使いやすいはずです。

数値の出所を読み分けることが大事です。Anthropic の数値は社内 eval が中心で、独立検証はまだ薄い。Tran と Kiela の論文は「公平比較すると差は消える」と言う。Cemri らは「失敗の半分以上は System Design と Inter-Agent Misalignment にある」と報告する。マルチエージェントの効能を主張する側と、シングルエージェントの十分性を主張する側で、実は同じデータを見ながら解釈が割れている、という構造があります。

### 12. 結び ── 設計開始前に、わたしがいつも立ち止まる三つの問い

サブエージェントとエージェントチームを使い分けるとき、わたしが設計の最初に投げる問いは三つです。

1. このタスクは、独立して並列に動かせる単位に分解できるか、それとも依存関係が密か。独立して並列に動かせるならサブエージェントの Orchestrator-worker が効きますし、依存が密ならシングルスレッドに context engineering を載せるほうが勝ちます。Anthropic も Cognition も、ここでは同じことを言っています。

2. コンテキストを共有すべきか、隔離すべきか。共有が必要な暗黙の決定があるなら、隔離は telephone game を生みます。逆に、親の context を圧迫したくない、無関係な探索を子に閉じ込めたい、という場面では、隔離こそが価値です。サブエージェントを「速くするための道具」ではなく「圧縮するための道具」として読み直すのは、この問いに答えるためです。

3. そのトークン消費は、その性能差を正当化するか。通常チャットの 15 倍のトークンは、無料ではありません。Anthropic が言う high-value tasks の条件、つまり並列化が効くこと、ひとつのコンテキストに収まらない量を扱うこと、多数の複雑なツールに繋ぐことが同時に揃うときに限り、マルチエージェントはコストに見合います。Tran と Kiela の論文を踏まえれば、まずシングルエージェントで等しいトークン予算を投じてベンチマークし、それで足りないときに初めてマルチエージェント化する、という順序が、2026 年時点で最も妥当な設計プロセスだろうと思います。

冒頭に書いた、メンバーの「マルチエージェントで組み直したい」という相談に戻ります。わたしがそこで返したのは新しい構成案ではなく、最初の問いでした。「そのタスクは、独立して並列に動かせる単位に分解できますか」。返ってきた答えは、ステップ間に強い依存があるという確認で、そこから議論はマルチエージェント化を取り下げ、シングルエージェントに context engineering をどう載せるかへ振れていきました。15 倍のトークンを払う前に最初の問いで止まる。これだけで設計の方角が変わる場面は、現場に実際にあります。

実装の現場で覚えておきたいのは、たったひとつです。サブエージェントは「並列で速くするための道具」ではなく、「親のコンテキストを使い切らずに、圧縮された結論だけを取り出すための道具」です。この視点に立つと、`AgentDefinition` の `tools` 制限も、`description` の自然言語ルーティングも、Skills と Slash Commands と Subagent の使い分けも、すべて context engineering の細部としてひとつの設計言語に収束します。役割で分けるのをやめて、コンテキスト境界で分ける。それが Claude Agent SDK が提示している、本当の設計判断です。

---

## 関連記事

- [マルチエージェントは「複数立ち上げ」とどう違うのか ─ 5 パターンを Python で動かして理解する](../multi-agent-patterns-handson/) ── 本稿で扱った 5 パターンを、Anthropic SDK で実際に動かす姉妹記事です

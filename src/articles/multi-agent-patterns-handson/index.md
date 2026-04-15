# マルチエージェントは「複数立ち上げ」とどう違うのか

この記事でわかること

- シングルエージェントを複数並べることと、マルチエージェントを設計することの違い
- 5 つの代表的なパターンが、それぞれどんな問題に効くのか
- Python と Anthropic SDK で 5 つを実際に動かしたときに、どこで詰まるのか

## はじめに

「マルチエージェントって、シングルエージェントを複数立ち上げればいいのでは」。長いあいだ、わたし自身もそう思っていました。LLM の API を呼ぶ関数があるなら、それを並列に走らせれば済むのではないか、と。

この見方は半分正しくて、半分外れています。独立したタスクをまとめて捌くだけなら、確かに「並列に呼ぶ」で済みます。問題は、エージェント同士が互いの結果を踏まえて動かなければならないときに起きます。たとえばエージェント A が「このコードは脆弱性がある」と言い、エージェント B が並行して「アーキテクチャは問題ない」と返したとして、A の発見した脆弱性が実は B の見ている設計に起因するものだったらどうなるか。両者がお互いを知らずに動いている限り、その因果は人間が後から繋ぎ直すしかありません。

マルチエージェントの本質は、この「文脈をどう流すか」という設計をシステム側に持ち込むことにあります。誰が何を知るべきか、どの順番で情報が伝わるか、どこで止めるか。その配線そのものがアーキテクチャになります。

この記事では、5 つの代表的なパターンを Python と Anthropic SDK で実際に動かし、何が起きるかを確かめながら整理します。コードはすべて手元で実行して挙動を確認したものを載せています。検証で見えてきた落とし穴も、そのまま書いておきます。

## 第0章　準備

最初にこの章を置くのは、以降のコードをそのまま動かして読み進めてもらうためです。

必要なものは Python 3.10 以上と `anthropic` パッケージ、そして `ANTHROPIC_API_KEY` だけです。

```bash
pip install anthropic
export ANTHROPIC_API_KEY=sk-ant-...
```

5 つのスクリプトで共通して使うヘルパーを `common.py` に置きます。同期呼び出し、非同期呼び出し、そして JSON 抽出の三つを用意します。JSON 抽出を独立させてあるのは、第1章の Generator-Verifier で必ず必要になるからです。

````python
# common.py
import anthropic
import json
import re
from typing import Any

MODEL = "claude-haiku-4-5-20251001"

_sync_client = anthropic.Anthropic()
_async_client = anthropic.AsyncAnthropic()


def call_claude(system: str, user: str, max_tokens: int = 1024) -> str:
    r = _sync_client.messages.create(
        model=MODEL,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    return r.content[0].text


async def call_claude_async(system: str, user: str, max_tokens: int = 1024) -> str:
    r = await _async_client.messages.create(
        model=MODEL,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    return r.content[0].text


def extract_json_object(text: str) -> dict[str, Any] | None:
    """テキストから最初の有効な JSON オブジェクトを抜き出す。コードフェンスにも耐える。"""
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fenced:
        try:
            return json.loads(fenced.group(1))
        except json.JSONDecodeError:
            pass
    start = text.find("{")
    while start != -1:
        depth = 0
        for i in range(start, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start:i + 1])
                    except json.JSONDecodeError:
                        break
        start = text.find("{", start + 1)
    return None
````

モデルは `claude-haiku-4-5-20251001` を指定しています。コストを抑えつつ、5 パターンの設計差を見るには十分でした。本番では用途に応じて変えてください。

## 第1章　Generator-Verifier ─ 生成と検証を分ける

最初にこの章を置くのは、5 パターンの中でいちばん導入が容易で、しかも分けることの効能がもっともはっきり感じられるからです。

ひとつのエージェントに「コードを書いて、テストも書いて、バグもチェックして」と頼むと、自分で書いたものを自分で検証することになります。人間でも自分のミスは自分では見えにくい。ここを別エージェントに切り出すと、生成側の思い込みが検証に持ち込まれません。

仕組みは単純です。Generator が初回出力を作り、Verifier が基準で評価し、不合格なら指摘を Generator に戻して再生成する。このループを最大 N 回回します。

実装は次のとおりです。

````python
# 01_generator_verifier.py
from common import call_claude, extract_json_object

GEN_SYS = """あなたはPythonコードを書くエンジニアです。
要件に従ったPythonの関数を書いてください。
コードブロック(```python ... ```)で囲んで出力してください。"""

VER_SYS = """あなたはコードレビュアーです。
提出されたPythonコードを以下の基準で評価してください。
1. 型アノテーションが全引数と戻り値に付いているか
2. 1行以上のdocstringがあるか
3. 入力が空・不正な場合のエラーハンドリングがあるか

すべて満たす場合のみ passed を true にしてください。
返答は単一のJSONオブジェクトのみ、以下の形式で:
{"passed": true/false, "issues": ["問題点1", "問題点2"]}
JSON以外の文章・コードフェンスは出力しないでください。"""


def run(task: str, max_iter: int = 4) -> dict:
    history = []
    code = ""
    for i in range(max_iter):
        if not history:
            prompt = task
        else:
            issues = "\n".join(f"- {x}" for x in history[-1]["verdict"]["issues"])
            prompt = f"前回のコード:\n{code}\n\n指摘事項:\n{issues}\n\n上記の問題を修正してください。"

        code = call_claude(GEN_SYS, prompt)
        verdict_text = call_claude(VER_SYS, f"以下のコードを評価してください:\n\n{code}")
        verdict = extract_json_object(verdict_text) or {
            "passed": False,
            "issues": ["JSONパース失敗"],
        }
        history.append({"iteration": i + 1, "code": code, "verdict": verdict})
        print(f"[iter {i+1}] passed={verdict.get('passed')} issues={verdict.get('issues')}")
        if verdict.get("passed"):
            break
    return {"iterations": len(history), "final_code": code}


if __name__ == "__main__":
    result = run("リストの中央値を返す関数 median(numbers) を書いてください。")
    print(f"\n=== {result['iterations']} iterations ===")
````

手元で走らせると、次のような出力になりました。

```text
[iter 1] passed=False issues=['引数 numbers に型アノテーションがない', '戻り値の型アノテーションがない']
[iter 2] passed=True issues=[]

=== 2 iterations ===
```

2 イテレーションで収束しました。1 巡目で型アノテーションの欠落を Verifier が指摘し、2 巡目の修正で全基準を満たしたわけです。

### 落とし穴

検証していて引っかかった点が二つあります。

ひとつは Verifier が返す JSON の形式ブレです。Verifier の system に「JSON 以外の文章・コードフェンスは出力しない」と書いておかないと、`{...}` の前後に説明文がつくか、コードフェンスで包まれて返ってきます。`re.search(r'\{.*\}', text, re.DOTALL)` のような単純な貪欲マッチだと、ネストや余分な文字に簡単に壊されます。`extract_json_object` のような balanced scan で抜き出すか、最初から「JSON のみ」と強く指示するか、両方やっておくのが堅実です。

もうひとつは Verifier の基準を曖昧にしてはいけないということです。「良いコードかどうか評価して」と曖昧に頼むと、ほぼ毎回 `passed: true` が返ってきて、ループは形だけ動きます。検証では「型アノテーション・docstring・エラーハンドリングの三点」のように具体に落とし込むことで初めて、不合格判定が機能しました。

## 第2章　Orchestrator-Subagent ─ 指揮者と専門家

この章を置くのは、Generator-Verifier の次に踏むべき自然な一歩がここにあるからです。

タスクを分解できて、しかもそれぞれが別の専門知識を要する場合、ひとつのエージェントにまとめて渡すとコンテキストが混濁します。レビューを例に取ると、セキュリティ・テスト・スタイルはそれぞれ別の頭で見たほうがいい。それぞれを別のサブエージェントにやらせ、最後に Orchestrator が統合する、というのがこのパターンです。

実装は次のようになります。検証では f-string で SQL を組み立てている明らかな脆弱性つきのサンプルコードを渡し、セキュリティエージェントが拾うかどうかを見ました。

````python
# 02_orchestrator.py
from common import call_claude

SUBAGENTS = {
    "security": (
        "セキュリティエンジニアとして、コードのセキュリティ問題を3点以内で指摘してください。"
        "問題がなければ「問題なし」と答えてください。",
        "セキュリティレビュー",
    ),
    "testing": (
        "テストエンジニアとして、このコードのテスト可能性と、不足しているテストケースを3点以内で指摘してください。",
        "テストレビュー",
    ),
    "style": (
        "シニアエンジニアとして、コードの可読性・命名・構造を3点以内でレビューしてください。",
        "スタイルレビュー",
    ),
}

ORCH_SYS = """あなたはシニアエンジニアリングマネージャーです。
3つの観点からのコードレビュー結果を統合し、優先度付きで改善提案をまとめてください。重複は省いてください。"""


def run(code: str) -> tuple[str, dict]:
    results = {}
    for key, (sys_prompt, label) in SUBAGENTS.items():
        print(f"  -> {label}")
        results[key] = call_claude(sys_prompt, f"レビュー対象:\n```python\n{code}\n```")

    integration = (
        f"以下の3つのレビュー結果を統合してください。\n\n"
        f"セキュリティレビュー:\n{results['security']}\n\n"
        f"テストレビュー:\n{results['testing']}\n\n"
        f"スタイルレビュー:\n{results['style']}"
    )
    return call_claude(ORCH_SYS, integration), results


if __name__ == "__main__":
    sample = '''
def get_user(user_id):
    db = connect_db()
    query = f"SELECT * FROM users WHERE id = {user_id}"
    result = db.execute(query)
    return result[0]
'''
    final, results = run(sample)
    print("\n=== FINAL ===\n", final[:600])
````

手元の出力を一部抜粋すると、セキュリティエージェントは想定どおり SQL インジェクションを Critical として拾い、Orchestrator は次のような統合結果を返しました。

```text
## Critical - 即時対応が必須
1. SQLインジェクション脆弱性
   query = "SELECT * FROM users WHERE id = ?"
   result = db.execute(query, (user_id,))

## High - 次のリリースまでに対応
2. エラーハンドリングの欠落
   結果が空の場合の存在確認と例外送出を追加
```

3 サブエージェントの出力が一本のレポートに統合されているのが確認できます。ここで重要なのは、サブエージェントには互いの結果が見えていない点です。彼らはそれぞれの観点に集中し、統合の責任はオーケストレーターが一手に引き受けています。

### 落とし穴

このパターンの弱点は、ある観点での発見が別の観点の判断を変えるべきケースに弱いことです。たとえば認証フローのバグがアーキテクチャ設計の選択にも影響する場合、サブエージェント B はそれを知らないまま「アーキテクチャは妥当」と返してしまいます。Orchestrator がうまく繋ぎ直すか、あるいは次章以降のパターンに切り替える必要があります。

並行性についても触れておきます。検証では実装を簡略にするため逐次呼び出しにしましたが、サブエージェントは互いに独立しているので、本来は第3章で見る `AsyncAnthropic` で並列化するのが自然です。

## 第3章　Agent Teams ─ 文脈を持ち続ける専門家

この章を置くのは、Orchestrator-Subagent と表面上似ているのに、設計上の仮定がまるで違うパターンだからです。

Orchestrator-Subagent はサブエージェントを「都度使い捨て」で呼びます。1 回のタスクで使ってコンテキストを捨てる。これはタスクが短く独立しているときには合理的ですが、フレームワーク移行のように同じドメインを何度も触る作業では、毎回ドメイン知識をゼロから組み立て直すことになり効率が落ちます。

Agent Teams は、各エージェントに自分の担当ドメインの文脈を蓄積させ続けます。担当サービスを深く理解した状態で次のタスクに入れる、というのがコアの差分です。

ここで本格的に並行実行が要るので、`AsyncAnthropic` を使います。

```python
# 03_agent_teams.py
import asyncio
import time
from dataclasses import dataclass, field
from common import call_claude_async


@dataclass
class TeamMember:
    name: str
    specialty: str
    context_history: list = field(default_factory=list)

    async def work(self, task: str) -> str:
        ctx = ""
        if self.context_history:
            ctx = "\n\nこれまでの作業文脈:\n" + "\n".join(
                f"- {h}" for h in self.context_history[-3:]
            )
        system = f"あなたは{self.specialty}の専門家です。{ctx}"
        result = await call_claude_async(system, task)
        self.context_history.append(f"タスク「{task[:30]}...」を完了")
        return result


async def main():
    services = ["UserService", "OrderService", "PaymentService"]
    team = [
        TeamMember(f"member_{i}", f"バックエンドAPIドキュメント作成者（担当: {svc}）")
        for i, svc in enumerate(services)
    ]

    async def process(member: TeamMember, svc: str) -> tuple[str, str]:
        print(f"  start {member.name} ({svc})")
        return svc, await member.work(
            f"{svc} というREST APIサービスの概要ドキュメントを200字以内で作成してください"
        )

    t0 = time.time()
    results = dict(await asyncio.gather(*(process(m, s) for m, s in zip(team, services))))
    print(f"\n=== parallel elapsed: {time.time() - t0:.2f}s ===")

    # 2巡目で同じメンバーに別タスクを渡すと、context_history が効くか確認
    await team[0].work("先ほどの内容に認証方式の節を追記してください（120字以内）")
    print(f"member_0 history len: {len(team[0].context_history)}")


if __name__ == "__main__":
    asyncio.run(main())
```

手元での実測は次のとおりでした。

```text
  start member_0 (UserService)
  start member_1 (OrderService)
  start member_2 (PaymentService)

=== parallel elapsed: 2.50s ===
member_0 history len: 2
```

3 サービス分のドキュメント生成を 2.5 秒で終えています。同じ呼び出しを直列で回すと 6〜8 秒程度かかったので、`AsyncAnthropic` 経由で実際に並行になっていることがわかります。

### 落とし穴

ここに書いておきたい落とし穴がひとつあります。同期クライアント (`anthropic.Anthropic`) を `asyncio.gather` で囲っても並行にはなりません。コルーチンの中で同期 I/O を呼ぶと、その I/O が終わるまで他のコルーチンも進めず、結果として直列実行とほぼ同じ時間になります。並行が欲しいなら `AsyncAnthropic` を使うか、最低でも `asyncio.to_thread` でラップする必要があります。これは検証中に実際に踏んだ落とし穴で、最初は 7 秒近くかかっていました。

もうひとつ、`context_history` を長く保持すると毎回のプロンプトが膨らみコストが増えます。検証コードでは直近 3 件だけに切っています。文脈を活かしたいパターンだからこそ、何を残し何を捨てるかは設計で決めておく必要があります。

### Orchestrator-Subagent との違い

| 観点               | Orchestrator-Subagent | Agent Teams              |
| :----------------- | :-------------------- | :----------------------- |
| エージェントの寿命 | タスクごとにリセット  | 複数タスクをまたいで存続 |
| 文脈の蓄積         | なし                  | あり（ドメイン専門化）   |
| 向く用途           | 短い・独立した処理    | 長期・深掘りが要る処理   |

## 第4章　Message Bus ─ イベント駆動で配線をシステムに渡す

この章を置くのは、エージェントの種類が増えてきたときに「誰が何に反応するか」の配線が爆発するのを抑える設計だからです。

Orchestrator のコードに「セキュリティアラートのうち、ネットワーク系はこの担当に、認証系はこの担当に」と全部書き下していくと、種類が増えるたびにコードが伸びます。Message Bus は、エージェントが「自分が反応したいトピック」を宣言し、トピックに発行されたメッセージを受け取る、という配線をミドルウェアに任せます。

トリアージエージェントが入口で分類し、適切なトピックに再発行する、という二段構えで組みます。

```python
# 04_message_bus.py
from collections import defaultdict
from typing import Callable
from common import call_claude


class MessageBus:
    def __init__(self) -> None:
        self.subscribers: dict[str, list[Callable]] = defaultdict(list)

    def subscribe(self, topic: str, handler: Callable) -> None:
        self.subscribers[topic].append(handler)

    def publish(self, topic: str, payload: dict) -> None:
        print(f"  [BUS] {topic}: {str(payload.get('summary', ''))[:60]}")
        for handler in self.subscribers.get(topic, []):
            handler(payload)


def normalize_category(text: str) -> str:
    """Claude の自由回答からカテゴリ語を抽出する。完全一致では脆い。"""
    t = text.lower()
    for c in ("network", "credential", "application"):
        if c in t:
            return c
    return "unknown"


def run(alert_text: str) -> None:
    bus = MessageBus()

    def triage(alert: dict) -> None:
        verdict = call_claude(
            "セキュリティアラートを分類してください。"
            "以下のいずれかのカテゴリで答えてください（1語のみ）: "
            "network / credential / application / unknown",
            alert["text"],
        )
        category = normalize_category(verdict)
        bus.publish(f"alert.{category}", {**alert, "category": category, "summary": f"分類: {category}"})

    def make_specialist(role: str, label: str) -> Callable:
        def handler(payload: dict) -> None:
            r = call_claude(
                f"{role}として、このアラートへの対応手順を3ステップで答えてください",
                payload["text"],
            )
            print(f"\n[{label}]\n{r[:300]}\n")
        return handler

    bus.subscribe("alert.raw", triage)
    bus.subscribe("alert.network", make_specialist("ネットワークセキュリティの専門家", "Network"))
    bus.subscribe("alert.credential", make_specialist("認証・認可の専門家", "Credential"))
    bus.subscribe("alert.application", make_specialist("アプリケーションセキュリティの専門家", "Application"))
    bus.subscribe("alert.unknown", make_specialist("セキュリティアナリスト", "Unknown"))

    bus.publish("alert.raw", {"text": alert_text, "summary": alert_text[:50]})


if __name__ == "__main__":
    run("ユーザー admin が深夜3時に海外IPアドレスから連続ログイン試行。5回失敗後に成功。")
```

検証では「admin が深夜の海外 IP からログイン試行」というアラートを投入したところ、トリアージは `credential` に分類し、認証担当に正しくディスパッチされました。

```text
  [BUS] alert.raw: ユーザー admin が深夜3時に海外IPアドレスから連続ログイン試行...
  [BUS] alert.credential: 分類: credential

[Credential]
ステップ1: ログイン成功の事実を確認、セッションの有効性を検証
ステップ2: 該当アカウントの即時ロック、IPアドレスのブロック
ステップ3: フォレンジック調査と関係者への通知
```

### 落とし穴

このパターンで最初に踏むのは、トリアージが返す文字列のブレです。検証では「1 語で答えてください」と指示しているのに、実際の応答は `credential` 単独だったり、`credential.` のように句点付きだったり、説明文を伴って `credential です` だったりします。`category.strip().lower() == "network"` のような完全一致で受けると、ほとんどが unknown に落ちます。`normalize_category` のように substring マッチへ緩めるか、`re` で語境界マッチにするのが現実的です。

もうひとつの落とし穴は循環です。あるエージェントの出力が別のトピックに発行され、それが回り回って元のトピックを再発火させると無限ループになります。再発火の段では、`payload` に「処理段数」のようなメタ情報を入れて閾値で止めるのがいちばん簡単です。

## 第5章　Shared State ─ 共有ナレッジで協調する

この章を置くのは、研究や調査のように「ある発見が別の調査方向を変える」タスクで Message Bus よりも自然に書ける場面があるからです。

Message Bus はメッセージという瞬間の通知を流す仕組みですが、Shared State は知識の蓄積を共有ストアに置き、各エージェントがそこを読み書きしながら進めます。中央コーディネーターはおらず、誰かが落ちても他のエージェントは進めます。

実装は次のとおりです。終了条件には収束エージェントを使い、`max_cycles` で必ず上限を切ります。

```python
# 05_shared_state.py
from datetime import datetime
from common import call_claude


class SharedKnowledgeStore:
    def __init__(self) -> None:
        self.findings: list[dict] = []

    def add_finding(self, agent: str, content: str) -> None:
        self.findings.append({"agent": agent, "content": content, "ts": datetime.now().isoformat()})

    def get_summary(self) -> str:
        if not self.findings:
            return "（まだ発見なし）"
        return "\n".join(f"[{f['agent']}] {f['content'][:120]}" for f in self.findings[-6:])


def run(question: str, max_cycles: int = 3, min_cycles: int = 2) -> str:
    store = SharedKnowledgeStore()
    agents = {
        "TechnicalAgent": "技術的な観点から分析する研究者",
        "BusinessAgent": "ビジネス・市場の観点から分析する研究者",
        "RiskAgent": "リスク・課題の観点から分析する研究者",
    }

    for cycle in range(max_cycles):
        print(f"\n=== cycle {cycle + 1} ===")
        for name, role in agents.items():
            sys_p = (
                f"あなたは{role}です。他のエージェントの発見を踏まえ、"
                "新しい観点を1〜2文で簡潔に追加してください。既出と重複しないこと。"
            )
            prompt = (
                f"リサーチクエスチョン: {question}\n\n"
                f"これまでの発見:\n{store.get_summary()}\n\n"
                "あなたの新しい発見を追加してください。"
            )
            store.add_finding(name, call_claude(sys_p, prompt))

        if cycle + 1 < min_cycles:
            continue

        verdict = call_claude(
            "研究ディレクターとして、以下の発見が結論を出すのに十分かどうか判断してください。"
            "十分なら DONE、不十分なら CONTINUE とだけ答えてください。",
            f"テーマ: {question}\n\n発見一覧:\n{store.get_summary()}",
        )
        print(f"  -> verdict: {verdict.strip()[:50]}")
        if "DONE" in verdict.upper():
            break

    return call_claude(
        "研究者として、以下の発見を統合して結論を300字以内でまとめてください。",
        f"テーマ: {question}\n\n発見:\n{store.get_summary()}",
    )


if __name__ == "__main__":
    print(run("AIエージェントが組織の意思決定に与える影響"))
```

### 落とし穴

検証していて発見した、最大の意外な点を書いておきます。

事前には「収束エージェントは早めに DONE と言ってしまうので min_cycles で抑える必要がある」と予想していたのですが、実測ではむしろ逆で、`max_cycles=3` を最後まで使い切ってもなお CONTINUE を返し続けました。Claude は「これで十分」と言うのが苦手で、「実証的根拠が不足」「定量分析が必要」と理由を挙げて延々と続行を勧めます。つまり Shared State の本質的なリスクは早期収束ではなく、止まらないことです。`max_cycles` の上限で必ず打ち切る設計が要ります。

もうひとつ、エージェントが互いの発見を踏まえる仕組みは効きますが、3 体が並べる発見は次第に「リスクの細分化」という同じ方向に寄っていきます。観点の多様性を保ちたいなら、system プロンプトで「他のエージェントが触れていない別の角度を必ず加える」と明示的に縛るか、観点切り替えの命令を中央から飛ばすほうが安全です。

## 第6章　パターンの選び方

この章を置くのは、5 つを並べただけだと「で、どれから手を付けるのか」が決められないからです。

判断のフローを文章で書くと次のようになります。タスクに明確な品質基準があるなら、まず Generator-Verifier を試します。基準があるからこそループを回せます。基準が言語化できないが、サブタスクへの分解はできるなら、Orchestrator-Subagent から始めます。これが最もシンプルで、後から他のパターンに移行しやすい起点です。サブタスクが長期で深掘りを要するなら Agent Teams に上がります。逆に、ワークフローがイベントで分岐するなら Message Bus、エージェント同士がリアルタイムで互いの発見を使うなら Shared State、という順で複雑さが増していきます。

Anthropic 自身のドキュメントも「まず Orchestrator-Subagent から始めよ」と書いています。複雑さに見合った理由が見つかるまでは、シンプルなパターンで粘るほうが結果としてうまくいく、というのが検証を通じての実感でもあります。

## あとがき

この記事のコードは、すべて `claude-haiku-4-5-20251001` を相手に手元で実行し、最後まで通ったものを載せています。試した順番に振り返ると、もっとも示唆的だったのは Agent Teams の並行化と Shared State の収束失敗でした。前者は同期 SDK を `asyncio.gather` で囲っても並行にならないという、よくある落とし穴をそのまま踏みました。後者は「Claude は止まるのが苦手だ」という、別のパターンでも繰り返し顔を出しそうな性質を露わにしました。

「複数立ち上げ」とマルチエージェントの違いを一行で書くなら、情報の流れの設計を人間がやるか、システムに組み込むかの違いです。シングルエージェントを並べるのは、流れを外から繋ぐやり方です。マルチエージェントは、流れの形そのものをアーキテクチャとして書きます。書いた配線が間違っていれば、当然ですが何かが詰まったり、止まらなかったり、伝わるべきものが伝わらなかったりします。だからこそ、5 つのパターンのどれを選ぶかを決める前に、まず自分のタスクに「どんな流れが要るのか」を一度紙に書いてみるのが、いちばん早い近道だと思います。

明日試すべき最小の一歩を一つだけ挙げるなら、第1章の Generator-Verifier をそのまま動かしてみてください。`ANTHROPIC_API_KEY` さえあれば数十秒で結果が出ますし、5 つのパターンの中で「エージェントを分ける意味」がいちばん短い距離で体感できる構成だからです。

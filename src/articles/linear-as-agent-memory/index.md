# 一枚の仕様書から、流れる issue へ ── Linear をエージェントの外部メモリとして使う

## 目次

### 第一部 なぜ SDD がいま求められているのか

- 1． なぜ枝葉ではなく前提の話をするのか
- 2． 2024 年から 2026 年の SDD 胎動、Kiro と Spec Kit
- 3． Scott Logic Eberhardt が実測した「10 倍遅くなる」という数字
- 4． Wattenberger の living spec と、仕様書ドリフトという人間心理の問題

### 第二部 static markdown artifact としての仕様書、その限界

- 5． SPEC.md を Claude に渡すという素朴な出発点
- 6． Anthropic の言う「context は有限の資源である」
- 7． Böckeler の三分類、spec-first と spec-anchored と spec-as-source
- 8． 仕様書が一枚のファイルである限り解けない問題

### 第三部 living external memory への転回

- 9． 2026 年 3 月 24 日の Saarinen、"Issue tracking is dead" の本意
- 10． Coinbase Base の Turakhia が 2026 年 1 月に言った「IDE を削除せよ」
- 11． Stripe Minions、週 1,000 PR という運用の形
- 12． Steve Yegge Beads、external memory for agents という命名
- 13． Fowler の humans on the loop、責任を渡すのでなく折り返す

### 第四部 読み解きとハンズオン ── freee 未入金通知 Bot で確かめる

- 14． なぜ題材として「未入金通知 Bot」を選んだのか
- 15． Linear プロジェクトと 10 issue の設計
- 16． GitHub repo と scaffold、ここまで戻れない一歩
- 17． 代表 issue ENG-9 をエージェントに放置する
- 18． PR が issue に自動で紐づく瞬間、外部メモリの閉ループ
- 19． 結び ── 仕様書は過去形で凍結し、issue は現在形で流れる

---

## 第一部　なぜ SDD がいま求められているのか

### 1. なぜ枝葉ではなく前提の話をするのか

本記事は、Spec-Driven Development(以下 SDD)という、2025 年後半から 2026 年にかけて一気に語られるようになった開発手法を、いま一度、前提の階層まで降りて考え直す試みです。SDD 自体の解説記事は、日本語でも英語でも既に大量に出回っています。Kiro の使い方、Spec Kit のインストール手順、GitHub Copilot Chat に spec を食わせるプロンプト例。読めば数分で手を動かせる類の記事です。

ただ、その手の記事を一通り読んだあとに残る疑問があります。なぜいま、わたしたちは仕様書をわざわざ書き直してエージェントに渡しているのか。なぜそれが、開発を加速するのでなく、むしろ遅くする場合があるのか。そして、仕様書というものの置き場所は、本当に `.kiro/specs/requirements.md` という一枚の markdown ファイルで正解なのか。この疑問に答えようとすると、枝葉を触っているだけでは足りません。SDD が何を解こうとしているのか、解けていないのはどこか、それを代替で解いた人たちが何と呼ばれているのか。そうした前提を並べる必要が出てきます。

わたしは、姉妹記事にあたる「流れるものは変わった、土台は変わっていない」で、Multics から UNIX、そして Claude Code までの設計思想の系譜を辿りました。あの記事で書いたことを、いまここで一行だけ要約すると、「重厚長大な仕組みは歴史的にだいたい失敗し、制約の中から生まれた思想が、毎回勝ってしまう」という話でした。本記事は、その観察を SDD という対象に当てはめて、静的な markdown 仕様書という重厚長大な方角から、living external memory という軽い外部メモリの方角へ、業界全体がいまどう転回しつつあるのかを追いかけます。

想定している読者は、SDD という言葉を使っているけれど最近うまく回らないと感じはじめている方、あるいは、Linear や GitHub Issues をすでに使っているけれど、エージェントに触らせる文脈ではどう設計すべきか迷っている方です。回り道は多めに入れます。ただ、その回り道のひとつひとつが、いま目の前で起きていることを理解するための補助線になるはずです。

### 2. 2024 年から 2026 年の SDD 胎動、Kiro と Spec Kit

SDD という語は、2025 年 7 月に AWS が Kiro をプレビュー発表したあたりで、一気に市民権を得ました。Kiro は、`requirements.md`、`design.md`、`tasks.md` という三枚の markdown ファイルを `.kiro/specs/` というディレクトリに並べ、仕様から実装までをエージェントに一貫して担わせるという、いわゆる spec-as-source の発想をプロダクトとして具現化したものです。AWS は Kiro の社内導入によって、2 週間想定の機能開発を 2 日で完了させた、18 ヶ月想定の rearchitecture を 6 人で 76 日で終えた、という実績を並べました。

2025 年 9 月には GitHub が Spec Kit を公開します。こちらは OSS で、`specify`、`plan`、`tasks`、`implement` という四段のフェーズを CLI として提供するものです。Microsoft Learn が 2026 年 2 月に公式教材を公開するに至り、GitHub stars は 80,000 に迫る規模になりました。Andrew Ng 率いる DeepLearning.AI と JetBrains の共同 SDD コースが 2026 年 4 月にリリースされ、教育文脈でも SDD は既定の語彙になります。

この 2025 年後半から 2026 年前半にかけての半年強の間、業界は一度 SDD に強く傾きました。わたしの周囲でも、新しいプロジェクトを立ち上げるときにまず `SPEC.md` を書きはじめる、という習慣は急速に広がりました。Kiro のプロモーション動画を見せられ、じゃあうちのチームでも導入しようかとなる。そして、やってみて、少し違和感が出てくる。その違和感の正体を、次の章から順に掘り下げます。

### 3. Scott Logic Eberhardt が実測した「10 倍遅くなる」という数字

2025 年 11 月 26 日、Scott Logic の CTO である Colin Eberhardt が、Spec Kit を実際のプロジェクトに適用した検証記事を公開します。条件を揃えて iterative prompting と比較した結果、Spec Kit は 33 分かけて 2,577 行の markdown を生成し、そこから 689 行のコードを生み出しました。一方、同じ課題を iterative prompting で進めた場合は 8 分で同等の成果物に到達しました。品質面でも、spec を介する経路が優位であるという結論は出ませんでした。

この「10 倍遅くなる」という数字は、後続の批判論考の弾薬になります。2026 年 3 月、Alvis Ng の記事「Spec-Driven Development Is Waterfall in Markdown」は、「Spec Kit は 77,000 stars を集め、AWS は IDE 一本を丸ごと作り、Tessl は 1 億 2,500 万ドルを調達した。そして、誰かが実際のプロジェクトで試した。10 倍遅かった」と皮肉を込めて書きました。François Zaninotto が Marmelab ブログに書いた「Spec-Driven Development: The Waterfall Strikes Back」は、Hacker News で 225 points、191 comments を集めました。「Agile が長い時間をかけて葬り去ったはずの仕様書を、わたしたちは本当に甦らせる必要があるのか」と同記事は問います。

ここで立ち止まっておくべきなのは、この「10 倍遅い」という数字が、SDD のすべてを否定しているわけではないということです。Eberhardt 自身も、Spec Kit が無意味だとは書いていません。ただ、iterative prompting と比べて 10 倍の時間をかけるに値するだけの優位性を、Spec Kit は示せなかった。これが 2025 年 Q4 時点の観測的事実です。つまり、SDD が抱えている問題は「概念として間違っている」というよりも、「静的な一枚の markdown ファイルとして運用するかぎり、費用対効果が合わない」という、置き場所と運用の問題です。

### 4. Wattenberger の living spec と、仕様書ドリフトという人間心理の問題

2026 年 2 月 20 日、Augment 社の Amelia Wattenberger(元 GitHub Next の研究者)が書いた論考は、この問題を人間心理の側から照らしました。彼女の言葉を借ります。「書き下した成果物を、動きつづけるシステムと同期させつづけることには、連続的なコストがかかる。一方、エンジニアは集中的なバーストで働くようにできている。ドキュメントを更新する仕事は、その日のあらゆる作業と注目を奪い合い、ほとんど毎回負ける」。

ここに指摘されているのは、仕様書のドリフトという現象は、エンジニアの怠慢や規律の問題ではなく、人間の認知構造そのものから構造的に派生しているということです。仕様書は、書いた瞬間にもっとも正確で、そこから日を追うごとに正確さを失っていきます。実装は動きます。顧客の要望は変わります。チームの合意は更新されます。そのすべてが仕様書の外側で起きるあいだ、仕様書は机の上で変わらず静かに置かれたまま、気づけば嘘の塊になっています。

Wattenberger が提案する解は、「では、仕様書を自分で維持する必要がないものにしてしまえ」という発想の転回でした。living spec、つまり、自分自身で自分を維持しつづける仕様、という命名です。彼女が Augment 社の Intent というプロダクトを売り出すモチベーションはここに集約されています。ただ、この発想自体は Augment の商業製品に閉じた話ではありません。Linear が 2026 年 3 月に発表した次のフェーズ、Steve Yegge の Beads、Stripe の Minions、Coinbase Base の Forge、すべてが同じ方角を向いています。

気づきはここにあります。SDD に違和感を抱くとき、違和感の根は「仕様を書かない方がいい」ではなく、「仕様を一枚の静的な markdown ファイルに閉じ込めるのが間違っている」というところにあります。第二部では、この静的な仕様書を Claude に渡したときに何が起こるかを、もう少し具体的に見ていきます。

---

## 第二部　static markdown artifact としての仕様書、その限界

### 5. SPEC.md を Claude に渡すという素朴な出発点

SDD を始めるとき、多くの人が最初にやる操作は、おそらく次のようなものです。`SPEC.md` というファイルを作り、プロジェクトの要件をそこに書き下す。次に Claude を起動し、「`SPEC.md` を読んで、全体設計と実装を進めてください」と依頼する。Kiro や Spec Kit が行儀よくディレクトリを分割しているだけで、実質的にやっていることはこれと同じです。

この素朴な出発点には、一見すると何も問題がなさそうに見えます。人間が書いた仕様を、エージェントが正確に読み、そこから実装を生成する。Waterfall 開発でドキュメントが書かれたあとに実装フェーズに入るのと、構造としては近いです。違うのは、実装の担い手が人間ではなくエージェントであるという一点だけです。

ただ、やってみると、いくつかの歪みがすぐ出てきます。第一に、仕様書が長くなります。エージェントに渡す以上、暗黙知に頼ることができないので、ふだんならチームの会話で済む内容まで書き下すことになります。第二に、仕様書を更新する責任が宙に浮きます。書いたのは企画者か、技術リードか、それともエージェントに食わせる前提で再構成した人か。誰が更新しつづけるのかが曖昧なまま、仕様書は日付だけが古くなっていきます。第三に、仕様書から生成されたコードが運用に入ったあと、コードの実態と仕様書のあいだにギャップが開きはじめます。

この三つのうち、どれか一つだけなら、規律で乗り切れます。三つが同時に効いてくると、規律では乗り切れません。Wattenberger が指摘した「ドキュメント更新は、あらゆる作業との注目の奪い合いで毎回負ける」が、ここで効いてきます。仕様書は、静的な一枚のファイルであるかぎり、長くなり、所有者が曖昧になり、運用後にドリフトする、という三重苦から逃れられません。

### 6. Anthropic の言う「context は有限の資源である」

この問題に対する技術的な反論として、しばしば聞かれるのが「context window が 1M token になったので、全仕様書を一気に食わせれば済む」という論法です。Claude Opus 4.6 や Sonnet 4.6、そして Opus 4.7 で利用できるようになった 1M context は、確かに、従来では不可能だった巨大なドキュメントをまるごと読ませる運用を可能にしました。

ただ、この論法には注釈が要ります。Anthropic 自身が 2025 年 9 月 29 日に公開した「Effective context engineering for AI agents」という記事で、次のように書いています。「context は有限の資源であり、限界収益は逓減する(context is a finite resource with diminishing marginal returns)」。公式ドキュメントも、1M token を宣伝するのと同じページで「context rot: トークン数が増えるほど、モデルが正確に思い出す能力は低下する」と認めています。Chroma Research の 18 モデル横断の検証も、context の伸長に伴う精度低下を実証しました。Claude Code Camp の実測によれば、Sonnet 4.5 の 1M context における MRCR スコアは 18.5%、Opus 4.6 でも 78.3% に留まり、80 ターンを超えたあたりでモデルは更地から始め直した方が性能が出る、と報告されています。

つまり、1M context は、あっても全仕様書を流し込む戦略の最適解にはなりません。これは、Karpathy が「context engineering」という語を立てたときに書いた「LLM は CPU、context window は RAM」という比喩とも整合します。RAM を増やせば扱えるデータ量は増えますが、CPU がアクセスした瞬間ごとに何を置いておくかの判断は相変わらず必要です。無制限に詰め込めば速度が出る、という話にはなりません。

Anthropic 記事が推奨する四つの技法、つまり Compaction、Structured note-taking、Sub-agent architectures、そして Tool result clearing はすべて、「context に何を載せない設計にするか」の技法です。SPEC.md を丸ごと食わせるという発想は、この四つの技法のすべてに真っ向から反します。

### 7. Böckeler の三分類、spec-first と spec-anchored と spec-as-source

SDD という語が雑に使われすぎているという指摘は、2026 年 3 月に Martin Fowler サイトの Birgitta Böckeler が丁寧な分類で応えました。彼女は SDD を三つに分けます。

- **spec-first**: 仕様を書いたうえで、そこから実装を生成する古典的な Waterfall 派。Kiro は完全にこの型
- **spec-anchored**: 仕様を一時的な足場として書き、実装とともに少しずつ捨てていく型。iterative prompting に近い
- **spec-as-source**: 仕様そのものを真実の源として維持しつづけ、コードはそこから派生するという型。Tessl や、初期の Spec Kit が標榜した位置

Eberhardt が「10 倍遅い」と書いたのは spec-first 型の運用です。Wattenberger が「living spec」と呼ぶのは、実質的に spec-anchored 型の延長線上にあります。Augment Intent はそれを spec-as-source の運用に近づけることを試みた製品です。

Böckeler は、spec-as-source 型の Spec Kit が、実際の検証の中で既存クラスを新規仕様と誤認して重複クラスを生成した具体例を記録しています。彼女の言葉を借りれば、「レビューはコードより疲れる。window が大きくなったからといって、AI が全部を正しく拾えるようになったわけではない」。これは 1M context の限界と完全に同じ話を、別の角度から言っています。

気づきはここにあります。SDD をめぐる議論は、実は「SDD かそうでないか」という二択ではありません。三分類のうちどれを採るか、そして、その型が抱える運用コストを自分のチームで引き受けられるかどうか、という具体的な選択の問題です。

### 8. 仕様書が一枚のファイルである限り解けない問題

第二部のここまでの話を、一度まとめておきます。SDD の素朴な出発点、つまり SPEC.md 一枚を Claude に食わせるという運用は、次の三つの問題から逃げられません。

第一に、所有者の問題です。静的な一枚のファイルは、誰が書き、誰が更新し、誰がレビューするかの責任が曖昧になります。更新されない仕様書は、ドキュメントとしての価値も、エージェントへの入力としての価値も急速に失います。

第二に、context の問題です。仕様書が長くなるほど、Claude が一度に載せられる範囲を超えていきます。1M context があっても、context rot の問題は残り、注意経済は崩れます。Anthropic 自身が、smallest possible set of high-signal tokens を探すのが context engineering の本筋だ、と書いています。

第三に、同期の問題です。仕様書と実装のあいだに乖離が生まれたとき、どちらを真実とみなすかの合意が崩れます。コードが動いていて、仕様書が古い、という状態は、コミュニケーション媒体としての仕様書の役割を失わせます。

これら三つの問題は、ファイルという物理単位のなかに仕様を閉じ込めているかぎり、解けません。所有者を立てても、担当者が異動すれば振り出しです。context を圧縮しても、いずれ溢れます。同期を気合で回しても、数週間で破綻します。解くには、仕様を置く場所そのものを変えるしかありません。ファイルという静的な器から、流れつづけるストリームのようなものへ。ここが、第三部で語りたい転回の入口です。

---

## 第三部　living external memory への転回

### 9. 2026 年 3 月 24 日の Saarinen、"Issue tracking is dead" の本意

2026 年 3 月 24 日、Linear の CEO である Karri Saarinen は、プロダクトの次のフェーズを発表する場で、短い宣言を掲げました。

> Issue tracking is dead.

言葉だけを見れば、挑発的な宣言です。Linear というプロダクトが、自分たち自身が属する「issue tracker」というカテゴリの終焉を宣言したのですから。ただ、彼が示したのは issue tracker というプロダクトの廃止ではなく、issue というものが担う役割の転回でした。同時に掲げた定義文は次のようなものです。

> Linear is the shared product system that turns context into execution.

context を execution に変換する、共有のプロダクトシステム。ここに含意されているのは、issue というものがもはや「人間が作業の進行を追うための記録」ではなく、「エージェントと人間が共有する、実行可能な context そのもの」に変わった、という認識です。その場で Saarinen は次の数字も示しました。Linear のエンタープライズワークスペースの 75% 以上に既にコーディングエージェントが導入されている。エージェントの作業量は 3 ヶ月で 5 倍に増えた。新規 issue の最大 25% がエージェントによって自動生成されている。

この数字から読み取れるのは、Linear の中で起きている変化が、既に「追記できる紙」から「エージェントと人間が代わる代わる触れる外部メモリ」への遷移を完了させつつある、ということです。Saarinen の別の発言を引用します。

> Agents are not mind readers. They become useful through context.

エージェントは心を読めない。context を与えることで、はじめて役に立つ。ここで彼が context と呼んでいるものは、まさに Linear の issue ツリー、プロジェクト、サイクル、triage という構造化された情報の総体です。markdown の SPEC.md 一枚ではなく、状態を持ち、依存関係を持ち、更新履歴を持ち、人間とエージェントが同時に編集できるストリームとしての情報。これが、わたしが本記事で「external memory」と呼びたいものの輪郭です。

### 10. Coinbase Base の Turakhia が 2026 年 1 月に言った「IDE を削除せよ」

Saarinen の宣言から遡ること 2 ヶ月、2026 年 1 月に、Coinbase の Head of Engineering である Chintan Turakhia は、Base App の全エンジニアに対して次のように指示したと公開しています。

> Delete your IDE. Work for two weeks without writing a single line of code.

IDE を削除せよ、2 週間、一行もコードを書かずに仕事をしろ。わたしはこの指示を最初に読んだとき、いくつか違和感を覚えました。IDE を捨てる話はこれまでに何度もあったが、毎回流行りの言葉だけで、中身は続かなかった。今回も同じだろう、と。ただ、Turakhia の別の言葉が、わたしの違和感を完全に溶かしました。

> I'm not designing things for humans anymore. I'm designing things for agents. And they need different things.

人間のために設計するのをやめた。エージェントのために設計している。そして彼らが必要としているものは、人間のそれとは違う。彼は続けます。エージェントが自律的に働くためには構造化された context が必要であり、その context が存在する場所は Linear だ。Linear をすべての source of truth として、day one から扱えと指示した。なぜならエージェントがそれに依存するからだ、と。

Coinbase Base は独自エージェント「Forge」を Linear Agent SDK で統合し、Slack 上のバグ報告から Linear issue を自動生成し、ラベル付与、サイズ見積、アサイン、Forge によるコード修正、PR ドラフト、Slack での review 依頼、という完全ループを回しています。毎週行う「Speedruns」という運用では、15 分で 500 PR が立ち上がり、GitHub を 4〜5 回ダウンさせたと記録されています。エンジニアは朝に夜間エージェントの PR をレビューし、10〜15 個の新しいエージェントを起動し、日中は複雑な仕事に集中し、就寝前に夜間バッチを起動する。KPI は「autonomous operation time」、つまり、人の介入なしにエージェントが走っている時間の総量です。

わたしが強調したいのは、Turakhia の「for agents」という語です。Linear は、人間のために設計されたプロダクトでした。それが、エージェントが自律的に作業するための外部メモリへと、用途を変えつつある。この転回は、Linear 側から見ると、Saarinen の「context into execution」という定義に対応します。

### 11. Stripe Minions、週 1,000 PR という運用の形

Coinbase が独自エージェントを走らせているのに対し、Stripe は「Minions」というアーキテクチャで、週 1,000 PR 以上をマージし、そのコード部分は人間が一行も書いていない、という運用を公開しています。公式ブログ「Minions: Stripe's one-shot, end-to-end coding agents」によれば、フローは次の通りです。

1. Slack メッセージでバグ報告や小さな要望が流れる
2. 10 秒で devbox が起動する(本番からネットワーク隔離済み)
3. Goose(Block 社 OSS)の fork がエージェント実体として動く
4. MCP サーバ「Toolshed」が 400+ ツールから、当該タスクに必要な 15 程度を prefetch する
5. ローカル lint が 5 秒で走る
6. CI は最大 2 ラウンドまでリトライ
7. PR が立ち上がり、人間がレビューする

ByteByteGo の解説記事には、次のような説明があります。「オンコール中に 5 個の小さなバグに気づいたら、Slack に 5 通メッセージを投げてコーヒーを取りに行く。戻ってきたら 5 個の PR が待っている」。

ここで注目したいのは、Stripe も Coinbase も、エージェント同士を複雑に連携させるマルチエージェントの orchestration を採っていない、ということです。Forge も Minions も、一つのタスクに一つのエージェント、それを並列で多数走らせるという、Karpathy 的な「LLM = CPU」の比喩でいえば、プロセスの多重化モデルです。これは第二部で触れた Anthropic の context engineering 記事が推奨する Sub-agent architectures とも整合します。

そして、それぞれのエージェントにとっての context の置き場所は、Coinbase が Linear、Stripe が Slack + GitHub Issues という違いはあるものの、どちらも「静的な markdown ファイル」ではなく、「状態を持った流れつづけるストリーム」である点は共通しています。ここが本記事の核心です。

### 12. Steve Yegge Beads、external memory for agents という命名

2025 年 10 月、Steve Yegge が「Beads」という OSS を公開しました。GitHub で 18,700 以上のスターを集めたこのプロジェクトは、まさに「エージェントのための外部メモリ」を自称しています。Yegge 自身の言葉を引きます。

> My agents have fully moved off markdown plans to an issue tracker, and they show no signs of going back.

わたしのエージェントは、markdown の plan から issue tracker 専用に完全移行した。戻る気配すら見せない。Yegge はさらに続けます。

> Beads isn't 'issue tracking for agents' — it's external memory for agents, with dependency tracking and query capabilities. Beads is an execution tool.

Beads は「エージェント向けの issue 追跡」ではない。依存関係追跡とクエリ機能を備えた、エージェントのための外部メモリだ。Beads は実行のためのツールだ。ここで Yegge が「external memory」という語を選んだのは象徴的です。第一部で触れた Wattenberger の「living spec」、第三部冒頭の Saarinen の「context into execution」、そして Yegge の「external memory」は、使っている語彙は違いますが、同じものを別の角度から指しています。

Beads の特徴は技術的に面白いです。git-backed で、SQLite をキャッシュとして使い、JSONL を可搬形式に持ち、依存関係のグラフを blocks/parent-child/related/discovered-from という四つの関係で表現します。この discovered-from というリンク種別は、エージェントが実装中に新しく気づいた事柄を、元の issue から「派生した発見」として書き戻すためのものです。静的な markdown 仕様書には、こういう「エージェントの観察が書き戻される経路」は存在しません。書き込みは一方通行です。living external memory としての issue tracker には、この経路がある、というのが決定的な違いです。

`bd ready` というコマンドが Beads にはあります。これは「いまブロックされていない、最も優先度の高い仕事」をエージェントに問い合わせるためのものです。エージェントは issue 一覧を総なめする必要がなく、context を汚さずに、次の一手だけを受け取れます。Anthropic の「smallest possible set of high-signal tokens」という context engineering の原則が、ここにも貫かれています。

### 13. Fowler の humans on the loop、責任を渡すのでなく折り返す

2026 年 4 月 2 日、Martin Fowler のサイトに Birgitta Böckeler が書いた「Harness Engineering」という記事が公開されました。第二部で触れた彼女の SDD 三分類と同じ著者です。この記事で彼女は、エージェント運用における人間の位置取りを三つに分けます。

- **humans outside the loop**: 人間はエージェントの動作から完全に切り離されている。完全な自律運用
- **humans in the loop**: エージェントのすべてのステップに人間の承認が挟まる。伝統的な HITL(Human In The Loop)
- **humans on the loop**: エージェントは自律的に動くが、人間がループの上を折り返すようにして、重要な分岐点で介入する

この三つ目、「on the loop」という語が、わたしが本記事で最も強調したいものです。Coinbase のエンジニアは朝にエージェントの夜間作業を review し、新しいエージェントを起動し、自分は複雑な仕事に集中し、夜にまた夜間バッチを起動する。Stripe のエンジニアは Slack に要望を流し、PR が立ったら review する。これらはどちらも、humans on the loop の典型です。エージェントに全権を委ねているわけではなく、かといってすべてのステップに人間が介在しているわけでもない。人間はループの上を折り返し、ここぞという場所で判断を入れます。

このとき、エージェントの自律性を担保するものは何か。答えは Saarinen の言葉に戻ります、「context into execution」。状態を持った共有の外部メモリが、エージェントと人間のあいだの折り返し地点を提供します。markdown ファイルには、この折り返しを受け止める構造がありません。issue tracker には、状態遷移、コメント、担当者アサイン、ラベル、依存、という構造があり、そのすべてがエージェントも人間も等しく触れる場所にあります。

気づきはここにあります。living external memory という方角は、単にエージェントのために情報を整理する話ではありません。人間がエージェントのループの上を折り返すための、物理的な立ち位置を提供する話です。仕様書を一枚の markdown に閉じ込めていると、この折り返しの場所がなくなります。issue という構造化された単位に載せると、折り返しの場所が自然に生まれます。

---

## 第四部　読み解きとハンズオン ── freee 未入金通知 Bot で確かめる

### 14. なぜ題材として「未入金通知 Bot」を選んだのか

第三部までで、static markdown artifact から living external memory への転回、という命題を組み立ててきました。ただ、命題を理屈だけで語っていても、読んだ方の手のなかで定着しません。第四部では、この転回を実際に小さな題材で追体験していきます。

題材として選んだのは、freee 会計 API から未入金の請求書一覧を取得し、Slack に通知する Bot です。この題材を選んだ理由は三つあります。第一に、ドメインが身近で、何をしたいかが一行で説明できること。請求書が支払期日を過ぎていたら Slack に投げる、これだけです。第二に、外部 API、純粋な計算、通知という三層に綺麗に分かれるので、issue として分解したときの粒度感が読者にとってわかりやすいこと。第三に、純粋な計算部分(どの請求書がどの時点で「警告すべき」状態にあたるかの判定)が、境界値テストの効く純関数として切り出せるため、エージェントに放置実装させる代表 issue の格好の候補になること。

scaffold と代表 issue の実装だけは実際に手を動かし、残りの issue は description として Linear に置いた状態で記事を閉じます。これは意図的です。「全部を実装した完成品」を見せたいわけではなく、「issue というストリームのなかで、エージェントと人間が折り返しながら動く構造」そのものを見せたいからです。完成品はむしろ、わたしの手元の運用が進むごとに更新されていきます。読者の手元でも同じ構造で進めていただけるように、本文の指示は「このあと自分で動かす」ことを前提に書きます。

### 15. Linear プロジェクトと 10 issue の設計

まず、Linear に「freee 未入金通知 Bot」というプロジェクトを作ります。今回はチーム ENG の配下です。Linear の MCP サーバを Claude Code に接続している場合、issue は MCP 経由で作成できます。接続できていない場合は Web UI で手動作成します。どちらの経路でも、記事の論証は変わりません。重要なのは、issue が markdown ファイルではなく、状態を持つ流れとして扱えるかどうか、という一点です。

issue の粒度は、次の六つの基準で判定します。スコープが 1〜3 ファイルに収まること。外部サービスの新規登録を含まないこと。Done 条件がコマンドの実行結果(`npm test` や `npm run build` の成否)で検証できること。context 量が 50,000 トークン以内に収まること。依存する issue がすべて Done であれば自動で `In Progress` に入れられること。副作用が小さく、rollback が容易であること。この六つを満たせば、エージェントに放置で処理させるに十分な粒度です。

作成する 10 issue は次の通りです。Linear 側の実体の識別子は、ENG チームの連番の関係で ENG-5 から ENG-14 になります。この連番のズレ自体が、「issue tracker は状態を持った実体であって、ただの番号付きリストではない」という当たり前の事実を、読者の手元で一度体感してもらう材料になります。

| 本記事の通し番号 | Linear 識別子 | タイトル                                                     | 粒度判定                              | AI 放置可否        |
| ---------------- | ------------- | ------------------------------------------------------------ | ------------------------------------- | ------------------ |
| 1                | ENG-5         | [setup] freee アプリ作成・Slack App 作成の手順ドキュメント化 | 人手が必要、AI は README ドラフトまで | △                  |
| 2                | ENG-6         | [auth] OAuth2 認可コードフロー実装(初回トークン取得 CLI)     | 1 ファイル、Done 条件明確             | ○                  |
| 3                | ENG-7         | [auth] トークンリフレッシュ機構(自動更新+ローテーション保存) | 純関数+mock テスト                    | ○                  |
| 4                | ENG-8         | [freee] 未入金請求書取得クライアント(pagination 対応)        | 型定義+mock                           | ○                  |
| 5                | ENG-9         | [logic] ステータス判定ロジック(未入金・期限超過・接近)       | 純関数、単体テスト 8 境界値           | ◎ 最も AI 放置向き |
| 6                | ENG-10        | [slack] Slack 通知モジュール(Webhook 版、Block Kit)          | snapshot テスト                       | ○                  |
| 7                | ENG-11        | [slack] chat.postMessage 版へのリファクタ(Bot Token)         | 差し替え、同出力保証                  | ○                  |
| 8                | ENG-12        | [app] メインエントリ+エラーハンドリング+構造化ログ           | retry 3 回、fallback                  | ○                  |
| 9                | ENG-13        | [ops] GitHub Actions schedule(JST 9:00 日次実行)             | workflow_dispatch 手動実行可          | ○                  |
| 10               | ENG-14        | [test] E2E テスト(msw 等で freee API モック)                 | `npm test` 全緑                       | ○                  |

このうち、通し番号 5(ENG-9)だけを今回のハンズオンで実際に実装対象とします。他の 9 個は issue description として Linear に残し、後日あるいは読者の手元で消化される前提です。

ENG-9 の description には、次のような living spec を書き込みます。

```yaml
入力:
  invoices:
    - invoice_id: string
      due_date: string (ISO 8601, YYYY-MM-DD)
      payment_status: "settled" | "unsettled"
      invoice_status: "draft" | "issued" | "cancelled"
  now: string (ISO 8601, YYYY-MM-DD)

出力:
  - invoice_id: string
    status: "overdue" | "due_soon" | "unsettled" | "settled" | "irrelevant"

ルール:
  - invoice_status != "issued" → "irrelevant"
  - payment_status == "settled" → "settled"
  - payment_status == "unsettled":
    - due_date < now → "overdue"
    - due_date <= now + 7 日 → "due_soon"
    - else → "unsettled"

受け入れテスト(最小 8 ケース):
  1. draft の請求書は "irrelevant" を返す
  2. cancelled の請求書は "irrelevant" を返す
  3. settled で issued は "settled" を返す
  4. unsettled で due_date が今日より 1 日前は "overdue"
  5. unsettled で due_date が今日と同じは "due_soon"
  6. unsettled で due_date が今日+7 日は "due_soon"
  7. unsettled で due_date が今日+8 日は "unsettled"
  8. 空配列は空配列を返す
```

ここで重要なのは、description が markdown の一段ではなく、Linear の issue という状態を持つ単位の内側に置かれていることです。人間がレビューを入れて修正しても、エージェントが `discovered-from` のリンクで派生 issue を生やしても、すべてが同じ構造のなかに収まります。SPEC.md ではこれができません。

### 16. GitHub repo と scaffold、ここまで戻れない一歩

次に、GitHub 側にリポジトリを作ります。今回は organization `engineers-hub-ltd-in-house-project` 配下に `freee-slack-notifier` という名前で、public 可視性、MIT ライセンスで作成します。

コマンドは次の通りです。

```bash
gh repo create engineers-hub-ltd-in-house-project/freee-slack-notifier \
  --public --license mit \
  --description "freee 未入金請求書を Slack に通知する Bot"
```

ここで一度、手を止めてください。`gh repo create --public` は、ここまで戻れない操作です。repo を削除することは可能ですが、URL がいったんインデックスされると検索エンジンから完全には消せません。実行前に次の四点を確認します。

- [ ] organization への書き込み権限がある
- [ ] public で問題ない情報しか入らない(`.env` は `.gitignore` 済み、secret は含めない)
- [ ] MIT で問題ない
- [ ] 名前の衝突がない(`gh repo view <name>` が 404 を返す)

このチェックリストは、本記事のように自動化を扱う文脈では、とくに疎かにしない方が良い箇所です。エージェントに任せるとしても、irreversible な操作の手前では、人間が一拍置いて判断する必要があります。これが第三部で言及した humans on the loop の具体的な姿です。

repo 作成後、scaffold を組み立てます。ディレクトリ構成は次のようにします。

```text
freee-slack-notifier/
├── package.json       tsx, typescript, @types/node, 依存最小
├── tsconfig.json
├── .gitignore         .env を含む
├── .env.example       FREEE_CLIENT_ID / FREEE_CLIENT_SECRET / FREEE_REFRESH_TOKEN / SLACK_WEBHOOK_URL
├── README.md          親記事の URL を参照
├── LICENSE            MIT
└── src/
    ├── index.ts       エントリ
    ├── freee.ts       freee API クライアント(未入金請求書一覧取得)
    ├── slack.ts       Slack Incoming Webhook クライアント
    ├── status.ts      ENG-9 の対象、空
    └── status.test.ts ENG-9 の対象、空
```

テストランナーは依存を減らす意図で `node --test` を使います。`tsx` と `typescript` と `@types/node` があれば、サードパーティに依存せずにテストが走ります。

scaffold そのものも、実はエージェントに作らせることができます。CLAUDE.md に「上記の構成で scaffold を組み立ててください」と書けば、Claude Code は `package.json`、`tsconfig.json`、`.gitignore`、`.env.example`、`README.md`、`LICENSE` をひと通り生成します。この時点ですでに、「scaffold を作る」という作業自体が issue #0 として扱える粒度になっていることに気づきます。

### 17. 代表 ENG-9 をエージェントに放置する

scaffold が揃い、Linear に ENG-9 が description つきで立っている状態で、次の一行だけをエージェントに渡します。

> Linear の ENG-9 を読んで、`src/status.ts` に純関数として実装してください。`src/status.test.ts` に description の受け入れテスト 8 ケースを書いて、`node --test` で全緑になったら、main から branch を切って PR を作成してください。PR の body には `Closes ENG-9` を含めてください。

このプロンプトに含まれていない情報を並べると、この指示の薄さが際立ちます。関数の引数名は書いていません。ルールの優先順位も書いていません。境界値の厳密な定義も書いていません。すべて ENG-9 の description のなかにある、という前提で書いています。

エージェント側の動きは、おおよそ次のようになります。Linear MCP 経由で ENG-9 を取得する。description から入力、出力、ルール、受け入れテストを読み取る。`src/status.ts` に純関数を実装する。`src/status.test.ts` に 8 ケースのテストを書く。`node --test` を走らせて全緑を確認する。`git checkout -b impl/status-classification`、`git add`、`git commit`、`git push`、`gh pr create --body "Closes ENG-9"`。

ここで意識していただきたいのは、わたしが書いた指示のほとんどが、Linear の issue のなかに既にあるという点です。プロンプトという場所ではなく、Linear という外部メモリに spec が置かれていて、エージェントはそこを読みに行きます。プロンプトは「どの issue を読むか」「最終的に何をするか」だけを示しています。これが living external memory を介した開発の基本形です。

### 18. PR が issue に自動で紐づく瞬間、外部メモリの閉ループ

エージェントが PR を立てると、Linear 側で面白いことが起きます。PR の body に `Closes ENG-9` と書いてあるだけで、Linear の ENG-9 は自動的に PR と紐づきます。Linear の web UI 上で issue を開くと、関連 PR として当該 PR がリンク表示され、PR が merge されれば issue のステータスが自動で `Done` に遷移します。

この一連の遷移のなかで、人間がやった作業を列挙すると、次の三つだけです。第一に、ENG-9 の description をレビューした(ルール定義、受け入れテストの粒度が妥当か)。第二に、PR の diff をレビューした(実装が description に忠実か、テストケースの抜け漏れがないか)。第三に、PR を merge ボタンで統合した。ここには、IDE でコードを書く作業は含まれていません。IDE を開いていません。

Turakhia の「Delete your IDE」という指示が、ここでようやく意味を帯びます。IDE を捨てろというのは、テキストエディタを使うなという話ではありません。「エージェントが自律的に動くための外部メモリが整っていれば、人間が IDE に滞在する時間は劇的に減る、そしてそれが正しい方角だ」という話です。外部メモリが整っていないうちに IDE を捨てても、何も起きません。Linear のような living external memory を整備したあとで、人間はループの上を折り返す側に位置取りを変えます。

Linear 側で ENG-9 のステータスが `Done` に遷移し、PR が merge されると、external memory の閉ループが一周します。起点は issue の description でした。そこからエージェントが仕事を拾い上げ、コードとテストが生まれ、PR が立ち、人間が review し、merge されて、issue が `Done` に戻る。この一周の中で、情報は一度も markdown の SPEC.md を通りません。Linear の issue と、GitHub の PR と、エージェントの実行履歴、それだけが情報の通り道です。

第三部で触れた Yegge Beads の `discovered-from` リンクは、この閉ループをさらに豊かにします。エージェントが実装中に気づいた副次的な問題や、テスト時の境界値の曖昧さを、別の issue として立て、元の issue からリンクを張ります。情報は一方通行ではなく、往復します。SPEC.md には、この往復の経路がありません。issue tracker という形式にはあります。

### 19. 結び ── 仕様書は過去形で凍結し、issue は現在形で流れる

わたしたちは長いあいだ、仕様書を成果物として扱ってきました。成果物は過去形で書かれ、ファイルとしてコミットされ、リポジトリの奥に沈んでいきます。読み返す機会は徐々に減り、更新する責任は曖昧になり、気づけば実装との乖離に耐えられなくなった仕様書は、ひっそりと更新されなくなります。

issue は、これとはまったく別の物体です。issue は現在形で書かれ、ステータスを持ち、担当者を持ち、コメントを重ね、依存を生やします。エージェントが触り、人間がレビューし、また別のエージェントが `discovered-from` で派生を生やします。これはストリームであって、静的な成果物ではありません。本記事の命題を一行で言えば、仕様の置き場所を、静的な markdown から流れるストリームに移す、という話です。Saarinen の "context into execution" も、Turakhia の「delete your IDE」も、Yegge の "external memory for agents" も、Wattenberger の "living spec" も、すべてこの一行の別表現です。

姉妹記事で書いたことを、もう一度ここで繰り返します。流れるものは変わった、土台は変わっていない。仕様書は過去形で凍結し、issue は現在形で流れる。これらは同じ話の二つの表現です。Unix が text stream を発明して半世紀が経ち、その思想は形を変えながら繰り返し戻ってきます。1970 年代にはパイプでした。2020 年代にはエージェントの外部メモリです。**土台は変わっていない**ということです。

この先、エージェントがさらに賢くなれば、わたしたちが issue tracker に書き込む description の粒度も、また変わっていくでしょう。Beads の `bd ready` のように、エージェントに「次の一手」だけを問い合わせる API が、標準になっていくかもしれません。Linear の Agent Interaction SDK が、issue のテンプレートにもっと明示的な「for agents」フィールドを足すかもしれません。どれも、方向は同じです。人間の成果物としての仕様書を、エージェントと人間が共有する外部メモリへ、少しずつ移していく。この流れは、今年から来年にかけて、日本語圏でも確実に広がっていくと思います。

それでは、みなさまの次の仕様が、一行の markdown ではなく、誰かがいまも編集しつづけている一枚の issue でありますように。

---

## 参考・関連リンク

- [Linear "Linear is the new standard for building software"(2026-03-24、Saarinen の宣言)](https://linear.app/next)
- [Linear Customers "How Coinbase built Base app with Linear at the center"(Turakhia の発言)](https://linear.app/customers/coinbase)
- [Stripe Engineering "Minions: Stripe's one-shot, end-to-end coding agents"](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents)
- [Steve Yegge "Introducing Beads: A Coding Agent Memory System"](https://steve-yegge.medium.com/introducing-beads-a-coding-agent-memory-system-637d7d92514a)
- [Beads repository](https://github.com/steveyegge/beads)
- [Amelia Wattenberger "What spec-driven development gets wrong"(2026-02-20)](https://www.augmentcode.com/blog/what-spec-driven-development-gets-wrong)
- [Colin Eberhardt "Putting Spec Kit Through Its Paces"(2025-11-26)](https://blog.scottlogic.com/2025/11/26/putting-spec-kit-through-its-paces-radical-idea-or-reinvented-waterfall.html)
- [Alvis Ng "Spec-Driven Development Is Waterfall in Markdown"(2026-03)](https://medium.com/@iamalvisng/spec-driven-development-is-waterfall-in-markdown-e2921554a600)
- [François Zaninotto "Spec-Driven Development: The Waterfall Strikes Back"](https://marmelab.com/blog/2025/11/12/spec-driven-development-waterfall-strikes-back.html)
- [Birgitta Böckeler "Exploring Gen AI: Spec-Driven Development"](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)
- [Birgitta Böckeler "Harness Engineering"(2026-04-02)](https://martinfowler.com/articles/harness-engineering.html)
- [Anthropic "Effective context engineering for AI agents"(2025-09-29)](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Anthropic "Building Effective Agents"](https://www.anthropic.com/research/building-effective-agents)
- [Claude Code 公式ドキュメント context windows](https://docs.claude.com/en/docs/build-with-claude/context-windows)
- [Linear MCP サーバ ドキュメント](https://linear.app/docs/mcp)
- [freee 開発者ドキュメント、会計 API](https://developer.freee.co.jp/)
- [本記事のハンズオン成果物](https://github.com/engineers-hub-ltd-in-house-project/freee-slack-notifier)
- 姉妹記事「流れるものは変わった、土台は変わっていない ── Multics の失敗から Claude Code まで、設計思想を辿る」

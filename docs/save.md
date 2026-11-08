# 保存・オフライン進行（v17）

v17では生涯通常転生回数・ROOT自動購入恒久権・旧ROOT互換フラグを追加しました。旧版の資産を読み込み時に消去せず、次の明示的ROOTから下位回数・ポイント・スキル・権利をリセットします。移行時の推定と台帳の詳細は [ROOT現行仕様](root-rebirth.md) を参照してください。

## 保存形式と検証

localStorage の `oimo-depth.save` キーに次の JSON を保存します。時刻は Unix epoch のミリ秒です。

```json
{
  "saveVersion": 17,
  "savedAt": 1700000000000,
  "gameState": {
    "imo": "gn1:0:0:0",
    "runEarnedScore": "gn1:0:0:0",
    "runStartingImo": "gn1:0:0:0",
    "scoreSpentThisRun": "gn1:0:0:0",
    "gearPurchasedThisRun": [],
    "productionRemainder": { "score": "gn1:0:0:0", "imo": "gn1:0:0:0" },
    "postDeepResearchSkillLock": false,
    "scoreCapStage": 0,
    "runStartingScoreCapStage": 0,
    "originResearchRanks": { "harvest": 0, "link": 0 },
    "researchRanks": { "geology": 0, "resonance": 0 },
    "equipmentCounts": { "worker": 0, "cart": 0, "harvester": 0, "deepDrill": 0, "refinery": 0, "veinExtractor": 0, "concentrator": 0, "rootRelay": 0, "coreChamber": 0, "originMiner": 0, "imoReactor": 0 },
    "permanent": {
      "lifetimePrestigeCount": 0,
      "rootAutomationUnlocked": false,
      "legacyRootProgress": false,
      "rootCycleMaxUnlockedStage": 0,
      "lifetimePrestigePointsEarned": 0,
      "pointsLostByDeepResearch": 0,
      "pointsLostByRoot": 0,
      "deepAnalysisActiveThisRoot": false,
      "gearModes": { "shovel": "standard", "lens": "standard", "drillBit": "standard", "compass": "standard", "rootCore": "standard" },
      "gearCustomPresets": [null, null, null],
      "selectedGearPreset": "standard",
      "gearUnlocked": { "shovel": false, "lens": false, "drillBit": false, "compass": false, "rootCore": false },
      "gearDiscovered": { "shovel": false, "lens": false, "drillBit": false, "compass": false, "rootCore": false },
      "rootRebirthCount": 0,
      "unspentRootCrystals": 0,
      "totalRootCrystalsEarned": 0,
      "totalRootCrystalsSpent": 0,
      "rootUpgradeRanks": { "blessing": 0, "memory": 0, "adaptation": 0 },
      "equipmentSystemUnlocked": false,
      "depthMeters": 0,
      "depthRemainder": 0,
      "digResearchRanks": { "basic": 0, "vein": 0 },
      "originAnalysisUnlocked": false,
      "rootConnectionUnlocked": false,
      "maxDiscoveredStage": 0,
      "deepResearchUnlocked": false,
      "deepResearchCount": 0,
      "prestigeCount": 0,
      "unspentPoints": 0,
      "skillRanks": { "harvest": 0, "discount": 0, "startingImo": 0, "breakthrough": 0, "automation": 0 }
    },
    "automation": {
      "enabled": false,
      "policy": "efficient",
      "equipment": { "worker": true, "cart": true, "harvester": true, "deepDrill": true, "refinery": true, "veinExtractor": true, "concentrator": true, "rootRelay": true, "coreChamber": true, "originMiner": true, "imoReactor": true },
      "priority": ["worker", "cart", "harvester", "deepDrill", "refinery", "veinExtractor", "concentrator", "rootRelay", "coreChamber", "originMiner", "imoReactor"]
    }
  }
}
```

`src/core/save.ts` が外部テキストを `unknown` として検証します。残高・累計・設備の制約と次の価格の有限性はコアで検証します。欠落・負数・NaN/Infinity・小数の設備数・上限超過・未対応バージョンは拒否します。保存時刻は非負整数で JavaScript Date の範囲内です。未知の追加フィールドは採用せず、既知の値をコピーします。

v7以降の金額は `GameNumber.toString()` の正規形文字列だけを受理します。通常の数値JSONや `"1e6"`、非正規な成分、NaN/Infinity・負金額は拒否します。価格はGameNumberで検証し、旧形式v1〜v6だけは従来通り次価格が安全整数を超える所有状態も拒否します。v15でも所有数・ランク・段階・回数・時刻はnumberで、安全整数と権限・上限・残高整合性を維持します。

v1〜v6の既存値は従来の補完と検証後に巨大数へ変換します。v5/v6の `automationRemainder` は符号を保持して `productionRemainder` へ移し、v1〜v4はゼロを補います。端数は符号付き巨大数文字列で、絶対値が `現上限 × 64 × Number.EPSILON` を超えるものを拒否します。負の補償を含めたSCOREも0〜上限内に制限します。省略時はゼロですが、明示されたnull・欠落成分・不正値は拒否します。詳細・許容誤差・旧結果との比較は [巨大数移行](number-migration.md)。

v1〜v3 は既存の設備・残高・SCORE・保存時刻を維持し、`scoreCapStage = 0` と `breakthrough = 0` を補完して v4 へ移行します。v1はさらに開始時支給0・恒久データ未取得を補完します。v1/v2は欠けた追加設備 `deepDrill` / `refinery` だけを0で補完し、v3/v4は全5設備を必須とします。v2以降の既存スキル・転生回数・ポイント・支給額を検証して維持します。既存3設備や既存恒久データの欠落は補完しません。旧形式の非ゼロ段階、v2/v3の非ゼロ心得は拒否します。v1の恒久フィールドは未知フィールドとして採用しません。

v4は上限段階と全4スキルが必須です。段階0は上限1e6・上位2設備は0のみ、段階1は心得取得済み・SCORE1e6〜1e9で、上位設備を所有できます。権利の前提・最低転生回数・支出済みを含むポイント整合性も検証します。マイルストーンのフラグや倍率は保存せず所有数から計算します。[初回限界突破](breakthrough.md)・[転生と基本スキル](prestige.md) を参照してください。未知の形式を推測して読み込みません。

## 深層記憶の移行（v8）

v8は解析累計 `permanent.deepResearchCount` と当周回の `postDeepResearchSkillLock` を必須にします。v1〜v7は従来の前提検証後、研究権限trueを1回、falseを0回として移行し、ロックfalse・取得済みスキル・支給額・時刻を保持します。移行時にリセットしません。正の解析履歴がある取得済み機能解禁権だけ、現在の強化前提の不足を許可します。ロック中の段階2以降では実支給額を最大100芋・50芋刻みで保持し、それ以外の支給検証は従来どおりです。履歴/権限・回数上限・ポイント総額・保持ランク/ロックの整合性と、旧版の厳密な前提検証は [深層記憶](deep-memory.md) を参照してください。

## 第3突破と発見履歴（v9）

v9は全9設備、新接続権 `rootConnectionUnlocked`、恒久の `maxDiscoveredStage` を保存します。v1〜v8の既存値を維持し、新設備0・接続権falseを追加。旧5/7設備の自動設定・順列を検証した後で新IDを個別ON・末尾追加します。発見履歴は実到達段階と実行済み深層解析から復元し、心得を持つだけでは発見扱いしません。現在段階・発見・権限の不整合と段階2以下での新設備所有を拒否します。深層記憶のロックと支給履歴は段階3でも保持します。[設備連携](root-connection.md) を参照してください。

## 恒久DEPTHの移行（v10）

v10は恒久の `depthMeters` / `depthRemainder` / `digResearchRanks` を必須保存します。v1〜v9は資産・権限・深層記憶・設定・日時を維持し、深度0・端数0・研究0を補います。昔の到達深度は推定せず、保存時刻以降の最大24hのSCORE稼働時間だけを新式で掘ります。初期化以外の通常転生・突破では保持します。深度は有限numberの0〜1e12m、端数と研究解禁/rankの整合性を検証します。図鑑・報酬・発見済み表示は恒久深度から導出します。[DEPTH仕様](depth.md) を参照してください。

## 第4突破と根源研究の移行（v11）

v11は全11設備、恒久の `originAnalysisUnlocked`、周回の `originResearchRanks: { harvest, link }` と段階4を追加します。v1〜v10の既存資産・履歴・DEPTH・掘削研究・設定・時刻は保持し、新設備0・新研究0・解析権falseを補完します。旧5/7/9設備の個別フラグと優先順を厳密に検証した後で、新IDを個別ON・順列末尾に追加します。全体ON/OFFは変えません。

解析権は最大発見段階4と一致し、根脈接続権は最大発見段階3以上と一致する必要があります。段階4には解析権・心得・深層解析履歴とSCORE 1e15以上が必要で、段階3以下の新設備所有・新研究ランクを拒否します。通常転生では上限段階0・周回研究0へ戻し、全ての発見・解析権・DEPTH・恒久研究を保持します。新研究の支出も研究返金の残高検証へ含めます。旧v1〜v6の安全整数価格検証は当時存在した設備に対して維持し、当時未導入の根源設備の初期価格は検査対象外とします。

金額の正規形・巨大数の有効桁・補償端数の制約と、保存失敗/競合時の原子的停止は従来どおりです。新解析・新研究・返金も書込成功後にだけ公開します。[根源領域](origin.md) を参照してください。

## ROOTの移行（v12）

v1〜v11の既存値と時刻を保持し、ROOT回数・結晶累計/残高/使用・強化0・装備未解禁を補います。v12では全ROOT項目を必須にし、非負安全整数、取得費用の総和と結晶元帳、解禁権とROOT/解析/発見履歴を照合します。SCORE1e18到達だけでは自動でROOT済みにしません。

ROOTでは周回だけをリセットし、通常回数/通常ポイントを付与しません。初期支給は通常スキル＋ROOT強化で再計算し、ロック中の支給上限もROOT支給を含めます。再周回で解析を永久ロックしないよう、解析履歴は `deepResearchCount - rootRebirthCount <= max(0, prestigeCount - 4)` とし、段階2以上は当ROOT周回で新たな解析を必要とします。旧版ではROOT回数0なので既存の制約を維持します。詳細は[ROOT仕様](root-rebirth.md)。

## 恒久装備とSCORE支出の移行（v13）

周回に巨大数の `scoreSpentThisRun` と最大5件のID内訳 `gearPurchasedThisRun`、恒久に `gearUnlocked` / `gearDiscovered` を保存します。利用可能SCOREは累計SCOREとの差分で導出し、別残高は保存しません。内訳IDは既知・重複なし・取得済み・当周回のROOT/段階条件内で、支出合計はID順に計算した価格合計と厳密一致する必要があります。負支出・累計超過・不正な発見/取得フラグ・先行ROOT条件を拒否します。

v1〜v12の資産・ROOT・深層記憶・DEPTH・研究・自動設定・時刻を保持し、支出0・内訳空・全装備未購入を補います。旧ROOT済み保存は現在段階で証明できる発見だけを補完し、過去の未記録の発見は推測しません。通常転生/ROOTでは支出と内訳だけを初期化し、装備と発見を保持します。上限後の解禁も累計SCOREを変えません。詳細は[装備仕様](gear.md)。

## 時間の精算

v5で全5スキルと自動設定、v6で研究権限・研究ランク・全7設備を追加しました。これらの必須条件をv9でも維持します。v1〜v4は自動スキル0と全体OFFを補い、v1〜v5には新設備0・研究0・研究権限falseを補います。v5の旧5設備の設定と優先順を検証して保持し、新設備の個別フラグはON・優先順は末尾に追加します。全体設定と既存値は維持します。旧形式で未対応設備所有や段階2を主張するデータを拒否します。[研究仕様](research.md) を参照してください。

現在は手動/自動購入のON/OFFにかかわらず `productionRemainder` で補償加算し、転生でゼロへ戻します。価格不足を補う借入補正は行いません。設定は周回と分けて維持します。方針・設備フラグ・優先順・権利なしONの拒否は [自動購入仕様](automation.md) を参照してください。

`settleOffline(save, now)` は時計や保存領域にアクセスしない純粋関数です。同じ保存データと現在時刻から同じ状態・報告を返します。

- 経過秒数: `max(0, (now - savedAt) / 1000)`
- 反映する秒数: `min(経過秒数, OFFLINE_LIMIT_SECONDS)`。初期上限は24時間（86,400秒）です。
- `advanceWithAutomation` に委譲し、現周回の上限でクリップします。設定ONなら購入可能時刻で区切って設備を自動購入し、転生・限界突破は行いません。OFFは従来の定率収穫です。心得を取得済みでも段階0なら1e6で停止します。
- 収穫増分を残高へ加え、自動購入の費用を差し引きます。報告の獲得芋は支出前の収穫で、自動購入台数を別途表示します。「反映した時間」は24時間で制限した対象時間です。上限到達後は収穫・購入とも止まります。
- 精算結果を現在時刻で直ちに保存し、同じ時間帯を次の読込で再加算しません。
- 時計が戻った場合は報酬0とし、保存時刻を巻き戻しません。画面で日時の確認を案内します。クライアントの時計変更に対する不正防止機能ではありません。

## セッションとブラウザの境界

`GameSession` は保存領域と `{ wallNow, monotonicNow }` の時計を引数で受け取ります。初回 `start()` だけが読込・精算・保存を行い、React StrictMode の effect 再実行でも繰り返しません。進行中は単調時計の実経過秒数を使い、250ms 間隔で描画します。

保存は10秒ごと・設備購入直後・転生とスキル購入直後・限界突破直後・非表示時（`visibilitychange` / `pagehide`）です。非表示時は直前の時間を精算して保存し、通常タイマーを停止扱いにします。復帰時（`visibilitychange` / `pageshow`）に壁時計からオフライン精算します。非表示・復帰イベントが重複してもそれぞれ一度しか処理しません。ページを閉じるイベントが届かなかった場合、最後の自動保存時刻以降を次回起動で計算します。

`useMiningGame` はブラウザイベント・タイマーの登録と解除を担当します。`useSyncExternalStore` でセッションを購読し、React の state updater 内では保存や時計参照を行いません。

## 破損・保存失敗・複数タブ

`SaveRepository` は読み込んだ元テキストを保持し、書込前に localStorage が同じ値か確認します。破損や未対応バージョンでは進行・自動保存を止め、元テキストをそのままエクスポートできます。正しいセーブのインポート、または確認後の初期化で復旧できます。読込・書込の権限エラーや容量不足も捕捉し、現在のメモリ状態と既存セーブを保護して案内します。

別タブの書込・削除・ストレージ全消去は `storage` イベントと通常更新前の読取で検出し、進行・購入・保存・上書き操作を停止します。他タブを閉じてから再読み込みして、最新セーブを基準に再開してください。**localStorage は複数操作のトランザクションを持たないため、完全な排他ロックや複数タブの進行マージは保証しません。** 同時使用を避ける案内と、競合時の明確な停止・警告を用意する方式です。

旧保存の移行・放置精算後に書込が失敗した場合は元テキストを保持し、エクスポートでも元テキストをそのまま退避できます。現行の精算自体が安全条件で停止した場合も、読込済み状態と元の保存時刻を保持します。成功していない区間の時刻だけを進めたり、部分購入を反映したりしません。

## 手動入出力と初期化

「セーブ管理」でエクスポートしたテキストを全選択してコピーし、任意の場所へ保管できます。破損時は元のテキストを返します。インポートは全項目を検証してから内容確認を表示し、利用者が「このセーブに置き換える」を選んだときだけ適用します。**インポートは記録されたゲーム状態をそのまま復元し、保存時刻を現在時刻に更新します。追加の放置報酬は付与しません。** これによりエクスポート→インポートで状態が一致します。

初期化も確認してから実行し、新しい初期状態を保存します。書込に失敗した場合は、インポート・初期化ともメモリ状態の置換を行いません。競合中や保存領域を利用できない状態では上書き操作を無効にします。

保存先はこのブラウザのこのオリジンだけです。別ブラウザ・別端末への同期はありません。ブラウザのデータ消去で失われるため、エクスポートによるバックアップを推奨します。

## テスト

`npm test` で保存形式・異常値・1時間/48時間の放置・SCORE クリップ・時計巻戻り・決定性、保存/復帰の二重実行、保存失敗・競合を検証します。UI テストでは StrictMode 起動、報告、入出力の確認と取消、破損からの復旧、ページイベントの重複、別タブ通知を確認します。

GitHub Pages のサブパス・公開ワークフローは維持しています。PR ではビルドと `/oimo-depth/` プレビューを確認し、実公開はマージ後に既存ワークフローで行います。

## 効果モードとプリセット（v14）

[モード保存仕様](gear-modes.md)。v1〜13は標準モードと空の3枠を補完し、既存の資産・進行を保持します。

## 解析済み通常転生（v15）

`permanent.deepAnalysisActiveThisRoot` と `runStartingScoreCapStage`（0/2）を必須保存します。通常転生では解析済みの上限1e12を維持し、ROOTで解除します。開始段階2は完了状態・解析累計・通常転生履歴・ロック解除を必要とします。段階3/4には引き続き所定SCOREへの到達が必要です。移行時は旧資産を保持し、段階・ROOT履歴から確定できる完了だけ補います。[推定条件と不明ケース](deep-memory.md)。

## ポイント経済（v16）

新規解析で使用済みptを返還せず、総獲得・使用中・未使用・消失の台帳を照合します。[旧保存の初期化と安全性](prestige-economy.md)を参照。

## ROOT下位リセット（v17）

`lifetimePrestigeCount` は通常転生時だけ増加し、ROOTでは保持します。`prestigeCount` は現ROOT内の通常転生回数としてROOTで0になります。ポイント獲得履歴と解析履歴の上限は生涯回数で検証します。`rootAutomationUnlocked` はROOT回数が正ならtrueで、通常自動スキルとは独立した権利です。

現在の権利と割当上限は `rootCycleMaxUnlockedStage`、表示の生涯発見は `maxDiscoveredStage` によります。v1〜v16のROOT済み保存だけ `legacyRootProgress=true` として旧権利・高ランクを保持し、次のROOTでfalseにします。ROOT後に解析累計が正であっても、現ROOT未解析・上限段階0・全通常ランク0を正しい状態として保存します。生涯台帳はROOT消失額を含めて収支一致を要求します。

生産端数の上限は64×EPSILONです。ROOT・モードを合わせた1e18経路で、巨大数の差分と残高クリップの丸めによる端数7598が従来の32×EPSILON（約7105）を超えるため変更しました。金額・購入可否・台帳の整数照合には許容幅を追加しません。

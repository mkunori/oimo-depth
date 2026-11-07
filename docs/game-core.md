# ゲーム計算エンジン（v0）

この基盤は UI・React・DOM・時刻 API・乱数・保存処理に依存しません。呼び出し元が経過秒数と購入イベントを渡します。React 画面への接続は `src/features/mining/useMiningGame.ts` が担当します。

## 状態と責務

#28以降の金額・SCORE・上限・価格・費用・生産量はGameNumberです。以下の表や例の数値は値を表し、カウンターと時間だけがnumberです。API・v7保存・精度の詳細は [巨大数移行](number-migration.md) を参照してください。

`src/core/state.ts` の `createInitialState()` は毎回独立した状態を生成します。

| フィールド | 意味・制約 |
| --- | --- |
| `imo` | 設備購入に使う残高。有限かつ `0 <= imo <= runEarnedScore + runStartingImo` |
| `runEarnedScore` | 現周回で収穫した芋の累計。購入で減らない。有限かつ現周回の上限以下 |
| `equipmentCounts` | 初期3種、段階1の2種、段階2の`veinExtractor` / `concentrator`の所有数。非負の安全な整数。未解禁設備の所有は拒否 |
| `runStartingImo` | この周回の開始時に支給した芋。SCORE に含めない |
| `scoreCapStage` | 現周回の上限段階。0: 1e6、1: 1e9、2: 1e12。各段階には権限と前段階の到達が必要 |
| `researchRanks` | 周回の研究強化2種のランク。段階2だけ0〜3、それ以外は0 |
| `permanent` | 転生回数・未使用ポイント・取得スキル。転生で維持する |
| `automation` | 全体ON/OFF・方針・設備別設定・指定優先順。周回と分け、転生で維持する |
| `productionRemainder` | 全収穫の符号付き補償端数（GameNumber）。有限範囲を検証し、転生でゼロへ戻す |

初期状態は残高・累計・全設備数が 0 です。状態型は readonly とし、各更新関数は入力やネストした所有数を変更しません。変化のない購入・時間更新は元の状態を返します。

`runEarnedScore` は収穫上限判定用であり、消費可能な SCORE を表しません。装備解禁などの消費可能 SCORE の要否は未決です。

## 仮バランスと丸め

`src/data/balance.ts` に SCORE 上限 `1,000,000`、基礎生産量 `1 imo/sec` を定義しています。設備の値は `src/data/equipment.ts` に集約しています。

| ID | 名称 | 基礎価格 | 価格倍率 | 1台あたり imo/sec |
| --- | --- | ---: | ---: | ---: |
| `worker` | 作業員 | 10 | 1.15 | 1 |
| `cart` | 運搬車 | 100 | 1.20 | 10 |
| `harvester` | 自動収穫機 | 1,000 | 1.25 | 100 |
| `deepDrill` | 深層掘削機（未解禁） | 2,000,000 | 1.20 | 1,500 |
| `refinery` | 芋精製プラント（未解禁） | 20,000,000 | 1.22 | 15,000 |

所有数 n のとき次の1台の価格は `ceil(basePrice * priceMultiplier ** n * equipmentPriceMultiplier)` です。スキルの割引後に**各台の価格を切り上げてから合計**します。割引なしで作業員の最初の10台は `10, 12, 14, 16, 18, 21, 24, 27, 31, 36`（合計 209）です。

生産能力は `(baseProduction + sum(count * productionPerUnit * milestoneMultiplier)) * productionMultiplier` です。既存3設備は10 / 25 / 50台で、それぞれ追加倍率 ×1.1 / ×1.15 / ×1.25 を乗算します。効果は同じ設備の所有全台に適用し、基礎生産と他設備には適用しません。スキル倍率は合計後に適用します。達成状況は所有数から導出します。[設備拡張の仕様と採用根拠](equipment-growth.md) と [転生と基本スキル](prestige.md) を参照してください。

収穫量は `min(生産能力 * 経過秒数, 上限 - runEarnedScore)` で制限し、実際に増えた SCORE と同量だけ残高を増やします。上限時は購入で残高が減っても収穫は再開しません。`getProductionPerSecond` は上限到達後も設備の生産能力を返します。

## API

#23以降の `advanceGame` は自動購入が有効ならイベント駆動で処理します。`advanceWithAutomation` は状態と自動購入台数・上限到達秒・任意のイベント列を返します。価格・生産・購入は同じコアAPIを共有し、SCORE上限で両方停止します。設定更新は `configureAutomation`、時間精算後の即時購入は `advanceWithAutomation(candidate, 0)` です。詳細な方針・精度・負荷上限は [自動購入仕様](automation.md) を参照してください。従来のOFF状態では下記例は同じ結果です。

```ts
import { createInitialState } from '../src/core/state';
import {
  advanceGame,
  getProductionPerSecond,
  getEquipmentPrice,
  getAffordableQuantity,
  getPurchaseQuote,
  purchaseEquipment,
} from '../src/core/game';

const initial = createInitialState();
const harvested = advanceGame(initial, 100); // 残高・累計 100
getProductionPerSecond(harvested); // 1
getEquipmentPrice('worker', 0); // 10
getAffordableQuantity(harvested, 'worker'); // 6
getPurchaseQuote(harvested, 'worker', 10); // { quantity: 6, totalCost: 91 }
const purchased = purchaseEquipment(harvested, 'worker', 10);
// 残高 9、累計 100、作業員 6台、生産能力 7/sec
```

`PurchaseMode` は `1 | 10 | 'MAX'` です。×10 は買える数量が10台未満ならその数量を購入します。MAX は買える限り購入します。0台なら支出は0、状態は変わりません。上昇する価格列を順番に走査するため、個別購入と同じ価格・数量になります。現在の上限と定義では MAX の走査は設備ごとに数十台程度で終了します。

`getEquipmentMilestones(id, count)` は現在倍率・次の閾値と倍率・達成済み節目を返します。`getEquipmentPurchaseGain` は次の1台で所有済み分も強化される効果を含めた生産増分を返し、シミュレーターの回収時間計算に使います。

`getEquipmentAvailability(id, state)` は獲得SCOREではなく現周回の上限と設備定義の `unlockAtScoreCap` を比較します。追加2種は初回突破後の上限1e9で解禁します。上限到達中・未解禁設備の見積もりは0台・0円、購入は状態を維持し、不正な所有状態は拒否します。#19の仮定用 `EconomyContext` は削除し、全APIが `getScoreCap(state)` を使います。権利と段階の制約、非リセット遷移は [初回限界突破](breakthrough.md) を参照してください。

## 入力検証と数値の限界

- 負・NaN・Infinity の時間、不正な残高・累計、負・小数・安全な整数範囲外の所有数、不明な設備 ID、不正な購入モードは `RangeError` です。入力状態は一切変更しません。
- 非常に大きい有限の経過時間も受け付けます。上限到達に必要な時間を先に比較するため、乗算による Infinity を状態に入れません。
- 次の価格が安全な整数の範囲を超える所有数では、価格取得・購入見積もりは `RangeError` です。v0 の到達可能な状態では発生しません。
- 金額・生産・累計は JavaScript `number` です。経過秒数は小数を許可し、収穫を整数に丸めません。購入費用は整数で上限以下なので、一括購入と個別購入の支出は完全一致します。
- 収穫の分割実行と一括実行は浮動小数点演算のため微差が生じます。初期上限 `1e6` 帯でテストの許容誤差を絶対値 `1e-8`（最大値に対して相対 `1e-14`）とし、設備数と整数の購入費用は完全一致を確認します。極小時間を膨大な回数に分割した際の誤差蓄積やビット単位の一致は保証しません。

## 後続 Issue の差し替え点

- 巨大数対応: `GameState` の金額・累計、`EquipmentDefinition` の価格・生産量、`src/core/game.ts` の演算・比較・丸め・有限値検証をまとめて任意精度の数値表現へ変更してください。価格指数計算も含むため、型だけの変更では対応できません。
- 倍率ボーナス: `getProductionPerSecond` / `getEquipmentMilestones` / `getSkillBonuses` に集約しています。ボーナス値自体は保存せず所有数・スキルから算出します。
- 転生・限界突破: 初期転生は `src/core/prestige.ts`、権利は `src/data/skills.ts`、1e6→1e9は `src/core/breakthrough.ts`、1e9→1e12と強化・返金は `src/core/research.ts`。研究権限は恒久、強化は周回。段階表は `src/data/scoreCaps.ts`。詳しくは [地層研究](research.md)。1e12より先は未実装です。
- オフライン計算・保存: `src/core/save.ts` が保存形式の検証と経過時間の上限制御を行い、`advanceGame` に渡します。保存領域・時計・React との接続は `src/features/save/` に分離しています。詳細は [保存とオフライン進行](save.md) を参照してください。
- 深度・地層・上位のスキル枝・装備・上位転生のモデルは仕様確定を待ちます。

テストは `npm test`、型チェックは `npm run typecheck`、本番ビルドは `npm run build` で実行します。

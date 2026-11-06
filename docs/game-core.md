# ゲーム計算エンジン（v0）

この基盤は UI・React・DOM・時刻 API・乱数・保存処理に依存しません。呼び出し元が経過秒数と購入イベントを渡します。React 画面への接続は `src/features/mining/useMiningGame.ts` が担当します。

## 状態と責務

`src/core/state.ts` の `createInitialState()` は毎回独立した状態を生成します。

| フィールド | 意味・制約 |
| --- | --- |
| `imo` | 設備購入に使う残高。有限かつ `0 <= imo <= runEarnedScore + runStartingImo` |
| `runEarnedScore` | 現周回で収穫した芋の累計。購入で減らない。有限かつ初期上限以下 |
| `equipmentCounts` | `worker` / `cart` / `harvester` の所有数。非負の安全な整数 |
| `runStartingImo` | この周回の開始時に支給した芋。SCORE に含めない |
| `permanent` | 転生回数・未使用ポイント・取得スキル。転生で維持する |

初期状態は残高・累計・全設備数が 0 です。状態型は readonly とし、各更新関数は入力やネストした所有数を変更しません。変化のない購入・時間更新は元の状態を返します。

`runEarnedScore` は収穫上限判定用であり、消費可能な SCORE を表しません。装備解禁などの消費可能 SCORE の要否は未決です。

## 仮バランスと丸め

`src/data/balance.ts` に SCORE 上限 `1,000,000`、基礎生産量 `1 imo/sec` を定義しています。設備の値は `src/data/equipment.ts` に集約しています。

| ID | 名称 | 基礎価格 | 価格倍率 | 1台あたり imo/sec |
| --- | --- | ---: | ---: | ---: |
| `worker` | 作業員 | 10 | 1.15 | 1 |
| `cart` | 運搬車 | 100 | 1.20 | 10 |
| `harvester` | 自動収穫機 | 1,000 | 1.25 | 100 |

所有数 n のとき次の1台の価格は `ceil(basePrice * priceMultiplier ** n * equipmentPriceMultiplier)` です。スキルの割引後に**各台の価格を切り上げてから合計**します。割引なしで作業員の最初の10台は `10, 12, 14, 16, 18, 21, 24, 27, 31, 36`（合計 209）です。

生産能力は `(baseProduction + sum(count * productionPerUnit)) * productionMultiplier` です。倍率・割引・初期所持芋は取得済スキルから計算します。仮値と開始額の扱いは [転生と基本スキル](prestige.md) を参照してください。

収穫量は `min(生産能力 * 経過秒数, 上限 - runEarnedScore)` で制限し、実際に増えた SCORE と同量だけ残高を増やします。上限時は購入で残高が減っても収穫は再開しません。`getProductionPerSecond` は上限到達後も設備の生産能力を返します。

## API

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

## 入力検証と数値の限界

- 負・NaN・Infinity の時間、不正な残高・累計、負・小数・安全な整数範囲外の所有数、不明な設備 ID、不正な購入モードは `RangeError` です。入力状態は一切変更しません。
- 非常に大きい有限の経過時間も受け付けます。上限到達に必要な時間を先に比較するため、乗算による Infinity を状態に入れません。
- 次の価格が安全な整数の範囲を超える所有数では、価格取得・購入見積もりは `RangeError` です。v0 の到達可能な状態では発生しません。
- 金額・生産・累計は JavaScript `number` です。経過秒数は小数を許可し、収穫を整数に丸めません。購入費用は整数で上限以下なので、一括購入と個別購入の支出は完全一致します。
- 収穫の分割実行と一括実行は浮動小数点演算のため微差が生じます。初期上限 `1e6` 帯でテストの許容誤差を絶対値 `1e-8`（最大値に対して相対 `1e-14`）とし、設備数と整数の購入費用は完全一致を確認します。極小時間を膨大な回数に分割した際の誤差蓄積やビット単位の一致は保証しません。

## 後続 Issue の差し替え点

- 巨大数対応: `GameState` の金額・累計、`EquipmentDefinition` の価格・生産量、`src/core/game.ts` の演算・比較・丸め・有限値検証をまとめて任意精度の数値表現へ変更してください。価格指数計算も含むため、型だけの変更では対応できません。
- 倍率ボーナス: `getProductionPerSecond` と `getSkillBonuses` に集約しています。ボーナス値自体は保存せずスキルから算出します。
- 転生・限界突破: 初期転生と基本スキルは `src/core/prestige.ts` / `src/data/skills.ts` に実装しています。上限変更は後続 Issue の対象です。
- オフライン計算・保存: `src/core/save.ts` が保存形式の検証と経過時間の上限制御を行い、`advanceGame` に渡します。保存領域・時計・React との接続は `src/features/save/` に分離しています。詳細は [保存とオフライン進行](save.md) を参照してください。
- 深度・地層・上位のスキル枝・装備・上位転生のモデルは仕様確定を待ちます。

テストは `npm test`、型チェックは `npm run typecheck`、本番ビルドは `npm run build` で実行します。

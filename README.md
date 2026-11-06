# IMO DEPTH

芋を掘り、深く進むブラウザゲームです。自動採掘で芋を集め、設備を買い、SCORE 1,000,000 を目指す最小ゲームをプレイできます。

TypeScript（strict）+ React + Vite を採用し、GitHub Pages への静的公開と Vitest によるコアロジックの単体テストを前提にしています。

UI から独立した自動採掘・SCORE 上限・設備購入の計算エンジンを React に接続しています。API・仮バランス・数値精度・拡張点は [ゲーム計算エンジンの仕様](docs/game-core.md)、画面と更新処理は [最小ゲーム画面の仕様](docs/game-ui.md) を参照してください。

進行はこのブラウザに自動保存され、復帰時は最大24時間分の自動採掘を反映します。「セーブ管理」からテキストをエクスポート／インポートできます。保存形式・破損時の復旧・複数タブの扱いは [保存とオフライン進行](docs/save.md) を参照してください。

SCORE 100,000 から手動で転生し、1pt（上限 1,000,000 なら2pt）を獲得できます。収穫倍率・設備割引・次周回の初期所持芋を強化する基本スキルを用意しています。リセット範囲・仮バランスは [転生と基本スキル](docs/prestige.md) を参照してください。

既存3設備は10 / 25 / 50台で台数倍率が上がります。次の目標と現在倍率を設備一覧に表示します。転生5回以上・収穫3・割引1を前提に3ptで「限界突破の心得」を取得し、SCORE1e6で転生せず上限1e9へ進めます。突破後は上位2設備を購入でき、通常転生では上限1e6に戻りますが突破権を保持します。詳細は [初回限界突破](docs/breakthrough.md)・[設備拡張](docs/equipment-growth.md)、旧セーブを保持するv5移行は [保存仕様](docs/save.md) にまとめています。

バランス検証は `npm run simulate` で再実行できます。初期15方策×6周回、正規の初回突破5経路、突破後の設備購入比較9ケースと将来の固定生産試算を [検証ガイドと結果](docs/balance/README.md) にまとめています。

「自動設備管理」（収穫1・転生1回以上・1pt）で、表示中・最大24時間の放置中の設備購入を解禁できます。初期OFFで、設備別設定・3方針・指定優先順は転生後も維持します。精算方式・成長比較・v5保存移行は [自動購入](docs/automation.md) を参照してください。

## 環境構築・開発

Node.js 24.x（`.nvmrc`）と付属の npm を使用してください。

```sh
npm ci
npm run dev
```

起動後、表示される URL の `/oimo-depth/` を開きます（通常は `http://localhost:5173/oimo-depth/`）。
Windows PowerShell の実行ポリシーで `npm.ps1` がブロックされる場合は、`npm.cmd ci` のように `npm.cmd` を使用できます。

## 検証・ビルド

```sh
npm run typecheck
npm test
npm run build
npm run preview
```

- `npm test`: Vitest を一度実行して終了します。コア単体テストと、jsdom での画面・購入・キーボード・タイマーの操作テストを実行します。
- `npm run test:watch`: テストを監視モードで実行します。コアテストは Node 環境で動作し、画面テストのみ `@vitest-environment jsdom` を指定しています。
- `npm run build`: 型チェック後、静的ファイルを `dist/` に生成します。
- `npm run preview`: ビルド結果を通常 `http://localhost:4173/oimo-depth/` で確認します。開発用の確認サーバーです。

依存関係を更新した場合は `package.json` と `package-lock.json` を一緒にコミットしてください。CI と公開ビルドは `npm ci` でロックファイルを使用します。

## ディレクトリの責務

| パス | 責務 |
| --- | --- |
| `src/main.tsx` | React の起動とグローバル CSS の読み込み |
| `src/App.tsx` | アプリ全体の構成とホーム画面 |
| `src/core/` | UI に依存しない純粋なゲーム計算・セーブモデルとその単体テスト |
| `src/features/` | 採掘・設備・転生などの機能別 UI |
| `src/components/` | 機能間で共有する UI |
| `src/data/` | 設備・強化などの定義データ |
| `src/assets/` | ソースから import する SVG などの軽量素材 |
| `public/` | 変換せずに配信する静的ファイル |
| `docs/` | 後続 Issue の仕様書・設計資料 |
| `.github/workflows/` | CI と GitHub Pages 公開 |

未使用のディレクトリは作成していません。必要になった時点で追加してください。

## CI・GitHub Pages 公開

PR と `main` への push で CI が型チェック・テスト・ビルドを実行します。
公開ワークフローも同じ検証を実行し、成功した `dist/` のみをアップロード・公開します。

初回はリポジトリ管理者が次の設定を行ってください。

1. GitHub の **Settings → Pages → Build and deployment → Source** で **GitHub Actions** を選択します。
2. **Settings → Actions → General** で Actions の実行と、ワークフローで使用する公式 `actions/*` を許可します。
3. `github-pages` environment に保護ルールを設定している場合は、`main` からの公開を許可し、必要な承認を行います。
4. PR を `main` にマージすると **Deploy to GitHub Pages** が自動実行されます。再公開は Actions の同ワークフローから **Run workflow** で `main` を選択します。

公開先は `https://mkunori.github.io/oimo-depth/` です。実際の公開 URL と成否はワークフローの deployment 結果で確認してください。ブランチからの手動実行では公開しません。

権限は、CI とビルドが `contents: read`、公開ジョブが `pages: write` と `id-token: write`（OIDC）です。個人アクセストークンやリポジトリの秘密情報は必要ありません。

Vite の `base` は `/oimo-depth/` に固定しています。ソース内の素材は import し、`public/` のファイルを参照する場合は `import.meta.env.BASE_URL` を使用してください。`/assets/...` のようなドメイン直下へのパスは避けてください。
設定は [Vite の GitHub Pages 公開手順](https://vite.dev/guide/static-deploy.html#github-pages) を参照しています。

## 環境変数・秘密情報

このアプリはブラウザだけで動作し、サーバーや秘密情報を必要としません。`VITE_*` の環境変数とビルドに含めた値は公開されるため、API キーやトークンなどの秘密情報を入れないでください。
`.env`、`.env.*`、生成物、依存パッケージは Git 管理から除外しています。共有用の `.env.example` を追加する場合もダミー値だけにしてください。

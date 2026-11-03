# IMO DEPTH

芋を掘り、深く進むブラウザゲームの開発基盤です。現在はホーム画面のプレースホルダーのみで、ゲーム機能は後続の Issue で実装します。

TypeScript（strict）+ React + Vite を採用し、GitHub Pages への静的公開と Vitest によるコアロジックの単体テストを前提にしています。

UI から独立した自動採掘・SCORE 上限・設備購入の計算エンジンを実装しています。API・仮バランス・数値精度・拡張点は [ゲーム計算エンジンの仕様](docs/game-core.md) を参照してください。ホーム画面への接続は後続 Issue で行います。

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

- `npm test`: Vitest を一度実行して終了します。初期スモークテストはホーム画面のレンダリングを確認します。
- `npm run test:watch`: テストを監視モードで実行します。今後の純粋なゲーム計算のテストは `src/core/*.test.ts` などに追加します。DOM 環境は不要です。
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

# Sora Autoplay Blocker

Sora (https://sora.chatgpt.com) の動画を必要なページだけで自動再生させる Chrome 拡張です。`/drafts`・`/explore`・`/profile` では強制的にオートプレイを無効化し、`/d/` と `/p/` の詳細ページでは再生を許可します。コンテンツスクリプトと MAIN ワールド用スクリプトを組み合わせ、`HTMLMediaElement.play` のフックや autoplay 属性の除去、ソースの遅延ロード、ドラフトカードへのメタ情報表示、CSS の微調整などを行います。

## 主な機能
- `/drafts` `/explore` `/profile` 上の動画/音声を自動停止し、autoplay 属性を削除。
- サービスワーカーから `page-inject.js` を MAIN ワールドに注入し、`HTMLMediaElement.play` を安全にパッチ。
- ドラフト一覧で発行日時とサムネイル ID をオーバーレイ表示、`.animate-pulse` を 100% 不透明に固定。
- SPA 形式のルーティングを監視し、ページ遷移に合わせてブロック ON/OFF を切り替え。
- `/d/` `/p/` の個別ページでは自動再生を許可し、遅延化したソースを自動的に復元。

## インストール手順（Chrome）
1. リポジトリをローカルに配置します（例: `git clone` または `~/git/dontplaysora` にコピー）。
2. Chrome で `chrome://extensions` を開きます。
3. 右上の「デベロッパーモード」を ON にします。
4. 「パッケージ化されていない拡張機能を読み込む」をクリックし、本ディレクトリ（`dontPlaySora`）を選択します。
5. 拡張が「Sora Autoplay Blocker」として登録されるので、必要ならピン留めします。
6. https://sora.chatgpt.com を開き、各ページで自動再生の挙動が想定通りか確認します。

## 開発メモ
- `background.js`: コンテンツスクリプトからの `inject-page-script` メッセージを受け取り、`chrome.scripting.executeScript` で `page-inject.js` を MAIN ワールドへ挿入します。
- `disable-autoplay.js`: DOM 監視や属性変更をフックし、動画ソースの遅延化・復元、ドラフト向けオーバーレイ生成、SPA ナビゲーション検知を担当します。
- `page-inject.js`: ページコンテキストで `HTMLMediaElement.play` をパッチし、ユーザー操作がない再生を拒否。免除ページでは原本のメソッドをそのまま使用します。
- `drafts.css`: `.animate-pulse` の不透明度固定やダイアログのサイズ調整など、UI 上の細かなスタイルを上書きします。
- `manifest.json`: MV3 形式。`host_permissions` や `web_accessible_resources` のマッチパターンは Chrome の検証に通るようにワイルドカード形式で定義しています。

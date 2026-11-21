# 日本語教育 学習ポータル

日本語教師向けの自主学習用静的Web教材。閲覧者登録・サーバー側の成績管理はありません。

## 初回公開（GitHubのブラウザ画面）
1. ZIPを解凍する。教材管理用リポジトリ `nihongo-learning` を作成する（GitHub Freeで公開する場合はPublic）。公開前に会社の規定・著作権・機密情報を確認する。
2. リポジトリの Add file → Upload files を開き、解凍したフォルダの**中身**をアップロードする。ルート直下に index.html、AGENTS.md、README.md、CHANGELOG.md、reference/、accreditation/ があることを確認する。隠しファイル .nojekyll がアップロードされなければ Add file → Create new file で同名の空ファイルを作る（この教材では必須ではない）。GitHub上に既存READMEがあれば意図を確認して置換する。
3. Commit changes で確定する。Settings → Pages → Build and deployment の Source を Deploy from a branch、Branch を main、フォルダを /(root) に設定し Save。
4. Actions または Settings → Pages でデプロイ成功を確認し、表示された公開URLを開く。通常のプロジェクトサイトURLは `https://<ユーザー名>.github.io/nihongo-learning/`。
5. 2教材のリンク、回答、採点、進捗保存、スマートフォン表示を確認してから共有する。

## 更新
ChatGPTのGitHub接続を設定し、対象リポジトリだけにアクセスを許可する。読み取りが可能になったら、最新版とAGENTS.mdを参照して変更するよう指示する。通常の読み取り接続だけで直接書き込めるとは限らない。直接編集には対応する書き込み機能またはCodexを利用し、作業ブランチ・Pull Request・レビュー・マージの順に進める。手動の場合は生成されたHTMLを既存の同一パスにアップロードしてコミットする。mainに反映後、Pagesの公開成功を確認する。

指示例：`AGENTS.mdに従い、reference/index.htmlの第3章の解説を修正してください。その他は維持してください。保存済み進捗への影響を確認し、変更差分とテスト結果を提示してください。公開前に私の承認を待ってください。`

## 構成と注意
- index.html: 教材一覧。新教材を追加する際にリンクを追加。
- reference/index.html: 日本語教育の参照枠（ver1.0）。保存キー ref-full9 は既存互換性のため維持。
- accreditation/index.html: 認定日本語教育機関（既存版、未採番）。保存キー ninteiProgress。
- AGENTS.md: AIの作成・更新ルール。既存の認定教材は新しい出題規則に全面準拠するよう改訂したものではない。
- CHANGELOG.md: 更新記録。

公開リポジトリおよび通常のPagesは社外からも閲覧できる。秘密情報を登録しない。進捗はブラウザ・オリジン単位で保存されるため、ローカルHTMLでの学習記録は公開サイトに自動移行されない。端末間の同期もない。誤更新時はGitHubの変更履歴を確認して修正またはrevertする。

公式手順: https://docs.github.com/ja/pages/quickstart

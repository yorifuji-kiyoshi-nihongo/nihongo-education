# 参照枠 第1章の読み上げ

原稿は `reference-01.narration.json` にあります。章タイトル、本文内の表・資料名を含む9単位です。教材本文と原稿を照合したうえで、`sourceHash` と `targets` を更新してください。各 `targets` は解説の直下要素の0始まりの位置です。導入の空配列は解説前の章タイトル・学習目標に対応します。

## Cloud Shellで生成する

Cloud Shellの `gcloud` ログインを使用します。`python3`、`ffmpeg`、`ffprobe` が必要です。FFmpegが入っていない場合は `sudo apt-get update && sudo apt-get install -y ffmpeg` で導入できます。

```bash
git clone --branch feature/chapter-audio --single-branch https://github.com/yorifuji-kiyoshi-nihongo/nihongo-education.git nihongo-education-audio
cd nihongo-education-audio
python3 tools/generate-audio.py --project nihongo-education-tts
```

表示された文字数と、Google Cloud側の当月の利用実績を確認してください。十分な無料枠が確認できたときに `GENERATE` を入力します。`--check` は原稿を検証するだけで、認証やAPI呼び出しは行いません。生成後、Cloud Shellで `cloudshell download ~/nihongo-reference-01-audio.zip` を実行し、ZIPを取得します。

## 保存と再生成

- `audio/reference/01/manifest.json` に教材・章・セクション・単位のID、順序、開始時刻、時間、MP3パス、原稿と合成設定のハッシュを収録します。読み上げ文は原稿JSONで同じ単位IDから確認できます。
- 段落別のMP3を更新単位として残し、プレーヤーは結合した `chapter.mp3` を再生します。段落境界をまたいでも、ネットワークで次のMP3を読み直しません。画面ロック中の継続や操作はOS／ブラウザに依存します。
- Cloud Shellのホームにキャッシュと送信台帳を保存します。同じホーム・Google Cloudプロジェクトで再実行すると、原稿と音声設定のハッシュが一致して検証に通るファイルを再利用します。
- 台帳は `~/.local/state/nihongo-education-tts/usage.json` です。送信前に文字数を確保し、失敗・再試行も累計に残します。第1章の試験は累計1万文字まで。共通の月間上限は50万文字です。429・503は各単位3回まで試行します。
- 通信断や中断で送信状況が不明な場合はAPI処理を止めます。Google Cloud側の実績と停止原因を確認できた場合のみ、`--review-interrupted` を付けて実行し、`REVIEWED` を入力します。予約量は残したまま、通常コマンドで再開できます。台帳やキャッシュを削除して再開すると、過去の送信量を追跡できなくなります。
- スクリプトの上限はローカルの台帳に基づきます。他の環境・スクリプト・プロジェクトなどからの使用分は別途確認してください。Google Cloud全体の請求を止める設定ではありません。利用実績が分からない場合は生成を中止してください。
- 参考資料は [Google Cloud の料金表](https://cloud.google.com/text-to-speech/pricing) と [割り当てと上限](https://cloud.google.com/text-to-speech/quotas) です。

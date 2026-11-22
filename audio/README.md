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

## 第1章の見出し修正後に再生成する

最初の生成に使った Cloud Shell と同じ環境で、既存のチェックアウトを更新します。

```bash
cd ~/nihongo-education-audio
git pull --ff-only origin feature/chapter-audio
python3 tools/generate-audio.py --project nihongo-education-tts
cloudshell download ~/nihongo-reference-01-audio.zip
```

以前のキャッシュを使うと、修正した5単位だけが生成対象になります。スクリプトが表示する新規件数と文字数（5単位・936文字）を確認してから生成してください。章MP3は9単位を再連結し、各単位の開始・終了時刻を再計算します。台帳は同じ場所に引き継ぎます。

## 全16章の計画と生成

教材の各解説を、章導入・見出しと本文・比較表・手順のまとまりで記録しています。原稿に記載した本文直下の位置は教材ハッシュと一緒に照合されます。別枠の資料一覧、問題、解答と練習欄は音源の範囲外です。音源のない章ではプレーヤーは表示されません。

以前のチェックアウトには生成済みファイルが残っている場合があります。以下は新しいディレクトリに取得するため、古いチェックアウトもCloud Shellのホーム内にあるキャッシュ・台帳もそのまま利用できます。

```bash
git clone --single-branch --branch feature/chapter-audio https://github.com/yorifuji-kiyoshi-nihongo/nihongo-education.git ~/nihongo-education-audio-batch
cd ~/nihongo-education-audio-batch
python3 tools/generate-audio.py --project nihongo-education-tts --all --plan
```

原稿と費用を承認してから生成します。Cloudの当月利用量（スクリプト外の利用を含む）を安全側に見積もり、その数値を `--existing-usage` に指定します。数値が確認できなければ生成しません。`--chapter reference:02 --chapter accreditation:01` のように複数指定できます。`--all` は全16章を対象としますが、承認済み第1章はハッシュが一致する既存MP3を利用します。送信上限を判定する際は最大3回の試行をすべて見込みます。

生成結果は既定で `~/.local/state/nihongo-education-tts/exports/` に章別のZIPとして保存します。Gitのチェックアウトに自動展開しないため、次回のpullで生成物が追跡済みファイルと衝突することを防ぎます。上の試験運用手順は旧版の記録です。現在の生成・出力はこの節の手順を使ってください。

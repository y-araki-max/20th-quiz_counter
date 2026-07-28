# GitHub Desktop で 2台のパソコンから編集する手順

コマンド入力は一切ありません。すべてマウス操作でできます。

---

## 用語（かんたん）
- **リポジトリ**＝このプロジェクト（フォルダ）をGitHubに置いたもの
- **Push（プッシュ）**＝自分の変更をGitHubに送る（アップロード）
- **Pull（プル）／Fetch（フェッチ）**＝GitHubの最新を自分のPCに取り込む（ダウンロード）

**合言葉：「編集する前にPull、終わったらPush」** これだけ守ればOKです。

---

## STEP 1：1台目のパソコンで準備

1. **GitHubアカウントを作る**（無料）… まだなければ [https://github.com](https://github.com) で登録
2. **GitHub Desktop をインストール** … [https://desktop.github.com](https://desktop.github.com) からダウンロードして起動
3. 起動したら、作ったGitHubアカウントで **サインイン**
4. メニュー **File →「Add Local Repository」**
5. 「Choose…」で、この **`20th quiz_counter` フォルダ**を選ぶ
6. 「これはGitリポジトリではありません」と出るので、
   **「create a repository（リポジトリを作成する）」** のリンクをクリック → 次の画面で **「Create Repository」** ボタン
7. 上部の **「Publish repository（リポジトリを公開）」** ボタンをクリック
   - **Name**：好きな名前（例：`quiz2024`）
   - **「Keep this code private（コードを非公開にする）」のチェックについて：**
     - ✅ チェックを外す（＝Public）… あとで**無料の公開URL（GitHub Pages）**を使いたい場合はこちら（推奨）
     - ☑ チェックを付ける（＝Private）… 自分たちの編集だけに使い、公開は別の方法でする場合
   - 「Publish Repository」を押す → これでGitHubに上がりました🎉

---

## STEP 2：2台目のパソコンに取り込む

1. 2台目にも **GitHub Desktop をインストール**して、**同じGitHubアカウントでサインイン**
2. メニュー **File →「Clone Repository（クローン）」**
3. 一覧から、さっき作ったリポジトリ（例：`quiz2024`）を選ぶ
4. 保存場所を決めて **「Clone」** … これで2台目にもフォルダ一式がコピーされます

これ以降、2台目でも同じように編集・同期できます。

---

## STEP 3：毎回の使い方（いちばん大事）

### 編集を始める前
GitHub Desktop を開いて、上部の **「Fetch origin」** をクリック。
もし **「Pull origin」** に変わったら押す（＝もう片方のPCでの変更を取り込む）。

### 編集する
`config.js` などを、いつも通りメモ帳などで開いて編集・保存。

### 編集が終わったら（GitHubに反映）
1. GitHub Desktop の左下に、変更内容の入力欄が出ます
2. **Summary** 欄に何をしたか一言（例：「問題を入力」）
3. **「Commit to main」** ボタンを押す
4. 右上の **「Push origin」** ボタンを押す → GitHubに反映されます

> 💡 **コツ**：2台で“同時に”編集しないこと。片方で編集→Push→もう片方でPull、の順番なら安全です。

---

## STEP 4：（任意）公開URLにする（GitHub Pages・無料）

STEP1で **Public** にした場合、そのまま公開URLにできます。

1. GitHubのサイトで、自分のリポジトリを開く
2. 上メニュー **「Settings」→ 左メニュー「Pages」**
3. 「Branch」を **main** にして **「Save」**
4. 1〜2分待つと、ページ上部に公開URLが表示されます
   （例：`https://あなたの名前.github.io/quiz2024/`）

このURLを社内で共有すれば、社員のスマホから使えます。

---

## 困ったとき
- **「Push」できない／エラーが出る** → たいてい相手PCの変更が先にある状態です。先に「Pull origin」してから、もう一度Pushしてください。
- **どっちが最新か分からなくなった** → 編集前に必ず「Fetch/Pull」する習慣で防げます。
- それでも困ったら、状況を教えてもらえれば一緒に解決します。

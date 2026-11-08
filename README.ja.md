[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="website/static/img/logo-dark.svg" />
  <img src="website/static/img/logo.svg" alt="gji branch mascot" width="72" height="68" />
</picture>

# gji — 作業を切り替えても、続きはそのまま。

機能の実装中に届いたPRレビュー。別のディレクトリで確認して、
戻ったら書きかけのコードから再開しましょう。

`gji`は、未完了の作業とPRレビューを行き来する開発者のためのGit worktree CLIです。
作業ごとにディレクトリを作り、対応する依存関係をセットアップして、
シェルをworktree間で移動させます。いつものGitコマンドとエディタを使いながら、
未コミットの変更は元の作業場所に残しておけます。

[はじめる](#はじめる) · [ドキュメント](https://gji.solaqua.dev/ja/docs/intro) · [自分に合うツールか確認する](https://gji.solaqua.dev/ja/docs/comparison)

<a href="https://gji.solaqua.dev/ja/#workflow">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset=".github/assets/readme-workflow.png" />
    <img src=".github/assets/readme-workflow.gif" alt="新しい作業を始め、別のworktreeでPRを開き、変更中の2ファイルが残るfeature/paymentsに戻る流れ。" width="960" height="336" />
  </picture>
</a>

*英語表記のワークフロー図解です。シェル連携は有効で、セットアップ時間は省略しています。*

## はじめる

**Node.js 20+**、worktree対応のGit、自動でディレクトリを移動するための
**zsh、bash、fishのいずれか**が必要です。

```sh
npm install -g @solaqua/gji
gji init
```

シェルを再起動するか、ウィザードが案内したシェル設定ファイルを読み込んでください。
シェル連携なしでは、CLIから現在のシェルのディレクトリは変更できません。
続いて、リポジトリのメインworktreeで、名前付きブランチ（detached HEADではない状態）から始めます。
`gji go --root`でメインworktreeへ移動します。

- **リモートへの接続：** ブランチの作成時は通常リモートからfetchするため、リモートに接続できる必要があります。
- **プロジェクトのセットアップ：** この例では`--no-install`で依存関係のインストールを省きます。通常は対応するロックファイルを検出すると、プロジェクトのパッケージマネージャでインストールするため、そのツールと時間、ディスク容量が必要です。`--no-install`を指定しても、設定済みの[フック](https://gji.solaqua.dev/ja/docs/hooks)はプロジェクトのコマンドを実行できます。よく知らないリポジトリやPRで使う前にフックを確認してください。

```sh
gji doctor
gji go --root
git branch --show-current
git status --short
gji new feature/try-gji --no-install
pwd
git branch --show-current
gji go --root
git status --short
```

`feature/try-gji`が既にある場合は、別の名前を使ってください。`new`の後は、
別のディレクトリにある`feature/try-gji`ブランチに移動しています。2回目の`go --root`で戻ると、
元のブランチに、最初の`git status`で確認した未コミットのファイルが残っています。
作業を切り替えるためにコミットやstashをする必要はありません。

`gji back`は移動履歴を使います。戻りたいworktreeを先に
`gji go <branch>`で訪れておくと、`back`で戻れます。

次の作業では`--no-install`を外すと、対応する依存関係が自動でセットアップされます。

[インストールとシェル設定](https://gji.solaqua.dev/ja/docs/installation) · [最初のworktreeを試す](https://gji.solaqua.dev/ja/docs/quick-start)

## 複数の作業を開いておく

たとえば、`feature/payments`で作業しているときに：

```sh
gji new feature/search       # 別のディレクトリで新しい作業を始める
gji pr 1234                  # リポジトリの実際のPRを開く
gji go feature/payments      # 書きかけの変更に戻る
```

`1234`は、そのリポジトリのGitHub PR番号に置き換えてください。`gji pr`は
`origin`からfetchするため、リモートに接続できる必要があります。各作業はそれぞれの
worktreeに残ります。移動で変わるのはシェルの場所です。変更を別のブランチへ
移したり、ファイルを同期したりはしません。

| やりたいこと | コマンド |
| --- | --- |
| 新しい作業を始める | `gji new` |
| ローカルでPRをレビューする | `gji pr 1234` |
| 開いている作業を探す | `gji`または`gji go` |
| 直前のworktreeに戻る | `gji back` |
| 現在のworktreeをエディタで開く | `gji open` |
| 完了したworktreeを片付ける | `gji done` |

`gji go`で**Tab**を押すと、登録済みのすべてのリポジトリを探せます。
worktreeの既定のパスは`../worktrees/<repo>/<branch>`です。

`gji done`はリンクされたworktreeを削除し、ブランチの削除を試みます。
片付ける前に、必要なファイルがないか確認してください。削除された未コミットの
ファイルや未追跡ファイルは`gji undo`では復元できません。
ブランチは`--keep-branch`で残せます。

## プロジェクトに合わせて準備する

- [ローカルファイルと既定の設定](https://gji.solaqua.dev/ja/docs/configuration) — `.env.local`のコピー、エディタの選択、依存関係のセットアップ設定。
- [フック](https://gji.solaqua.dev/ja/docs/hooks) — 組み込みの依存関係インストール後にプロジェクト固有のコマンドを実行。
- [日々のワークフロー](https://gji.solaqua.dev/ja/docs/daily-workflow) — レビュー、実験、移動、エディタの利用。
- [同期とクリーンアップ](https://gji.solaqua.dev/ja/docs/sync-and-cleanup) — 作業中のworktreeのrebaseと完了したworktreeの整理。
- [コマンドリファレンス](https://gji.solaqua.dev/ja/docs/commands) — オプション、JSON出力、スクリプトでの利用。
- [トラブルシューティング](https://gji.solaqua.dev/ja/docs/troubleshooting) — 設定、移動、インストールの問題を解決。

## コントリビューション

```sh
pnpm install
pnpm test
pnpm build
```

CLIのソースは`src/`にあります。サイトとドキュメントの開発については、
[website/README.md](website/README.md)（英語）を参照してください。

## ライセンス

[MIT](LICENSE)

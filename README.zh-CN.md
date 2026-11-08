[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="website/static/img/logo-dark.svg" />
  <img src="website/static/img/logo.svg" alt="gji branch mascot" width="72" height="68" />
</picture>

# gji — 切换任务，接着上次的进度。

功能还没写完，PR 审查就来了？在另一个目录里查看，
回来后继续处理留下的改动。

`gji` 是一款 Git worktree 命令行工具，适合在未完成的任务和 PR 审查之间切换的开发者。
它为每个任务创建目录、安装支持的依赖，并在 worktree 之间切换 shell 目录。
继续使用熟悉的 Git 命令和编辑器，把未提交的改动留在原来的工作目录即可。

[开始使用](#开始使用) · [文档](https://gji.solaqua.dev/zh/docs/intro) · [gji 适合我吗？](https://gji.solaqua.dev/zh/docs/comparison)

<a href="https://gji.solaqua.dev/zh/#workflow">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset=".github/assets/readme-workflow.png" />
    <img src=".github/assets/readme-workflow.gif" alt="开始新任务，在独立 worktree 中打开 PR，然后返回仍保留两个已修改文件的 feature/payments。" width="960" height="336" />
  </picture>
</a>

*工作流示意图，使用英文标注。已启用 shell 集成，省略了环境准备时间。*

## 开始使用

需要 **Node.js 20+**、支持 worktree 的 Git，以及用于自动切换目录的
**zsh、bash 或 fish**。

```sh
npm install -g @solaqua/gji
gji init
```

重启 shell，或加载向导提示的 shell 配置文件。
没有 shell 集成，CLI 无法更改当前 shell 的工作目录。
然后从仓库的主 worktree 开始，并确保当前检出的是具名分支（非 detached HEAD 状态）。
`gji go --root` 会切换到主 worktree。

- **远程访问：** 创建分支时默认会从远程仓库 fetch，因此需要能访问远程仓库。
- **项目环境：** 本次试用通过 `--no-install` 跳过依赖安装。通常，检测到支持的锁文件后，gji 会使用项目的包管理器安装依赖，因此需要先准备该工具，安装也会花费时间和磁盘空间。即使使用 `--no-install`，已配置的[钩子](https://gji.solaqua.dev/zh/docs/hooks)仍可能执行项目命令。在不熟悉的仓库或 PR 中使用前，请先检查钩子配置。

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

如果 `feature/try-gji` 已存在，请换一个未使用的分支名。运行 `new` 后，
你会进入另一个目录，当前分支是 `feature/try-gji`。再次运行 `go --root` 后，
你会回到原来的分支，第一次 `git status` 显示的未提交文件仍然保留在那里。
无需为了切换任务而先 commit 或 stash。

`gji back` 根据导航历史返回。请先用 `gji go <branch>` 访问要返回的 worktree，
之后才能通过 `back` 回到它。

下次开始任务时，去掉 `--no-install`，即可让 gji 自动安装支持的依赖。

[安装与 shell 配置](https://gji.solaqua.dev/zh/docs/installation) · [完整体验第一个 worktree](https://gji.solaqua.dev/zh/docs/quick-start)

## 同时保留多个任务

例如，你正在 `feature/payments` 上工作：

```sh
gji new feature/search       # 在独立目录中开始另一个任务
gji pr 1234                  # 打开仓库中实际存在的 PR
gji go feature/payments      # 回到之前留下的改动
```

将 `1234` 替换为该仓库中的 GitHub PR 编号。`gji pr` 从 `origin` fetch，
因此需要能够访问该远程仓库。每个任务都留在各自的 worktree 中。
导航只改变 shell 所在的目录，不会把改动移到其他分支，也不会同步文件。

| 想做什么 | 命令 |
| --- | --- |
| 开始新任务 | `gji new` |
| 在本地审查 PR | `gji pr 1234` |
| 查找已打开的任务 | `gji` 或 `gji go` |
| 返回上一个 worktree | `gji back` |
| 用编辑器打开当前 worktree | `gji open` |
| 清理已完成的关联 worktree | `gji done` |

在 `gji go` 中按 **Tab** 可浏览所有已注册的仓库。
worktree 的默认路径为 `../worktrees/<repo>/<branch>`。

`gji done` 会删除关联 worktree，并尝试删除它的分支。
清理前请检查是否还有需要保留的文件。被删除的未提交文件和未跟踪文件
无法通过 `gji undo` 恢复。使用 `--keep-branch` 可保留分支。

## 按项目需要准备环境

- [本地文件与默认配置](https://gji.solaqua.dev/zh/docs/configuration) — 复制 `.env.local`、选择编辑器或调整依赖安装设置。
- [钩子](https://gji.solaqua.dev/zh/docs/hooks) — 在内置依赖安装完成后执行项目专用命令。
- [日常工作流](https://gji.solaqua.dev/zh/docs/daily-workflow) — 审查、实验、导航和打开编辑器。
- [同步与清理](https://gji.solaqua.dev/zh/docs/sync-and-cleanup) — rebase 活跃 worktree 并清理已完成的任务。
- [命令参考](https://gji.solaqua.dev/zh/docs/commands) — 选项、JSON 输出和脚本用法。
- [故障排查](https://gji.solaqua.dev/zh/docs/troubleshooting) — 解决配置、导航或安装问题。

## 参与贡献

```sh
pnpm install
pnpm test
pnpm build
```

CLI 源码位于 `src/`。网站和文档开发请参阅
[website/README.md](website/README.md)（英文）。

## 许可证

[MIT](LICENSE)

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="website/static/img/logo-dark.svg" />
  <img src="website/static/img/logo.svg" alt="gji branch mascot" width="72" height="68" />
</picture>

# gji — 작업을 바꿔도, 하던 일은 그대로.

기능을 만들던 중에 들어온 PR 리뷰. 별도 디렉터리에서 확인하고,
돌아와서 남겨 둔 변경 사항부터 이어 가세요.

`gji`는 미완성 작업과 PR 리뷰를 오가는 개발자를 위한 Git worktree CLI입니다.
작업마다 디렉터리를 만들고, 지원하는 의존성을 준비하며, 셸을 worktree 사이로
이동시킵니다. 평소 쓰던 Git 명령과 에디터를 그대로 사용하세요.
미커밋 변경 사항은 원래 작업하던 곳에 남겨 두면 됩니다.

[시작하기](#시작하기) · [문서](https://gji.solaqua.dev/ko/docs/intro) · [내 작업 방식에 맞을까?](https://gji.solaqua.dev/ko/docs/comparison)

<a href="https://gji.solaqua.dev/ko/#workflow">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset=".github/assets/readme-workflow.png" />
    <img src=".github/assets/readme-workflow.gif" alt="새 작업을 시작하고 별도 worktree에서 PR을 연 뒤, 수정 파일 두 개가 그대로 남아 있는 feature/payments로 돌아가는 흐름." width="960" height="336" />
  </picture>
</a>

*영문 표기의 워크플로 그림입니다. 셸 연동이 켜져 있으며 프로젝트 준비 시간은 생략했습니다.*

## 시작하기

**Node.js 20+**, worktree를 지원하는 Git, 자동 디렉터리 이동을 위한
**zsh, bash 또는 fish**가 필요합니다.

```sh
npm install -g @solaqua/gji
gji init
```

셸을 다시 시작하거나 마법사가 안내한 셸 설정 파일을 불러오세요.
셸 연동이 없으면 CLI가 현재 셸의 디렉터리를 바꿀 수 없습니다.
그런 다음 저장소의 기본 worktree에서 브랜치를 체크아웃한 상태(detached HEAD가 아닌 상태)로 시작하세요.
`gji go --root`로 기본 worktree로 이동합니다.

- **원격 저장소 접근:** 브랜치를 만들 때는 기본적으로 원격 저장소에서 fetch하므로 접근할 수 있어야 합니다.
- **프로젝트 준비:** 이번 예제는 `--no-install`로 의존성 설치를 건너뜁니다. 보통은 지원하는 lockfile을 찾으면 프로젝트의 패키지 매니저로 설치하므로, 해당 도구와 시간, 디스크 공간이 필요합니다. `--no-install`을 써도 설정된 [훅](https://gji.solaqua.dev/ko/docs/hooks)은 프로젝트 명령을 실행할 수 있습니다. 익숙하지 않은 저장소나 PR에서 사용하기 전에 훅을 확인하세요.

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

`feature/try-gji`가 이미 있으면 다른 이름을 쓰세요. `new` 실행 후에는
별도 디렉터리의 `feature/try-gji` 브랜치에 있게 됩니다. 두 번째 `go --root`로 돌아오면
원래 브랜치에 처음 `git status`에서 확인한 미커밋 파일이 그대로 남아 있습니다.
작업을 오가려고 커밋하거나 stash할 필요가 없습니다.

`gji back`은 이동 기록을 사용합니다. 돌아올 worktree를 먼저
`gji go <branch>`로 방문해야 `back`으로 돌아갈 수 있습니다.

다음 작업부터는 `--no-install`을 빼면 지원하는 의존성을 자동으로 준비합니다.

[설치와 셸 설정](https://gji.solaqua.dev/ko/docs/installation) · [첫 worktree 따라 해 보기](https://gji.solaqua.dev/ko/docs/quick-start)

## 여러 작업을 열어 두기

`feature/payments`에서 작업하던 중이라면:

```sh
gji new feature/search       # 새 작업을 별도 디렉터리에서 시작
gji pr 1234                  # 저장소의 실제 PR 열기
gji go feature/payments      # 남겨 둔 변경 사항으로 돌아가기
```

`1234`는 해당 저장소의 GitHub PR 번호로 바꾸세요. `gji pr`은 `origin`에서
fetch하므로 원격 저장소에 접근할 수 있어야 합니다. 각 작업은 자체 worktree에 남습니다.
이동은 셸의 위치만 바꿉니다. 변경 사항을 다른 브랜치로 옮기거나 파일을
동기화하지는 않습니다.

| 하고 싶은 일 | 명령 |
| --- | --- |
| 새 작업 시작 | `gji new` |
| 로컬에서 PR 리뷰 | `gji pr 1234` |
| 열려 있는 작업 찾기 | `gji` 또는 `gji go` |
| 직전 worktree로 돌아가기 | `gji back` |
| 현재 worktree를 에디터로 열기 | `gji open` |
| 완료된 worktree 정리 | `gji done` |

`gji go`에서 **Tab**을 누르면 등록된 모든 저장소를 탐색할 수 있습니다.
worktree의 기본 경로는 `../worktrees/<repo>/<branch>`입니다.

`gji done`은 연결된 worktree를 제거하고 브랜치 삭제를 시도합니다.
정리 전에 필요한 파일을 확인하세요. 삭제된 미커밋 파일과 추적되지 않은 파일은
`gji undo`로 복구할 수 없습니다. 브랜치는 `--keep-branch`로 남길 수 있습니다.

## 프로젝트에 맞게 준비하기

- [로컬 파일과 기본 설정](https://gji.solaqua.dev/ko/docs/configuration) — `.env.local` 복사, 에디터 선택, 의존성 준비 방식 설정.
- [훅](https://gji.solaqua.dev/ko/docs/hooks) — 기본 의존성 설치 후 프로젝트별 명령 실행.
- [일상 작업 흐름](https://gji.solaqua.dev/ko/docs/daily-workflow) — 리뷰, 실험, 이동, 에디터 사용.
- [동기화와 정리](https://gji.solaqua.dev/ko/docs/sync-and-cleanup) — 작업 중인 worktree rebase 및 완료된 worktree 정리.
- [명령어 레퍼런스](https://gji.solaqua.dev/ko/docs/commands) — 옵션, JSON 출력, 스크립팅.
- [문제 해결](https://gji.solaqua.dev/ko/docs/troubleshooting) — 설정, 이동, 설치 문제 해결.

## 기여하기

```sh
pnpm install
pnpm test
pnpm build
```

CLI 소스는 `src/`에 있습니다. 웹사이트와 문서 개발은
[website/README.md](website/README.md)(영문)를 참고하세요.

## 라이선스

[MIT](LICENSE)

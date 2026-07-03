# gji DX 로드맵 — Agent Workbench로 가는 길

> 이 문서는 gji의 장기 제품 방향(비전 → 킬러 베팅 → 로드맵)과, 주니어 개발자가 바로 착수할 수 있는 상세 스펙(SPEC-01 ~ SPEC-17)을 담는다.
> 기준 버전: v0.8.0 (2026-07)

---

## 0. TL;DR

- **비전**: gji는 두 개의 축으로 이긴다.
  - **단순함의 축** — 기억할 동사는 5개(`gji`, `new`, `go`, `done`, `agent`)뿐이다. 나머지는 이 5개의 *지능*으로 흡수한다. 모든 파괴적 작업은 `gji undo`로 되돌릴 수 있다.
  - **AI의 축** — worktree는 에이전트의 작업장이다. gji는 "사람 1명 + 에이전트 N개"가 한 레포에서 병렬로 일할 때의 **관제탑(Agent Workbench)**이 된다.
- **킬러 베팅 4개**: ① **Agent Workbench**(`gji agent`·`fan`·`grab`·MCP) ② **`--take`**(작업 중이던 변경을 들고 이동) ③ **Instant Worktree**(CoW 복제로 `node_modules` 즉시 부트스트랩) ④ **기억할 것이 없는 CLI**(bare `gji` 허브 + 만능 `go` + `undo`).
- **로드맵**: H1(→v1.0) 단순함의 코어 → H2(v1.x) 속도와 몰입 + 에이전트 v1 → H3(v2.0) 에이전트 함대(fleet) 관제.
- **스펙**: SPEC-01~17은 배경·CLI 표면·동작 명세·엣지 케이스·구현 가이드·테스트 계획·수용 기준까지 포함하며, 각각 독립적으로 PR 가능한 단위다.

---

## 1. 비전과 포지셔닝

### 1.1 한 문장 정의

**gji는 "브랜치를 넘나드는 비용"과 "병렬 작업을 관리하는 비용"을 동시에 없애는 도구다.** git worktree는 수단일 뿐이고, 사용자가 사는 가치는 두 가지다:

1. 지금 하던 걸 흐트러뜨리지 않고, 새 컨텍스트에 *작업 가능한 상태로* 들어간다. (인간의 컨텍스트 스위칭)
2. 에이전트에게 격리된 작업장을 주고, 여러 작업장을 한눈에 보고, 결과를 수확한다. (에이전트의 병렬 작업)

### 1.2 왜 지금인가 — 시장 구조의 변화

AI 에이전트 시대에 한 레포의 동시 작업 수는 1 → N이 됐다. 그런데 도구 지형을 보면:

- **git worktree 원시 명령**: 강력하지만 UX가 없다. 에이전트 개념도 없다.
- **에이전트 CLI들**(Claude Code, Codex, Aider...): 각자 훌륭하지만 *작업장 관리*는 사용자 몫이다. 같은 체크아웃에서 두 개를 돌리면 서로를 밟는다.
- **터미널 멀티플렉서/런처**: 프로세스는 관리하지만 git·브랜치·정리를 모른다.

**"에이전트마다 격리된 worktree를 주고, 전체를 관제하고, 결과를 수확하고, 정리한다"**는 자리가 비어 있다. gji는 이미 그 자리의 기반(worktree 생성·정리·훅·레지스트리·JSON 모드)을 다 갖고 있다. 마지막 마일—에이전트 수명주기와 관제—만 얹으면 된다.

동시에, gji의 경쟁 상대는 여전히 **"그냥 stash 하고 checkout 하는 습관"**이다. 습관을 이기는 건 기능 수가 아니라 *마찰의 부재*다. 그래서 AI 기능을 쌓을수록 표면은 오히려 줄여야 한다. 이 문서의 모든 결정은 이 긴장 위에 서 있다.

### 1.3 North-star 지표

| 지표 | 정의 | 현재(추정) | 목표 |
|---|---|---|---|
| **TTC** (Time-To-Context) | 명령 입력 → deps·env·에디터까지 작업 가능한 상태 | 수 분 (`pnpm install` 대기) | **10초 이내** (H2, CoW) |
| **TTFW** (Time-To-First-Worktree) | 설치 → 첫 worktree 성공 | 5~10분 (셸 설정 3단계 수동) | **1분 이내** (H1) |
| **TTA** (Time-To-Agent) | 아이디어 → 에이전트가 격리 작업장에서 작업 시작 | 불가능 (수동 조합) | **명령 1개, 15초** (H2) |
| **동시 작업 수** | 개발자 1명이 불안 없이 굴리는 병렬 컨텍스트 수 | 2~3 (머릿속 한계) | **5+** (관제탑이 기억을 대신) |

### 1.4 설계 원칙

기존 강점(1~5)은 유지하고, 이번 개정에서 6~8을 추가한다. 모든 신규 스펙은 이를 따른다:

1. **모든 명령은 3-모드**: 인터랙티브(TTY) / headless(`GJI_NO_TUI=1`) / JSON(`--json`).
2. **셸 핸드오프 우선**: 이동이 결과인 명령은 `cd`까지 완결. `--print`는 항상 escape hatch.
3. **파괴적 작업은 명시적**: `--force` 없는 삭제는 프롬프트, `--dry-run` 제공.
4. **훅이 확장점**: 프로젝트별 로직은 코어가 아니라 훅으로.
5. **실패해도 안전**: 부가 기능(훅·히스토리·메타데이터) 실패는 경고로 강등.
6. **동사 5개의 원칙**: 신규 기능은 새 명령이 아니라 기존 동사의 지능 확장으로 먼저 검토한다. 새 동사 추가는 이 문서 수준의 근거를 요구한다. 기존 명령은 절대 깨지 않되, *배울 필요*는 없게 만든다.
7. **모든 파괴는 되돌릴 수 있다**: 삭제 계열 명령은 실행 전 undo 저널에 복구 정보를 남긴다. "실수해도 된다"는 확신이 곧 단순함이다.
8. **AI는 배관이 아니라 콘센트**: gji는 LLM API를 직접 호출하지 않고 토큰을 관리하지 않는다. 사용자가 이미 설치한 에이전트 CLI(claude, codex, aider…)를 *실행하고 관제*할 뿐이다. 유지비와 신뢰 문제를 구조적으로 회피한다.

---

## 2. 현재 상태 진단

### 2.1 강점 (v0.8.0)

- 17개 명령의 넓은 표면: `new`/`pr`/`go`/`warp`/`back`/`open`/`status`/`ls`/`sync`/`sync-files`/`clean`/`remove`/`run-hook`/`config`/`init`/`completion`/`history`
- 검색형 worktree picker(`@clack/core` 커스텀 프롬프트, 최근 사용순 정렬), 크로스 레포 `warp` + 자동 레포 레지스트리
- 3-레이어 config(global → per-repo global → `.gji.json`) + 훅 머지 규칙
- 패키지 매니저 감지 + 설치 프롬프트(Always/Never 영속화), `syncFiles`
- 전 명령 `--json`/headless 지원, dry-run, man 페이지, Homebrew Formula, Docusaurus 문서 사이트
- 테스트 커버리지가 매우 두터움 (테스트가 소스의 2~3배 분량)

### 2.2 마찰 지점 — 사용자 여정별

| 여정 단계 | 마찰 | 근거 | 해결 스펙 |
|---|---|---|---|
| **온보딩** | wrapper + completion + editor 설정이 3단계 수동 | `init.ts`는 wrapper만 담당 | SPEC-02 |
| **온보딩** | 설정 상태를 진단할 수단 부재 ("cd가 안 돼요") | troubleshooting.mdx가 수동 체크리스트 | SPEC-01 |
| **학습** | 명령 17개 + `warp`/`back`/`go`의 역할 구분을 사용자가 외워야 함 | `cli.ts` | SPEC-11, 12 |
| **시작** | main에서 실수로 작업 시작 시 변경을 들고 이동 불가 → stash 스파이럴 회귀 | `new.ts`에 이전 경로 없음 | SPEC-06 ★ |
| **시작** | 새 worktree의 `node_modules` 풀설치 대기 | `install-prompt.ts` | SPEC-07 ★ |
| **시작** | 기존 로컬/원격 브랜치를 worktree로 여는 경로 자체가 없음 (`new`는 `-b` 전용) | `go.ts`, `new.ts` | SPEC-03 |
| **작업 중** | worktree가 늘수록 "이게 뭐 하던 거였지"를 사람이 기억해야 함 | 메타데이터 없음 | SPEC-14 |
| **작업 중** | 여러 worktree에서 dev server 포트 충돌 | 해결 수단 없음 | SPEC-09 |
| **리뷰** | `gji pr`은 번호를 이미 알아야 하고, `pr/1234`는 무슨 PR인지 안 알려줌 | `pr.ts` | SPEC-05 |
| **종료** | merge 후 정리가 remove+이동+prune 별도 명령 | `remove.ts` | SPEC-04 |
| **실수** | `remove`/`clean`을 잘못 눌렀을 때 복구 수단 없음 → 삭제 계열 사용을 겁냄 | — | SPEC-13 |
| **에이전트** | 에이전트를 격리 실행할 수단이 없음: worktree 생성→cd→CLI 실행→터미널 관리 전부 수동 | — | SPEC-15 ★ |
| **에이전트** | 여러 에이전트 시도를 비교·수확·정리하는 동선 없음 | — | SPEC-16, 17 |
| **에이전트** | `--json`은 있지만 에이전트가 gji를 발견/활용할 1급 인터페이스(MCP) 없음 | — | SPEC-10 |
| **문서** | `warp`/`back`/`history`가 README 명령 테이블에 없음 | README.md | SPEC-08 |
| **플랫폼** | Windows(PowerShell) 미지원 | `init.ts` | H3 |

---

## 3. 킬러 베팅 — 4개

> "킬러"의 기준: ① 데모 한 번으로 설치 욕구를 만들고 ② 경쟁 수단에 없으며 ③ 포지셔닝(1.1)을 직접 전진시킨다.

### B1 ★ Agent Workbench — 에이전트의 작업장이자 관제탑 (H2~H3)

```sh
# 아이디어에서 에이전트 착수까지 한 명령
gji agent "fix the login redirect bug"
#  ✓ worktree agent/fix-login-redirect  (⚡ node_modules cloned, 1.2s)
#  ✓ claude started in background       attach: gji attach fix-login-redirect

# 여러 접근을 병렬로 시도
gji fan 3 "refactor the auth module"

# 전체 관제
gji agent ls
#  ● fix-login-redirect   claude   running    12m   +214 −38  (5 files)
#  ● refactor-auth-1      claude   running     3m   +12 −4
#  ◌ refactor-auth-2      claude   exited      1m   +340 −290
#  ◌ refactor-auth-3      claude   exited      2m   +85 −70

# 결과 비교·선택·수확
gji pick refactor-auth        # diffstat 비교 → 승자 선택 → 나머지 정리
gji grab fix-login-redirect   # 에이전트의 변경을 내 worktree로 가져오기
```

**왜 킬러인가**: 위 데모는 오늘 어떤 단일 도구로도 안 된다. "에이전트 1개 돌리기"는 누구나 하지만, "에이전트 N개를 *격리*해서 돌리고, *관제*하고, *수확*하고, *정리*한다"는 워크플로우는 비어 있는 자리다. worktree라는 격리 수단을 이미 쥔 gji가 이 자리의 자연스러운 주인이다. 원칙 8에 따라 gji는 에이전트 CLI를 실행·관제만 하므로(API 미호출) 어떤 에이전트와도 호환되고 유지비가 낮다. → SPEC-15, 16, 17, 10

### B2 ★ `--take` — 변경을 들고 이동 (H2 초입)

```sh
# main에서 30분 작업하다가: "아, 브랜치 팠어야 했는데"
gji new fix/login-redirect --take
# → 변경(untracked 포함)이 새 worktree로 이사, main은 깨끗해짐
```

README가 약속하는 "No stash"의 마지막 구멍. 모두가 매주 겪는 실수이며, 이 순간의 구원 경험이 습관 전환을 만든다. → SPEC-06

### B3 ★ Instant Worktree — CoW 부트스트랩 (H2)

```sh
gji new feature/dark-mode
# ⚡ node_modules cloned from main worktree in 1.2s (copy-on-write)
```

메인 worktree의 `node_modules`·빌드 캐시를 파일시스템 CoW clone으로 복제. TTC를 분 → 초로 바꾸는 체감 최대의 단일 변화이며, **B1의 전제 조건**이기도 하다(에이전트마다 install을 기다리면 fan-out이 성립하지 않는다). → SPEC-07

### B4 ★ 기억할 것이 없는 CLI (H1)

```sh
gji            # 이것만 기억하면 됨: 최근 worktree + 액션이 있는 허브
gji go <아무거나>  # worktree든, 브랜치든, 원격 브랜치든, PR #1234든, 다른 레포든 알아서 도착
gji go -       # 직전 worktree로 (cd - 처럼)
gji undo       # 방금 지운 것 복구
```

기능이 늘수록 표면은 줄인다. `warp`/`back`/`history`는 별도 개념에서 `go`의 지능으로 흡수(별칭 유지), bare `gji`는 도움말 대신 작업 허브가 되고, 모든 삭제는 되돌릴 수 있다. **B1의 복잡성(에이전트 N개)을 감당할 수 있는 건 이 단순함 위에서만 가능하다.** → SPEC-11, 12, 13, 14

### 소비되는 명령 표면 (목표 상태)

| 기억할 동사 | 흡수하는 것 |
|---|---|
| `gji` | 허브(picker + 액션). status/ls의 일상 용도 대체 |
| `gji new` | `--take`, CoW, 슬롯, 기존 브랜치는 go가 처리 |
| `gji go` | `warp`(크로스 레포)·`back`(`go -`)·PR 번호·브랜치 생성 제안 |
| `gji done` | `remove` + 이동 + prune (remove는 저수준 도구로 잔존) |
| `gji agent` | 실행·목록·로그·attach·stop, `fan`/`pick`/`grab`은 agent의 자매 동사 |
| (유틸리티) | `doctor`, `undo`, `sync`, `clean`, `config`, `init` — 매일 쓰지 않아 외울 필요 없음 |

기존 명령·별칭은 전부 유지한다(하위 호환). 줄이는 것은 *명령 수*가 아니라 *배워야 하는 개념 수*다.

---

## 4. 로드맵

### 4.1 H1 — 단순함의 코어 (v0.9 → v1.0, ~2개월)

목표: **TTFW 1분**, "기억할 것이 없는 CLI" 완성, v1.0 선언.

| 항목 | 스펙 | 임팩트 | 노력 |
|---|---|---|---|
| `gji doctor` 진단 | SPEC-01 | 중 | 하 |
| `gji init` 원스톱 마법사 | SPEC-02 | 상 | 중 |
| bare `gji` 허브 | SPEC-11 | 상 | 하 |
| `gji go` 만능 리졸버 + `go -` | SPEC-12 | 상 | 중 |
| `gji go` 기존 로컬/원격 브랜치 생성 제안 | SPEC-03 | 상 | 하 |
| `gji undo` | SPEC-13 | 상 | 중 |
| `gji done` 종료 플로우 | SPEC-04 | 중 | 중 |
| 문서 갭 해소 (`warp`/`back`/`history`) | SPEC-08 | 중 | 하 |

### 4.2 H2 — 속도·몰입·에이전트 v1 (v1.x, 2~5개월)

목표: **TTC 10초, TTA 15초**. 데모 가능한 차별화.

| 항목 | 스펙 | 임팩트 | 노력 |
|---|---|---|---|
| `--take` 변경 이전 | SPEC-06 ★ | 최상 | 상 |
| CoW 부트스트랩 `syncDirs` | SPEC-07 ★ | 최상 | 상 |
| `gji agent` v1 (실행·ls·logs·attach·stop) | SPEC-15 ★ | 최상 | 상 |
| 컨텍스트 카드 + task 메타데이터 | SPEC-14 | 상 | 중 |
| `gji pr` 인자 없이 PR picker | SPEC-05 | 중 | 중 |
| worktree 슬롯(포트 오프셋) | SPEC-09 | 중 | 하 |
| 데모 GIF/영상 리뉴얼 (agent·take·instant 중심) | — | 상 | 하 |

### 4.3 H3 — 에이전트 함대 관제 (v2.0, 5개월+)

- **`gji fan` / `gji pick`** — 병렬 시도와 승자 선택 (SPEC-16)
- **`gji grab`** — 다른 worktree의 변경 수확 (SPEC-17)
- **`gji mcp`** — MCP 서버: 에이전트가 스스로 작업장을 만들고 정리 (SPEC-10)
- **`gji dash`** — 전 레포·전 에이전트 fleet view TUI (agent ls + 컨텍스트 카드 + picker 인프라의 승격, 별도 RFC)
- **forge 상태 통합** — `gh`/`glab` 있을 때 PR CI·리뷰 상태를 카드·dash에 표시
- **Windows/PowerShell** — `init powershell`, 경로 감사, CI 매트릭스 확장
- **에코시스템** — starship 세그먼트, tmux 세션 매핑, `.gji.json` JSON Schema 발행

### 4.4 백로그

`gji new --base <ref>` · `gji ls --dirty` · `gji clean --older-than 14d` · `gji open --last` · `gji rename` · lockfile 변경 감지로 CoW 클론 후 stale 안내 · 에이전트 완료 데스크톱 알림 · AI 브랜치명 제안(설치된 에이전트 CLI 위임, opt-in)

---

## 5. 상세 스펙

> 공통 규약 (모든 스펙에 적용):
> - 테스트는 기존 컨벤션(vitest, `*.test.ts`가 소스 옆, `repo.test-helpers.ts`의 실제 git 레포 fixture, black-box 통합 테스트)을 따른다.
> - 모든 신규 명령/플래그는 ① TTY ② `GJI_NO_TUI=1` ③ `--json` 3-모드 동작 정의 필수. JSON 에러는 stderr에 `{ "error": "..." }` + exit 1.
> - CLI 등록은 `cli.ts`의 `registerCommands`와 `attachCommandActions` 두 곳 모두 수정.
> - 완료 정의(DoD): 구현 + 테스트 + `README.md` 명령 테이블 + `website/docs/commands.mdx` + `pnpm generate-man` + `shell-completion.ts` 갱신.

### 스펙 지도

| # | 이름 | Horizon | 난이도 | 베팅 |
|---|---|---|---|---|
| 01 | `gji doctor` | H1 | 하 | — |
| 02 | `gji init` 마법사 | H1 | 중 | B4 |
| 03 | `go` 브랜치 생성 제안 | H1 | 하~중 | B4 |
| 04 | `gji done` | H1 | 중 | — |
| 05 | `pr` picker | H2 | 중 | — |
| 06 | `--take` | H2 | 상 | B2 ★ |
| 07 | CoW `syncDirs` | H2 | 상 | B3 ★ |
| 08 | 문서 갭 | H1 | 하 | — |
| 09 | 슬롯 | H2 | 하~중 | — |
| 10 | `gji mcp` | H3 | 상 | B1 |
| 11 | bare `gji` 허브 | H1 | 하~중 | B4 ★ |
| 12 | `go` 만능 리졸버 | H1 | 중 | B4 ★ |
| 13 | `gji undo` | H1 | 중 | B4 ★ |
| 14 | 컨텍스트 카드 | H2 | 중 | B1·B4 |
| 15 | `gji agent` v1 | H2 | 상 | B1 ★ |
| 16 | `gji fan`/`pick` | H3 | 상 | B1 |
| 17 | `gji grab` | H3 | 중~상 | B1 |

---

### SPEC-01 · `gji doctor` — 설치 상태 진단

| | |
|---|---|
| 난이도 | 하 (주니어 온보딩용으로 최적) |
| 예상 규모 | 소스 ~200줄 + 테스트, PR 1개 |
| 선행 조건 | 없음 |
| 대상 파일 | 신규 `src/doctor.ts`, `src/doctor.test.ts`, `src/cli.ts` |

#### 배경

가장 흔한 지원 요청은 "gji go 했는데 디렉토리가 안 바뀐다"이다. 원인은 거의 항상 wrapper 미설치/미적용인데, 사용자가 스스로 확인할 방법이 없다. 문제를 코드가 진단하게 한다.

#### CLI 표면

```sh
gji doctor          # 사람용 체크리스트 출력
gji doctor --json   # CI/에이전트용
```

#### 동작 명세

아래 검사를 순서대로 수행하고 `✓`(정상) / `✗`(문제) / `-`(해당 없음/확인 불가)와 한 줄 힌트를 출력한다:

1. **git 버전**: `git --version` 파싱. `< 2.17`이면 ✗, 실행 실패 시 ✗.
2. **셸 통합**: `$SHELL`에서 셸 판별 → 해당 rc 파일(`~/.zshrc`, `~/.bashrc`, `~/.config/fish/config.fish`)에 `gji init` 문자열 존재 여부. 없으면 ✗ + `eval "$(gji init zsh)"` 안내. `$SHELL` 미판별 시 `-`.
3. **completion**: 셸별 관례 경로(`~/.zsh/completions/_gji` 등)의 파일 존재 여부. 없으면 `-` + 설치 명령 안내.
4. **글로벌 config 파싱**: `~/.config/gji/config.json` 존재 시 JSON 파싱 + 알려지지 않은 키 경고. 파싱 실패 시 ✗.
5. **로컬 config 파싱**: git 레포 안일 때만 `.gji.json` 동일 검사. 레포 밖이면 `-`.
6. **worktreePath 쓰기 가능**: 베이스 디렉토리 부모의 존재·쓰기 가능 여부 (`fs.access`, 실제 쓰지 않음).
7. **레지스트리 위생**: 등록 레포 중 경로가 사라진 항목 수 보고 (자동 삭제하지 않음).
8. **에디터**: config `editor`의 CLI가 PATH에 있는지.
9. **고아 상태 파일**: slots(SPEC-09)·agents(SPEC-15) 상태 중 대상 worktree가 사라진 엔트리 수 보고. (해당 스펙 merge 전에는 검사 자체를 생략)

#### 출력 예시

```
gji doctor

 ✓ git 2.44.0
 ✗ shell integration not found in ~/.zshrc
     add: eval "$(gji init zsh)"
 - zsh completion not installed (optional)
     run: gji completion zsh > ~/.zsh/completions/_gji
 ✓ global config valid (~/.config/gji/config.json)
 ✓ local config valid (.gji.json)
 ✓ worktree base writable (../worktrees/gji)
 ✓ 3 repos registered, all reachable
 ✓ editor "cursor" found on PATH

1 problem found.
```

- exit code: ✗가 하나라도 있으면 1, 아니면 0. `-`는 영향 없음.
- `--json`: `{ "checks": [{ "id": "git-version", "status": "ok"|"fail"|"skip", "message": "...", "hint": "..." }], "problems": 1 }`

#### 엣지 케이스

| 케이스 | 기대 동작 |
|---|---|
| git 레포 밖에서 실행 | 레포 의존 검사(5,6)는 `-`, 나머지 정상 수행 |
| rc 파일 자체가 없음 | 검사 2는 ✗ + 파일 생성 포함 안내 |
| `GJI_CONFIG_DIR` 설정됨 | 4·7·9는 해당 경로 기준 (테스트 격리에도 사용) |
| headless | TTY와 동일 출력 |

#### 테스트 계획

- rc 파일 eval 라인 유무에 따른 검사 2 결과 (임시 HOME 픽스처)
- 깨진 JSON config → 검사 4 ✗ & exit 1
- 레포 밖 실행 → skip 처리 & exit 0
- `--json` 스키마 스냅샷

#### 수용 기준

- [ ] 검사가 문서화된 순서로 출력된다
- [ ] 문제가 있을 때만 exit 1
- [ ] `--json` 출력이 스키마와 일치
- [ ] README·commands.mdx·man·completion 갱신

---

### SPEC-02 · `gji init` 원스톱 설정 마법사

| | |
|---|---|
| 난이도 | 중 |
| 예상 규모 | `init.ts` 확장 ~250줄 + 테스트 |
| 선행 조건 | SPEC-01 권장 (완료 후 doctor로 검증 안내) |
| 대상 파일 | `src/init.ts`, `src/init.test.ts`, `src/cli.ts` |

#### 배경

현재 온보딩은 wrapper / completion / editor 3단계 수동이다. TTFW 1분 목표를 위해 인자 없는 `gji init`을 인터랙티브 마법사로 승격한다.

#### CLI 표면

```sh
gji init             # TTY: 마법사 / 비-TTY: 현재처럼 도움말+에러
gji init zsh         # 기존 동작 유지: wrapper 스크립트 출력 (변경 금지)
gji init zsh --write # 기존 동작 유지
```

**하위 호환이 최우선이다.** 셸 인자가 주어진 기존 호출 경로의 출력은 바이트 단위로 동일해야 한다(기존 사용자의 rc에서 `eval "$(gji init zsh)"`가 실행 중이다).

#### 동작 명세 (마법사)

1. `$SHELL`에서 셸 자동 감지 → `select`로 확인 (zsh/bash/fish, 감지값이 기본 선택).
2. **wrapper 설치**: rc 파일에 이미 gji init 라인이 있으면 "already installed ✓" 후 건너뜀. 없으면 confirm → 마커 주석과 함께 추가:
   ```sh
   # >>> gji shell integration >>>
   eval "$(gji init zsh)"
   # <<< gji shell integration <<<
   ```
   fish는 기존 `--write` 로직 재사용.
3. **completion 설치**: 관례 경로에 파일 작성 confirm → 승인 시 디렉토리 생성 + 작성. zsh는 `fpath` 라인이 없으면 마커 블록 안에 함께 추가.
4. **editor 설정**: `EDITORS` 중 PATH에서 발견된 것들을 `select`로 제시(+ "skip"). 선택 시 글로벌 config `editor` 저장 (`gji open --save` 경로 재사용).
5. 요약 + "restart your shell or run: source ~/.zshrc" + "verify with: gji doctor".

#### 엣지 케이스

| 케이스 | 기대 동작 |
|---|---|
| 단계 중 취소(Ctrl-C) | 완료한 단계는 유지, "Aborted", exit 1 |
| rc 파일 없음 | 생성 여부까지 confirm에 포함 |
| 마커 블록이 있는데 내용이 다름 | 블록 내용 갱신(멱등), 중복 추가 금지 |
| headless / `--json` | "run `gji init <shell> --write` in non-interactive mode" 에러, exit 1 |
| 지원 외 셸 | 감지 실패 처리, select에서 직접 선택 |

#### 테스트 계획

- 임시 HOME에서 전 단계 승인 시 rc/completion/config 파일 상태 검증
- 재실행 멱등성 (마커 블록 1개 유지)
- `gji init zsh` 출력 스냅샷 불변 회귀 테스트
- headless 에러 exit 1

#### 수용 기준

- [ ] 새 머신에서 `npm i -g` → `gji init` → 셸 재시작 → `gji new`까지 문서 없이 완주
- [ ] `gji init <shell>` 계열 기존 출력 완전 불변
- [ ] 멱등: N회 실행에도 rc 오염 없음
- [ ] README 설치 안내가 `gji init` 한 단계로 단순화

---

### SPEC-03 · `gji go` — 존재하는 브랜치의 worktree 즉석 생성

| | |
|---|---|
| 난이도 | 하~중 |
| 예상 규모 | `go.ts`·`new.ts` 수정 ~150줄 + 테스트 |
| 선행 조건 | 없음. SPEC-12(만능 리졸버)의 3·4단계에 해당하므로 먼저 merge되면 SPEC-12가 얇아진다 |
| 대상 파일 | `src/go.ts`, `src/new.ts`(생성 파이프라인 일반화), `src/repo.ts`, 테스트 |

#### 배경

`gji go X`는 X의 worktree가 없으면 실패한다. 그런데 X가 **이미 존재하는 로컬/원격 브랜치**인 경우(동료 브랜치, 예전 브랜치)가 매우 흔하고, 현재는 이를 여는 경로가 아예 없다 — `gji new`는 `git worktree add -b`로 새 브랜치 생성 전용이다. "가려고 했으면 데려다준다"로 바꾼다.

#### 동작 명세

`gji go <query>`에서 worktree 매칭 실패 시, 에러 전에 순서대로:

1. **로컬 브랜치 존재** (`git show-ref --verify refs/heads/<query>`): TTY면 confirm — `branch "X" exists but has no worktree. Create one? (Y/n)` → 승인 시 `git worktree add <path> <branch>`(`-b` 없음) 후 기존 `new`와 동일한 후처리(syncFiles → install prompt → afterCreate 훅 → history → 셸 핸드오프).
2. **원격 브랜치 존재** (`refs/remotes/origin/<query>`, syncRemote 반영): confirm → `git worktree add --track -b <branch> <path> origin/<branch>`.
3. 둘 다 없으면 기존 에러 + 힌트: `create it with: gji new <query>`.

구현 노트: `new.ts`의 생성 함수를 `mode: "create" | "checkout" | "track"`으로 일반화해 재사용한다. 후처리 파이프라인 중복 구현 금지.

#### 엣지 케이스

| 케이스 | 기대 동작 |
|---|---|
| headless / `--print` | 프롬프트 불가 → 기존 에러 + 힌트만. 자동 생성 금지 (이동 명령이 조용히 쓰기 작업을 하면 안 됨) |
| 브랜치가 이미 다른 worktree에 체크아웃됨 | git 에러를 변환: `branch "X" is already checked out at <path>` + `gji go <path>` 힌트 |
| 부분 매칭 다수 + 정확한 브랜치명 존재 | 정확 일치 우선 (기존 스코어링 유지) |
| 로컬·원격 둘 다 존재 | 로컬 우선 |

#### 테스트 계획

- 로컬 브랜치만 존재 → confirm 승인 → 생성 + cd 핸드오프
- confirm 거절 → exit 1, 무변화
- 원격 전용 → tracking 검증 (`git rev-parse --abbrev-ref X@{upstream}` = `origin/X`)
- headless → 에러 + 힌트, 생성 없음
- 이미 체크아웃된 브랜치 → 친절한 에러

#### 수용 기준

- [ ] "동료 브랜치 보기"가 `gji go their-branch` 한 번으로 완결
- [ ] afterCreate 훅·install prompt·syncFiles가 `gji new`와 동일 적용
- [ ] 비인터랙티브에서 쓰기 작업 전무

---

### SPEC-04 · `gji done` — 작업 종료 한 방 정리

| | |
|---|---|
| 난이도 | 중 |
| 예상 규모 | 신규 `src/done.ts` ~200줄 + 테스트 |
| 선행 조건 | SPEC-13(undo 저널)이 먼저면 저널 기록을 포함해 구현 |
| 대상 파일 | 신규 `src/done.ts`, `src/done.test.ts`, `src/cli.ts`, `src/init.ts`(wrapper 명령 목록) |

#### 배경

PR merge 뒤 사용자는 ① worktree 삭제 ② 브랜치 삭제 ③ 원래 자리로 이동을 해야 한다. `remove`는 ①②를 하지만 "현재 worktree 안에서" 실행하면 자기 발밑을 지우는 셈이라 동선이 어색하다. 종료를 하나의 동사로 만든다.

#### CLI 표면

```sh
gji done                 # 현재 worktree를 정리하고 빠져나감
gji done [branch]        # 다른 worktree 지정 (이동 없음)
gji done --force         # merge 미확인이어도 진행
gji done --keep-branch   # worktree만 지우고 브랜치 보존
gji done --json --force  # 에이전트용
```

#### 동작 명세 (branch 인자 없음 = 현재 worktree)

1. 현재 위치가 linked worktree가 아니면 에러: `gji done: not inside a linked worktree`.
2. **merge 상태 판정** (`clean --stale` 판정 로직 재사용): 기본 브랜치에 merge됨 *또는* upstream gone.
   - 통과 → 진행. 미통과 & TTY → confirm: `branch "X" doesn't look merged. Delete anyway? (y/N)`. 미통과 & headless/`--json` → `--force` 없으면 exit 1.
3. dirty worktree면 remove와 동일한 보호.
4. undo 저널 기록(SPEC-13) → `beforeRemove` 훅 → `git worktree remove` → 브랜치 삭제(`--keep-branch` 제외).
5. **이동**: 히스토리에서 방금 지운 경로를 제외한 가장 최근 항목으로 셸 핸드오프. 없으면 메인 레포 루트. (`SHELL_WRAPPED_COMMANDS` 등록 필요)
6. `git worktree prune` (조용히).
7. 요약: `✓ removed feature/x (worktree + branch) → back at main · undo: gji undo`.

`--json`: `{ "branch": "...", "path": "...", "deleted": true, "branchDeleted": true, "movedTo": "/path" }`.

#### 엣지 케이스

| 케이스 | 기대 동작 |
|---|---|
| 히스토리 최근 항목이 이미 삭제된 경로 | 존재 확인 후 다음 항목 폴백, 전부 없으면 레포 루트 |
| detached worktree | 브랜치 삭제 생략, 판정은 dirty 여부만 |
| `done [branch]`가 현재 worktree 지정 | 인자 없는 실행과 동일 취급 |
| beforeRemove 훅 실패 | 경고 후 계속 |
| 메인 worktree 지정 | 에러 |

#### 테스트 계획

- merge된 브랜치: 정리 + 히스토리 기반 이동 검증
- 미merge + confirm 거절 → 무변화 / headless + `--force` → 진행
- `--keep-branch` → 브랜치 잔존
- 히스토리 폴백 체인

#### 수용 기준

- [ ] merge된 작업의 종료가 명령 1개 + Enter 1번
- [ ] wrapper로 자동 이동 완결 (`--print` 우회 지원)
- [ ] 비 merge 브랜치를 절대 조용히 지우지 않음

---

### SPEC-05 · `gji pr` — 인자 없이 열린 PR picker

| | |
|---|---|
| 난이도 | 중 |
| 예상 규모 | `pr.ts` 확장 ~200줄 + 테스트 |
| 선행 조건 | 없음 |
| 대상 파일 | `src/pr.ts`, `src/pr.test.ts`, 신규 `src/forge.ts` |

#### 배경

`gji pr <ref>`는 번호를 이미 알아야 한다. `gh` CLI가 있으면 목록에서 고르게 한다. 직접 API 호출·토큰 관리는 하지 않는다(원칙 8) — 인증은 `gh`/`glab`에 위임한다.

#### CLI 표면

```sh
gji pr             # gh 있으면: 열린 PR picker → 선택 → 기존 플로우
gji pr 1234        # 기존 동작 불변
gji pr --json      # 인자 없음 + json → 에러 (ref required)
```

#### 동작 명세

1. 인자 없음 & TTY:
   - `src/forge.ts`의 `detectForgeCli()`: PATH에서 `gh` 탐색 (H2는 GitHub만, glab 후속).
   - `gh pr list --json number,title,author,headRefName,isDraft,updatedAt --limit 30` (cwd = repo root).
   - clack `select`: `#1234 Fix login redirect` + hint `author · branch · 2d ago`. draft는 `[draft]`.
   - 선택 번호로 기존 `runPrCommand` 진입.
2. `gh` 없음 → 에러 + 힌트: `install GitHub CLI for interactive listing: https://cli.github.com`.
3. `gh pr list` 실패(미인증 등) → gh stderr 첫 줄 포함 에러, exit 1.
4. **PR 제목 기억**: 성공 시 `~/.config/gji/pr-meta.json`에 `{ "<repoRoot>#<n>": { "title": "..." } }` 저장 → `ls`/picker/컨텍스트 카드(SPEC-14)에서 `pr/1234`의 metadata로 제목 표시. 조회 실패는 조용히 무시.

#### 엣지 케이스

| 케이스 | 기대 동작 |
|---|---|
| headless에서 인자 없음 | 기존 규약: `ref argument is required in non-interactive mode` |
| 열린 PR 0개 | `no open pull requests`, exit 0 |
| picker 취소 | `Aborted`, exit 1 |
| 구버전 gh (`--json` 미지원) | 실행 에러 경로와 동일 |
| 해당 PR worktree 이미 존재 | 기존 충돌 동작 유지 |

#### 테스트 계획

- fake `gh` 바이너리를 PATH 앞에 배치 → 목록 → 선택 → 생성 통합 테스트
- gh 부재/실패 → 힌트 에러/에러 전파
- pr-meta 저장·표시 검증

#### 수용 기준

- [ ] `gh` 있는 레포에서 번호를 몰라도 리뷰 시작 가능
- [ ] `gh` 없이도 기존 UX 저하 없음
- [ ] gji가 토큰/인증을 직접 다루지 않음

---

### SPEC-06 ★ · `gji new --take` — 변경을 들고 새 worktree로

| | |
|---|---|
| 난이도 | 상 (git 동작 이해 필요 — 시니어 리뷰 필수) |
| 예상 규모 | `new.ts` + 신규 `src/take.ts` ~300줄 + 테스트 다수 |
| 선행 조건 | 없음. SPEC-03의 파이프라인 일반화가 먼저 merge되면 편함 |
| 대상 파일 | `src/new.ts`, 신규 `src/take.ts`, `src/take.test.ts`, `src/cli.ts` |

#### 배경 (킬러 베팅 B2)

"main에서 실수로 작업 시작"은 stash 스파이럴의 대표 시나리오다. `gji new fix/x --take` 한 번으로 uncommitted 변경(스테이징·비스테이징·untracked 포함)이 새 worktree로 *이사*하고 원본은 깨끗해진다.

#### CLI 표면

```sh
gji new fix/login --take         # 현재 worktree의 변경을 이동
gji new fix/login --take --copy  # 이동 대신 복사 (원본 유지)
gji new --take                   # TTY: 브랜치명 프롬프트 후 동일
```

`--take`는 `--detached`와 조합 가능, `--dry-run`과 조합 시 이동될 파일 목록만 출력.

#### 동작 명세

핵심 설계: **git stash는 레포 전역(모든 worktree 공유)이라는 점을 이용**해 stash로 운반한다. patch 파일 방식보다 바이너리·권한·rename에 안전하다.

1. **사전 검증**: git worktree 안일 것 / `git status --porcelain` 비어 있으면 에러 `nothing to take: working tree is clean` / merge·rebase·cherry-pick 진행 중(`.git/MERGE_HEAD` 등)이면 에러.
2. **베이스 고정**: 새 worktree는 반드시 **현재 worktree의 HEAD**에서 분기 (`git worktree add -b <branch> <path> HEAD`). 베이스가 같으므로 apply 충돌이 구조적으로 없다. (일반 `new`의 베이스 로직과 다름을 코드 주석으로 명시)
3. **스태시 생성**: `git stash push --include-untracked -m "gji-take: <branch>"`. 출력에서 커밋 SHA를 파싱해 이후 단계는 ref가 아닌 **SHA로 참조** (다른 프로세스의 stash 조작 레이스 제거). 실패 시 즉시 중단(원본 무변화).
4. **worktree 생성**: 기존 파이프라인. 실패 시 **롤백**: 원본에서 `git stash pop`. pop까지 실패하면 안내: `your changes are safe in stash: <sha> — run "git stash apply <sha>" to restore`.
5. **적용**:
   - **move(기본)**: 새 worktree에서 `git stash apply <sha>` 성공 → stash drop.
   - **copy(`--copy`)**: 새 worktree에서 `apply` → 원본에서도 `apply` → drop.
   - apply 실패 시 stash를 절대 drop하지 않고 SHA 복구 안내, exit 1.
6. **인덱스 보존은 v1에서 보장하지 않는다**: staged/unstaged 구분이 사라질 수 있음을 문서화 (`--index` 재적용은 후속).
7. **후처리**: syncFiles는 apply *이후* 실행하되 기존 "존재 파일 미덮어쓰기" 규칙이 take 파일을 보호함을 테스트로 보장. install prompt·훅·히스토리·핸드오프는 기존과 동일.
8. 요약: `✓ took 7 changed files (2 untracked) → fix/login`.

#### 엣지 케이스

| 케이스 | 기대 동작 |
|---|---|
| untracked만 존재 | 정상 동작 (`-u` 포함) |
| ignored 파일 | 이동 안 함 (`-a` 미사용). `--dry-run`에 각주 |
| 서브모듈 변경 | v1 미지원 — 감지 시 경고 + 서브모듈 외만 운반 |
| 매우 큰 untracked | 파일 수 5,000개 초과 시 confirm |
| `--json` | branch 필수, 출력에 `"taken": { "files": 7, "untracked": 2 }` |

#### 테스트 계획 (실제 git 픽스처)

- staged + unstaged + untracked 혼합 → 새 worktree에 모두 존재, 원본 clean
- `--copy` → 양쪽 존재
- worktree 생성 실패 주입(경로 선점) → 원본 완전 복구
- apply 실패 주입 → stash 보존 + 복구 안내
- syncFiles 충돌 → take 파일 승리
- `--dry-run` → 무변화 + 목록 출력
- 바이너리·실행 권한 보존

#### 수용 기준

- [ ] 어떤 실패 경로에서도 사용자 변경이 유실되지 않는다 (SHA 안내 포함)
- [ ] move/copy 시맨틱이 문서·`--help`에 명확
- [ ] README 데모 시나리오 GIF 추가

---

### SPEC-07 ★ · Instant Worktree — `syncDirs` CoW 부트스트랩

| | |
|---|---|
| 난이도 | 상 (플랫폼별 파일시스템 지식 — 시니어 리뷰 필수) |
| 예상 규모 | 신규 `src/dir-clone.ts` ~250줄 + config + 테스트 |
| 선행 조건 | 없음. SPEC-15(agent)의 TTA 목표가 이 스펙에 의존 |
| 대상 파일 | 신규 `src/dir-clone.ts`, `src/config.ts`, `src/new.ts`, `src/install-prompt.ts`, 테스트 |

#### 배경 (킬러 베팅 B3)

새 worktree의 진짜 비용은 `pnpm install` 대기다. 메인 worktree의 `node_modules`·빌드 캐시를 파일시스템 copy-on-write clone으로 복제하면 수 GB가 1~2초에 끝나고 디스크는 공유된다. 에이전트 fan-out(SPEC-16)은 이것 없이는 성립하지 않는다.

#### Config 표면

```json
{
  "syncDirs": ["node_modules", ".next"]
}
```

- `syncFiles`와 동일한 3-레이어 머지. 값은 레포 루트 기준 상대 경로만. `..`·절대 경로·`.git` 포함 경로는 로드 시 검증 에러.

#### 동작 명세

1. **실행 시점**: worktree 생성 직후, `syncFiles`·install prompt·afterCreate 훅보다 **먼저**.
2. **클론 전략** (`cloneDir(src, dest)`):
   - macOS: `cp -Rc` (APFS clonefile). Linux: `cp -a --reflink=always` (Btrfs/XFS).
   - 실패 시 **일반 복사로 폴백하지 않는다** (수 분짜리 복사는 기대 배반). 스킵 + 1줄 안내: `syncDirs: filesystem doesn't support copy-on-write, skipped node_modules`.
   - 실패 결과를 `~/.config/gji/state.json`에 레포별 캐시 → 이후 시도 생략.
3. **소스**: 메인 worktree(레포 루트)의 해당 디렉토리. 없으면 조용히 스킵.
4. **install prompt 상호작용**: `node_modules` 클론 성공 시 install prompt 생략 + 안내: `⚡ node_modules cloned (1.2s) — run install only if lockfile changed`. (lockfile 비교 stale 감지는 백로그)
5. **pnpm 처리**: `.pnpm` 내부 심링크는 상대 경로라 유효. 단 `node_modules/.modules.yaml`은 절대 경로 포함 가능 → pnpm 감지 시 클론 후 삭제(다음 install 때 재생성). npm/yarn hoisted는 추가 처리 없음.
6. **출력**: `⚡ cloned node_modules (2.1 GB → 1.2s)`. `--json`: `"cloned": [{ "dir": "node_modules", "ms": 1200 }]`. `--dry-run`: 목록+예상 크기만.

#### 엣지 케이스

| 케이스 | 기대 동작 |
|---|---|
| worktreePath가 소스와 다른 파일시스템 | reflink 불가 → 스킵 + 안내 |
| 소스가 심링크 | 실체 기준, 레포 밖 지시면 스킵 + 경고 |
| dest에 이미 존재 (`--force` 재생성) | 스킵 (no-overwrite 원칙) |
| 클론 도중 실패(부분 복사) | 부분 결과 삭제 후 스킵 (반쯤 복사된 node_modules는 최악) |
| Windows | H3 전까지 항상 스킵 + 안내 |

#### 테스트 계획

- `cloneDir` 주입 가능 설계 → 성공/실패/부분 실패를 fake로 통합 테스트
- 실제 reflink는 CI 조건부 (`it.skipIf`)
- pnpm `.modules.yaml` 삭제 검증
- install prompt 생략 경로 검증
- config 검증(절대 경로·`..` 거부)

#### 수용 기준

- [ ] APFS/Btrfs에서 2GB node_modules 기준 TTC "수 분" → "5초 이내" (README에 벤치 수치)
- [ ] 비지원 환경에서 조용하고 정확한 폴백 (느린 전체 복사 금지)
- [ ] 부분 복사 상태를 절대 남기지 않음

---

### SPEC-08 · 문서 갭 해소 — `warp`/`back`/`history` 공식화

| | |
|---|---|
| 난이도 | 하 (첫 기여로 최적) |
| 예상 규모 | 문서 전용 PR |
| 대상 파일 | `README.md`, `website/docs/commands.mdx`, `website/docs/daily-workflow.mdx`, `man`(재생성) |

#### 작업 내용

1. README 명령 테이블에 `warp`/`back`/`history` 3줄 추가 (기존 서식 유지).
2. "Daily workflow" 코드 블록에 `warp`(멀티 레포)와 `back`(리뷰 복귀) 예시 추가.
3. website 동일 반영 + 레포 레지스트리 개념을 FAQ에 1문단 ("warp가 레포를 어떻게 아나요?").
4. `pnpm generate-man` 재생성 확인.
5. 명령 테이블과 `registerCommands`의 옵션 표기 1:1 전수 대조 (불일치는 문서를 코드에 맞춘다).

#### 수용 기준

- [ ] `src/cli.ts`의 모든 명령·옵션이 README·website에 존재
- [ ] man에 3개 명령 포함

---

### SPEC-09 · Worktree 슬롯 — 포트 충돌 없는 병렬 dev server

| | |
|---|---|
| 난이도 | 하~중 |
| 예상 규모 | 신규 `src/slots.ts` ~120줄 + hooks 연동 + 테스트 |
| 선행 조건 | 없음 |
| 대상 파일 | 신규 `src/slots.ts`, `src/hooks.ts`, `src/new.ts`, `src/remove.ts`, 문서 |

#### 배경

worktree 3개에서 `pnpm dev`를 켜면 포트가 충돌한다. gji가 포트를 직접 관리하는 것은 과잉이므로, **worktree마다 안정적인 정수 슬롯**만 부여하고 활용은 훅에 맡긴다. 에이전트 병렬 실행(SPEC-15·16)에서 각 작업장의 dev server가 공존하는 기반이기도 하다.

#### 동작 명세

1. `~/.config/gji/slots.json`에 레포별 `{ "<worktreePath>": <slot> }` 저장 (`GJI_CONFIG_DIR` 존중).
2. **부여**: 생성 시(`new`/`pr`/`go` 생성 경로/`agent`) 사용 중이지 않은 가장 작은 0 이상 정수. 메인 worktree는 슬롯 0 예약.
3. **회수**: `remove`/`clean`/`done` 시 엔트리 삭제. `doctor`에 고아 슬롯 검사 추가.
4. **노출**: 훅 env `GJI_SLOT` + 템플릿 `{{slot}}` (`hooks.ts` 변수 주입부 확장). `ls --json`·`status --json`에 `slot` 필드.
5. 슬롯 파일 훼손 시 빈 상태에서 재시작 (히스토리와 동일한 관대함).

#### 활용 예 (문서 수록)

```json
{
  "hooks": {
    "afterEnter": "export PORT=$((3000 + GJI_SLOT)) && echo \"dev server port: $PORT\""
  }
}
```

#### 엣지 케이스

| 케이스 | 기대 동작 |
|---|---|
| gji 밖에서 만든 worktree | 슬롯 없음 → `GJI_SLOT` 미설정, `ls`에 slot: null |
| 슬롯 파일 동시 쓰기 | 마지막 쓰기 승리 허용 (잠금 미도입 — 최악이 포트 겹침이며 현 상태와 동일) |
| 같은 경로 재생성 (`--force`) | 기존 슬롯 유지 |

#### 테스트 계획

- 생성 3회 → 슬롯 1,2,3 / 2번 제거 후 재생성 → 2 재사용
- 훅 `GJI_SLOT`·`{{slot}}` 치환 검증
- 깨진 slots.json → 경고 없이 재시작

#### 수용 기준

- [ ] worktree 2개 dev server 동시 실행 레시피가 문서에 존재하고 동작
- [ ] 슬롯 번호가 worktree 수명 동안 불변

---

### SPEC-10 · `gji mcp` — 에이전트용 MCP 서버

| | |
|---|---|
| 난이도 | 상 |
| 예상 규모 | 신규 `src/mcp/` 디렉토리. 착수 전 이 개요를 상세 RFC로 승격 |
| 선행 조건 | SPEC-14(task 메타데이터), SPEC-15(agent 상태) — 도구 응답에 포함 |
| 대상 파일 | 신규 `src/mcp/` |

#### 방향

- `gji mcp` 명령이 stdio 기반 MCP 서버 실행. 의존성은 `@modelcontextprotocol/sdk` 하나만.
- 노출 도구(기존 `--json` 코드 경로 재사용 — 새 비즈니스 로직 금지):
  - `gji_list` / `gji_status` — worktree 목록·상태 (task·slot·agent 상태 포함)
  - `gji_new` (branch, take?, task?) / `gji_pr` / `gji_grab`
  - `gji_remove` (force 필수) / `gji_clean_stale` / `gji_run_hook`
- 파괴적 도구는 description에 명시 + dry-run 파라미터 기본 true.
- **양방향 컨텍스트**: 에이전트가 자기 worktree의 task(SPEC-14)를 읽어 "내가 왜 여기 있는지"를 알고, 사람은 `gji agent ls`로 에이전트가 뭘 했는지 본다. MCP는 이 루프의 에이전트 쪽 절반이다.
- 배포: README에 Claude Code/Cursor 등록 스니펫, `llms.txt`를 website에 발행.
- 성공 판정: 에이전트가 "이 PR 검토해줘"를 받아 사람 개입 없이 `gji_pr` → 작업 → `gji_remove`까지 완주하는 데모.

---

### SPEC-11 · bare `gji` — 도움말이 아니라 허브

| | |
|---|---|
| 난이도 | 하~중 |
| 예상 규모 | 신규 `src/hub.ts` ~150줄 + `cli.ts` + picker 확장 + 테스트 |
| 선행 조건 | 없음 (SPEC-12와 독립, 함께면 시너지) |
| 대상 파일 | 신규 `src/hub.ts`, `src/hub.test.ts`, `src/cli.ts`, `src/worktree-picker.ts`, `src/init.ts`(wrapper) |

#### 배경 (킬러 베팅 B4)

현재 `gji` 단독 실행은 도움말을 출력한다. 도움말은 아무도 매일 읽지 않는다. `lazygit`·`fzf`가 증명했듯, **인자 없는 실행이 곧 작업 화면**인 도구가 손에 남는다. bare `gji`를 "최근 worktree + 핵심 액션"의 허브로 만들어, 사용자가 외워야 할 것을 이 한 글자로 줄인다.

#### CLI 표면

```sh
gji        # TTY: 허브 picker / 비-TTY·headless: 기존 도움말 (변경 없음)
gji -h     # 도움말 (기존 그대로)
```

#### 동작 명세

1. TTY & git 레포 안: 기존 searchable picker를 확장한 허브를 연다.
   ```
   ◆ gji — my-repo
   │ ▸ feature/dark-mode      dirty · 2h ago
   │ ▸ pr/1234  Fix login     clean · 1d ago     ← pr-meta 제목(SPEC-05)
   │ ▸ main                   clean
   │ ─────────────────────────
   │ ＋ new worktree…
   │ ⇣ open a pull request…
   │ ⌂ repo root
   └  type to search · enter to jump
   ```
   - worktree 행 선택 = `go`와 동일(히스토리 기록 + 셸 핸드오프).
   - `＋ new worktree…` = `gji new`의 브랜치 프롬프트로 연결.
   - `⇣ open a pull request…` = `gji pr` picker(SPEC-05, gh 없으면 번호 입력 프롬프트).
   - agent 행(SPEC-15 이후): 실행 중 에이전트가 있으면 상단에 상태와 함께 표시.
2. TTY & 레포 밖: 크로스 레포 목록(현 `warp` 무인자 동작)으로 대체. 레지스트리 비어 있으면 기존 안내.
3. 비-TTY / `GJI_NO_TUI=1` / 파이프: **기존 도움말 출력 유지** (스크립트 하위 호환).
4. 셸 wrapper: 허브도 `go`와 동일한 핸드오프 메커니즘 사용 (`SHELL_WRAPPED_COMMANDS`에 bare 호출 등록).

#### 구현 노트

- `worktree-picker.ts`의 entry 타입에 `kind: "worktree" | "action" | "separator"`를 추가하는 것이 핵심 변경. action 행은 검색 대상에서 제외하지 않되 항상 하단 고정.
- `cli.ts`의 `argv.length === 0` 분기를 `runHubCommand`로 교체 (비-TTY 가드 포함).

#### 엣지 케이스

| 케이스 | 기대 동작 |
|---|---|
| worktree가 메인 하나뿐 | 허브는 열리되 액션 행이 주인공 (`new`/`pr` 유도) |
| 취소(Esc/Ctrl-C) | 조용히 exit 0 (에러 아님 — 허브는 둘러보기 화면) |
| 레포 밖 + 레지스트리 빈 상태 | 기존 warp 안내 문구 재사용 |
| `gji --json` | 인자 없는 json은 에러: `nothing to output — see gji ls --json` |

#### 테스트 계획

- fake TTY IO로 허브 → worktree 선택 → 핸드오프 출력 검증
- action 행 선택 → new/pr 플로우 진입
- 비-TTY → 도움말 스냅샷 불변
- 취소 → exit 0

#### 수용 기준

- [ ] 신규 사용자가 배울 첫 명령이 "그냥 `gji`"가 된다 (README 첫 예제 교체)
- [ ] 기존 스크립트(`gji` 출력 파싱)가 깨지지 않는다 (비-TTY 불변)
- [ ] 허브 → 점프까지 키 입력 3회 이내 (타이핑 검색 포함)

---

### SPEC-12 · `gji go` 만능 리졸버 — warp·back·PR을 하나의 동사로

| | |
|---|---|
| 난이도 | 중 |
| 예상 규모 | `go.ts` 재구성 ~250줄 + 테스트 |
| 선행 조건 | SPEC-03 (리졸버 3·4단계). SPEC-05와 pr-meta 공유 |
| 대상 파일 | `src/go.ts`, `src/warp.ts`(리졸버 재사용), `src/back.ts`, 테스트 |

#### 배경 (킬러 베팅 B4)

현재 사용자는 "같은 레포 이동은 `go`, 다른 레포는 `warp`, 되돌아가기는 `back`"을 외워야 한다. 셋 다 본질은 "어딘가로 간다"이다. `go` 하나가 모든 목적지를 해석하게 하고, `warp`/`back`은 별칭으로 유지한다(하위 호환 + 스크립트).

#### CLI 표면

```sh
gji go feature/x     # 1) 현 레포 worktree
gji go other-repo    # 2) 다른 레포의 worktree (레지스트리)
gji go some-branch   # 3) worktree 없는 로컬 브랜치 → 생성 제안 (SPEC-03)
gji go origin-only   # 4) 원격 브랜치 → tracking 생성 제안 (SPEC-03)
gji go 1234          # 5) PR 번호 → gji pr 플로우로 위임
gji go -             # 직전 worktree (cd - 와 동일한 근육기억)
gji go               # picker (기존; 크로스 레포 항목 포함으로 확장)
```

#### 동작 명세 — 해석 순서

`gji go <query>`는 아래 순서로 해석하고, **첫 번째 성공에서 멈춘다**:

1. **현 레포 worktree** 매칭 (기존 `resolveWorktreeQuery` 스코어링: 정확 > 접두 > 부분).
2. **크로스 레포 worktree** 매칭 (레지스트리 전체 — 현 `warp <branch>` 로직 재사용).
3. **로컬 브랜치** 존재 → 생성 confirm (SPEC-03).
4. **원격 브랜치** 존재 → tracking confirm (SPEC-03).
5. **PR 참조** (`#123`, 전체가 숫자, PR URL) → `runPrCommand`로 위임 (worktree 생성 후 이동).
6. 전부 실패 → 에러 + 각 단계별 힌트 요약:
   ```
   gji go: nothing matched "xyz"
     · no worktree or branch named "xyz" in this repo
     · no worktree in 3 registered repos
     · create it: gji new xyz
   ```

특수 인자:
- `gji go -` : 히스토리에서 현재 경로 다음의 최근 항목으로 이동 (= `back 1`). `-`는 유효한 브랜치명이 아니므로 충돌 없음.
- 인자 없는 `gji go`: 기존 picker에 크로스 레포 항목을 `repo:branch` 라벨로 포함 (현 `warp` 무인자와 통합, 현 레포 항목이 상단).

모호성 규칙:
- 같은 이름이 여러 단계에서 매칭 가능하면 **낮은 번호 단계 우선** (현 레포가 항상 이긴다).
- 2단계에서 복수 레포에 동일 브랜치 → TTY는 해당 후보만으로 좁힌 picker, headless는 후보 나열 에러.
- 숫자로만 된 *브랜치*가 실존하면 1~4단계에서 먼저 잡히므로 5단계와 충돌하지 않는다.

기존 명령 처리:
- `gji warp` → `go`의 2단계만 스코프한 별칭으로 유지 (deprecated 표기 없이 — 원칙 6: 배울 필요만 없애면 된다).
- `gji back [n]` → 유지. `go -`는 `back 1`과 동일 구현 공유.

#### 엣지 케이스

| 케이스 | 기대 동작 |
|---|---|
| headless + 3·4·5단계 도달 | 쓰기 작업 금지 → 에러 + 힌트 (SPEC-03과 동일 원칙) |
| `--print` + 5단계(PR) | PR 생성은 쓰기 작업 → 거부, `use: gji pr 1234` 힌트 |
| `go -` 히스토리 비어 있음 | `no previous worktree` 에러, exit 1 |
| 크로스 레포 대상 레포가 삭제됨 | 해당 후보 제외, doctor 안내 1줄 |
| PR URL이 다른 레포의 것 | 현 레포 origin과 불일치 시 에러 + 해당 레포에서 실행 힌트 |

#### 테스트 계획

- 해석 순서 우선순위: 동명의 worktree vs 로컬 브랜치 vs PR 번호 픽스처로 각 단계 승자 검증
- `go -` 왕복 (A→B→`go -`→A)
- 크로스 레포 모호성 → picker 후보 축소 / headless 에러
- 6단계 에러 메시지 힌트 3종 포함 스냅샷
- `warp`/`back` 별칭 기존 테스트 전부 통과 (회귀 없음)

#### 수용 기준

- [ ] "어디로든 `gji go`"가 문서의 공식 멘탈 모델이 된다 (README에서 warp/back은 각주로 강등)
- [ ] 기존 `go`/`warp`/`back` 사용법이 전부 그대로 동작
- [ ] 해석 순서가 문서화되어 있고 결정적(deterministic)이다

---

### SPEC-13 · `gji undo` — 모든 파괴적 작업의 되돌리기

| | |
|---|---|
| 난이도 | 중 (git reflog 이해 필요) |
| 예상 규모 | 신규 `src/undo.ts` ~250줄 + 각 삭제 명령에 저널 기록 추가 + 테스트 |
| 선행 조건 | 없음. SPEC-04(done)·16(pick)은 이 저널에 기록 |
| 대상 파일 | 신규 `src/undo.ts`, `src/undo.test.ts`, `src/remove.ts`, `src/clean.ts`, `src/cli.ts` |

#### 배경 (킬러 베팅 B4)

삭제가 무서우면 사용자는 worktree를 쌓아두고, 쌓이면 도구가 지저분해 보이고, 지저분하면 떠난다. "잘못 지워도 `gji undo`"라는 확신은 `clean`·`done`을 과감하게 쓰게 만드는 심리적 기반이며, 에이전트가 정리 명령을 실행하는 시대(SPEC-10)에는 안전망으로서 필수가 된다.

#### CLI 표면

```sh
gji undo           # 가장 최근 파괴적 작업 복구
gji undo --list    # 복구 가능한 작업 목록 (최근 20개)
gji undo <id>      # 특정 작업 복구
gji undo --json    # 에이전트용
```

#### 동작 명세

**저널 기록** (remove/clean/done/pick의 삭제 직전에 공통 함수로):

```jsonc
// ~/.config/gji/undo-log.json (최근 20개 유지)
{
  "id": "u-20260703-1432-a1",
  "op": "remove",            // remove | clean | done | pick
  "repoRoot": "/home/me/code/my-repo",
  "timestamp": 1751500000000,
  "entries": [{
    "branch": "feature/x",   // detached면 null
    "headSha": "abc123...",  // 삭제 직전 HEAD (git rev-parse)
    "path": "/…/worktrees/my-repo/feature/x",
    "upstream": "origin/feature/x",  // 있을 때만
    "wasDirty": false        // dirty 상태로 --force 삭제됐는지
  }]
}
```

**복구** (`gji undo`):

1. 저널에서 대상 선택 (기본: 같은 레포의 가장 최근 항목. 다른 레포 항목이 더 최근이면 안내 후 그것을 복구할지 confirm).
2. 각 entry에 대해:
   - 브랜치가 없으면 `git branch <branch> <headSha>`로 재생성. (SHA는 기본 gc 유예기간 ~90일 내 안전 — reflog 만료 전. 문서에 명시)
   - `git worktree add <path> <branch>` (원 경로가 점유돼 있으면 에러 + 수동 안내 — v1은 대체 경로를 만들지 않는다).
   - `upstream` 기록이 있으면 `git branch --set-upstream-to`.
   - 슬롯(SPEC-09)·task(SPEC-14) 메타데이터도 저널에 있으면 복원.
3. `wasDirty: true`였다면 경고 출력: `note: uncommitted changes at deletion time were not preserved`. (커밋되지 않은 변경까지 저장하는 것은 v1 범위 밖 — 저널이 무거워지고 시맨틱이 복잡해진다. `remove --force`의 confirm 문구에 "cannot be undone for uncommitted changes"를 추가하는 것으로 대신한다.)
4. 성공 시 해당 저널 항목 제거 + 요약: `✓ restored feature/x at <path>`.

#### 엣지 케이스

| 케이스 | 기대 동작 |
|---|---|
| 저널 비어 있음 | `nothing to undo`, exit 0 |
| 동일 브랜치가 이미 재생성돼 있고 SHA가 다름 | 덮어쓰지 않음 — 에러 + `git branch -f` 수동 안내 (사용자 작업 보호) |
| headSha가 gc로 소실 | git 에러를 변환: `commit no longer exists (gc'd) — cannot restore` |
| clean으로 5개 삭제 → undo | 한 저널 항목의 entries 전체 복구, 일부 실패 시 성공/실패 각각 보고 (부분 성공 허용) |
| 저널 파일 훼손 | 빈 상태로 재시작 + 경고 1줄 |

#### 테스트 계획

- remove → undo → worktree·브랜치·upstream 복원 검증
- clean 다중 삭제 → undo 일괄 복구 / 일부 경로 점유 시 부분 성공 보고
- 브랜치 선점(다른 SHA) → 거부 검증
- dirty --force 삭제 → undo 후 경고 문구
- 저널 20개 초과 롤링

#### 수용 기준

- [ ] `remove`/`clean`/`done`의 모든 삭제가 저널에 남고 `gji undo`로 복구된다
- [ ] 복구가 기존 사용자 작업을 절대 덮어쓰지 않는다
- [ ] 삭제 계열 명령의 완료 메시지에 `undo: gji undo` 힌트가 표시된다

---

### SPEC-14 · 컨텍스트 카드 — "이게 뭐 하던 거였지"의 종말

| | |
|---|---|
| 난이도 | 중 |
| 예상 규모 | 신규 `src/task.ts` + `src/context-card.ts` ~250줄 + 테스트 |
| 선행 조건 | SPEC-05(pr-meta)와 시너지. SPEC-15가 task를 자동 기록 |
| 대상 파일 | 신규 `src/task.ts`, `src/context-card.ts`, `src/go.ts`, `src/new.ts`, `src/ls.ts`, `src/cli.ts` |

#### 배경 (킬러 베팅 B1·B4)

병렬 컨텍스트가 5개를 넘는 순간, 병목은 git이 아니라 **인간의 기억**이다. worktree마다 "무엇을 위한 것인지(task)"를 기록하고, 진입하는 순간 상태 요약을 보여주면, 사람이 기억을 도구에 위임할 수 있다. 에이전트 작업장에서는 task가 곧 프롬프트여서(SPEC-15) 자동으로 채워진다.

#### CLI 표면

```sh
gji new fix/login --task "로그인 리다이렉트 500 수정"   # 생성 시 기록
gji task                        # 현재 worktree의 task 표시
gji task "다시 정리한 목적"      # 갱신
gji task --clear
# gji pr 1234  → task는 PR 제목으로 자동 설정 (SPEC-05 pr-meta)
# gji agent "…" → task는 프롬프트로 자동 설정 (SPEC-15)
```

#### 동작 명세

**저장**: task는 worktree의 gitdir(`<repo>/.git/worktrees/<name>/gji-task.json`)에 저장한다.

- 근거: worktree와 수명을 함께하고(`git worktree remove`·`prune` 시 자동 소멸), 레포 밖 중앙 파일의 고아 문제가 없다.
- 형식: `{ "task": "...", "source": "manual" | "pr" | "agent", "updatedAt": <ts> }`
- gitdir 접근 유틸은 `repo.ts`에 `worktreeGitDir(path)` 헬퍼로 추가.

**컨텍스트 카드**: `gji go`(및 허브 선택) 성공 직후, 셸 핸드오프와 별개로 stderr에 출력:

```
┌ feature/dark-mode
│ task   다크모드 토글 + 시스템 설정 연동
│ state  3 files dirty · ↑2 ↓0 origin/feature/dark-mode
│ last   a1b2c3 "wire ThemeContext" · 2h ago
│ pr     #1234 Add dark mode (SPEC-05 meta 있을 때)
└ agent  ● claude running · 12m (SPEC-15 있을 때)
```

- 각 행은 해당 데이터가 있을 때만. 최대 6행, 항상 1초 이내 (ahead/behind는 기존 `worktree-info.ts` 캐시 로직 재사용, 원격 fetch 금지).
- 끄기: config `contextCard: false` 또는 `gji go --quiet`. headless/`--print`/`--json`에서는 출력하지 않는다 (파이프 오염 금지 — stderr라도 스크립트 소음 최소화).

**노출**: `ls`(비-compact)의 각 행에 task 요약(40자 절단) 추가. `ls --json`·`status --json`에 `task` 필드. picker(허브 포함)의 hint에 task 우선 표시.

#### 엣지 케이스

| 케이스 | 기대 동작 |
|---|---|
| task 미설정 | 카드에서 task 행 생략. `gji task`는 `no task set — set one: gji task "..."` |
| gji 밖에서 만든 worktree | 동일하게 동작 (gitdir는 항상 존재) |
| task 파일 훼손 | 무시하고 미설정 취급 (원칙 5) |
| 메인 worktree | task 설정 가능하되 카드는 동일 규칙 |
| 멀티바이트(한글) 절단 | grapheme 단위 안전 절단 (`Intl.Segmenter`) |

#### 테스트 계획

- `--task` 생성 → `gji task` 표시 → worktree remove 후 파일 소멸 확인
- 카드 각 행의 조건부 렌더링 (dirty/ahead-behind/pr-meta 유무 조합)
- `--quiet`·config off·headless에서 미출력
- ls/json 필드 노출

#### 수용 기준

- [ ] worktree 5개 상황에서 `gji`(허브)만으로 각각의 목적·상태 파악 가능
- [ ] 카드 출력이 셸 핸드오프·스크립트 파싱을 절대 방해하지 않음
- [ ] pr/agent 생성 경로에서 task가 자동으로 채워짐

---

### SPEC-15 ★ · `gji agent` — 에이전트에게 작업장을

| | |
|---|---|
| 난이도 | 상 (프로세스 수명주기 — 시니어 리뷰 필수) |
| 예상 규모 | 신규 `src/agent/` ~400줄 + 테스트. PR 2~3개로 분할 권장 (① run ② ls/logs ③ attach/stop) |
| 선행 조건 | SPEC-07(CoW) 강력 권장 — 없으면 TTA 목표 미달. SPEC-14(task 자동 기록) |
| 대상 파일 | 신규 `src/agent/run.ts`, `src/agent/state.ts`, `src/agent/ls.ts`, `src/cli.ts`, `src/config.ts` |

#### 배경 (킬러 베팅 B1)

"에이전트한테 이 버그 맡기고 나는 내 일 하기"는 오늘 이렇게 생겼다: worktree 수동 생성 → cd → install 대기 → 에이전트 CLI 실행 → 터미널 하나 점유 → 끝났는지 수시로 확인 → 수동 정리. gji는 이 전체를 한 명령으로 만든다. **원칙 8**: gji는 에이전트 CLI를 실행·관제할 뿐, API를 호출하지 않는다.

#### Config 표면

```jsonc
{
  "agent": {
    // argv 배열 (훅과 동일 규칙: 배열=no-shell). {{prompt}} 치환.
    "command": ["claude", "-p", "{{prompt}}"],
    // 미설정 시: PATH에서 claude → codex → aider 순 자동 감지, 감지 결과를 안내
    "branchPrefix": "agent/"   // 기본값
  }
}
```

- 권한 플래그(예: `--dangerously-skip-permissions`)는 **gji가 기본으로 넣지 않는다**. 사용자가 command에 명시해야 하며, 문서에 에이전트별 권장 조합과 위험을 안내한다.

#### CLI 표면

```sh
gji agent "fix the login redirect bug"      # worktree 생성 + 에이전트 백그라운드 시작
gji agent "..." --branch fix/login          # 브랜치명 지정 (기본: agent/<slug> 자동)
gji agent "..." --here                      # 현재 worktree에서 실행 (생성 없이)
gji agent "..." --fg                        # 백그라운드 대신 전면 실행 (끝나면 그 자리)
gji agent ls                                # 관제: 전체 에이전트 상태
gji agent logs <query> [-f]                 # 로그 보기/팔로우
gji attach <query>                          # tmux attach (없으면 logs -f로 폴백)
gji agent stop <query>                      # 정지 (SIGTERM → 5s → SIGKILL)
```

#### 동작 명세

**시작 (`gji agent "<prompt>"`)**:

1. **브랜치명 자동 생성**: 프롬프트 → slug (소문자·kebab·영숫자만·최대 40자, 비ASCII는 제거 후 비면 `task`) → `agent/<slug>`, 충돌 시 `-2` 접미. LLM 호출 없음 — 결정적이고 즉각적이어야 한다 (AI 이름 제안은 백로그의 opt-in).
2. **worktree 생성**: 기존 `new` 파이프라인 전체 재사용 (CoW·syncFiles·슬롯·훅 포함). **install prompt는 자동 skip** (백그라운드에서 프롬프트 불가) — CoW 성공 시 문제없고, 실패 시 afterCreate 훅에 위임됨을 안내.
3. **task 기록**: 프롬프트를 task로 저장 (`source: "agent"`, SPEC-14).
4. **실행**:
   - **tmux 있음(권장 경로)**: `tmux new-session -d -s gji-<repo>-<slug>` 안에서 command 실행. attach 가능하고, 에이전트가 중간에 인터랙티브 질문을 해도 살아 있다.
   - **tmux 없음**: `spawn(detached, stdio → 로그 파일)`. attach 불가·인터랙티브 불가를 시작 시점에 1줄 안내: `tip: install tmux to attach to running agents`.
   - 로그: 두 경로 모두 `~/.config/gji/agents/logs/<id>.log`에 기록 (tmux는 `pipe-pane`).
5. **상태 기록**: `~/.config/gji/agents.json`에 `{ id, repoRoot, path, branch, prompt, mode: "tmux"|"pid", tmuxSession?, pid?, startedAt, fanGroup? }`.
6. 출력:
   ```
   ✓ worktree agent/fix-login-redirect   (⚡ node_modules cloned, 1.2s)
   ✓ claude started (tmux: gji-myrepo-fix-login-redirect)
     watch:  gji agent logs fix-login -f
     attach: gji attach fix-login
   ```
   시작 후 **즉시 반환**한다. 사용자는 자기 worktree에 남는다 (이동 없음 — 관제는 이동이 아니다).

**관제 (`gji agent ls`)**:

```
  AGENT                   CLI     STATE     AGE   CHANGES
● fix-login-redirect      claude  running   12m   +214 −38 (5 files)
● refactor-auth-1         claude  running    3m   +12 −4 (1 file)
◌ refactor-auth-2         claude  exited     1m   +340 −290 (12 files)
```

- STATE는 조회 시점에 라이브 판정: tmux 세션 존재 여부 / `process.kill(pid, 0)`. 저장된 상태를 믿지 않는다 (크래시·재부팅 안전).
- CHANGES는 해당 worktree의 `git diff --shortstat HEAD` + untracked 수 — **"결과물이 있는가"를 한눈에**. 이것이 이 화면의 존재 이유다.
- `--json` 필수 지원 (dash·MCP가 이 데이터를 재사용).

**종료 후**: 에이전트 worktree는 일반 worktree다 — `gji go`로 들어가 검토, `gji grab`(SPEC-17)으로 수확, `gji done`/`pick`으로 정리. 특별한 상태 전이 없음(단순함).

#### 엣지 케이스

| 케이스 | 기대 동작 |
|---|---|
| agent.command 미설정 + 자동 감지 실패 | 에러 + config 예시 출력. 절대 임의 실행 안 함 |
| headless/`--json`에서 시작 | 허용 (프롬프트 없는 경로). `--json`은 `{ id, branch, path, tmuxSession }` 반환 — 스크립트로 fan-out 가능 |
| 같은 프롬프트 재실행 | 새 슬러그(-2)로 새 작업장. 기존 것 재사용 안 함 |
| stop 시 이미 죽어 있음 | 상태만 정리, exit 0 |
| agents.json의 worktree가 수동 삭제됨 | ls에서 `missing` 표기, `doctor`가 정리 안내 |
| 에이전트가 브랜치를 바꿈/새 브랜치 생성 | 관제는 worktree 경로 기준이므로 영향 없음 (CHANGES는 그 worktree의 현재 상태) |
| `--here`가 dirty worktree | 허용하되 경고 1줄 (에이전트가 기존 변경을 건드릴 수 있음) |

#### 테스트 계획

- command를 fake 스크립트(`sleep` + 파일 쓰기)로 주입 → 시작/상태/로그/stop 전 과정 통합 테스트 (pid 모드)
- tmux 경로는 tmux 존재 시 조건부 테스트 (`it.skipIf(!hasTmux)`)
- 슬러그 생성 표: 한글/특수문자/장문/충돌 케이스
- 크래시 시뮬레이션(pid 파일만 남음) → ls가 exited로 정정
- `agent ls --json` 스키마

#### 수용 기준

- [ ] TTA: 명령 입력 → 에이전트 작업 시작까지 15초 이내 (CoW 환경)
- [ ] 터미널을 점유하지 않고, 사용자의 현재 worktree를 바꾸지 않는다
- [ ] `agent ls`만으로 "누가 뭘 하고 있고 결과물이 있는지" 파악 가능
- [ ] gji가 권한 상승 플래그를 기본으로 주입하지 않는다

---

### SPEC-16 · `gji fan` / `gji pick` — 병렬 시도와 승자 선택 (H3)

| | |
|---|---|
| 난이도 | 상 |
| 예상 규모 | 신규 `src/agent/fan.ts` + `src/agent/pick.ts` ~350줄. 착수 전 상세 RFC 승격 |
| 선행 조건 | SPEC-15, SPEC-13(undo), SPEC-07(CoW — N배 비용이므로 사실상 필수) |

#### 배경 (킬러 베팅 B1)

LLM은 확률적이다 — 같은 과제도 시도마다 품질이 다르다. 비싼 것은 컴퓨트가 아니라 *사람의 재시도 대기*이므로, N개를 동시에 돌리고 최선을 고르는 것이 합리적 전략이 된다. worktree 격리를 가진 gji만이 이를 한 명령으로 만들 수 있다.

#### CLI 표면

```sh
gji fan 3 "refactor the auth module"        # 동일 프롬프트 3회 병렬
gji fan "A안: 미들웨어로" "B안: 데코레이터로"   # 상이한 프롬프트 N개
gji pick refactor-auth                       # 그룹 비교·선택·정리
gji fan ls                                   # 그룹 목록 (agent ls의 그룹 뷰)
```

#### 동작 명세 (개요 — RFC에서 상세화)

**fan**: SPEC-15의 시작 루틴을 N회 호출하되 `fanGroup: "<slug>"`를 공유. 브랜치는 `agent/<slug>-1..N`. 시작 전 비용 요약 confirm: `create 3 worktrees (+ 3 agents)? — est. disk +X GB` (CoW면 무시 가능 수준임을 표시).

**pick**: 그룹의 각 후보를 나란히 비교하는 picker:

```
◆ pick a winner — refactor-auth (3 candidates)
│ ▸ -1  exited 8m   +340 −290 (12 files)   tests: ✓ 42 passed
│   -2  exited 6m   +85 −70 (4 files)      tests: ✗ 3 failed
│   -3  running…    +12 −4
└  enter: inspect diff · p: pick · d: drop · r: run check
```

- `--check "pnpm test"` 옵션: 각 후보 worktree에서 검증 명령을 실행해 결과 열 표시 (직렬 실행, 슬롯 덕에 포트 안전).
- **pick 확정 시**: 승자 branch를 유지(또는 `--merge`로 현재 브랜치에 merge), 패자들은 undo 저널 기록 후 일괄 remove. 실행 중인 패자는 stop 후 제거.
- 비교의 근거 데이터(diffstat·체크 결과)는 `agent ls --json` 스키마를 재사용.

#### 핵심 리스크 (RFC에서 해소할 것)

- 동일 파일을 고친 N개 diff의 *내용* 비교 UX (v1은 diffstat + 에디터로 열기까지만, 인라인 diff 뷰는 dash로)
- `--check`의 신뢰성 (설치 상태·훅과의 상호작용)
- 패자 제거의 되돌림 보장 (undo 저널 필수)

#### 수용 기준 (v1)

- [ ] fan 3 → pick → 승자 merge → 패자 정리가 5분 내 완주되는 데모
- [ ] 패자 제거가 전부 `gji undo`로 복구 가능
- [ ] fan 없이 수동으로 만든 agent들도 `pick --group <이름>`으로 묶어 비교 가능

---

### SPEC-17 · `gji grab` — 다른 worktree의 변경 수확

| | |
|---|---|
| 난이도 | 중~상 |
| 예상 규모 | 신규 `src/grab.ts` ~200줄 + 테스트 |
| 선행 조건 | 없음 (SPEC-15의 수확 동선이지만 독립 유용 — 사람 worktree 간에도 쓴다) |
| 대상 파일 | 신규 `src/grab.ts`, `src/grab.test.ts`, `src/cli.ts` |

#### 배경 (킬러 베팅 B1)

에이전트(또는 다른 브랜치의 나)가 만든 변경 중 *일부만* 지금 내 작업에 가져오고 싶을 때, 현재는 checkout·cherry-pick·patch 조합을 수동으로 해야 한다. "저 worktree의 저 변경을 이리로"를 한 동사로 만든다. PR 왕복 없이 로컬에서 결과를 합성하는, 에이전트 시대의 새 동선이다.

#### CLI 표면

```sh
gji grab fix-login                    # 해당 worktree의 전체 변경을 현재 worktree에 적용
gji grab fix-login src/auth.ts src/   # 특정 경로만
gji grab fix-login --commits          # diff 적용 대신 커밋들을 cherry-pick
gji grab fix-login --dry-run          # 적용될 diff 요약만
```

#### 동작 명세

1. **소스 해석**: query를 SPEC-12 리졸버의 1~2단계(worktree 한정)로 해석. 현재 worktree 자신이면 에러.
2. **수확 범위 정의** (기본 모드): 소스 worktree의 `merge-base(현재 HEAD, 소스 HEAD)` 대비 **총 델타** =
   - 커밋된 변경: `git diff <merge-base>..<source-HEAD>`
   - - 커밋 안 된 tracked 변경: 소스에서 `git diff HEAD`
   - - untracked 파일: 파일 목록으로 수집
   - 구현: 소스 worktree에서 `git diff <merge-base>` 실행(working tree 포함 형태) + `git ls-files --others --exclude-standard`.
3. **적용**:
   - diff는 현재 worktree에서 `git apply --3way [--include=<path>...]`.
   - untracked는 파일 복사 (기존 파일 있으면 개별 confirm, `--force`로 일괄 덮어쓰기).
   - `--3way` 충돌 시: 충돌 마커를 남기고 파일 목록 보고 (git의 표준 동작 — gji가 자동 해소를 시도하지 않는다), exit 1이 아닌 **exit 0 + 경고** (부분 성공이 정상 결과).
4. **`--commits` 모드**: `git cherry-pick <merge-base>..<source-HEAD>`. 커밋 이력을 보존하고 싶을 때. 소스에 uncommitted 변경이 있으면 "not included" 경고.
5. **소스 불변 보장**: 어떤 모드에서도 소스 worktree를 절대 변경하지 않는다.
6. 요약: `✓ grabbed 5 files from fix-login (2 conflicts — resolve markers in: src/auth.ts, src/session.ts)`.

#### 엣지 케이스

| 케이스 | 기대 동작 |
|---|---|
| 현재 worktree가 dirty | 허용 (grab의 정상 사용례) — 단 apply 실패 시 이미 적용된 hunk가 남을 수 있음을 시작 전에 안내: `tip: commit or stash first for clean rollback` |
| 소스와 히스토리 무관(merge-base 없음) | 에러: `no common ancestor` |
| 경로 필터가 아무것도 매칭 안 함 | `nothing to grab for given paths`, exit 0 |
| 바이너리 파일 | `git apply` 바이너리 diff 경로 검증 (테스트 포함) |
| `--commits` + merge 커밋 포함 | cherry-pick 실패를 git 메시지와 함께 전달 + `--commits` 없이 재시도 힌트 |
| headless/`--json` | 프롬프트(untracked 덮어쓰기) 발생 시 `--force` 요구. `--json` 출력: `{ "applied": n, "conflicts": [...], "copied": [...] }` |

#### 테스트 계획

- 커밋+미커밋+untracked 혼합 소스 → 전체 grab 검증
- 경로 필터 부분 grab
- 충돌 유발 픽스처 → 마커 + 경고 + exit 0
- `--commits` cherry-pick 이력 보존
- 소스 worktree 불변 (모든 시나리오에서 `git status` 비교)

#### 수용 기준

- [ ] "에이전트 결과 중 이 파일만 가져오기"가 명령 1개
- [ ] 소스 worktree가 어떤 경우에도 변하지 않음
- [ ] 충돌이 숨겨지지 않고 정확히 보고됨

---

## 6. 지표와 검증

- **벤치 스크립트**: `scripts/bench-ttc.mjs` — `gji new` 실행부터 `node_modules` 사용 가능까지 측정. SPEC-07 전/후 수치를 README·릴리스 노트에 공개 (킬러 피처는 숫자로 판다). SPEC-15 merge 후 TTA 측정 추가.
- **doctor 채택률 프록시**: 이슈 템플릿에 `gji doctor` 출력 첨부 요청 → 지원 왕복 감소 확인.
- **문서-코드 일치**: SPEC-08 이후, CLI 등록 명령과 README 테이블을 대조하는 테스트(`cli.test.ts` 확장)로 갭 재발을 CI에서 차단.
- **에이전트 데모**: H2 종료 시점에 "agent → ls → go → grab → done" 풀 사이클 GIF를 README 최상단에 배치. 이것이 신규 유입의 첫 화면이 된다.

## 7. 리스크

| 리스크 | 완화 |
|---|---|
| `--take`·`grab`에서 사용자 변경 유실 (신뢰 치명타) | stash SHA 운반·소스 불변 보장·모든 실패 경로에 복구 안내·시니어 리뷰 필수·릴리스 전 dogfooding |
| 에이전트 실행이 보안 사고로 이어짐 (권한 플래그) | gji는 권한 플래그를 기본 주입하지 않음. command는 명시적 사용자 config. 문서에 위험 안내 |
| 에이전트 CLI들의 인터페이스 변화 | 원칙 8 (실행·관제만) 덕에 결합도가 argv 템플릿 하나. CLI별 어댑터를 만들지 않는다 |
| CoW 미지원 환경의 기대 배반 | 느린 폴백 금지·명시적 스킵 메시지·지원 FS 문서화 |
| 표면 비대화 (동사 추가: agent/fan/pick/grab/undo/task) | 원칙 6: 매일 쓰는 동사는 5개 유지, 나머지는 허브·카드가 필요한 순간에 노출. bare `gji`가 발견 가능성(discoverability)을 담당 |
| tmux 의존 인식 | tmux는 권장이지 필수 아님 (pid 모드 폴백). 시작 메시지로 자연 유도 |
| forge/gh 의존 취약성 | gh 부재 시 완전한 기존 UX 유지, 인증 미취급 |
| Windows 요구 증가 | H3 전까지 README에 지원 셸 명시, PowerShell은 H3 최우선 |

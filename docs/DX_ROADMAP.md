# gji DX 로드맵 — 킬러 피처와 실행 스펙

> 이 문서는 gji의 장기 제품 방향(비전 → 킬러 피처 → 로드맵)과, 주니어 개발자가 바로 착수할 수 있는 상세 스펙(SPEC-01 ~ SPEC-10)을 담는다.
> 기준 버전: v0.8.0 (2026-07)

---

## 0. TL;DR

- **비전**: "사람과 AI가 한 레포에서 병렬로 일하는 시대의 컨텍스트 스위칭 레이어." gji는 worktree 관리 도구가 아니라 *컨텍스트 진입 시간(Time-To-Context)을 0에 수렴시키는 도구*로 포지셔닝한다.
- **킬러 피처 4개 베팅**: ① `--take`(작업 중이던 변경을 새 worktree로 들고 이동) ② Instant Worktree(CoW 복제로 `node_modules` 즉시 부트스트랩) ③ `gji dash`(전 레포 worktree 대시보드 TUI) ④ Agent-native gji(MCP 서버 + 에이전트 문서).
- **로드맵**: H1(→v1.0) 마찰 제거와 신뢰 구축 → H2(v1.x) 킬러 피처 출시 → H3(v2.0) 플랫폼 확장(MCP, Windows, forge 통합).
- **스펙**: 아래 SPEC-01~10은 배경·CLI 표면·동작 명세·엣지 케이스·구현 가이드·테스트 계획·수용 기준까지 포함하며, 각각 독립적으로 PR 가능한 단위다.

---

## 1. 비전과 포지셔닝

### 1.1 한 문장 정의

**gji는 "브랜치를 넘나드는 비용"을 없애는 도구다.** git worktree는 수단일 뿐이고, 사용자가 사는 가치는 "지금 하던 걸 흐트러뜨리지 않고, 새 컨텍스트에 *작업 가능한 상태로* 들어가는 것"이다.

### 1.2 왜 지금인가

AI 에이전트 시대에 한 레포의 동시 작업 수는 1 → N으로 늘었다(내 기능 브랜치 + 리뷰 + 에이전트 실험 + 마이그레이션 검증). 이 시장에서 gji의 경쟁 상대는 `git worktree` 원시 명령이 아니라 **"그냥 stash 하고 checkout 하는 습관"**이다. 습관을 이기려면 매 단계의 체감 비용이 확실히 낮아야 한다.

### 1.3 North-star 지표

| 지표 | 정의 | 현재(추정) | 목표 |
|---|---|---|---|
| **TTC** (Time-To-Context) | 명령 입력 → deps·env·에디터까지 작업 가능한 상태 | 수 분 (`pnpm install` 대기) | **10초 이내** (H2, CoW 부트스트랩) |
| **TTFW** (Time-To-First-Worktree) | 설치 → 첫 worktree 성공 | 5~10분 (셸 설정 3단계 수동) | **1분 이내** (H1, init 마법사) |
| 잔존 | 설치 후 2주 뒤에도 `gji new`를 쓰는 비율 | 측정 불가 | 정성 피드백/스타 추이로 대체 |

### 1.4 설계 원칙 (기존 강점의 유지)

현재 코드베이스가 이미 잘 지키고 있는 원칙들이며, 모든 신규 스펙은 이를 따른다:

1. **모든 명령은 3-모드**: 인터랙티브(TTY) / headless(`GJI_NO_TUI=1`) / JSON(`--json`). 신규 명령도 예외 없음.
2. **셸 핸드오프 우선**: 디렉토리 이동이 결과인 명령은 wrapper를 통해 `cd`까지 완결한다. `--print`는 항상 escape hatch로 남긴다.
3. **파괴적 작업은 명시적**: `--force` 없는 삭제는 항상 프롬프트, `--dry-run` 제공.
4. **훅이 확장점**: gji 코어에 프로젝트별 로직을 넣지 않는다. 프로젝트별 요구는 `afterCreate`/`afterEnter`/`beforeRemove`(+신규 훅)로 흡수한다.
5. **실패해도 안전**: 훅 실패·히스토리 기록 실패는 경고로 강등, 본 작업은 성공시킨다.

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
| **온보딩** | wrapper + completion + editor 설정이 3단계 수동. README에서 셸 설정 안내가 두 번 반복될 만큼 복잡 | `init.ts`는 wrapper만 다루고 completion은 별도 수동 설치 | SPEC-02 |
| **온보딩** | 설정이 잘 됐는지 확인할 방법이 없음. "gji go 했는데 cd가 안 돼요"류 이슈에 진단 수단 부재 | troubleshooting.mdx가 수동 체크리스트 | SPEC-01 |
| **시작** | main에서 실수로 작업을 시작한 경우(가장 흔한 실수) 변경을 들고 새 worktree로 갈 수 없음 → 결국 stash 스파이럴로 회귀 | `new.ts`에 변경 이전 경로 없음 | SPEC-06 ★ |
| **시작** | 새 worktree의 `node_modules` 풀설치 대기. 설치 *프롬프트*는 해결했지만 설치 *시간*은 그대로 | `install-prompt.ts` | SPEC-07 ★ |
| **시작** | `gji go <아직 worktree 없는 브랜치>` → 에러만. 기존 로컬/원격 브랜치를 worktree로 여는 경로 자체가 없음 (`gji new`는 새 브랜치 생성 전용, `-b` 실패) | `go.ts`, `new.ts` | SPEC-03 |
| **리뷰** | `gji pr`은 번호/URL을 이미 알아야 함. 열린 PR 목록에서 고를 수 없고, `pr/1234` 브랜치명은 무슨 PR인지 알려주지 않음 | `pr.ts` | SPEC-05 |
| **작업 중** | 여러 worktree에서 dev server 포트 충돌. 각자 `.env` 수동 편집 | 해결 수단 없음 | SPEC-09 |
| **종료** | merge 후 정리가 `remove` + 이동 + prune 별도 명령. "끝났다"에 대응하는 단일 동사가 없음 | `remove.ts`, `clean.ts` | SPEC-04 |
| **전체 조망** | `status`/`ls`는 현재 레포 한정 텍스트. 전 레포·전 worktree를 보고 *조작*하는 화면 없음 | `warp`는 이동 전용 | SPEC-10(대시보드는 H2) |
| **에이전트** | `--json`은 있지만 에이전트가 gji를 발견/활용할 1급 인터페이스(MCP, llms.txt) 없음 | — | H3 (§4.3) |
| **문서** | `warp`/`back`/`history`가 README 명령 테이블에 없음. 0.8.0 최대 피처가 미문서화 | README.md | SPEC-08 |
| **플랫폼** | Windows(PowerShell) 미지원 | `init.ts` zsh/bash/fish만 | H3 |

---

## 3. 킬러 피처 — 4개의 베팅

> "킬러"의 기준: ① 데모 한 번으로 설치 욕구를 만들고 ② 경쟁 수단(raw worktree, stash 습관, 유사 툴)에 없으며 ③ gji의 포지셔닝(TTC 최소화)을 직접 전진시킨다.

### K1. `--take` — 변경을 들고 이동 (H2 초입, SPEC-06)

```sh
# main에서 30분 작업하다가 깨달음: "아, 이거 브랜치 팠어야 했는데"
gji new fix/login-redirect --take
# → 새 worktree 생성 + 지금까지의 변경(untracked 포함)이 그대로 이동 + main은 깨끗해짐
```

**왜 킬러인가**: README가 약속하는 "No stash"의 마지막 구멍이 이 시나리오다. 잘못된 곳에서 작업을 시작하는 건 모두가 매주 겪는 실수이며, 이 순간의 구원 경험이 습관 전환(stash → gji)을 만든다. 유사 도구(raw worktree, ghq, lazygit)에 이 동선이 없다.

### K2. Instant Worktree — CoW 부트스트랩 (H2, SPEC-07)

```sh
gji new feature/dark-mode
# ⚡ node_modules cloned from main worktree in 1.2s (copy-on-write)
# ✓ ready — no install needed
```

메인 worktree의 `node_modules`·빌드 캐시(`.next`, `.turbo` 등)를 파일시스템 CoW(clone)로 복제한다. APFS(macOS)·Btrfs/XFS(Linux)에서 수 GB 디렉토리가 1~2초에 복제되고 디스크도 공유된다. **TTC를 분 단위 → 초 단위로 바꾸는, 체감이 가장 큰 단일 변화.**

### K3. `gji dash` — 전 레포 조망 대시보드 (H2 후반)

레포 레지스트리 + worktree-info + picker 인프라가 이미 있으므로, 다음 단계는 "이동 전용 목록"을 "보고 조작하는 화면"으로 승격하는 것이다. 전 레포의 worktree를 dirty/ahead-behind/최근 사용과 함께 보여주고 단축키로 jump(`↵`)/open(`o`)/remove(`d`)/sync(`s`)를 실행한다. lazygit이 git UI의 기준을 만들었듯, worktree UX의 기준 화면을 선점한다. (H2 후반, 본 문서에서는 방향만 정의하고 상세 스펙은 dash RFC로 분리)

### K4. Agent-native gji — MCP 서버 + 에이전트 문서 (H3, SPEC-10)

README의 "AI 병렬 작업" 포지셔닝을 인터페이스로 완성한다. `gji mcp`(stdio MCP 서버)로 에이전트가 worktree를 생성/조회/정리하고, `llms.txt` + 에이전트 스킬 문서로 Claude Code/Cursor가 gji를 *스스로 발견해서* 쓰게 만든다. "에이전트에게 브랜치별 격리 작업장을 주는 표준 도구" 자리를 선점하는 베팅.

---

## 4. 로드맵

### 4.1 H1 — 마찰 제거와 신뢰 (v0.9 → v1.0, ~2개월)

목표: **TTFW 1분**, 기존 기능의 완성도·문서 갭 해소. v1.0 선언의 조건.

| 항목 | 스펙 | 임팩트 | 노력 |
|---|---|---|---|
| `gji doctor` 진단 명령 | SPEC-01 | 중 | 하 |
| `gji init` 원스톱 마법사 (wrapper+completion+editor) | SPEC-02 | 상 | 중 |
| `gji go` 미존재 브랜치 → 생성 제안 (기존 로컬/원격 브랜치 지원) | SPEC-03 | 상 | 하 |
| `gji done` 작업 종료 플로우 | SPEC-04 | 중 | 중 |
| `gji pr` 인자 없이 열린 PR picker | SPEC-05 | 중 | 중 |
| README/문서 갭 해소 (`warp`/`back`/`history`) | SPEC-08 | 중 | 하 |

### 4.2 H2 — 킬러 피처 (v1.x, 2~5개월)

목표: **TTC 10초**, 데모 가능한 차별화.

| 항목 | 스펙 | 임팩트 | 노력 |
|---|---|---|---|
| `--take` 변경 이전 | SPEC-06 ★ | 최상 | 상 |
| CoW 부트스트랩 `syncDirs` | SPEC-07 ★ | 최상 | 상 |
| worktree 슬롯(포트 오프셋) | SPEC-09 | 중 | 하 |
| `gji dash` v1 | 별도 RFC | 상 | 상 |
| 데모 GIF/영상 리뉴얼 (take·instant 중심) | — | 상 | 하 |

### 4.3 H3 — 플랫폼 확장 (v2.0, 5개월+)

- **`gji mcp`** — MCP 서버 (SPEC-10, 개요 수준)
- **Windows/PowerShell** — `init powershell`, 경로 처리 감사(audit), CI 매트릭스에 windows-latest 추가
- **forge 상태 통합** — `gh`/`glab` 있을 때 `status`/`dash`에 PR CI·리뷰 상태 표시
- **팀 설정 공유** — `.gji.json`의 JSON Schema 발행(에디터 자동완성), `gji config check`
- **에코시스템** — starship 프롬프트 세그먼트, tmux 세션 매핑(`gji go --tmux`), VS Code 확장 검토

### 4.4 백로그 (기회가 되면)

`gji new --base <ref>`(기본 브랜치가 아닌 지점에서 분기) · `gji ls --dirty` 필터 · `gji clean --older-than 14d` · `gji open --last` · `gji rename <old> <new>` · worktree별 셸 프롬프트 뱃지 문서화

---

## 5. 상세 스펙

> 공통 규약 (모든 스펙에 적용):
> - 테스트는 기존 컨벤션(vitest, `*.test.ts`가 소스 옆, `repo.test-helpers.ts`의 실제 git 레포 fixture 사용, black-box 통합 테스트)을 따른다.
> - 모든 신규 명령/플래그는 ① TTY ② `GJI_NO_TUI=1` ③ `--json` 3-모드 모두에서 동작 정의가 있어야 하며, JSON 에러는 stderr에 `{ "error": "..." }` + exit 1.
> - CLI 등록은 `cli.ts`의 `registerCommands`(도움말 정의)와 `attachCommandActions`(핸들러 연결) 두 곳 모두 수정해야 한다.
> - 완료 정의(DoD): 구현 + 테스트 + `README.md` 명령 테이블 + `website/docs/commands.mdx` + `pnpm generate-man` 재생성 + shell completion(`shell-completion.ts`) 갱신.

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

1. **git 버전**: `git --version` 파싱. `< 2.17` 이면 ✗ ("git 2.17+ required for worktree stability"), 실행 실패 시 ✗.
2. **셸 통합**: `$SHELL`에서 셸 판별 → 해당 rc 파일(`~/.zshrc`, `~/.bashrc`, fish는 `~/.config/fish/config.fish`)에 `gji init` 문자열 존재 여부. 없으면 ✗ + `eval "$(gji init zsh)"` 안내. `$SHELL` 미판별 시 `-`.
3. **completion**: 셸별 관례 경로(`~/.zsh/completions/_gji`, `~/.local/share/bash-completion/completions/gji`, `~/.config/fish/completions/gji.fish`)의 파일 존재 여부. 없으면 `-`(경고 아님) + 설치 명령 안내.
4. **글로벌 config 파싱**: `~/.config/gji/config.json` 존재 시 JSON 파싱 + 알려진 키 외 키 경고. 파싱 실패 시 ✗.
5. **로컬 config 파싱**: git 레포 안일 때만 `.gji.json` 동일 검사. 레포 밖이면 `-`.
6. **worktreePath 쓰기 가능**: 설정된(또는 기본) worktree 베이스 디렉토리의 부모가 존재하고 쓰기 가능한지. (실제 쓰지 말고 `fs.access`로 확인)
7. **레지스트리 위생**: `repo-registry`의 등록 레포 중 경로가 사라진 항목 수 보고. 있으면 `-` + 개수 표시 (자동 삭제하지 않는다).
8. **에디터**: config의 `editor`가 설정돼 있으면 해당 CLI가 PATH에 있는지 (`which` 대신 `spawn` 시도 없이 PATH 탐색).

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

- exit code: ✗가 하나라도 있으면 1, 아니면 0. `-`는 exit code에 영향 없음.
- `--json`: `{ "checks": [{ "id": "git-version", "status": "ok"|"fail"|"skip", "message": "...", "hint": "..." }], "problems": 1 }`

#### 엣지 케이스

| 케이스 | 기대 동작 |
|---|---|
| git 레포 밖에서 실행 | 레포 의존 검사(5,6)는 `-`, 나머지는 정상 수행. 실패 아님 |
| rc 파일 자체가 없음 | 검사 2는 ✗ + 파일 생성 포함 안내 |
| `GJI_CONFIG_DIR` 설정됨 | 4·7은 해당 경로 기준 (테스트 격리에도 이 env를 사용) |
| headless | 프롬프트가 없으므로 TTY와 동일 출력 |

#### 테스트 계획

- rc 파일에 eval 라인 유무에 따른 검사 2 결과 (임시 HOME 픽스처)
- 깨진 JSON config → 검사 4 ✗ & exit 1
- 레포 밖 실행 → skip 처리 & exit 0
- `--json` 스키마 스냅샷

#### 수용 기준

- [ ] 위 8개 검사가 문서화된 순서로 출력된다
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

현재 온보딩은 wrapper(`gji init zsh --write` 또는 수동 eval) / completion(수동 리다이렉트) / editor(별도 `gji open --save`) 3단계다. TTFW 1분 목표를 위해 인자 없는 `gji init`을 인터랙티브 마법사로 승격한다.

#### CLI 표면

```sh
gji init            # TTY: 마법사 실행 / 비-TTY: 현재처럼 도움말+에러
gji init zsh        # 기존 동작 유지: wrapper 스크립트 출력 (변경 금지)
gji init zsh --write # 기존 동작 유지
```

**하위 호환이 최우선이다.** 셸 인자가 주어진 기존 호출 경로의 출력은 바이트 단위로 동일해야 한다(기존 사용자의 rc에서 `eval "$(gji init zsh)"`가 실행 중이다).

#### 동작 명세 (마법사)

1. `$SHELL`에서 셸 자동 감지 → `select`로 확인 (zsh/bash/fish, 감지값이 기본 선택).
2. **wrapper 설치**: 해당 rc 파일에 이미 gji init 라인이 있으면 "already installed ✓" 표시하고 건너뜀. 없으면 추가 여부 confirm → 승인 시 rc 파일 끝에 마커 주석과 함께 추가:
   ```sh
   # >>> gji shell integration >>>
   eval "$(gji init zsh)"
   # <<< gji shell integration <<<
   ```
   fish는 기존 `--write` 로직 재사용.
3. **completion 설치**: 셸별 관례 경로에 completion 파일 작성 여부 confirm → 승인 시 디렉토리 생성 + 파일 작성. zsh는 `fpath` 라인이 rc에 없으면 마커 블록 안에 함께 추가.
4. **editor 설정**: `EDITORS` 목록 중 PATH에서 발견된 것들을 `select`로 제시(+ "skip"). 선택 시 글로벌 config `editor`에 저장 (`gji open --save`와 동일 경로 재사용).
5. 마지막에 요약 출력 + "restart your shell or run: source ~/.zshrc" + "verify with: gji doctor".

#### 엣지 케이스

| 케이스 | 기대 동작 |
|---|---|
| 각 단계에서 취소(Ctrl-C) | 이미 완료한 단계는 유지, "Aborted" 출력, exit 1 |
| rc 파일 없음 | 생성 여부까지 confirm에 포함 |
| 마커 블록이 이미 있는데 내용이 다름 | 블록 내용 갱신(멱등), 중복 추가 금지 |
| headless / `--json` | 마법사 진입 불가: "run `gji init <shell> --write` in non-interactive mode" 에러, exit 1 |
| 지원 외 셸 ($SHELL=nu 등) | 감지 실패로 처리, select에서 직접 고르게 함 |

#### 테스트 계획

- 임시 HOME에서 마법사 전 단계 승인 시 rc/completion/config 파일 상태 검증
- 재실행 멱등성 (rc에 마커 블록 1개 유지)
- 기존 `gji init zsh` 출력 스냅샷 불변 회귀 테스트
- headless에서 에러 exit 1

#### 수용 기준

- [ ] 새 머신에서 `npm i -g` → `gji init` → 셸 재시작 → `gji new`까지 다른 문서 없이 완주 가능
- [ ] `gji init <shell>` 계열 기존 출력 완전 불변
- [ ] 멱등: 마법사 N회 실행해도 rc 파일 오염 없음
- [ ] README의 3단계 설치 안내가 `gji init` 한 단계로 단순화됨

---

### SPEC-03 · `gji go` — 존재하는 브랜치의 worktree 즉석 생성

| | |
|---|---|
| 난이도 | 하~중 |
| 예상 규모 | `go.ts`·`new.ts` 수정 ~150줄 + 테스트 |
| 선행 조건 | 없음 |
| 대상 파일 | `src/go.ts`, `src/new.ts`(또는 신규 `src/checkout.ts`), `src/repo.ts`, 테스트 |

#### 배경

`gji go X`는 X의 worktree가 없으면 실패한다. 그런데 X가 **이미 존재하는 로컬/원격 브랜치**인 경우가 매우 흔하다(동료 브랜치, 예전 브랜치). 현재는 이를 여는 경로가 아예 없다 — `gji new`는 `git worktree add -b`로 *새 브랜치 생성 전용*이라 기존 브랜치에서 실패한다. "가려고 했으면 데려다준다"로 바꾼다.

#### 동작 명세

`gji go <query>`에서 worktree 매칭 실패 시, 에러 전에 다음을 순서대로 확인:

1. **로컬 브랜치 존재** (`git show-ref --verify refs/heads/<query>`): TTY면 confirm — `branch "X" exists but has no worktree. Create one? (Y/n)` → 승인 시 `git worktree add <path> <branch>`(기존 브랜치 체크아웃, `-b` 없음) 후 기존 `new`와 동일한 후처리(syncFiles → install prompt → afterCreate 훅 → history 기록 → 셸 핸드오프).
2. **원격 브랜치 존재** (`git show-ref --verify refs/remotes/origin/<query>`, syncRemote 설정 반영): confirm — `remote branch "origin/X" found. Create local worktree tracking it? (Y/n)` → `git worktree add --track -b <branch> <path> origin/<branch>`.
3. 둘 다 없으면 기존 에러 유지 + 힌트 한 줄: `create it with: gji new <query>`.

구현 노트: 기존-브랜치 체크아웃 경로는 `new.ts`의 worktree 생성 함수를 `mode: "create" | "checkout" | "track"` 파라미터로 일반화해 재사용한다. 후처리 파이프라인 중복 구현 금지.

#### 엣지 케이스

| 케이스 | 기대 동작 |
|---|---|
| headless / `--print` | 프롬프트 불가 → 기존 에러 + 힌트만. 자동 생성하지 않는다 (이동 명령이 조용히 쓰기 작업을 하면 안 됨) |
| 브랜치가 이미 다른 worktree에 체크아웃됨 | git이 거부 → git 에러를 사용자 메시지로 변환: `branch "X" is already checked out at <path>` + `gji go <path>` 힌트 |
| query가 picker 부분 매칭으로는 여럿, 정확한 브랜치명으로는 존재 | 정확 일치 우선 (기존 `resolveWorktreeQuery` 스코어링 유지) |
| 로컬·원격 둘 다 존재 | 로컬 우선, 원격 확인은 건너뜀 |
| detached worktree 이름과 충돌 | worktree 매칭이 이미 우선이므로 해당 없음 |

#### 테스트 계획

- 로컬 브랜치만 존재 → confirm 승인 → worktree 생성 + cd 핸드오프
- confirm 거절 → exit 1, 파일시스템 무변화
- 원격 전용 브랜치 → tracking 브랜치 생성 검증 (`git rev-parse --abbrev-ref X@{upstream}` = `origin/X`)
- headless → 에러 + 힌트, 생성 없음
- 이미 체크아웃된 브랜치 → 친절한 에러

#### 수용 기준

- [ ] "동료 브랜치 보기"가 `gji go their-branch` 한 번으로 완결
- [ ] afterCreate 훅·install prompt·syncFiles가 `gji new`와 동일하게 적용
- [ ] 비인터랙티브 모드에서 어떤 쓰기 작업도 발생하지 않음

---

### SPEC-04 · `gji done` — 작업 종료 한 방 정리

| | |
|---|---|
| 난이도 | 중 |
| 예상 규모 | 신규 `src/done.ts` ~200줄 + 테스트 |
| 선행 조건 | 없음 (SPEC-03의 후처리 일반화와 독립) |
| 대상 파일 | 신규 `src/done.ts`, `src/done.test.ts`, `src/cli.ts`, `src/init.ts`(셸 wrapper 명령 목록) |

#### 배경

PR이 merge된 뒤 사용자는 ① worktree 삭제 ② 브랜치 삭제 ③ 원래 자리로 이동을 해야 한다. `remove`가 ①②를 하지만 "현재 worktree 안에서" 실행하면 자기 발밑을 지우는 셈이라 동선이 어색하다. 종료를 하나의 동사로 만든다.

#### CLI 표면

```sh
gji done                 # 현재 worktree를 정리하고 빠져나감
gji done [branch]        # 다른 worktree 지정 가능 (이동 없음, remove와 동일해짐)
gji done --force         # merge 미확인이어도 진행
gji done --keep-branch   # worktree만 지우고 브랜치는 보존
gji done --json --force  # 에이전트용
```

#### 동작 명세 (branch 인자 없음 = 현재 worktree)

1. 현재 디렉토리가 linked worktree가 아니면(메인 레포 루트면) 에러: `gji done: not inside a linked worktree`.
2. **merge 상태 판정** (기존 `clean --stale` 판정 로직 재사용): 브랜치가 기본 브랜치에 merge됨 *또는* upstream이 gone.
   - 판정 통과 → 진행.
   - 미통과 & TTY → 경고 confirm: `branch "X" doesn't look merged. Delete anyway? (y/N)`.
   - 미통과 & headless/`--json` → `--force` 없으면 에러 exit 1.
3. dirty worktree면 remove와 동일한 보호 (confirm / `--force`).
4. `beforeRemove` 훅 실행 → `git worktree remove` → 브랜치 삭제(`--keep-branch` 없을 때).
5. **이동**: 히스토리(`history.ts`)에서 방금 지운 경로를 제외한 가장 최근 항목으로 셸 핸드오프. 히스토리가 비었으면 메인 레포 루트로. (`back`과 동일한 메커니즘, wrapper 등록 필요)
6. `git worktree prune` 실행(조용히).
7. 요약 출력: `✓ removed feature/x (worktree + branch) → back at main`.

`--json` 출력: `{ "branch": "...", "path": "...", "deleted": true, "branchDeleted": true, "movedTo": "/path" }` (JSON 모드에선 셸 핸드오프 생략, `movedTo`는 참고값).

#### 엣지 케이스

| 케이스 | 기대 동작 |
|---|---|
| 히스토리의 최근 항목이 이미 삭제된 경로 | 존재 확인 후 다음 항목으로 폴백, 전부 없으면 레포 루트 |
| detached worktree에서 실행 | 브랜치 삭제 단계 생략, merge 판정은 dirty 여부만 |
| `done [branch]`로 현재 worktree를 지정 | 인자 없는 실행과 동일 취급 (이동 포함) |
| beforeRemove 훅 실패 | 기존 원칙대로 경고 후 계속 |
| 메인 worktree 지정 | 에러 (remove와 동일) |

#### 테스트 계획

- merge된 브랜치: 정리 + 히스토리 기반 이동 경로 출력 검증
- 미merge + TTY confirm 거절 → 무변화
- 미merge + headless + `--force` → 진행
- `--keep-branch` → 브랜치 잔존 확인
- 히스토리 폴백 체인 (최근 항목 삭제됨 → 다음 → 루트)

#### 수용 기준

- [ ] merge된 작업의 종료가 명령 1개 + Enter 1번
- [ ] 셸 wrapper로 자동 이동까지 완결 (`SHELL_WRAPPED_COMMANDS`에 등록, `--print` 우회 지원)
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

`gji pr <ref>`는 번호를 이미 알아야 한다. 리뷰 요청을 받으면 브라우저에서 번호를 확인해 오는 왕복이 생긴다. `gh` CLI가 있으면 목록에서 고르게 한다. (직접 API 호출·토큰 관리는 하지 않는다 — 인증은 `gh`/`glab`에 위임하는 것이 유지비가 압도적으로 낮다.)

#### CLI 표면

```sh
gji pr             # gh 있으면: 열린 PR 목록 picker → 선택 → 기존 pr 플로우
gji pr 1234        # 기존 동작 불변
gji pr --json      # 인자 없음 + json → 에러 (ref required)
```

#### 동작 명세

1. 인자 없이 호출 & TTY:
   - `src/forge.ts`에 `detectForgeCli()` 구현: PATH에서 `gh` 탐색 (H1은 GitHub만, glab은 후속).
   - 있으면 `gh pr list --json number,title,author,headRefName,isDraft,updatedAt --limit 30` 실행 (cwd = repo root).
   - 결과를 clack `select`로 표시: `#1234 Fix login redirect` + hint로 `author · branch · 2d ago`. draft는 라벨에 `[draft]` 표시.
   - 선택된 번호로 기존 `runPrCommand` 플로우 진입 (fetch ref → worktree).
2. `gh` 없음 → 에러 + 힌트: `gji pr: PR number required (install GitHub CLI for interactive listing: https://cli.github.com)`.
3. `gh pr list` 실패(미인증, GH가 아닌 origin 등) → gh의 stderr 첫 줄을 포함한 에러로 변환, exit 1.
4. **PR 제목 기억**: 선택/지정된 PR의 제목을 `gh pr view <n> --json title`로 조회 가능할 때, worktree 생성 성공 후 히스토리 entry의 branch 대신 표시용 메타로 활용할 수 있도록 `~/.config/gji/pr-meta.json`에 `{ "<repoRoot>#<n>": { "title": "..." } }` 저장. `ls`/picker에서 `pr/1234` 항목의 metadata로 제목을 표시. (조회 실패는 조용히 무시)

#### 엣지 케이스

| 케이스 | 기대 동작 |
|---|---|
| headless에서 인자 없음 | 기존 에러 규약: `ref argument is required in non-interactive mode` |
| 열린 PR 0개 | `no open pull requests` 안내, exit 0 |
| picker에서 취소 | `Aborted`, exit 1 |
| gh 버전이 `--json` 미지원(구버전) | 실행 에러 경로와 동일 처리 |
| 이미 해당 PR worktree 존재 | 기존 `pr` 명령의 현행 충돌 동작 유지 |

#### 테스트 계획

- `gh` 스텁(테스트용 fake 바이너리를 PATH 앞에 배치)으로 목록 → 선택 → worktree 생성 통합 테스트
- gh 부재 → 힌트 에러
- gh 실패(exit 1) → 에러 전파
- pr-meta 저장 및 `ls` 표시 검증

#### 수용 기준

- [ ] `gh`가 있는 GitHub 레포에서 번호를 몰라도 리뷰 시작 가능
- [ ] `gh` 없이도 기존 UX가 전혀 저하되지 않음
- [ ] gji가 토큰/인증을 직접 다루지 않음

---

### SPEC-06 ★ · `gji new --take` — 변경을 들고 새 worktree로

| | |
|---|---|
| 난이도 | 상 (git 동작 이해 필요 — 시니어 리뷰 필수) |
| 예상 규모 | `new.ts` + 신규 `src/take.ts` ~300줄 + 테스트 다수 |
| 선행 조건 | 없음. SPEC-03의 생성 파이프라인 일반화가 먼저 merge되면 편함 |
| 대상 파일 | `src/new.ts`, 신규 `src/take.ts`, `src/take.test.ts`, `src/cli.ts` |

#### 배경 (킬러 피처 K1)

"main에서 실수로 작업 시작"은 stash 스파이럴의 대표 시나리오다. `gji new fix/x --take` 한 번으로 uncommitted 변경(스테이징·비스테이징·untracked 포함)이 새 worktree로 *이사*하고 원래 worktree는 깨끗해진다.

#### CLI 표면

```sh
gji new fix/login --take         # 현재 worktree의 변경을 새 worktree로 이동
gji new fix/login --take --copy  # 이동 대신 복사 (원본 유지)
gji new --take                   # TTY: 브랜치명 프롬프트 후 동일 동작
```

`--take`는 `--detached`와 조합 가능, `--dry-run`과 조합 시 이동될 파일 목록을 출력만 한다.

#### 동작 명세

핵심 설계: **git stash는 레포 전역(모든 worktree가 공유)이라는 점을 이용**해 stash로 운반한다. patch 파일 방식보다 바이너리·권한·rename을 안전하게 다룬다.

1. **사전 검증** (모두 통과해야 진행):
   - 현재 위치가 git worktree 안일 것.
   - `git status --porcelain` 결과가 비어 있으면 에러: `nothing to take: working tree is clean`.
   - merge/rebase/cherry-pick 진행 중(`.git/MERGE_HEAD` 등 존재)이면 에러: `cannot take changes during an in-progress merge/rebase`.
2. **베이스 고정**: 새 worktree는 반드시 **현재 worktree의 HEAD**에서 분기한다 (`git worktree add -b <branch> <path> HEAD`). 베이스가 같으므로 apply 충돌이 구조적으로 없다. (일반 `gji new`의 베이스 선택 로직과 다름을 코드 주석으로 명시)
3. **스태시 생성**: `git stash push --include-untracked -m "gji-take: <branch>"`. 실패 시 즉시 중단(원본 무변화).
4. **worktree 생성**: 기존 `new` 파이프라인. 실패 시 **롤백**: 원본 worktree에서 `git stash pop` 후 에러 보고. pop까지 실패하면 stash ref를 안내: `your changes are safe in stash: stash@{0} — run "git stash pop" to restore`.
5. **적용**: 새 worktree에서 `git stash pop` (`--copy`면 `git stash apply` 후 원본에서도... 가 아니라 — `--copy`는 3단계를 `git stash create`+`git stash store` 없이 `git stash push` 후 **원본에 `git stash apply`, 새 worktree에서 `git stash pop`** 순서 대신, 간단히: `push` → 새 worktree `apply` → 원본 `pop`... 복잡하므로 다음으로 확정한다):
   - **move(기본)**: 원본 `stash push -u` → 새 worktree `stash pop`.
   - **copy(`--copy`)**: 원본 `stash push -u` → 새 worktree `stash apply` → 원본 `stash pop`.
   - pop/apply 실패 시 stash는 절대 drop하지 말고 stash ref 복구 안내 출력, exit 1.
6. **인덱스 보존은 보장하지 않는다** (v1 범위 축소): staged/unstaged 구분은 pop 후 모두 unstaged가 될 수 있음을 문서에 명시 (`--index` 재적용은 후속).
7. **후처리**: syncFiles는 stash pop *이후*에 실행하되 기존 "존재하는 파일은 덮어쓰지 않음" 규칙이 take된 파일을 보호함을 테스트로 보장. install prompt·afterCreate 훅·히스토리·셸 핸드오프는 기존과 동일.
8. 요약 출력: `✓ took 7 changed files (2 untracked) → fix/login`.

#### 엣지 케이스

| 케이스 | 기대 동작 |
|---|---|
| untracked만 있고 tracked 변경 없음 | 정상 동작 (`-u`가 포함하므로) |
| ignored 파일 | 이동하지 않음 (`-a` 미사용). `--dry-run`에 "ignored files are not taken" 각주 |
| 서브모듈 변경 | v1 미지원 — 감지 시 경고 출력하고 서브모듈 외 변경만 운반 |
| 매우 큰 untracked (예: node_modules가 ignore 안 된 레포) | stash가 느릴 수 있음 — 파일 수 5,000개 초과 시 confirm |
| `--json` | 프롬프트 없는 경로에서만 허용 (branch 필수), 출력에 `"taken": { "files": 7, "untracked": 2 }` 추가 |
| 동시성: stash 직후 다른 프로세스가 stash 조작 | stash push의 출력에서 커밋 SHA를 파싱해 `stash apply <sha>`로 ref가 아닌 SHA를 사용 (레이스 제거) |

#### 테스트 계획 (통합 테스트, 실제 git 픽스처)

- staged + unstaged + untracked 혼합 → 새 worktree에 모두 존재, 원본 clean
- `--copy` → 양쪽에 존재
- worktree 생성 실패 주입(경로 선점) → 원본 완전 복구
- pop 실패 주입 → stash 보존 + 복구 안내 메시지
- syncFiles와 take 파일 충돌 → take 파일 승리
- `--dry-run` → 무변화 + 파일 목록 출력
- 바이너리 파일·실행 권한 보존

#### 수용 기준

- [ ] 어떤 실패 경로에서도 사용자 변경이 유실되지 않는다 (stash SHA 안내 포함)
- [ ] move/copy 시맨틱이 문서·`--help`에 명확
- [ ] README 데모 시나리오("실수로 main에서 시작") GIF 추가

---

### SPEC-07 ★ · Instant Worktree — `syncDirs` CoW 부트스트랩

| | |
|---|---|
| 난이도 | 상 (플랫폼별 파일시스템 지식 필요 — 시니어 리뷰 필수) |
| 예상 규모 | 신규 `src/dir-clone.ts` ~250줄 + config + 테스트 |
| 선행 조건 | 없음 |
| 대상 파일 | 신규 `src/dir-clone.ts`, `src/config.ts`(키 추가), `src/new.ts`, `src/install-prompt.ts`(상호작용), 테스트 |

#### 배경 (킬러 피처 K2)

새 worktree의 진짜 비용은 `pnpm install`/`npm ci` 대기다. 메인 worktree의 `node_modules`·빌드 캐시를 파일시스템 copy-on-write clone으로 복제하면 수 GB가 1~2초에 끝나고 디스크는 공유된다.

#### Config 표면

```json
{
  "syncDirs": ["node_modules", ".next"]
}
```

- `syncFiles`와 동일한 3-레이어 머지·`sync-files` 명령 계열과의 일관성 유지 (단, v1은 config 키만, 전용 명령은 후속).
- 값은 레포 루트 기준 상대 경로만 허용. `..`·절대 경로·`.git` 포함 경로는 로드 시 검증 에러.

#### 동작 명세

1. **실행 시점**: worktree 생성 직후, `syncFiles`·install prompt·afterCreate 훅보다 **먼저**. (클론이 성공하면 install prompt는 "이미 node_modules 있음"으로 건너뛸 수 있어야 함 — 아래 4)
2. **클론 전략** (`src/dir-clone.ts`의 `cloneDir(src, dest)`):
   - macOS(darwin): `cp -Rc <src> <dest>` (APFS clonefile).
   - Linux: `cp -a --reflink=always <src> <dest>` (Btrfs/XFS reflink).
   - 실패(비지원 FS 등) 시: **일반 복사로 폴백하지 않는다** (수 분 걸리는 복사는 기대 배반). 대신 스킵 + 1줄 안내: `syncDirs: filesystem doesn't support copy-on-write, skipped node_modules (falling back to install prompt)`.
   - 지원 여부는 매번 실제 시도로 판정하되, 실패 결과를 `~/.config/gji/state.json`에 캐시해 두 번째부터는 시도 없이 스킵 (레포 루트별 캐시).
3. **소스 선택**: 메인 worktree(레포 루트)의 해당 디렉토리. 소스가 없으면 조용히 스킵.
4. **install prompt 상호작용**: 클론 성공한 디렉토리에 `node_modules`가 포함되면 install prompt를 건너뛰고 대신 안내 출력: `⚡ node_modules cloned (1.2s) — run install only if lockfile changed`. (lockfile 비교로 stale 감지는 후속 고도화로 백로그에 기재)
5. **pnpm 주의점 처리**: pnpm의 `node_modules/.pnpm` 내부 심링크는 상대 경로라 클론 후에도 유효하다. 단 `node_modules/.modules.yaml`은 절대 경로를 포함할 수 있으므로, pnpm 감지 시 클론 후 해당 파일을 삭제한다(다음 install 때 pnpm이 재생성). npm/yarn(hoisted)은 추가 처리 없음.
6. **출력**: 사람 모드에서 각 디렉토리별 `⚡ cloned node_modules (2.1 GB → 1.2s)`. `--json`에는 `"cloned": [{ "dir": "node_modules", "ms": 1200 }]`.
7. `--dry-run`: 클론될 디렉토리 목록과 예상 크기만 출력.

#### 엣지 케이스

| 케이스 | 기대 동작 |
|---|---|
| worktreePath가 소스와 다른 파일시스템 | reflink 불가 → 스킵 + 안내 (크로스 디바이스는 CoW 불가) |
| 소스 디렉토리가 심링크 | 심링크가 가리키는 실체 기준, 단 레포 밖을 가리키면 스킵 + 경고 |
| dest에 이미 디렉토리 존재 (`--force` 재생성 경로) | 스킵 (`syncFiles`의 no-overwrite 원칙과 동일) |
| 클론 도중 실패(부분 복사) | 부분 결과 삭제 후 스킵 처리 (반쯤 복사된 node_modules는 최악) |
| Windows | H3 전까지 항상 스킵 + 안내 |

#### 테스트 계획

- `cloneDir`를 주입 가능하게 설계 → 성공/실패/부분 실패 시나리오를 fake로 통합 테스트
- 실제 reflink는 CI에서 조건부 테스트 (Linux CI가 Btrfs가 아니면 skip 마킹 — `it.skipIf`)
- pnpm `.modules.yaml` 삭제 검증
- install prompt 생략 경로 검증
- config 검증(절대 경로·`..` 거부)

#### 수용 기준

- [ ] APFS/Btrfs에서 2GB node_modules 기준 TTC가 "install 수 분" → "5초 이내"로 단축 (README에 벤치 수치 기재)
- [ ] 비지원 환경에서 조용하고 정확한 폴백 (절대 느린 전체 복사를 하지 않음)
- [ ] 어떤 경우에도 부분 복사 상태를 남기지 않음

---

### SPEC-08 · 문서 갭 해소 — `warp`/`back`/`history` 공식화

| | |
|---|---|
| 난이도 | 하 (첫 기여로 최적) |
| 예상 규모 | 문서 전용 PR |
| 대상 파일 | `README.md`, `website/docs/commands.mdx`, `website/docs/daily-workflow.mdx`, `man`(재생성) |

#### 작업 내용

1. README 명령 테이블에 다음 3줄 추가 (기존 서식 유지):
   - `gji warp [branch] [-n|--new] [--print] [--json]` — 등록된 모든 레포를 가로질러 worktree로 점프
   - `gji back [n] [--print]` — 직전(또는 n단계 전) 방문 worktree로 복귀
   - `gji history [--json]` — 이동 히스토리 출력
2. "Daily workflow" 코드 블록에 `gji warp`(멀티 레포 시나리오)와 `gji back`(리뷰 갔다가 복귀) 예시 추가.
3. `website/docs/commands.mdx`·`daily-workflow.mdx`에 동일 내용 반영. 레포 레지스트리(자동 등록) 개념을 FAQ에 1문단 추가: "warp가 레포를 어떻게 아나요?"
4. `pnpm generate-man`으로 man 페이지 재생성 확인.
5. 명령 테이블과 `registerCommands`의 옵션 표기가 1:1인지 전수 대조 (이 과정에서 발견된 불일치는 문서를 코드에 맞춘다).

#### 수용 기준

- [ ] `src/cli.ts`에 등록된 모든 명령·옵션이 README 테이블과 website에 존재
- [ ] man 페이지에 3개 명령 포함

---

### SPEC-09 · Worktree 슬롯 — 포트 충돌 없는 병렬 dev server

| | |
|---|---|
| 난이도 | 하~중 |
| 예상 규모 | 신규 `src/slots.ts` ~120줄 + hooks 연동 + 테스트 |
| 선행 조건 | 없음 |
| 대상 파일 | 신규 `src/slots.ts`, `src/hooks.ts`, `src/new.ts`, `src/remove.ts`, 문서 |

#### 배경

worktree 3개에서 `pnpm dev`를 동시에 켜면 포트가 충돌한다. gji가 포트를 직접 관리하는 것은 과잉이므로, **worktree마다 안정적인 정수 슬롯 번호**만 부여하고 활용은 훅과 프로젝트에 맡긴다.

#### 동작 명세

1. `~/.config/gji/slots.json`에 레포별 `{ "<worktreePath>": <slot> }` 저장. (`GJI_CONFIG_DIR` 존중)
2. **부여**: worktree 생성 시(`new`/`pr`/`go` 생성 경로) 해당 레포에서 *사용 중이지 않은 가장 작은 0 이상 정수*를 할당. 메인 worktree는 항상 슬롯 0으로 예약.
3. **회수**: `remove`/`clean`/`done`이 worktree를 지울 때 해당 엔트리 삭제. `doctor`(SPEC-01)에 고아 슬롯 검사 1줄 추가.
4. **노출**:
   - 모든 훅에 env `GJI_SLOT`과 템플릿 변수 `{{slot}}` 추가 (`hooks.ts`의 기존 변수 주입부 확장).
   - `gji ls --json`·`status --json`에 `slot` 필드 추가.
5. 슬롯 파일이 깨졌거나 없으면 전체 재부여하지 말고 빈 상태에서 재시작 (히스토리와 동일한 관대함).

#### 활용 예 (문서에 수록)

```json
{
  "hooks": {
    "afterEnter": "export PORT=$((3000 + GJI_SLOT)) && echo \"dev server port: $PORT\""
  }
}
```

Next.js/Vite 등에서 `PORT`/`--port $((3000 + GJI_SLOT))` 패턴을 daily-workflow 문서에 레시피로 추가.

#### 엣지 케이스

| 케이스 | 기대 동작 |
|---|---|
| gji 밖에서 만든 worktree (raw `git worktree add`) | 슬롯 없음 → 훅에서 `GJI_SLOT` 미설정. `ls`에서 slot: null |
| 슬롯 파일 동시 쓰기 | 마지막 쓰기 승리 허용 (파일 잠금 도입하지 않음 — 충돌 시 최악이 포트 겹침이고, 이는 현 상태와 동일) |
| 같은 경로 재생성 (`--force`) | 기존 슬롯 유지 |

#### 테스트 계획

- 생성 3회 → 슬롯 1,2,3 / 2번 제거 후 재생성 → 2 재사용
- 훅에서 `GJI_SLOT`·`{{slot}}` 치환 검증
- 깨진 slots.json → 경고 없이 재시작

#### 수용 기준

- [ ] worktree 2개에서 dev server 동시 실행 레시피가 문서에 존재하고 동작
- [ ] 슬롯 번호가 worktree 수명 동안 불변

---

### SPEC-10 · `gji mcp` — 에이전트용 MCP 서버 (H3, 개요 스펙)

| | |
|---|---|
| 난이도 | 상 |
| 예상 규모 | 신규 패키지 수준. 착수 전 이 개요를 상세 RFC로 승격할 것 |
| 대상 파일 | 신규 `src/mcp/` 디렉토리 |

#### 방향

- `gji mcp` 명령이 stdio 기반 MCP 서버를 실행. 의존성은 공식 `@modelcontextprotocol/sdk` 하나만 추가.
- 노출 도구(각각 기존 `--json` 코드 경로를 그대로 재사용 — 새 비즈니스 로직 금지):
  - `gji_list` (ls --json), `gji_status`, `gji_new` (branch, take?, base?), `gji_pr`, `gji_remove` (force 필수), `gji_clean_stale`, `gji_run_hook`
- 파괴적 도구(`remove`, `clean`)는 description에 명시 + dry-run 파라미터 기본 true.
- 배포: README에 Claude Code/Cursor 등록 스니펫, `llms.txt`를 website에 발행.
- 성공 판정: 에이전트가 "이 PR 검토해줘"를 받았을 때 사람이 개입 없이 `gji_pr` → 작업 → `gji_remove`까지 완주하는 데모.

---

## 6. 지표와 검증

- **벤치 스크립트**: `scripts/bench-ttc.mjs` — `gji new` 실행부터 `node_modules` 사용 가능까지 측정. SPEC-07 전/후 수치를 README·릴리스 노트에 공개 (킬러 피처는 숫자로 판다).
- **doctor 채택률 프록시**: 이슈 템플릿에 `gji doctor` 출력 첨부 요청 → 지원 왕복 횟수 감소 확인.
- **문서-코드 일치**: SPEC-08 이후, CLI 등록 명령과 README 테이블을 대조하는 테스트(`cli.test.ts` 확장)를 추가해 갭 재발을 CI에서 차단.

## 7. 리스크

| 리스크 | 완화 |
|---|---|
| `--take`에서 사용자 변경 유실 (신뢰 치명타) | stash SHA 기반 운반, 모든 실패 경로에 복구 안내, 시니어 리뷰 필수, 릴리스 전 dogfooding 기간 |
| CoW 미지원 환경에서의 기대 배반 | 느린 폴백 금지·명시적 스킵 메시지·지원 FS 문서화 |
| 명령 수 증가로 표면 비대화 | 신규 명령은 H1에서 `doctor`/`done` 2개만. 나머지는 기존 명령의 플래그/무인자 확장으로 흡수 |
| forge 의존(gh) 취약성 | gh 부재 시 완전한 기존 UX 유지, gji는 인증을 절대 직접 다루지 않음 |
| Windows 요구 증가 | H3 전까지 README에 지원 셸 명시, PowerShell은 H3 최우선 |

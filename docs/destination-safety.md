# Destination safety

`syncDirs` and `syncFiles` reject pre-existing symlink components, unsafe ancestors, and ordinary concurrent `gji` operations. They use destination checks, operation locks, and temporary output to avoid publishing incomplete results during normal worktree creation.

## Scope

The remaining check-to-use race requires a hostile same-user process to replace a path component while `gji` is operating. In a normal single-user workflow, this is primarily a reliability and data-integrity concern, not a privilege-escalation vulnerability.

It can become a security issue when `gji` runs with elevated or separate service-account privileges, or when its output is consumed by privileged automation. Fully eliminating that case requires platform-specific descriptor-relative APIs such as `openat`/`O_NOFOLLOW` or an equivalent native no-replace operation.

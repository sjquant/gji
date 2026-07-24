# Destination safety

`syncDirs` and `syncFiles` protect worktree destinations against pre-existing symlink components, unsafe ancestors, and ordinary concurrent `gji` operations. Clone and sync operations also use temporary output, destination checks, and operation locks to avoid publishing incomplete results through normal `gji` workflows.

The CLI does not claim to defend against a hostile same-user process that replaces a checked path component between validation and the subsequent filesystem operation. Fully closing that TOCTOU window requires platform-specific descriptor-relative filesystem APIs, such as `openat`/`O_NOFOLLOW` or an equivalent native no-replace operation.

This limitation is relevant when an untrusted local process can modify the worktree or its parent directories concurrently. It is not expected in the normal single-user developer workflow supported by `gji`.

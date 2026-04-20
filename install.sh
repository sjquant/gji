#!/bin/sh

set -eu

PACKAGE_NAME="@solaqua/gji"
INSTALL_ROOT_DEFAULT="${HOME}/.local/share/gji"
BIN_DIR_DEFAULT="${HOME}/.local/bin"
INSTALL_MARKER_START="# >>> gji install >>>"
INSTALL_MARKER_END="# <<< gji install <<<"

main() {
  os="$(detect_os)"
  arch="$(detect_arch)"
  install_root="${GJI_INSTALL_ROOT:-$INSTALL_ROOT_DEFAULT}"
  bin_dir="${GJI_BIN_DIR:-$BIN_DIR_DEFAULT}"
  version_spec="$(resolve_version_spec)"

  log "Detected platform: ${os}/${arch}"
  check_dependencies "$os"
  install_package "$install_root" "$version_spec"
  install_symlink "$install_root" "$bin_dir"
  setup_shell_integration "$bin_dir"
  print_success "$bin_dir" "$os" "$arch"
}

detect_os() {
  os_name="${GJI_TEST_UNAME_S:-$(uname -s)}"

  case "$os_name" in
    Darwin)
      printf 'darwin\n'
      ;;
    Linux)
      printf 'linux\n'
      ;;
    *)
      fail "Unsupported operating system: ${os_name}. Supported platforms: macOS and Linux."
      ;;
  esac
}

detect_arch() {
  arch_name="${GJI_TEST_UNAME_M:-$(uname -m)}"

  case "$arch_name" in
    x86_64|amd64)
      printf 'x64\n'
      ;;
    arm64|aarch64)
      printf 'arm64\n'
      ;;
    *)
      fail "Unsupported architecture: ${arch_name}. Supported architectures: x64 and arm64."
      ;;
  esac
}

resolve_version_spec() {
  if [ -n "${GJI_VERSION:-}" ]; then
    printf '@%s\n' "$GJI_VERSION"
    return
  fi

  printf '\n'
}

check_dependencies() {
  os="$1"

  if ! command -v node >/dev/null 2>&1; then
    fail "$(missing_dependency_message "$os" "node")"
  fi

  if ! command -v npm >/dev/null 2>&1; then
    fail "$(missing_dependency_message "$os" "npm")"
  fi
}

missing_dependency_message() {
  os="$1"
  dependency="$2"

  case "$os" in
    darwin)
      printf 'Missing required dependency: %s. Install Node.js and npm first, for example with Homebrew: brew install node\n' "$dependency"
      ;;
    linux)
      printf 'Missing required dependency: %s. Install Node.js and npm first using your distro package manager or https://nodejs.org/\n' "$dependency"
      ;;
  esac
}

install_package() {
  install_root="$1"
  version_spec="$2"

  mkdir -p "$install_root"
  log "Installing ${PACKAGE_NAME}${version_spec} into ${install_root}"
  npm install --global --prefix "$install_root" "${PACKAGE_NAME}${version_spec}"
}

install_symlink() {
  install_root="$1"
  bin_dir="$2"
  source_bin="${install_root}/bin/gji"
  target_bin="${bin_dir}/gji"

  if [ ! -x "$source_bin" ]; then
    fail "Install completed but ${source_bin} was not created."
  fi

  mkdir -p "$bin_dir"
  ln -sf "$source_bin" "$target_bin"
}

setup_shell_integration() {
  bin_dir="$1"

  if [ "${GJI_NO_SHELL_SETUP:-0}" = "1" ]; then
    log "Skipping shell setup because GJI_NO_SHELL_SETUP=1"
    return
  fi

  shell_name="$(detect_shell_name)"

  if [ -z "$shell_name" ]; then
    log "Skipping shell setup because SHELL is not bash, zsh, or fish"
    return
  fi

  rc_path="$(resolve_shell_rc_path "$shell_name")"
  block="$(render_shell_block "$shell_name" "$bin_dir")"

  mkdir -p "$(dirname "$rc_path")"

  if [ -f "$rc_path" ]; then
    current_contents="$(cat "$rc_path")"
  else
    current_contents=""
  fi

  next_contents="$(replace_install_block "$current_contents" "$block")"
  printf '%s' "$next_contents" > "$rc_path"
  log "Updated ${rc_path} for ${shell_name}"
}

detect_shell_name() {
  if [ -z "${SHELL:-}" ]; then
    printf '\n'
    return
  fi

  shell_name="$(basename "$SHELL")"

  case "$shell_name" in
    bash|fish|zsh)
      printf '%s\n' "$shell_name"
      ;;
    *)
      printf '\n'
      ;;
  esac
}

resolve_shell_rc_path() {
  shell_name="$1"

  case "$shell_name" in
    bash)
      printf '%s/.bashrc\n' "$HOME"
      ;;
    fish)
      printf '%s/.config/fish/config.fish\n' "$HOME"
      ;;
    zsh)
      printf '%s/.zshrc\n' "$HOME"
      ;;
  esac
}

render_shell_block() {
  shell_name="$1"
  bin_dir="$2"

  case "$shell_name" in
    fish)
      cat <<EOF
$INSTALL_MARKER_START
if not contains "$bin_dir" \$PATH
  set -gx PATH "$bin_dir" \$PATH
end
eval ("$bin_dir/gji" init fish)
$INSTALL_MARKER_END
EOF
      ;;
    bash|zsh)
      cat <<EOF
$INSTALL_MARKER_START
case ":\$PATH:" in
  *:"$bin_dir":*) ;;
  *) export PATH="$bin_dir:\$PATH" ;;
esac
eval "\$("$bin_dir/gji" init $shell_name)"
$INSTALL_MARKER_END
EOF
      ;;
  esac
}

replace_install_block() {
  current_contents="$1"
  block="$2"
  current_file="$(mktemp)"
  next_file="$(mktemp)"

  trap 'rm -f "$current_file" "$next_file"' EXIT HUP INT TERM

  printf '%s' "$current_contents" > "$current_file"
  printf '%s\n' "$block" > "$next_file"

  if grep -F "$INSTALL_MARKER_START" "$current_file" >/dev/null 2>&1; then
    awk -v start="$INSTALL_MARKER_START" -v end="$INSTALL_MARKER_END" '
      BEGIN { inside = 0 }
      index($0, start) { inside = 1; next }
      index($0, end) {
        inside = 0
        next
      }
      inside == 0 { print }
    ' "$current_file" > "${current_file}.clean"
    mv "${current_file}.clean" "$current_file"
  fi

  if [ -s "$current_file" ]; then
    awk 'BEGIN { last = "" } { lines[NR] = $0; last = $0 } END {
      for (i = 1; i <= NR; i += 1) {
        print lines[i]
      }
      if (NR > 0 && last != "") {
        print ""
      }
    }' "$current_file" > "${current_file}.trimmed"
    mv "${current_file}.trimmed" "$current_file"
  fi

  cat "$current_file"
  cat "$next_file"
  printf '\n'

  rm -f "$current_file" "$next_file"
  trap - EXIT HUP INT TERM
}

print_success() {
  bin_dir="$1"
  os="$2"
  arch="$3"

  log "Installed gji for ${os}/${arch}"
  log "Binary: ${bin_dir}/gji"
  log "Open a new shell or run the appropriate source command to load PATH and shell integration."
}

log() {
  printf 'gji install: %s\n' "$1"
}

fail() {
  printf 'gji install: %s\n' "$1" >&2
  exit 1
}

main "$@"

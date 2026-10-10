#!/usr/bin/env bash
#
# Moody Blues installer for Debian and Ubuntu servers.
#
#   curl -fsSL https://raw.githubusercontent.com/MrAguinaga/moody-blues/main/install.sh | bash
#
# It installs what is missing (Docker Engine with Compose, fuse3, git, curl, Node.js and pnpm),
# fetches the latest release of the code into a directory of its own (never MB_HOME), builds it
# and links the `moody-blues` command. It is safe to run again, never asks for secrets and never
# runs `moody-blues setup`.
#
# Environment:
#   MOODY_BLUES_REF           Tag, branch or commit to check out (default: latest v* release, or main)
#   MOODY_BLUES_REPO          Git URL to clone from (default: the public GitHub repository)
#   MOODY_BLUES_DIR           Code directory (default: /usr/local/lib/moody-blues)
#   MOODY_BLUES_BIN           Path of the command link (default: /usr/local/bin/moody-blues)
#   MOODY_BLUES_SKIP_DOCKER   Set to 1 to leave Docker alone
#   MB_HOME                   Data directory created for the installing user (default: /opt/moody-blues)

set -euo pipefail

REPO_URL="${MOODY_BLUES_REPO:-https://github.com/MrAguinaga/moody-blues.git}"
CODE_DIR="${MOODY_BLUES_DIR:-/usr/local/lib/moody-blues}"
BIN_LINK="${MOODY_BLUES_BIN:-/usr/local/bin/moody-blues}"
REQUESTED_REF="${MOODY_BLUES_REF:-}"
SKIP_DOCKER="${MOODY_BLUES_SKIP_DOCKER:-0}"
DATA_HOME="${MB_HOME:-/opt/moody-blues}"

NODE_MAJOR=24
NODE_MIN_MAJOR=20
NODE_MIN_MINOR=10
NODE_PREFIX=/usr/local
APT_PACKAGES=(ca-certificates curl git xz-utils fuse3)
RELEASE_TAG_PATTERN='^v[0-9]+\.[0-9]+\.[0-9]+$'

TARGET_USER=""
TARGET_GROUP=""
TARGET_HOME=""
DOCKER_GROUP_CHANGED=0

if [ -t 1 ]; then
  BOLD=$'\033[1m'
  RED=$'\033[31m'
  GREEN=$'\033[32m'
  YELLOW=$'\033[33m'
  RESET=$'\033[0m'
else
  BOLD=""
  RED=""
  GREEN=""
  YELLOW=""
  RESET=""
fi

step() { printf '%s==>%s %s\n' "$BOLD" "$RESET" "$*"; }
ok() { printf '    %s✔%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '    %s!%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
die() {
  printf '%s✖ %s%s\n' "$RED" "$*" "$RESET" >&2
  exit 1
}

as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

as_user() {
  if [ "$(id -u)" -eq 0 ] && [ "$TARGET_USER" != "root" ]; then
    runuser -u "$TARGET_USER" -- env HOME="$TARGET_HOME" PATH="$PATH" \
      COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true HUSKY=0 "$@"
  else
    env COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true HUSKY=0 "$@"
  fi
}

have() { command -v "$1" >/dev/null 2>&1; }

resolve_target_user() {
  TARGET_USER="${SUDO_USER:-$(id -un)}"
  TARGET_GROUP="$(id -gn "$TARGET_USER")"
  TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
  [ -n "$TARGET_HOME" ] || die "Could not find the home directory of $TARGET_USER."
}

check_host() {
  step "Checking the host"
  [ "$(uname -s)" = "Linux" ] || die "This installer supports Linux servers only."
  have apt-get || die "This installer supports Debian and Ubuntu (apt-get was not found)."
  if [ "$(id -u)" -ne 0 ]; then
    have sudo || die "Run this as root or install sudo."
    sudo -n true 2>/dev/null || sudo -v || die "sudo is required to install system packages."
  fi
  resolve_target_user
  ok "installing for the user $TARGET_USER"
}

package_installed() {
  dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q '^install ok installed$'
}

install_system_packages() {
  step "Installing system packages"
  local missing=()
  local package
  for package in "${APT_PACKAGES[@]}"; do
    package_installed "$package" || missing+=("$package")
  done

  if [ "${#missing[@]}" -eq 0 ]; then
    ok "already installed: ${APT_PACKAGES[*]}"
    return
  fi
  as_root env DEBIAN_FRONTEND=noninteractive apt-get update -qq </dev/null
  as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${missing[@]}" </dev/null
  ok "installed: ${missing[*]}"
}

node_is_usable() {
  have node || return 1
  local version major minor
  version="$(node -p 'process.versions.node')"
  major="${version%%.*}"
  minor="${version#*.}"
  minor="${minor%%.*}"
  [ "$major" -gt "$NODE_MIN_MAJOR" ] || { [ "$major" -eq "$NODE_MIN_MAJOR" ] && [ "$minor" -ge "$NODE_MIN_MINOR" ]; }
}

node_architecture() {
  case "$(uname -m)" in
    x86_64 | amd64) echo "x64" ;;
    aarch64 | arm64) echo "arm64" ;;
    *) die "Unsupported CPU architecture: $(uname -m)." ;;
  esac
}

install_node() {
  step "Installing Node.js"
  if node_is_usable; then
    ok "Node.js $(node -v) is already installed"
    return
  fi

  local architecture base workdir archive
  architecture="$(node_architecture)"
  base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  workdir="$(mktemp -d)"

  curl -fsSL "$base/SHASUMS256.txt" -o "$workdir/SHASUMS256.txt"
  archive="$(awk -v suffix="-linux-${architecture}.tar.xz" \
    '$2 ~ /^node-v[0-9.]+-linux-/ && index($2, suffix) { print $2; exit }' "$workdir/SHASUMS256.txt")"
  [ -n "$archive" ] || die "No Node.js ${NODE_MAJOR}.x build found for linux-${architecture}."

  curl -fsSL "$base/$archive" -o "$workdir/$archive"
  (cd "$workdir" && grep " ${archive}\$" SHASUMS256.txt | sha256sum -c --status -) \
    || die "The checksum of $archive does not match."

  as_root tar -xJf "$workdir/$archive" -C "$NODE_PREFIX" --strip-components=1 --no-same-owner \
    --exclude='*/CHANGELOG.md' --exclude='*/LICENSE' --exclude='*/README.md'
  rm -rf "$workdir"
  hash -r
  node_is_usable || die "Node.js was installed but is not usable."
  ok "installed Node.js $(node -v)"
}

install_pnpm() {
  step "Enabling pnpm"
  if have pnpm; then
    ok "pnpm is already available"
    return
  fi
  if ! have corepack; then
    as_root npm install -g corepack </dev/null
  fi
  as_root corepack enable </dev/null
  hash -r
  have pnpm || die "pnpm could not be enabled through corepack."
  ok "pnpm enabled through corepack"
}

docker_with_compose() {
  have docker && docker compose version >/dev/null 2>&1
}

install_docker_from_distribution() {
  as_root env DEBIAN_FRONTEND=noninteractive apt-get update -qq </dev/null
  as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io docker-compose-v2 </dev/null
}

install_docker() {
  step "Installing Docker Engine"
  if [ "$SKIP_DOCKER" = "1" ]; then
    warn "skipped (MOODY_BLUES_SKIP_DOCKER=1)"
    return
  fi
  if docker_with_compose; then
    ok "Docker $(docker --version | cut -d' ' -f3 | tr -d ',') with Compose is already installed"
  else
    local script
    script="$(mktemp)"
    curl -fsSL https://get.docker.com -o "$script"
    if ! as_root sh "$script" </dev/null; then
      warn "the official script failed; falling back to the distribution packages"
      install_docker_from_distribution
    fi
    rm -f "$script"
    if ! docker_with_compose; then
      die "Docker Engine with the Compose plugin could not be installed."
    fi
    ok "installed Docker with Compose"
  fi

  if [ -d /run/systemd/system ] && have systemctl; then
    as_root systemctl enable --now docker </dev/null >/dev/null 2>&1 || warn "could not start the docker service"
  fi

  if [ "$TARGET_USER" != "root" ] && ! id -nG "$TARGET_USER" | tr ' ' '\n' | grep -qx docker; then
    as_root usermod -aG docker "$TARGET_USER"
    DOCKER_GROUP_CHANGED=1
    ok "added $TARGET_USER to the docker group"
  fi
}

prepare_directory() {
  local directory="$1"
  if [ ! -d "$directory" ]; then
    as_root install -d -o "$TARGET_USER" -g "$TARGET_GROUP" "$directory"
  elif [ "$(stat -c %U "$directory")" != "$TARGET_USER" ]; then
    as_root chown -R "$TARGET_USER:$TARGET_GROUP" "$directory"
  fi
}

git_in_code_dir() {
  as_user git -C "$CODE_DIR" "$@"
}

in_code_dir() {
  (cd "$CODE_DIR" && as_user "$@")
}

latest_release_tag() {
  git_in_code_dir tag --list 'v[0-9]*' | grep -E "$RELEASE_TAG_PATTERN" | sort -V | tail -n 1 || true
}

checkout_requested_ref() {
  local candidate
  for candidate in "refs/tags/$REQUESTED_REF" "refs/remotes/origin/$REQUESTED_REF" "$REQUESTED_REF"; do
    if git_in_code_dir rev-parse --verify --quiet "${candidate}^{commit}" >/dev/null; then
      git_in_code_dir checkout --quiet --detach "$candidate"
      ok "checked out $REQUESTED_REF"
      return
    fi
  done
  die "The ref $REQUESTED_REF does not exist in $REPO_URL."
}

fetch_code() {
  step "Fetching the code into $CODE_DIR"
  prepare_directory "$CODE_DIR"

  if [ -d "$CODE_DIR/.git" ]; then
    if [ -n "$(git_in_code_dir status --porcelain --untracked-files=no)" ]; then
      die "$CODE_DIR has local changes. Commit or discard them, then run the installer again."
    fi
    git_in_code_dir fetch --quiet --tags --force origin </dev/null
    ok "updated the existing checkout"
  elif [ -z "$(ls -A "$CODE_DIR")" ]; then
    as_user git clone --quiet "$REPO_URL" "$CODE_DIR" </dev/null
    ok "cloned $REPO_URL"
  else
    die "$CODE_DIR exists and is not a Moody Blues checkout. Move it away or set MOODY_BLUES_DIR."
  fi

  if [ -n "$REQUESTED_REF" ]; then
    checkout_requested_ref
    return
  fi

  local tag
  tag="$(latest_release_tag)"
  if [ -n "$tag" ]; then
    git_in_code_dir checkout --quiet --detach "refs/tags/$tag"
    ok "checked out the latest release, $tag"
  else
    git_in_code_dir checkout --quiet -B main origin/main
    ok "no release has been published yet; following main"
  fi
}

build_code() {
  step "Installing dependencies and building"
  in_code_dir pnpm install --frozen-lockfile </dev/null
  in_code_dir pnpm build </dev/null
  ok "built the packages and the CLI"
}

link_command() {
  step "Linking the moody-blues command"
  local entrypoint="$CODE_DIR/apps/cli/dist/main.js"
  [ -f "$entrypoint" ] || die "The build did not produce $entrypoint."
  as_root chmod +x "$entrypoint"
  as_root ln -sfn "$entrypoint" "$BIN_LINK"
  hash -r
  ok "$BIN_LINK -> $entrypoint"
}

prepare_data_home() {
  step "Preparing the data directory"
  if [ -e "$DATA_HOME" ]; then
    ok "$DATA_HOME already exists; left untouched"
    return
  fi
  as_root install -d -o "$TARGET_USER" -g "$TARGET_GROUP" "$DATA_HOME"
  ok "created $DATA_HOME for $TARGET_USER"
}

print_next_steps() {
  local version
  version="$("$BIN_LINK" --version)"

  printf '\n%s✔ Moody Blues %s is installed.%s\n\n' "$GREEN" "$version" "$RESET"
  printf 'Next steps:\n'
  if [ "$DOCKER_GROUP_CHANGED" -eq 1 ]; then
    printf '  1. Log out and back in, so %s can use Docker without sudo.\n' "$TARGET_USER"
    printf '  2. Create a private secrets file (see the README for its keys):\n'
  else
    printf '  1. Create a private secrets file (see the README for its keys):\n'
  fi
  printf '       install -m 600 /dev/null ~/secrets.env\n'
  printf '       # RD_API_TOKEN, ADMIN_USERNAME, ADMIN_PASSWORD, MB_MODE, MB_DOMAIN, MB_ACME_EMAIL\n'
  printf '  %s. Provision the server:\n' "$([ "$DOCKER_GROUP_CHANGED" -eq 1 ] && echo 3 || echo 2)"
  printf '       moody-blues setup --env-file ~/secrets.env\n'
  printf '\nUpdate later with: moody-blues update\n'
}

main() {
  check_host
  install_system_packages
  install_node
  install_pnpm
  install_docker
  fetch_code
  build_code
  link_command
  prepare_data_home
  print_next_steps
}

main "$@"

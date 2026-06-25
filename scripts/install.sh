#!/usr/bin/env bash
#
# install.sh — Bootstrap 1 LỆNH cho ZCRM Community.
#
# Tự động: kiểm tra môi trường (Docker, Docker Compose, git, openssl, curl) → cài phần
# còn thiếu → TẢI mã nguồn (clone) nếu CÀI MỚI / git pull nếu ĐÃ CÓ → chạy deploy
# (zalocrm-deploy.sh tự phát hiện cài mới vs nâng cấp, backup DB, migrate, health).
#
# Chạy 1 lệnh (cài mới hoặc cập nhật đều được):
#   curl -fsSL https://raw.githubusercontent.com/locphamnguyen/ZaloCRM/main/scripts/install.sh | bash
# Hoặc tải về rồi chạy:
#   bash install.sh
#
# Tuỳ biến qua biến môi trường:
#   ZCRM_DIR=/srv/zcrm   curl ... | bash      # thư mục cài (mặc định: $HOME/zcrm)
#   ZCRM_BRANCH=main     curl ... | bash      # nhánh git (mặc định: main)
#
set -euo pipefail

REPO_URL="${ZCRM_REPO:-https://github.com/locphamnguyen/ZaloCRM.git}"
APP_DIR="${ZCRM_DIR:-$HOME/zcrm}"
BRANCH="${ZCRM_BRANCH:-main}"

c_blue=$'\033[1;36m'; c_grn=$'\033[1;32m'; c_yel=$'\033[1;33m'; c_red=$'\033[1;31m'; c_off=$'\033[0m'
log()  { echo "${c_blue}▶${c_off} $*"; }
ok()   { echo "${c_grn}✓${c_off} $*"; }
warn() { echo "${c_yel}⚠${c_off}  $*"; }
die()  { echo "${c_red}✗ $*${c_off}" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# sudo nếu không phải root (và có sudo).
SUDO=""
if [ "$(id -u)" -ne 0 ]; then have sudo && SUDO="sudo"; fi

OS="$(uname -s)"

# ── Trình quản lý gói (Linux) → cài các gói cơ bản (git/openssl/curl/ca-certificates) ──
pkg_install() {  # $@ = tên gói
  if   have apt-get; then $SUDO apt-get update -y -qq && $SUDO apt-get install -y -qq "$@"
  elif have dnf;     then $SUDO dnf install -y -q "$@"
  elif have yum;     then $SUDO yum install -y -q "$@"
  elif have apk;     then $SUDO apk add --no-cache "$@"
  elif have pacman;  then $SUDO pacman -Sy --noconfirm "$@"
  elif have brew;    then brew install "$@"
  else return 1; fi
}

ensure_basics() {
  local missing=()
  for c in git curl openssl; do have "$c" || missing+=("$c"); done
  [ ${#missing[@]} -eq 0 ] && { ok "Sẵn có: git, curl, openssl."; return 0; }
  log "Thiếu: ${missing[*]} → đang cài…"
  pkg_install "${missing[@]}" ca-certificates 2>/dev/null || pkg_install "${missing[@]}" \
    || die "Không tự cài được ${missing[*]}. Cài thủ công rồi chạy lại."
  for c in "${missing[@]}"; do have "$c" || die "Vẫn thiếu '$c' sau khi cài."; done
  ok "Đã cài: ${missing[*]}."
}

# ── Docker ─────────────────────────────────────────────────────────────────────
ensure_docker() {
  if have docker; then ok "Docker đã có ($(docker --version 2>/dev/null | cut -d, -f1))."; return 0; fi
  if [ "$OS" = "Darwin" ]; then
    die "macOS: hãy cài Docker Desktop trước — https://www.docker.com/products/docker-desktop/ rồi chạy lại."
  fi
  warn "Chưa có Docker — cài tự động qua script chính thức get.docker.com (cần quyền sudo)…"
  curl -fsSL https://get.docker.com | $SUDO sh || die "Cài Docker thất bại — xem https://docs.docker.com/engine/install/"
  # Bật + tự khởi động dịch vụ (nếu có systemd).
  have systemctl && { $SUDO systemctl enable --now docker 2>/dev/null || true; }
  # Thêm user hiện tại vào nhóm docker (đỡ phải sudo lần sau — cần đăng nhập lại).
  if [ -n "${SUDO}" ] && [ "${USER:-}" != "root" ]; then
    $SUDO usermod -aG docker "$USER" 2>/dev/null && \
      warn "Đã thêm '$USER' vào nhóm docker — ĐĂNG XUẤT/ĐĂNG NHẬP lại để chạy docker không cần sudo."
  fi
  have docker || die "Docker vẫn chưa sẵn sàng sau khi cài."
  ok "Đã cài Docker."
}

ensure_compose() {
  docker compose version >/dev/null 2>&1 && { ok "Docker Compose v2 đã có."; return 0; }
  warn "Thiếu Docker Compose v2 (plugin) — thử cài…"
  pkg_install docker-compose-plugin 2>/dev/null || true
  docker compose version >/dev/null 2>&1 || \
    die "Cần Docker Compose v2 ('docker compose'). Cài: https://docs.docker.com/compose/install/"
  ok "Docker Compose v2 đã sẵn sàng."
}

# Một số distro cần khởi động daemon thủ công (không systemd).
docker_ready() { docker info >/dev/null 2>&1; }
wait_docker() {
  docker_ready && return 0
  have systemctl && { $SUDO systemctl start docker 2>/dev/null || true; }
  for _ in $(seq 1 15); do docker_ready && return 0; sleep 1; done
  die "Docker daemon chưa chạy. Khởi động Docker (hoặc Docker Desktop) rồi chạy lại."
}

# ── Tải mã nguồn: clone (mới) hoặc pull (đã có) ─────────────────────────────────
fetch_source() {
  if [ -d "$APP_DIR/.git" ]; then
    log "Đã có mã nguồn ở '$APP_DIR' → CẬP NHẬT (git pull)…"
    git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH" -q
    git -C "$APP_DIR" reset --hard "origin/$BRANCH" -q
    ok "Đã cập nhật mã nguồn nhánh $BRANCH."
  else
    [ -e "$APP_DIR" ] && [ ! -d "$APP_DIR/.git" ] && die "'$APP_DIR' đã tồn tại nhưng không phải repo git. Chọn ZCRM_DIR khác."
    log "TẢI mã nguồn về '$APP_DIR' (clone nhánh $BRANCH)…"
    git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$APP_DIR" -q
    ok "Đã tải mã nguồn."
  fi
}

# ── Luồng chính ─────────────────────────────────────────────────────────────────
echo "═══════════════════════════════════════════════"
echo "  ZCRM — Cài đặt / Cập nhật TỰ ĐỘNG (1 lệnh)"
echo "═══════════════════════════════════════════════"
log "Thư mục cài: $APP_DIR   |   Nhánh: $BRANCH"

ensure_basics
ensure_docker
ensure_compose
wait_docker
fetch_source

cd "$APP_DIR"
[ -x scripts/zalocrm-deploy.sh ] || chmod +x scripts/zalocrm-deploy.sh 2>/dev/null || true
log "Chạy deploy (tự phát hiện cài mới / nâng cấp)…"
# Dùng sudo cho docker nếu user chưa thuộc nhóm docker trong phiên hiện tại.
if docker info >/dev/null 2>&1; then
  bash scripts/zalocrm-deploy.sh "${1:-auto}"
else
  warn "Phiên hiện tại chưa có quyền docker → chạy deploy bằng sudo."
  $SUDO bash scripts/zalocrm-deploy.sh "${1:-auto}"
fi

echo ""
ok "HOÀN TẤT. Mã nguồn tại: $APP_DIR"
echo "→ Hướng dẫn sử dụng: https://docs.locnguyendata.com/"

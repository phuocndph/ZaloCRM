#!/usr/bin/env bash
#
# zalocrm-deploy.sh — Cài đặt / Nâng cấp ZCRM Community TỰ ĐỘNG.
#
# Một lệnh lo trọn: tự phát hiện CÀI MỚI hay NÂNG CẤP, backup DB trước khi nâng cấp,
# sinh .env (secret ngẫu nhiên) nếu chưa có, build + chạy Docker, migrate DB, rồi
# kiểm tra sức khoẻ. KHÔNG bao giờ xoá dữ liệu (không dùng `down -v`).
#
# Dùng:
#   ./scripts/zalocrm-deploy.sh            # tự phát hiện (auto)
#   ./scripts/zalocrm-deploy.sh install    # ép cài mới
#   ./scripts/zalocrm-deploy.sh upgrade    # ép nâng cấp (vd 3.3 → 3.4)
#   ./scripts/zalocrm-deploy.sh backup     # chỉ backup database rồi thoát
#
# Yêu cầu: Docker + Docker Compose v2, openssl. Chạy ở thư mục gốc mã nguồn.
set -euo pipefail
cd "$(dirname "$0")/.."

APP="zalo-crm-app"; DB="zalo-crm-db"
CORE_SERVICES=(app db redis minio minio-init)   # clamav/backup là tuỳ chọn → không bật
PORT_DEFAULT="3080"

c_blue=$'\033[1;36m'; c_grn=$'\033[1;32m'; c_yel=$'\033[1;33m'; c_red=$'\033[1;31m'; c_off=$'\033[0m'
log()  { echo "${c_blue}▶${c_off} $*"; }
ok()   { echo "${c_grn}✓${c_off} $*"; }
warn() { echo "${c_yel}⚠${c_off}  $*"; }
die()  { echo "${c_red}✗ $*${c_off}" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "Thiếu '$1' — cài đặt trước khi chạy."; }

# set_env KEY VALUE — thay (hoặc thêm) dòng KEY=... trong .env. Truyền qua ENV để
# không vướng ký tự đặc biệt (/, :, #...) trong value.
set_env() {
  K="$1" V="$2" perl -i -pe 's/^\Q$ENV{K}\E=.*/"$ENV{K}=$ENV{V}"/e' .env
  grep -qE "^$1=" .env || printf '%s=%s\n' "$1" "$2" >> .env
}
env_val() {  # đọc giá trị KEY từ .env; rỗng nếu chưa có .env / không khớp (an toàn set -e)
  [ -f .env ] || return 0
  grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- || true
}
gen() { openssl rand -hex "${1:-32}"; }

# Keep the volume that is already mounted on the running deployment. Zalo
# sessions are stored in PostgreSQL session_data.
volume_name() {
  local service="$1" destination="$2"
  docker inspect "$service" --format "{{range .Mounts}}{{if eq .Destination \"$destination\"}}{{.Name}}{{end}}{{end}}" 2>/dev/null || true
}

bind_existing_volumes() {
  docker inspect "$DB" >/dev/null 2>&1 || return 0
  local pair key service destination actual configured
  for pair in \
    "ZALOCRM_PG_VOLUME:$DB:/var/lib/postgresql/data" \
    "ZALOCRM_REDIS_VOLUME:zalo-crm-redis:/data" \
    "ZALOCRM_MINIO_VOLUME:zalo-crm-minio:/data" \
    "ZALOCRM_FILE_VOLUME:zalo-crm-app:/var/lib/zalo-crm/files" \
    "ZALOCRM_CLAMAV_VOLUME:zalo-crm-clamav:/var/lib/clamav"; do
    key="${pair%%:*}"; pair="${pair#*:}"; service="${pair%%:*}"; destination="${pair#*:}"
    actual="$(volume_name "$service" "$destination")"
    [ -n "$actual" ] || continue
    configured="$(env_val "$key")"
    if [ -n "$configured" ] && [ "$configured" != "$actual" ]; then
      warn "$key=$configured but the running container uses $actual; keeping the mounted volume."
    fi
    set_env "$key" "$actual"
    ok "$key=$actual"
  done
}

saved_session_count() {
  docker inspect "$DB" >/dev/null 2>&1 || return 1
  local count
  count="$(docker exec "$DB" psql -U "$DBUSER" -d "$DBNAME" -tAc \
    "SELECT count(*) FROM zalo_accounts WHERE session_data IS NOT NULL AND archived_at IS NULL;" \
    2>/dev/null | tr -d '[:space:]')" || return 1
  [[ "$count" =~ ^[0-9]+$ ]] || return 1
  printf '%s\n' "$count"
}

audit_saved_sessions() {
  local count="$1" label="$2"
  case "$count" in
    ''|*[!0-9]*) warn "$label: could not read saved Zalo session count (value=$count)." ;;
    *) log "$label: $count saved Zalo session(s) in PostgreSQL." ;;
  esac
}

# ── Kiểm tra & né port trùng ──────────────────────────────────────────────────
# port_in_use PORT → 0 nếu CÓ gì đó đang LISTEN ở 127.0.0.1:PORT.
# Dùng /dev/tcp của bash (chạy được Linux/macOS/Git Bash trên Windows); dự phòng
# bằng container Docker khác đang publish port đó.
port_in_use() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && { exec 3>&- 3<&- 2>/dev/null; return 0; }
  docker ps --format '{{.Ports}}' 2>/dev/null | grep -qE "(^|[^0-9]):$1->" && return 0
  return 1
}
# find_free_port PORT → in ra port trống đầu tiên ≥ PORT.
find_free_port() {
  local p="$1"
  while port_in_use "$p"; do p=$((p+1)); [ "$p" -gt 65000 ] && die "Không tìm được port trống từ $1."; done
  echo "$p"
}
# app_port → port host của app (APP_PORT trong .env, mặc định PORT_DEFAULT).
app_port() { local p; p="$(env_val APP_PORT)"; echo "${p:-$PORT_DEFAULT}"; }

# ensure_ports — với từng dịch vụ, nếu port mặc định bận thì nhảy sang port trống
# rồi GHI vào .env (compose đọc ${APP_PORT}…). Cập nhật URL theo port mới. Chỉ gọi
# lúc TẠO .env (cài mới) — bản đang chạy giữ nguyên port trong .env (chính nó giữ port).
ensure_ports() {
  log "Kiểm tra port trống cho các dịch vụ (app/db/redis/minio)…"
  local changed=0 pair key def cur free
  for pair in "APP_PORT:3080" "DB_PORT:5433" "REDIS_PORT:6379" "MINIO_PORT:9000" "MINIO_CONSOLE_PORT:9001"; do
    key="${pair%%:*}"; def="${pair##*:}"
    cur="$(env_val "$key")"; cur="${cur:-$def}"
    free="$(find_free_port "$cur")"
    if [ "$free" != "$cur" ]; then warn "Port $cur ($key) đang bận → dùng $free."; changed=1; fi
    set_env "$key" "$free"
  done
  # APP_PORT / MINIO_PORT có thể đổi → cập nhật URL công khai cho khớp.
  local appp miniop; appp="$(env_val APP_PORT)"; miniop="$(env_val MINIO_PORT)"
  set_env APP_URL       "http://localhost:${appp}"
  set_env CRM_LOGIN_URL "http://localhost:${appp}"
  set_env S3_PUBLIC_URL "http://localhost:${miniop}/zalocrm-attachments"
  [ "$changed" = 1 ] && warn "Đã đổi port để né trùng — chi tiết trong .env." || ok "Các port mặc định đều trống."
}

# ── Pre-flight ────────────────────────────────────────────────────────────────
need docker; need openssl
docker compose version >/dev/null 2>&1 || die "Cần Docker Compose v2 (lệnh 'docker compose')."
[ -f docker-compose.yml ] || die "Không thấy docker-compose.yml — chạy ở thư mục gốc mã nguồn ZCRM."

MODE="${1:-auto}"
DBUSER="$(env_val DB_USER)"; DBUSER="${DBUSER:-crmuser}"
DBNAME="$(env_val DB_NAME)"; DBNAME="${DBNAME:-zalocrm}"

# ── Sinh .env (cài mới) ───────────────────────────────────────────────────────
ensure_env() {
  [ -f .env ] && { ok ".env đã có — giữ nguyên (không ghi đè secret)."; return 0; }
  [ -f .env.example ] || die "Thiếu .env.example để tạo .env."
  log "Chưa có .env — tạo mới + sinh secret ngẫu nhiên…"
  cp .env.example .env
  # Né port trùng TRƯỚC khi đặt URL — set_env APP_PORT/MINIO_PORT + URL khớp port mới.
  ensure_ports
  # Ưu tiên APP_URL truyền qua biến môi trường (domain production); nếu không có thì
  # dùng URL localhost theo port vừa chọn (ensure_ports đã ghi vào .env).
  local appurl="${APP_URL:-$(env_val APP_URL)}"; appurl="${appurl:-http://localhost:$(app_port)}"
  local s3pub="${S3_PUBLIC_URL:-$(env_val S3_PUBLIC_URL)}"; s3pub="${s3pub:-http://localhost:$(env_val MINIO_PORT)/zalocrm-attachments}"
  local miniopw; miniopw="$(gen 16)"
  set_env JWT_SECRET          "$(gen 32)"
  set_env ENCRYPTION_KEY      "$(gen 32)"
  set_env DB_PASSWORD         "$(gen 16)"
  set_env MINIO_ROOT_USER     "zalocrm"
  set_env MINIO_ROOT_PASSWORD "$miniopw"
  set_env S3_ACCESS_KEY       "zalocrm"
  set_env S3_SECRET_KEY       "$miniopw"
  set_env S3_ENDPOINT         "http://minio:9000"
  set_env S3_BUCKET           "zalocrm-attachments"
  set_env S3_PUBLIC_URL       "$s3pub"
  set_env APP_URL             "$appurl"
  set_env CRM_LOGIN_URL       "$appurl"
  DBUSER="$(env_val DB_USER)"; DBUSER="${DBUSER:-crmuser}"
  DBNAME="$(env_val DB_NAME)"; DBNAME="${DBNAME:-zalocrm}"
  ok ".env đã tạo (JWT/ENCRYPTION/DB/MinIO sinh tự động)."
  warn "Production: sửa APP_URL='$appurl' và S3_PUBLIC_URL thành domain HTTPS thật, rồi chạy lại."
}

# ── Có phải bản đang chạy (để quyết cài mới vs nâng cấp)? ──────────────────────
is_existing() {
  docker inspect "$DB" >/dev/null 2>&1 || return 1
  local n; n="$(docker exec "$DB" psql -U "$DBUSER" -d "$DBNAME" -tAc "SELECT count(*) FROM users" 2>/dev/null || echo 0)"
  [ "${n:-0}" -gt 0 ] 2>/dev/null
}

backup_db() {
  docker inspect "$DB" >/dev/null 2>&1 || { warn "Chưa có DB container — bỏ qua backup."; return 0; }
  local f="backup-zalocrm-$(date +%F-%H%M).sql"
  log "Backup database → $f …"
  docker exec "$DB" pg_dump -U "$DBUSER" "$DBNAME" > "$f" || die "Backup thất bại."
  [ -s "$f" ] || die "File backup rỗng — DỪNG (không nâng cấp khi chưa có backup an toàn)."
  ok "Backup OK: $f ($(du -h "$f" | cut -f1))."
}

build_up() {
  log "Build + khởi động dịch vụ lõi (app db redis minio)…"
  docker compose up -d --build "${CORE_SERVICES[@]}"
}

wait_app() {
  log "Chờ app container sẵn sàng…"
  for _ in $(seq 1 30); do
    [ "$(docker inspect -f '{{.State.Running}}' "$APP" 2>/dev/null)" = "true" ] && { ok "app đang chạy."; return 0; }
    docker inspect "$DB" >/dev/null 2>&1 && docker exec "$DB" pg_isready -U "$DBUSER" >/dev/null 2>&1 || true
  done
  die "app không khởi động được — xem: docker logs $APP"
}

migrate() {
  log "Áp migration database (prisma migrate deploy)…"
  docker exec "$APP" npx prisma migrate deploy || die "migrate thất bại — xem docker logs $APP"
  ok "Migration đã áp xong."
}

cutover() {
  # Nâng cấp: ép mọi user đăng nhập lại 1 lần (vô hiệu token cũ).
  log "Cutover: vô hiệu token cũ (user đăng nhập lại 1 lần)…"
  docker exec "$DB" psql -U "$DBUSER" -d "$DBNAME" \
    -c "UPDATE users SET jwt_token_version = jwt_token_version + 1;" >/dev/null 2>&1 || \
    warn "Bỏ qua cutover (không tăng được jwt_token_version)."
}

restart_app() { log "Khởi động lại app cho sạch…"; docker compose restart app >/dev/null; }

health() {
  local p; p="$(app_port)"
  log "Kiểm tra sức khoẻ…"
  for _ in $(seq 1 30); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${p}/" 2>/dev/null)" = "200" ] && break
    sleep 1 || true
  done
  local code; code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${p}/" 2>/dev/null || echo 000)"
  [ "$code" = "200" ] && ok "App phục vụ OK (HTTP 200) tại http://localhost:${p}" \
                       || warn "App chưa trả 200 (mã $code) — xem: docker logs $APP"
}

# Mở URL bằng trình duyệt mặc định (best-effort, đa nền tảng). NO_OPEN=1 để tắt
# (vd deploy trên server không màn hình).
open_url() {
  [ "${NO_OPEN:-0}" = "1" ] && return 0
  local url="$1"
  if   command -v open >/dev/null 2>&1;            then open "$url" >/dev/null 2>&1 || return 0        # macOS
  elif command -v xdg-open >/dev/null 2>&1;        then xdg-open "$url" >/dev/null 2>&1 || return 0    # Linux desktop
  elif command -v cmd.exe >/dev/null 2>&1;         then cmd.exe /c start "" "$url" >/dev/null 2>&1 || return 0  # Windows (Git Bash)
  elif command -v powershell.exe >/dev/null 2>&1;  then powershell.exe -NoProfile -Command "Start-Process '$url'" >/dev/null 2>&1 || return 0
  else return 0; fi
  ok "Đã mở $url trên trình duyệt."
}

# ── Luồng chính ───────────────────────────────────────────────────────────────
case "$MODE" in
  backup) backup_db; exit 0 ;;
  auto)    is_existing && MODE=upgrade || MODE=install ;;
  install|upgrade) ;;
  *) die "Mode không hợp lệ: $MODE (auto|install|upgrade|backup)";;
esac

if [ "$MODE" = "install" ]; then
  echo "═══ CÀI MỚI ZCRM Community ═══"
  ensure_env
  build_up
  wait_app
  migrate
  restart_app
  health
  echo ""
  ok "HOÀN TẤT cài mới."
  echo "→ Mở http://localhost:$(app_port) → trang /setup tự hiện → tạo tổ chức + tài khoản chủ."
  open_url "http://localhost:$(app_port)/setup"
else
  echo "═══ NÂNG CẤP ZCRM Community (giữ dữ liệu) ═══"
  [ -f .env ] || die "Không thấy .env — đây không phải bản đang chạy. Dùng 'install' để cài mới."
  bind_existing_volumes
  EXPECTED_SAVED_SESSIONS="$(saved_session_count)" || die "Không đọc được session Zalo từ PostgreSQL trước nâng cấp — dừng để bảo vệ dữ liệu."
  audit_saved_sessions "$EXPECTED_SAVED_SESSIONS" "Before upgrade"
  backup_db
  build_up         # up -d --build, KHÔNG -v → GIỮ database
  wait_app
  migrate
  ACTUAL_SAVED_SESSIONS="$(saved_session_count)" || die "Không đọc được session Zalo từ PostgreSQL sau migration — dừng để bảo vệ dữ liệu."
  audit_saved_sessions "$ACTUAL_SAVED_SESSIONS" "After migration"
  if [[ "$EXPECTED_SAVED_SESSIONS" =~ ^[0-9]+$ && "$ACTUAL_SAVED_SESSIONS" =~ ^[0-9]+$ ]] &&
     [ "$ACTUAL_SAVED_SESSIONS" -lt "$EXPECTED_SAVED_SESSIONS" ]; then
    die "Saved Zalo sessions dropped from $EXPECTED_SAVED_SESSIONS to $ACTUAL_SAVED_SESSIONS; stopping to avoid the wrong DB/volume."
  fi
  cutover
  restart_app
  health
  echo ""
  ok "HOÀN TẤT nâng cấp. User cần đăng nhập lại 1 lần (đúng, do cutover)."
  open_url "http://localhost:$(app_port)"
fi

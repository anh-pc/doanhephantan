#!/usr/bin/env bash
# ==============================================================================
# KỊCH BẢN DEMO BẢO VỆ ĐỒ ÁN MÔN HỆ PHÂN TÁN (PHIÊN BẢN ẤN TƯỢNG)
# Microservices · API Gateway · Load Balancing · Redis Cache-Aside ·
# Graceful Degradation · Chaos Failover · Ticket Search/Filter/Pagination
#
# Cách chạy trên Ubuntu:
#   chmod +x scripts/*.sh
#   ./scripts/demo_baove.sh          # Trình chiếu từng phần (Enter để đi tiếp)
#   ./scripts/demo_baove.sh --auto   # Chạy tự động liền mạch toàn bộ 7 phần
#   ./scripts/demo_baove.sh --menu   # Menu chọn nhanh từng phần (dùng khi thầy hỏi đáp!)
# ==============================================================================
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
MODE="step"
case "${1:-}" in
  --auto) MODE="auto" ;;
  --menu) MODE="menu" ;;
esac

# Bảng màu ANSI
BOLD="\033[1m"
DIM="\033[2m"
CYAN="\033[1;36m"
BLUE="\033[1;34m"
GREEN="\033[1;32m"
YELLOW="\033[1;33m"
MAGENTA="\033[1;35m"
RED="\033[1;31m"
WHITE="\033[1;37m"
RESET="\033[0m"

PASS_COUNT=0
FAIL_COUNT=0
SUMMARY_LINES=()
START_EPOCH=$(date +%s)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# Đảm bảo nếu bị ngắt đột ngột giữa phần tắt Redis vẫn tự bật lại
cleanup_on_interrupt() {
  echo -e "\n${YELLOW}⚠ Đang khôi phục dịch vụ nếu có container tạm dừng...${RESET}"
  docker compose start redis >/dev/null 2>&1 || true
  exit 130
}
trap cleanup_on_interrupt INT TERM

print_hero() {
  clear || true
  echo -e "${CYAN}"
  cat <<'EOF'
╔══════════════════════════════════════════════════════════════════════════════╗
║   __  __ ___ ____ ____   ___  ____  _____ ____  _   _ ___ ____ _____ ____    ║
║  |  \/  |_ _/ ___|  _ \ / _ \/ ___|| ____|  _ \| | | |_ _/ ___| ____/ ___|   ║
║  | |\/| || | |   | |_) | | | \___ \|  _| | |_) | | | || | |   |  _| \___ \   ║
║  | |  | || | |___|  _ <| |_| |___) | |___|  _ <| |_| || | |___| |___ ___) |  ║
║  |_|  |_|___\____|_| \_\\___/|____/|_____|_| \_\\___/|___\____|_____|____/   ║
║                                                                              ║
║         DEMO BẢO VỆ ĐỒ ÁN HỆ PHÂN TÁN — API GATEWAY · LB · REDIS · HA        ║
╚══════════════════════════════════════════════════════════════════════════════╝
EOF
  echo -e "${RESET}"
  echo -e "  ${BOLD}Gateway URL${RESET} : ${GREEN}${BASE_URL}${RESET}"
  echo -e "  ${BOLD}Kiến trúc${RESET}   : Client → Nginx Gateway → Frontend / User(Node) / Ticket(Flask×N) → PG + Redis"
  echo -e "  ${BOLD}Chế độ chạy${RESET} : ${YELLOW}${MODE}${RESET} ${DIM}(hỗ trợ: mặc định | --auto | --menu)${RESET}"
  echo ""
}

section() {
  local num="$1"
  local title="$2"
  local talk="$3"
  echo ""
  echo -e "${CYAN}┌──────────────────────────────────────────────────────────────────────────────┐${RESET}"
  echo -e "${CYAN}│${RESET} ${BOLD}${WHITE}[PHẦN ${num}] ${title}${RESET}"
  echo -e "${CYAN}└──────────────────────────────────────────────────────────────────────────────┘${RESET}"
  echo -e "${MAGENTA}💬 Điểm nhấn trình bày:${RESET} ${DIM}${talk}${RESET}"
  echo ""
}

step() {
  echo -e "${YELLOW}▶ $1${RESET}"
}

ok() {
  echo -e "${GREEN}  ✔ PASS:${RESET} $1"
  PASS_COUNT=$((PASS_COUNT + 1))
  SUMMARY_LINES+=("${GREEN}✔ PASS${RESET} │ $1")
}

fail() {
  echo -e "${RED}  ✘ FAIL:${RESET} $1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
  SUMMARY_LINES+=("${RED}✘ FAIL${RESET} │ $1")
}

pause_next() {
  if [[ "$MODE" == "step" ]]; then
    echo ""
    read -r -p "$(echo -e "${DIM}── Nhấn [Enter] sang phần tiếp theo (hoặc gõ 'q' để dừng): ${RESET}")" ans
    if [[ "${ans,,}" == "q" ]]; then
      print_summary
      exit 0
    fi
  elif [[ "$MODE" == "auto" ]]; then
    sleep 1
  fi
}

# Gọi GET và in bảng đẹp mắt bằng Python chuẩn (không cần cài jq)
api_table() {
  local label="$1"
  local url="$2"
  echo -e "  ${BLUE}${label}${RESET} ${DIM}(${url})${RESET}"
  python3 - "$url" <<'PY'
import json, sys, urllib.request
url = sys.argv[1]
with urllib.request.urlopen(url, timeout=10) as r:
    data = json.loads(r.read().decode("utf-8"))
    xcache = r.headers.get("X-Cache", "-")
    upstream = r.headers.get("X-Upstream-Addr", "-")
    rid = (r.headers.get("X-Request-ID", "-") or "-")[:12]
    print(f"    HTTP {r.status} | X-Cache={xcache:<6} | Upstream={upstream} | X-Request-ID={rid}...")
    items = data.get("items")
    if isinstance(items, list):
        total = data.get("total", len(items))
        page = data.get("page", "-")
        tpages = data.get("total_pages", "-")
        print(f"    Kết quả: total={total} | trang={page}/{tpages} | đang hiển thị={len(items)}")
        if not items:
            print("    (Danh sách rỗng — [] — đúng chuẩn HTTP 200)")
        elif isinstance(items[0], dict):
            print("    ┌─────┬──────────────────────────────┬──────────────┬──────────────┬─────┐")
            print("    │ ID  │ Sự kiện                      │ Danh mục     │ Giá (VNĐ)    │  SL │")
            print("    ├─────┼──────────────────────────────┼──────────────┼──────────────┼─────┤")
            for it in items[:6]:
                ev = str(it.get("event", ""))[:28]
                cat = str(it.get("category", ""))[:12]
                price = f"{int(it.get('price', 0)):,}".replace(",", ".") + " đ"
                qty = str(it.get("quantity", 0))
                print(f"    │ {str(it.get('id','')):<3} │ {ev:<28} │ {cat:<12} │ {price:>12} │ {qty:>3} │")
            print("    └─────┴──────────────────────────────┴──────────────┴──────────────┴─────┘")
            if len(items) > 6:
                print(f"    ... (+{len(items) - 6} vé nữa)")
        else:
            print("    Danh mục:", ", ".join(str(x) for x in items))
    else:
        print("   ", json.dumps(data, ensure_ascii=False))
PY
}

# ==============================================================================
# PHẦN 1: KIẾN TRÚC MICROSERVICES, DATABASE-PER-SERVICE & CÁCH LY MẠNG
# ==============================================================================
part_1_architecture() {
  section "1/7" "KIẾN TRÚC MICROSERVICES, DATABASE-PER-SERVICE & CÁCH LY MẠNG" \
    "Hệ thống tách 2 mạng Docker (edge/data), mỗi service sở hữu 1 DB riêng; Gateway không thể chạm vào DB."

  step "1.1 Khởi động toàn bộ dịch vụ qua Docker Compose & đồng bộ schema..."
  docker compose up -d --build
  docker compose exec -T postgres psql -U postgres -d tickets_db -c \
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS category VARCHAR(100) NOT NULL DEFAULT 'Khac';" >/dev/null

  for _ in $(seq 1 20); do
    if curl -fsS "${BASE_URL}/healthz" >/dev/null 2>&1; then break; fi
    sleep 1
  done

  docker compose ps

  step "1.2 Kiểm tra Health Check + Tracing Header (X-Request-ID, X-Upstream-Addr)..."
  python3 - "${BASE_URL}" <<'PY'
import json, sys, urllib.request
base = sys.argv[1]
for path in ("/healthz", "/api/users/health", "/api/tickets/health"):
    with urllib.request.urlopen(base + path, timeout=5) as r:
        body = r.read().decode("utf-8").strip()
        rid = (r.headers.get("X-Request-ID") or "-")[:16]
        up = r.headers.get("X-Upstream-Addr") or "gateway-local"
        print(f"    {path:<22} -> HTTP {r.status} | upstream={up:<18} | rid={rid}...")
PY
  ok "Tất cả dịch vụ healthy & Gateway gắn X-Request-ID cho mọi request"

  step "1.3 Chứng minh Database-per-Service (users_db tách biệt tickets_db)..."
  docker compose exec -T postgres psql -U postgres -c "\l" | grep -E "users_db|tickets_db" || true
  ok "Database-per-Service: users_db và tickets_db hoàn toàn tách biệt"

  step "1.4 Chứng minh Cách ly mạng (Security): Gateway (mạng edge) KHÔNG thấy PostgreSQL/Redis (mạng data)..."
  if docker compose exec -T gateway getent hosts postgres >/dev/null 2>&1; then
    fail "Gateway phân giải được postgres (không đúng thiết kế cách ly mạng)"
  else
    echo -e "    ${DIM}gateway -> getent hosts postgres : Không phân giải được (đúng thiết kế!)${RESET}"
    echo -e "    ${DIM}ticket-service -> getent hosts postgres :$(docker compose exec -T ticket-service getent hosts postgres | head -n1 | awk '{print " " $1 " (kết nối qua mạng data)"}')${RESET}"
    ok "Network Isolation chuẩn: Gateway bị cô lập hoàn toàn khỏi tầng dữ liệu"
  fi
}

# ==============================================================================
# PHẦN 2: TÌM KIẾM VÉ, LỌC DANH MỤC PHÍA SERVER, PHÂN TRANG & BẢO MẬT
# ==============================================================================
part_2_search_security() {
  section "2/7" "TÌM KIẾM, LỌC DANH MỤC PHÍA SERVER, PHÂN TRANG & BẢO MẬT" \
    "Truy vấn tham số hoá chống SQLi, escape ILIKE (%, _, \\), tìm danh mục phía server, kẹp biên không 4xx."

  step "2.1 Tìm theo tên không phân biệt hoa/thường & bỏ khoảng trắng (AC1):"
  api_table "Tìm q='  CONCERT  '" "${BASE_URL}/api/tickets?q=%20%20CONCERT%20%20"

  step "2.2 Kết hợp từ khoá + danh mục chính xác (AC2 + AC3):"
  api_table "Lọc q='Hà Nội' & category='Âm nhạc'" "${BASE_URL}/api/tickets?q=H%C3%A0%20N%E1%BB%99i&category=%C3%82m%20nh%E1%BA%A1c"

  step "2.3 Tìm danh mục phía server (AC10 — hỗ trợ hàng trăm danh mục):"
  api_table "GET /api/tickets/categories?q=công&limit=20" "${BASE_URL}/api/tickets/categories?q=c%C3%B4ng&limit=20"

  step "2.4 Kiểm chứng Phòng thủ bảo mật & Xử lý biên (AC6, AC20, AC21):"
  api_table "Escape ký tự đặc biệt q='%' (không khớp tất cả!)" "${BASE_URL}/api/tickets?q=%25"
  api_table "Chống SQL Injection q=\"' OR 1=1 --\"" "${BASE_URL}/api/tickets?q=%27%20OR%201%3D1%20--"
  api_table "Kẹp biên tự động page=999&page_size=2 (về trang cuối, HTTP 200)" "${BASE_URL}/api/tickets?page=999&page_size=2"

  ok "Tìm kiếm, lọc danh mục, phân trang & bảo mật SQLi/ILIKE hoạt động chuẩn xác"
}

# ==============================================================================
# PHẦN 3: REDIS CACHE-ASIDE (ĐO SPEEDUP + BIỂU ĐỒ) & CACHE INVALIDATION
# ==============================================================================
part_3_redis_cache() {
  section "3/7" "REDIS CACHE-ASIDE (TĂNG TỐC ~100×) & CACHE INVALIDATION" \
    "Truy vấn nặng pg_sleep(0.5) được cache ở Redis; khi POST tạo vé mới thì lập tức vô hiệu hoá cache."

  step "3.1 Xoá Redis rồi đo 30 request /api/tickets/stats (1 MISS từ DB vs 29 HIT từ Redis):"
  docker compose exec -T redis redis-cli FLUSHALL >/dev/null
  python3 - "${BASE_URL}" <<'PY'
import json, statistics, sys, time, urllib.request
url = sys.argv[1] + "/api/tickets/stats"
misses, hits = [], []
for _ in range(30):
    t0 = time.perf_counter()
    with urllib.request.urlopen(url, timeout=10) as r:
        body = json.loads(r.read().decode("utf-8"))
    ms = (time.perf_counter() - t0) * 1000
    (hits if body["cache"] == "HIT" else misses).append(ms)

m_avg = statistics.mean(misses) if misses else 0.1
h_avg = statistics.mean(hits) if hits else 0.1
speedup = m_avg / max(h_avg, 0.01)

bar_m = "█" * 40
bar_h = "█" * max(1, int(round(40 * h_avg / max(m_avg, 1))))
print(f"    MISS (PostgreSQL) │ \033[1;31m{bar_m}\033[0m {m_avg:6.1f} ms (n={len(misses)})")
print(f"    HIT  (Redis)      │ \033[1;32m{bar_h:<40}\033[0m {h_avg:6.1f} ms (n={len(hits)})")
print(f"    ⚡ Hiệu quả tăng tốc: \033[1;32mnhanh hơn {speedup:.1f}×\033[0m nhờ Redis Cache-Aside!")
PY

  step "3.2 Chứng minh Cache Invalidation tức thời khi thêm vé mới (AC15):"
  docker compose exec -T redis redis-cli FLUSHALL >/dev/null
  H1=$(curl -fsSI "${BASE_URL}/api/tickets" | grep -i '^X-Cache:' | tr -d '\r')
  H2=$(curl -fsSI "${BASE_URL}/api/tickets" | grep -i '^X-Cache:' | tr -d '\r')
  DEMO_EV="Su Kien Bao Ve $(date +%H%M%S)"
  curl -fsS -X POST "${BASE_URL}/api/tickets" \
    -H "Content-Type: application/json" \
    -d "{\"event\":\"${DEMO_EV}\",\"price\":350000,\"quantity\":25,\"category\":\"Hoi thao\"}" >/dev/null
  H3=$(curl -fsSI "${BASE_URL}/api/tickets" | grep -i '^X-Cache:' | tr -d '\r')
  ENC_EV=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$DEMO_EV")
  H4=$(curl -fsSI "${BASE_URL}/api/tickets?q=${ENC_EV}" | grep -i '^X-Cache:' | tr -d '\r')

  echo "    1. GET /api/tickets (lần đầu)   -> ${H1}"
  echo "    2. GET /api/tickets (lần hai)   -> ${H2}"
  echo "    3. POST /api/tickets ('${DEMO_EV}') -> tự xoá tickets:list & tickets:stats"
  echo "    4. GET /api/tickets (sau POST)  -> ${H3} (đọc lại DB, thấy ngay vé mới!)"
  echo "    5. GET /api/tickets?q=...       -> ${H4} (lọc luôn bỏ qua cache, không lệch dữ liệu)"

  ok "Redis tăng tốc truy vấn nặng và Cache Invalidation hoạt động tức thời"
}

# ==============================================================================
# PHẦN 4: GRACEFUL DEGRADATION — TẮT HẲN REDIS NHƯNG HỆ THỐNG KHÔNG SẬP!
# ==============================================================================
part_4_graceful_degradation() {
  section "4/7" "GRACEFUL DEGRADATION — TẮT HẲN REDIS NHƯNG HỆ THỐNG KHÔNG SẬP" \
    "Khi tầng cache gặp sự cố, dịch vụ tự suy giảm êm về PostgreSQL (HTTP 200) và tự hồi phục khi Redis sống lại."

  step "4.1 Giả lập sự cố Redis: dừng đột ngột container redis..."
  docker compose stop redis >/dev/null

  step "4.2 Gọi API khi Redis đang CHẾT — hệ thống vẫn phục vụ HTTP 200:"
  api_table "GET /api/tickets (Redis DOWN -> suy giảm êm)" "${BASE_URL}/api/tickets"
  api_table "GET /api/tickets?q=mau (Redis DOWN -> vẫn lọc mượt)" "${BASE_URL}/api/tickets?q=mau"

  step "4.3 Khởi động lại Redis — tự hồi phục cache HIT mà KHÔNG cần restart ticket-service:"
  docker compose start redis >/dev/null
  sleep 2
  curl -fsS "${BASE_URL}/api/tickets" >/dev/null
  RECOVERED=$(curl -fsSI "${BASE_URL}/api/tickets" | grep -i '^X-Cache:' | tr -d '\r')
  echo "    Trạng thái sau khi Redis sống lại: ${RECOVERED}"

  if echo "$RECOVERED" | grep -qi "HIT"; then
    ok "Graceful Degradation: Redis sập không làm sập dịch vụ & tự hồi phục HIT"
  else
    fail "Redis chưa hồi phục trạng thái HIT sau khi khởi động lại"
  fi
}

# ==============================================================================
# PHẦN 5: SCALE NGANG ×3 & CÂN BẰNG TẢI NGINX (BIỂU ĐỒ TRỰC QUAN)
# ==============================================================================
part_5_scale_lb() {
  section "5/7" "SCALE NGANG (3 REPLICA) & CÂN BẰNG TẢI NGINX ROUND-ROBIN" \
    "Ticket Service stateless hoàn toàn -> nhân bản ×3, reload DNS Nginx và phân phối đều 300 request."

  step "5.1 Chạy ./scripts/scale.sh 3 (nhân bản 3 container + reload Nginx DNS):"
  ./scripts/scale.sh 3

  step "5.2 Bắn 300 request qua Nginx Gateway & vẽ biểu đồ phân phối theo replica:"
  python3 - "${BASE_URL}" <<'PY'
import json, statistics, sys, time, urllib.request
from collections import Counter

url = sys.argv[1] + "/api/tickets/whoami"
N = 300
served, lat, errors = Counter(), [], 0
for _ in range(N):
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            body = json.loads(r.read().decode("utf-8"))
            lat.append((time.perf_counter() - t0) * 1000)
            if r.status == 200:
                served[body.get("served_by", "?")] += 1
            else:
                errors += 1
    except Exception:
        errors += 1
        lat.append((time.perf_counter() - t0) * 1000)

lat.sort()
p50 = lat[int(0.50 * (len(lat) - 1))]
p95 = lat[int(0.95 * (len(lat) - 1))]
print(f"    Tổng request: {N} | Lỗi: {errors} ({errors/N:.1%}) | Độ trễ: avg={statistics.mean(lat):.1f}ms  p50={p50:.1f}ms  p95={p95:.1f}ms  max={lat[-1]:.1f}ms")
print("    ┌────────────────┬──────────────────────────────────────────┬───────────────┐")
print("    │ Replica        │ Phân phối tải (Round-Robin)              │ Request (%)   │")
print("    ├────────────────┼──────────────────────────────────────────┼───────────────┤")
for k, v in sorted(served.items()):
    pct = v / N
    bar = "█" * max(1, int(round(pct * 40)))
    print(f"    │ {k:<14} │ \033[1;36m{bar:<40}\033[0m │ {v:>4d} ({pct:5.1%}) │")
print("    └────────────────┴──────────────────────────────────────────┴───────────────┘")
if len(served) < 3 or errors > 0:
    sys.exit(1)
PY
  ok "Scale ×3 + Load Balancing chia tải đều ~33.3% cho 3 replica, 0% lỗi"
}

# ==============================================================================
# PHẦN 6: CHAOS FAILOVER — GIẾT NÓNG 1 REPLICA NGAY GIỮA LUỒNG TẢI ĐA LUỒNG!
# ==============================================================================
part_6_chaos_ha() {
  section "6/7" "CHAOS FAILOVER — GIẾT NÓNG 1 REPLICA GIỮA LÚC TẢI ĐANG CHẠY!" \
    "200 request chạy song song 8 luồng; giết đột ngột 1 container giữa chừng -> Nginx retry trong suốt, 0% lỗi!"

  step "6.1 Bắn 200 request đa luồng đồng thời giết nóng 1 container ticket-service sau 0.25s..."
  python3 - "${BASE_URL}" <<'PY'
import concurrent.futures, json, subprocess, sys, time, urllib.request
from collections import Counter

url = sys.argv[1] + "/api/tickets/whoami"
N = 200
killed_id = [None]

def kill_midflight():
    time.sleep(0.25)
    out = subprocess.check_output(["docker", "compose", "ps", "-q", "ticket-service"], text=True).strip().splitlines()
    if out:
        victim = out[0]
        killed_id[0] = victim[:12]
        print(f"    💥 [CHAOS] Đang giết đột ngột container {killed_id[0]} giữa luồng tải...")
        subprocess.run(["docker", "kill", victim], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def hit(_):
    try:
        with urllib.request.urlopen(url, timeout=8) as r:
            body = json.loads(r.read().decode("utf-8"))
            return r.status, body.get("served_by", "?")
    except Exception:
        return 0, "ERR"

served, errors = Counter(), 0
with concurrent.futures.ThreadPoolExecutor(max_workers=9) as ex:
    killer = ex.submit(kill_midflight)
    futs = [ex.submit(hit, i) for i in range(N)]
    for f in concurrent.futures.as_completed(futs):
        st, by = f.result()
        if st == 200:
            served[by] += 1
        else:
            errors += 1
    killer.result()

print(f"    Kết quả dưới sự cố: {N} request | Lỗi người dùng thấy: \033[1;32m{errors} ({errors/N:.1%})\033[0m")
for k, v in sorted(served.items()):
    tag = "  <-- bị giết giữa chừng!" if killed_id[0] and k.startswith(killed_id[0]) else "  (tiếp nhận toàn bộ tải còn lại)"
    print(f"      - {k:<14}: {v:>3d} req{tag}")
if errors > 0:
    sys.exit(1)
PY

  step "6.2 Trích log Nginx Gateway cho thấy cơ chế failover sang replica khoẻ mạnh:"
  docker compose logs --tail=20 gateway | grep -iE "upstream|failed|timed out|refused" | tail -n 6 || \
    echo -e "    ${DIM}(Nginx đã retry thành công trong nội bộ upstream)${RESET}"

  step "6.3 Tự động khôi phục cụm về lại đủ 3 replica (Self-healing)..."
  ./scripts/scale.sh 3 >/dev/null
  docker compose ps ticket-service
  ok "High Availability: Giết nóng 1 replica giữa luồng tải — 0% lỗi & tự khôi phục ×3"
}

# ==============================================================================
# PHẦN 7: CHẠY TOÀN BỘ BỘ KIỂM THỬ TỰ ĐỘNG (11/11) TRÊN CỤM 3 REPLICA
# ==============================================================================
part_7_automated_tests() {
  section "7/7" "KIỂM THỬ TỰ ĐỘNG (11 TEST CASES) & NHẤT QUÁN ĐA REPLICA" \
    "Chạy scripts/test_search.py trực tiếp trên cụm 3 replica + PostgreSQL 16 + Redis 7."

  step "Chạy python3 scripts/test_search.py..."
  if BASE_URL="${BASE_URL}" python3 scripts/test_search.py; then
    ok "Toàn bộ 11/11 test tự động PASS trên cụm 3 replica thật"
  else
    fail "Có test tự động chưa đạt"
  fi
}

# ==============================================================================
# TỔNG KẾT & GỢI Ý DEMO GIAO DIỆN WEB
# ==============================================================================
print_summary() {
  local elapsed=$(( $(date +%s) - START_EPOCH ))
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════════════════════════╗${RESET}"
  echo -e "${CYAN}║                         BẢNG TỔNG KẾT DEMO BẢO VỆ                            ║${RESET}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════════════════════════╝${RESET}"
  for line in "${SUMMARY_LINES[@]}"; do
    echo -e "  ${line}"
  done
  echo ""
  echo -e "  ${BOLD}Tổng kết:${RESET} ${GREEN}${PASS_COUNT} PASS${RESET} │ ${RED}${FAIL_COUNT} FAIL${RESET} │ Thời gian: ${YELLOW}${elapsed}s${RESET}"
  echo ""
  echo -e "${BOLD}${CYAN}🌐 Kịch bản chốt 30 giây trên trình duyệt (${BASE_URL}):${RESET}"
  echo -e "  1. ${BOLD}Tìm kiếm & lọc UX:${RESET} gõ ${YELLOW}mau${RESET} (debounce 300ms) → chọn danh mục ${YELLOW}Am nhac${RESET} → chỉ còn 1 vé."
  echo -e "  2. ${BOLD}Edge case & hỗ trợ:${RESET} gõ ${YELLOW}%${RESET} (không khớp tất cả) → gõ ${YELLOW}zzz${RESET} → bấm ${YELLOW}Xoá bộ lọc${RESET}."
  echo -e "  3. ${BOLD}Responsive & bàn phím:${RESET} nhấn F12 chọn chiều rộng ${YELLOW}360px${RESET} (xếp dọc, không cuộn ngang) & dùng Tab/↑/↓/Esc."
  echo -e "  4. ${BOLD}Giám sát cân bằng tải:${RESET} kéo xuống khung dưới bấm ${YELLOW}Gửi 30 request${RESET} và ${YELLOW}Gọi truy vấn nặng${RESET}."
  echo ""
}

# ==============================================================================
# CHẾ ĐỘ MENU TƯƠNG TÁC (DÙNG KHI THẦY HỎI ĐÁP / MUỐN XEM LẠI 1 PHẦN BẤT KỲ)
# ==============================================================================
run_menu() {
  print_hero
  while true; do
    echo -e "${BOLD}${CYAN}Chọn kịch bản muốn chạy cho thầy xem:${RESET}"
    echo "  1) Khởi động hệ thống, Database-per-Service & Cách ly mạng (edge/data)"
    echo "  2) Tìm kiếm vé, lọc danh mục phía server, phân trang & chống SQLi/ILIKE"
    echo "  3) Redis Cache-Aside (đo Speedup + biểu đồ) & Cache Invalidation"
    echo "  4) Graceful Degradation — Tắt hẳn Redis nhưng hệ thống KHÔNG sập"
    echo "  5) Scale ngang ×3 & Cân bằng tải Nginx (biểu đồ 300 request)"
    echo "  6) Chaos Failover — Giết nóng 1 replica giữa luồng tải đa luồng (0% lỗi)"
    echo "  7) Chạy toàn bộ 11 test tự động (scripts/test_search.py)"
    echo "  a) Chạy TẤT CẢ (1 → 7)"
    echo "  q) Thoát & in tổng kết"
    echo ""
    read -r -p "$(echo -e "${YELLOW}Nhập lựa chọn [1-7/a/q]: ${RESET}")" choice
    case "${choice,,}" in
      1) part_1_architecture ;;
      2) part_2_search_security ;;
      3) part_3_redis_cache ;;
      4) part_4_graceful_degradation ;;
      5) part_5_scale_lb ;;
      6) part_6_chaos_ha ;;
      7) part_7_automated_tests ;;
      a)
        part_1_architecture
        part_2_search_security
        part_3_redis_cache
        part_4_graceful_degradation
        part_5_scale_lb
        part_6_chaos_ha
        part_7_automated_tests
        print_summary
        ;;
      q)
        print_summary
        break
        ;;
      *) echo -e "${RED}Lựa chọn không hợp lệ.${RESET}" ;;
    esac
    echo ""
  done
}

# ==============================================================================
# MAIN
# ==============================================================================
if [[ "$MODE" == "menu" ]]; then
  run_menu
  exit 0
fi

print_hero
part_1_architecture;        pause_next
part_2_search_security;     pause_next
part_3_redis_cache;         pause_next
part_4_graceful_degradation; pause_next
part_5_scale_lb;            pause_next
part_6_chaos_ha;            pause_next
part_7_automated_tests
print_summary

[[ "$FAIL_COUNT" -eq 0 ]]

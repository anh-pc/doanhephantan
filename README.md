# Microservices + API Gateway + Load Balancing (Docker, Nginx, Redis)

Đồ án môn Hệ phân tán gồm 3 dịch vụ độc lập (**Frontend React**, **User Service Node.js**, **Ticket Service Python/Flask**) đặt sau **Nginx API Gateway**; **Redis** làm cache-aside; **PostgreSQL** lưu dữ liệu theo mô hình *Database-per-Service*.

```text
Client ──► Nginx Gateway (:8080)
             ├── /            → frontend (Nginx tĩnh)
             ├── /api/users   → user-service (Node.js)     ──► PostgreSQL: users_db
             └── /api/tickets → ticket-service ×N (Flask)  ──► PostgreSQL: tickets_db
                                                           └─► Redis (cache-aside)
```

Hai mạng Docker tách biệt: `edge` (gateway ↔ dịch vụ) và `data` (dịch vụ ↔ PostgreSQL/Redis). Gateway không thể truy cập trực tiếp DB/Redis.

---

## Chạy trên Ubuntu (từng bước)

### 1. Cài môi trường *(chỉ làm 1 lần trên máy mới)*
```bash
sudo apt update && sudo apt install -y git curl python3 docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
newgrp docker

# Kiểm tra
docker --version && docker compose version && python3 --version
```
*(Nếu vẫn báo lỗi quyền Docker sau `newgrp docker`, hãy đăng xuất và đăng nhập lại Ubuntu.)*

### 2. Tải mã nguồn và chuẩn bị script
```bash
git clone https://github.com/anh-pc/doanhephantan.git
cd doanhephantan
chmod +x scripts/*.sh
sed -i 's/\r$//' scripts/*.sh
```
*(Nếu đã clone trước đó, chỉ cần chạy `git pull origin main && chmod +x scripts/*.sh && sed -i 's/\r$//' scripts/*.sh`.)*

### 3. Dựng sạch hệ thống
```bash
docker compose down -v
docker compose up -d --build
docker compose ps
curl http://localhost:8080/healthz      # kỳ vọng: gateway ok
```
Mở trình duyệt tại **http://localhost:8080** *(nếu truy cập từ máy khác qua LAN và bật firewall `ufw`, mở cổng bằng `sudo ufw allow 8080/tcp`)*.

### 4. Chạy kịch bản Demo Bảo vệ (7 phần trọn gói)
Bao gồm: kiểm chứng cách ly mạng `edge`/`data`, tìm kiếm & lọc danh mục/chống SQLi, biểu đồ tăng tốc Redis ~100× & Cache Invalidation, **Graceful Degradation** (tắt hẳn Redis không sập), scale ×3 & biểu đồ cân bằng tải, **Chaos Failover** (giết nóng 1 replica giữa luồng tải đa luồng với 0% lỗi), và 11 test tự động.

```bash
./scripts/demo_baove.sh          # Chế độ thuyết trình (nhấn Enter qua từng phần)
./scripts/demo_baove.sh --auto   # Chạy tự động toàn bộ 7 phần
./scripts/demo_baove.sh --menu   # Menu chọn nhanh từng phần khi thầy hỏi đáp
```

### 5. Dừng và dọn dẹp
```bash
docker compose down      # Dừng container, giữ dữ liệu PostgreSQL
docker compose down -v   # Dừng container và xoá sạch dữ liệu PostgreSQL
```

---

## Các lệnh chạy lẻ (khi cần kiểm tra từng tính năng)
```bash
# Kiểm thử tự động tìm kiếm, lọc danh mục, phân trang, bảo mật (11 test)
python3 scripts/test_search.py

# Scale lên 3 replica + reload DNS Nginx + đo cân bằng tải
./scripts/scale.sh 3
python3 scripts/lb_test.py --url http://localhost:8080 --n 300

# Giả lập dừng 1 replica để kiểm tra chịu lỗi (High Availability)
./scripts/kill-one.sh
python3 scripts/lb_test.py --url http://localhost:8080 --n 150

# Đo tốc độ Redis cache (MISS ~0.5s vs HIT vài ms)
docker compose exec redis redis-cli FLUSHALL
python3 scripts/cache_test.py --url http://localhost:8080 --n 50

# Nâng cấp DB cũ (nếu không chạy docker compose down -v)
docker compose exec -T postgres psql -U postgres -d tickets_db -c \
  "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS category VARCHAR(100) NOT NULL DEFAULT 'Khac';"
```

---

## API
| Phương thức | Đường dẫn | Mô tả |
|---|---|---|
| GET / POST | `/api/users` | Danh sách / thêm người dùng |
| GET / PUT / DELETE | `/api/users/{id}` | Chi tiết / cập nhật / xoá người dùng |
| GET | `/api/tickets` | Danh sách vé (cache Redis 30 s khi không truyền tham số); hỗ trợ lọc/phân trang `?q=&category=&page=&page_size=` (đọc trực tiếp PostgreSQL) |
| POST | `/api/tickets` | Tạo vé mới (nhận `category` tuỳ chọn, mặc định `'Khac'`; tự xoá cache) |
| GET | `/api/tickets/categories` | Tìm danh sách danh mục phân biệt `?q=&limit=` (mặc định 20, tối đa 50) |
| GET | `/api/tickets/{id}` | Chi tiết vé |
| GET | `/api/tickets/stats` | Thống kê nặng mô phỏng `pg_sleep(0.5)`, cache Redis 60 s |
| GET | `/api/tickets/whoami` | Trả tên container xử lý (phục vụ đo cân bằng tải) |

---

## Lưu ý kỹ thuật khi bảo vệ
1. **Nginx phân giải DNS một lần khi nạp cấu hình:** Sau khi scale/tạo lại container (IP thay đổi), cần `nginx -s reload` (đã tích hợp sẵn trong `scripts/scale.sh`).
2. **Passive Health Check:** Nginx mã nguồn mở dùng `max_fails=2 fail_timeout=10s` và `proxy_next_upstream` để tự retry sang replica khoẻ mạnh khi một container chết đột ngột.
3. **Graceful Degradation:** Khi Redis gặp sự cố, `ticket-service` tự coi như cache miss và đọc trực tiếp PostgreSQL thay vì trả lỗi 500.
4. **Cổng 8080 bị chiếm:** Nếu khởi động báo trùng cổng, kiểm tra tiến trình đang chiếm bằng `sudo ss -tulpn | grep :8080`.
5. **Mật khẩu & SPOF:** Mật khẩu mặc định trong `docker-compose.yml` chỉ phục vụ demo (có thể đổi qua biến `POSTGRES_PASSWORD` trong `.env`); trong môi trường production cần đặt nhiều Gateway phía sau Load Balancer/VIP để tránh điểm lỗi đơn (SPOF).

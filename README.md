# Microservices + API Gateway + Load Balancing (Docker, Nginx, Redis)

Đồ án môn Hệ phân tán. Kiến trúc gồm 3 dịch vụ độc lập (Frontend React, User Service Node.js,
Ticket Service Python) đặt sau **Nginx API Gateway**; Redis làm cache; PostgreSQL lưu dữ liệu
(mỗi dịch vụ một database riêng).

```
Client ──► Nginx Gateway (:8080)
             ├── /            → frontend (Nginx tĩnh)
             ├── /api/users   → user-service (Node.js)   ──► PostgreSQL: users_db
             └── /api/tickets → ticket-service ×N (Flask) ──► PostgreSQL: tickets_db
                                                         └─► Redis (cache-aside)
```

Hai mạng Docker: `edge` (gateway ↔ dịch vụ) và `data` (dịch vụ ↔ PostgreSQL/Redis). Gateway không truy cập được DB.

## Yêu cầu
- Ubuntu 22.04 / 24.04 (hoặc Linux tương đương), cổng `8080` đang trống.
- Docker Engine + Docker Compose v2 (`docker compose version`), `git`, `python3`.

## Chạy trên Ubuntu (từng bước)

### 1. Cài đặt Docker, Docker Compose v2, Git và Python 3
```bash
sudo apt update
sudo apt install -y git python3 docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
newgrp docker

# Kiểm tra cài đặt
docker --version
docker compose version
```
*(Nếu vẫn báo lỗi quyền Docker sau `newgrp docker`, hãy đăng xuất và đăng nhập lại Ubuntu.)*

### 2. Tải mã nguồn và cấp quyền thực thi cho script
```bash
git clone https://github.com/anh-pc/doanhephantan.git
cd doanhephantan

# Cấp quyền chạy và chuẩn hoá ký tự xuống dòng (tránh lỗi CRLF khi push từ Windows)
chmod +x scripts/*.sh
sed -i 's/\r$//' scripts/*.sh
```

### 3. Khởi động hệ thống
```bash
docker compose up -d --build            # 1 bản sao mỗi dịch vụ
docker compose ps                       # kiểm tra toàn bộ container đã healthy/running
curl http://localhost:8080/healthz      # kỳ vọng: gateway ok
```
Mở trình duyệt truy cập **http://localhost:8080** (nếu chạy trên máy chủ từ xa thì thay `localhost` bằng IP của máy Ubuntu và mở cổng `8080` trên firewall nếu bật `ufw`: `sudo ufw allow 8080/tcp`).

### 4. Nếu máy đã từng chạy phiên bản cũ (đã có volume `pgdata`)
`db/init.sql` chỉ tự chạy khi tạo volume PostgreSQL mới. Khi cập nhật code mới trên volume cũ, chọn **1 trong 2** cách:

- **Cách A (giữ nguyên dữ liệu cũ):** chạy lệnh thêm cột `category`:
  ```bash
  docker compose exec -T postgres psql -U postgres -d tickets_db -c \
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS category VARCHAR(100) NOT NULL DEFAULT 'Khac';"
  ```
- **Cách B (tạo lại DB sạch với đầy đủ dữ liệu mẫu mới):**
  ```bash
  docker compose down -v
  docker compose up -d --build
  ```

### 5. Dừng và dọn dẹp
```bash
docker compose down      # dừng container, giữ lại dữ liệu PostgreSQL
docker compose down -v   # dừng container và xoá luôn dữ liệu PostgreSQL
```

## Kiểm thử tìm kiếm, lọc danh mục và phân trang
```bash
python3 scripts/test_search.py
# Hoặc chỉ định URL khác:
BASE_URL=http://localhost:8080 python3 scripts/test_search.py
```

## Demo scale + cân bằng tải
```bash
./scripts/scale.sh 3                    # = up --scale ticket-service=3 + nginx reload
docker compose ps ticket-service        # thấy 3 container
python3 scripts/lb_test.py --url http://localhost:8080 --n 300   # phân phối request theo replica
```
Hoặc bấm nút **"Gửi 30 request"** trên giao diện (cột `served_by` = tên container).

## Demo chịu lỗi (High Availability)
```bash
./scripts/kill-one.sh                   # dừng 1 replica
python3 scripts/lb_test.py --url http://localhost:8080 --n 300   # vẫn 0 lỗi, chỉ còn 2 replica nhận tải
docker compose logs gateway | grep -i "upstream"                 # xem nginx thử lại sang replica khác
./scripts/scale.sh 3                    # khôi phục lại đủ 3 bản sao
```

## Demo cache
```bash
docker compose exec redis redis-cli FLUSHALL
python3 scripts/cache_test.py --url http://localhost:8080 --n 50   # 1 MISS (~0,5 s) rồi HIT
```

## API
| Phương thức | Đường dẫn | Mô tả |
|---|---|---|
| GET/POST | `/api/users` | Danh sách / tạo người dùng |
| GET | `/api/users/{id}` | Chi tiết người dùng |
| GET | `/api/tickets` | Danh sách vé (cache 30 s khi không truyền tham số); hỗ trợ lọc/phân trang `?q=&category=&page=&page_size=` (đọc trực tiếp PostgreSQL) |
| POST | `/api/tickets` | Tạo vé mới (nhận thêm `category` tuỳ chọn, mặc định `'Khac'`; tự xoá cache) |
| GET | `/api/tickets/categories` | Tìm danh sách danh mục phân biệt `?q=&limit=` (mặc định 20, tối đa 50) |
| GET | `/api/tickets/{id}` | Chi tiết vé |
| GET | `/api/tickets/stats` | Thống kê "nặng" mô phỏng bằng `pg_sleep(0.5)`, cache 60 s |
| GET | `/api/tickets/whoami` | Trả về tên replica xử lý (phục vụ demo cân bằng tải) |

## Lưu ý kỹ thuật (quan trọng khi bảo vệ)
1. Nginx **phân giải DNS một lần khi nạp cấu hình**. Tên `ticket-service` trả về nhiều IP thì mỗi IP là
   một server trong upstream. Sau khi scale/tạo lại container (IP đổi) phải `nginx -s reload` (đã nằm trong `scale.sh`).
2. Nginx mã nguồn mở chỉ có **passive health check** (`max_fails`, `fail_timeout`). Health check chủ động là
   tính năng NGINX Plus.
3. Khi dừng đột ngột 1 container, vài request đầu có thể chậm thêm tới `proxy_connect_timeout` (1 s)
   trước khi Nginx chuyển sang replica khác; sau `max_fails` lần lỗi, server đó bị loại 10 s.
4. Mật khẩu PostgreSQL mặc định chỉ dành cho demo; đặt `POSTGRES_PASSWORD` trong file `.env` nếu cần.
5. Gateway là điểm lỗi đơn (SPOF) trong demo này; môi trường thật cần nhiều gateway + VIP/DNS/LB phía trên.
6. Dữ liệu `seed` trong `db/init.sql` là dữ liệu mẫu.

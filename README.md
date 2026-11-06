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
Docker Engine + Docker Compose v2 (`docker compose version`). Cổng 8080 trống.

## Chạy
```bash
docker compose up -d --build            # 1 bản sao mỗi dịch vụ
# mở http://localhost:8080
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
| GET/POST | /api/users | Danh sách / tạo người dùng |
| GET | /api/users/{id} | Chi tiết người dùng |
| GET/POST | /api/tickets | Danh sách (cache 30 s) / tạo vé (xoá cache) |
| GET | /api/tickets/{id} | Chi tiết vé |
| GET | /api/tickets/stats | Thống kê "nặng" mô phỏng bằng `pg_sleep(0.5)`, cache 60 s |
| GET | /api/tickets/whoami | Trả về tên replica xử lý (phục vụ demo cân bằng tải) |

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

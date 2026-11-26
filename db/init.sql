-- Database-per-service: mỗi dịch vụ sở hữu một database riêng biệt
CREATE DATABASE users_db;
CREATE DATABASE tickets_db;

\connect users_db
CREATE TABLE users (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  email      VARCHAR(150) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

INSERT INTO users (name, email, created_at) VALUES
  ('Nguyễn Minh Quân',   'quan.nguyen@vietticket.vn',     now() - interval '14 days'),
  ('Trần Thu Thảo',      'thuthao.tran@gmail.com',        now() - interval '11 days'),
  ('Lê Hoàng Nam',       'hoangnam.le@outlook.com',       now() - interval '9 days'),
  ('Phạm Khánh Linh',    'khanhlinh.pham@gmail.com',      now() - interval '7 days'),
  ('Võ Đức Trọng',       'ductrong.vo@techcorp.vn',       now() - interval '5 days'),
  ('Đặng Ngọc Ánh',      'ngocanh.dang@gmail.com',        now() - interval '3 days'),
  ('Bùi Tuấn Kiệt',      'tuankiet.bui@stu.edu.vn',       now() - interval '2 days'),
  ('Hoàng Mai Phương',   'maiphuong.hoang@vietticket.vn', now() - interval '6 hours');

\connect tickets_db
CREATE TABLE tickets (
  id         SERIAL PRIMARY KEY,
  event      VARCHAR(150) NOT NULL,
  price      NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  quantity   INTEGER NOT NULL CHECK (quantity >= 0),
  category   VARCHAR(100) NOT NULL DEFAULT 'Khac',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tickets_category ON tickets(category);

INSERT INTO tickets (event, price, quantity, category, created_at) VALUES
  ('Live Concert: Những Thành Phố Mơ Màng 2026 - TP.HCM',           850000, 320, 'Âm nhạc',   now() - interval '12 days'),
  ('Đêm nhạc Acoustic: Chuyện Của Mùa Đông - Hà Nội',               450000,  85, 'Âm nhạc',   now() - interval '11 days'),
  ('Vietnam Cloud & Microservices Summit 2026',                     350000, 200, 'Công nghệ', now() - interval '10 days'),
  ('Giải chạy VnExpress Marathon Midnight Hà Nội - Cự ly 21km',     790000, 450, 'Thể thao',  now() - interval '9 days'),
  ('Triển lãm Nghệ thuật Tương tác Đa giác quan Van Gogh',          380000, 190, 'Triển lãm', now() - interval '8 days'),
  ('Vở kịch: Ngày Xửa Ngày Xưa 36 - Nhà hát Bến Thành',             650000,  42, 'Sân khấu',  now() - interval '8 days'),
  ('Google DevFest Vietnam: AI & Hệ Phân Tán Hiện Đại',             150000, 280, 'Công nghệ', now() - interval '7 days'),
  ('Indie Night: Vũ. & Chillies Live Session',                      620000,   8, 'Âm nhạc',   now() - interval '6 days'),
  ('Stand-up Comedy: Sài Gòn Tếu - Đêm Hài Độc Thoại',              320000,   6, 'Sân khấu',  now() - interval '6 days'),
  ('Vé Cáp treo & Công viên Sun World Bà Nà Hills Đà Nẵng',         900000, 380, 'Giải trí',  now() - interval '5 days'),
  ('Chung kết Giải Bóng rổ VBA 2026 - Nhà thi đấu Hồ Xuân Hương',   420000,  95, 'Thể thao',  now() - interval '4 days'),
  ('Workshop Làm Gốm Thủ Công Bát Tràng Cuối Tuần',                 280000,  14, 'Workshop',  now() - interval '4 days'),
  ('Hoà nhạc Giao hưởng Ghibli & Anime - Nhà hát Lớn Hà Nội',       1200000, 54, 'Âm nhạc',   now() - interval '3 days'),
  ('V.League: Hà Nội FC vs Công An Hà Nội - Khán đài A',            250000, 160, 'Thể thao',  now() - interval '3 days'),
  ('Hội thảo Kiến trúc Hệ thống Chịu tải Cao cho Startup',          490000,  75, 'Công nghệ', now() - interval '2 days'),
  ('Tour Đêm Hoàng Thành Thăng Long - Giải mã Hoàng cung',          300000,  48, 'Giải trí',  now() - interval '2 days'),
  ('Workshop Pha chế Cà phê Specialty & Latte Art Cơ bản',          340000,   9, 'Workshop',  now() - interval '1 day'),
  ('Múa rối nước Thăng Long - Suất diễn đặc biệt tối Thứ Bảy',      200000,  90, 'Sân khấu',  now() - interval '12 hours');

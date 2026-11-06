-- Database-per-service: mỗi dịch vụ sở hữu một database riêng (cùng một PostgreSQL instance để gọn demo)
CREATE DATABASE users_db;
CREATE DATABASE tickets_db;

\connect users_db
CREATE TABLE users (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  email      VARCHAR(150) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
INSERT INTO users (name, email) VALUES
  ('Nguoi dung mau 01', 'user01@example.com'),
  ('Nguoi dung mau 02', 'user02@example.com');

\connect tickets_db
CREATE TABLE tickets (
  id         SERIAL PRIMARY KEY,
  event      VARCHAR(150) NOT NULL,
  price      NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  quantity   INTEGER NOT NULL CHECK (quantity >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Dữ liệu mẫu (seed) phục vụ demo, không phải dữ liệu thật
INSERT INTO tickets (event, price, quantity) VALUES
  ('Su kien mau A', 150000, 100),
  ('Su kien mau B', 250000, 50),
  ('Su kien mau C', 500000, 20);

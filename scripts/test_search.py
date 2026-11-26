#!/usr/bin/env python3
"""Kiểm thử tự động cho Ticket Service (API tìm kiếm/lọc/phân trang/cache)
và kiểm tra tự động các tiêu chí UX/WCAG tĩnh trên mã nguồn Frontend.

Chỉ dùng thư viện chuẩn Python (unittest + urllib + pathlib + re).
Chạy khi hệ thống đang khởi động:
    python3 scripts/test_search.py
Tuỳ chọn đổi URL gateway:
    BASE_URL=http://localhost:8080 python3 scripts/test_search.py
"""
import json
import os
from pathlib import Path
import re
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
PROJECT_ROOT = Path(__file__).resolve().parent.parent


def http_json(method, path, params=None, payload=None, timeout=10):
    url = BASE_URL + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            return resp.status, body, dict(resp.headers.items())
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            body = json.loads(raw)
        except Exception:
            body = {"raw": raw}
        return exc.code, body, dict(exc.headers.items())


def _rel_luminance(hex_color):
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    vals = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        vals.append(c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * vals[0] + 0.7152 * vals[1] + 0.0722 * vals[2]


def contrast_ratio(hex1, hex2):
    l1, l2 = _rel_luminance(hex1), _rel_luminance(hex2)
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)


class TestTicketSearch(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.prefix = f"tsearch-{int(time.time() * 1000)}"
        cls.cat_conf = f"{cls.prefix}-HoiThao"
        cls.cat_music = f"{cls.prefix}-AmNhac"
        cls.cat_special = f"{cls.prefix}-Cat_%_\\End"

        cls.created = []
        fixtures = [
            (f"{cls.prefix} Gala Dem Nhac", 150000, 10, cls.cat_music),
            (f"{cls.prefix} Hoi Nghi Cloud", 250000, 20, cls.cat_conf),
            (f"{cls.prefix} Hoi Nghi AI", 300000, 30, cls.cat_conf),
            (f"{cls.prefix} Giam 50% Hom Nay", 100000, 15, cls.cat_special),
            (f"{cls.prefix} Ma_Ve_VIP", 200000, 5, cls.cat_special),
            (f"{cls.prefix} Duong\\Dan\\Ve", 180000, 8, cls.cat_special),
        ]
        for i in range(1, 8):
            fixtures.append((f"{cls.prefix} PageItem {i:02d}", 100000 + i * 1000, i, cls.cat_conf))

        for event, price, qty, category in fixtures:
            status, body, _ = http_json(
                "POST",
                "/api/tickets",
                payload={"event": event, "price": price, "quantity": qty, "category": category},
            )
            assert status == 201, f"Seed ticket failed: {status} {body}"
            cls.created.append(body["ticket"])

    # AC1: tìm theo tên khớp một phần, không phân biệt hoa/thường, bỏ khoảng trắng đầu/cuối; rỗng = không lọc
    def test_ac1_search_by_name(self):
        status, body, _ = http_json("GET", "/api/tickets", {"q": f"  {self.prefix.upper()} hoi nghi  "})
        self.assertEqual(status, 200)
        events = [t["event"] for t in body["items"]]
        self.assertEqual(len(events), 2)
        self.assertTrue(all("Hoi Nghi" in e for e in events))

        status_empty, body_empty, headers_empty = http_json("GET", "/api/tickets", {"q": "   "})
        self.assertEqual(status_empty, 200)
        self.assertGreaterEqual(body_empty["total"], len(self.created))
        self.assertIn("X-Cache", headers_empty)
        self.assertIn(body_empty["cache"], ("HIT", "MISS"))

    # AC2: lọc theo category chính xác
    def test_ac2_filter_by_category(self):
        status, body, _ = http_json("GET", "/api/tickets", {"category": self.cat_music})
        self.assertEqual(status, 200)
        self.assertEqual(body["total"], 1)
        self.assertEqual(len(body["items"]), 1)
        self.assertEqual(body["items"][0]["category"], self.cat_music)

    # AC3: kết hợp cả q và category
    def test_ac3_combined_q_and_category(self):
        status, body, _ = http_json(
            "GET",
            "/api/tickets",
            {"q": f"{self.prefix} hoi nghi", "category": self.cat_conf},
        )
        self.assertEqual(status, 200)
        self.assertEqual(body["total"], 2)
        self.assertTrue(all(t["category"] == self.cat_conf for t in body["items"]))

        status_none, body_none, _ = http_json(
            "GET",
            "/api/tickets",
            {"q": f"{self.prefix} hoi nghi", "category": self.cat_music},
        )
        self.assertEqual(status_none, 200)
        self.assertEqual(body_none["items"], [])
        self.assertEqual(body_none["total"], 0)

    # AC4: phân trang, total/page/page_size/total_pages, tương thích ngược khi bỏ page & page_size
    def test_ac4_pagination_and_backward_compat(self):
        status, body_all, _ = http_json("GET", "/api/tickets", {"q": self.prefix})
        self.assertEqual(status, 200)
        self.assertEqual(body_all["total"], len(self.created))
        self.assertEqual(len(body_all["items"]), len(self.created))
        self.assertEqual(body_all["page"], 1)
        self.assertEqual(body_all["total_pages"], 1)
        self.assertIn("served_by", body_all)
        self.assertIn("elapsed_ms", body_all)

        status_p1, body_p1, _ = http_json("GET", "/api/tickets", {"q": self.prefix, "page": 1})
        self.assertEqual(status_p1, 200)
        self.assertEqual(body_p1["page"], 1)
        self.assertEqual(body_p1["page_size"], 10)
        self.assertEqual(body_p1["total"], len(self.created))
        self.assertEqual(body_p1["total_pages"], 2)
        self.assertEqual(len(body_p1["items"]), 10)

        status_p2, body_p2, _ = http_json("GET", "/api/tickets", {"q": self.prefix, "page": 2})
        self.assertEqual(status_p2, 200)
        self.assertEqual(body_p2["page"], 2)
        self.assertEqual(len(body_p2["items"]), len(self.created) - 10)
        ids_p1 = [t["id"] for t in body_p1["items"]]
        ids_p2 = [t["id"] for t in body_p2["items"]]
        self.assertEqual(ids_p1 + ids_p2, [t["id"] for t in body_all["items"]])

    # AC5: không có kết quả hoặc danh mục không tồn tại -> items rỗng, HTTP 200
    def test_ac5_empty_results_return_200(self):
        status_q, body_q, _ = http_json("GET", "/api/tickets", {"q": f"{self.prefix}-khong-ton-tai"})
        self.assertEqual(status_q, 200)
        self.assertEqual(body_q["items"], [])
        self.assertEqual(body_q["total"], 0)

        status_c, body_c, _ = http_json("GET", "/api/tickets", {"category": f"{self.prefix}-NoCat"})
        self.assertEqual(status_c, 200)
        self.assertEqual(body_c["items"], [])
        self.assertEqual(body_c["total"], 0)

    # AC6: escape ký tự đặc biệt ILIKE (%, _, \)
    def test_ac6_escape_ilike_special_chars(self):
        s_pct, b_pct, _ = http_json("GET", "/api/tickets", {"q": f"{self.prefix} Giam 50%"})
        self.assertEqual(s_pct, 200)
        self.assertEqual(b_pct["total"], 1)
        self.assertIn("50%", b_pct["items"][0]["event"])

        s_pct_cat, b_pct_cat, _ = http_json(
            "GET", "/api/tickets", {"q": "%", "category": self.cat_conf}
        )
        self.assertEqual(s_pct_cat, 200)
        self.assertEqual(b_pct_cat["items"], [])

        s_us, b_us, _ = http_json("GET", "/api/tickets", {"q": "_Ve_", "category": self.cat_special})
        self.assertEqual(s_us, 200)
        self.assertEqual(b_us["total"], 1)
        self.assertIn("Ma_Ve_VIP", b_us["items"][0]["event"])

        s_bs, b_bs, _ = http_json("GET", "/api/tickets", {"q": "Duong\\Dan", "category": self.cat_special})
        self.assertEqual(s_bs, 200)
        self.assertEqual(b_bs["total"], 1)
        self.assertIn("Duong\\Dan\\Ve", b_bs["items"][0]["event"])

    # AC10 (backend): GET /api/tickets/categories?q=&limit=
    def test_ac10_categories_endpoint(self):
        status, body, _ = http_json("GET", "/api/tickets/categories", {"q": self.prefix.lower(), "limit": 20})
        self.assertEqual(status, 200)
        self.assertIn(self.cat_conf, body["items"])
        self.assertIn(self.cat_music, body["items"])
        self.assertIn(self.cat_special, body["items"])
        self.assertEqual(len(body["items"]), len(set(body["items"])))

        s_esc, b_esc, _ = http_json("GET", "/api/tickets/categories", {"q": f"{self.prefix}-Cat_%_\\"})
        self.assertEqual(s_esc, 200)
        self.assertEqual(b_esc["items"], [self.cat_special])

        s_lim, b_lim, _ = http_json("GET", "/api/tickets/categories", {"q": self.prefix, "limit": 1})
        self.assertEqual(s_lim, 200)
        self.assertEqual(len(b_lim["items"]), 1)

        s_none, b_none, _ = http_json("GET", "/api/tickets/categories", {"q": f"{self.prefix}-khongco"})
        self.assertEqual(s_none, 200)
        self.assertEqual(b_none["items"], [])

    # AC15: nhất quán giữa các bản sao và thấy ngay sau POST (không bị cache cũ làm lệch)
    def test_ac15_distributed_consistency_after_create(self):
        http_json("GET", "/api/tickets")
        s_hit, b_hit, _ = http_json("GET", "/api/tickets")
        self.assertEqual(s_hit, 200)
        self.assertEqual(b_hit["cache"], "HIT")

        fresh_prefix = f"ac15-{int(time.time() * 1000)}"
        unique_event = f"{fresh_prefix} FreshTicket"
        fresh_cat = f"{fresh_prefix}-Cat"
        s_post, b_post, _ = http_json(
            "POST",
            "/api/tickets",
            payload={"event": unique_event, "price": 99000, "quantity": 7, "category": fresh_cat},
        )
        self.assertEqual(s_post, 201)
        new_id = b_post["ticket"]["id"]

        for _ in range(6):
            s_search, b_search, h_search = http_json(
                "GET", "/api/tickets", {"q": unique_event, "category": fresh_cat}
            )
            self.assertEqual(s_search, 200)
            self.assertEqual(h_search.get("X-Cache"), "BYPASS")
            self.assertEqual([t["id"] for t in b_search["items"]], [new_id])

        s_list, b_list, _ = http_json("GET", "/api/tickets")
        self.assertEqual(s_list, 200)
        self.assertTrue(any(t["id"] == new_id for t in b_list["items"]))

    # Kẹp biên phân trang & chống SQLi + kiểm tra hợp lệ đầu vào (AC36 phía server)
    def test_bounds_validation_and_sqli(self):
        for bad_page in ("0", "-5", "abc"):
            s, b, _ = http_json("GET", "/api/tickets", {"q": self.prefix, "page": bad_page, "page_size": 5})
            self.assertEqual(s, 200)
            self.assertEqual(b["page"], 1)

        s_big, b_big, _ = http_json("GET", "/api/tickets", {"q": self.prefix, "page": 9999, "page_size": 5})
        self.assertEqual(s_big, 200)
        self.assertEqual(b_big["page"], b_big["total_pages"])

        s_ps, b_ps, _ = http_json("GET", "/api/tickets", {"q": self.prefix, "page": 1, "page_size": 500})
        self.assertEqual(s_ps, 200)
        self.assertEqual(b_ps["page_size"], 100)

        s_sqli, b_sqli, _ = http_json("GET", "/api/tickets", {"q": "' OR 1=1 --"})
        self.assertEqual(s_sqli, 200)
        self.assertEqual(b_sqli["items"], [])

        s_over, _, _ = http_json(
            "POST",
            "/api/tickets",
            payload={"event": "E" * 151, "price": 10000, "quantity": 1},
        )
        self.assertEqual(s_over, 400)

    def test_seed_data_if_present(self):
        status, body, _ = http_json("GET", "/api/tickets", {"q": "Su kien mau"})
        self.assertEqual(status, 200)
        by_event = {t["event"]: t for t in body["items"]}
        if "Su kien mau A" in by_event:
            self.assertEqual(by_event["Su kien mau A"]["category"], "Hoi thao")
            self.assertEqual(by_event["Su kien mau B"]["category"], "Hoi thao")
            self.assertEqual(by_event["Su kien mau C"]["category"], "Am nhac")

    def test_users_crud_if_available(self):
        try:
            s_health, _, _ = http_json("GET", "/api/users/health", timeout=3)
        except Exception:
            self.skipTest("User service không chạy trong môi trường test độc lập")
        if s_health != 200:
            self.skipTest("User service không khả dụng trên gateway hiện tại")

        uid_tag = int(time.time() * 1000)
        s_create, b_create, _ = http_json(
            "POST",
            "/api/users",
            payload={"name": f"User {uid_tag}", "email": f"u{uid_tag}@example.com"},
        )
        self.assertEqual(s_create, 201)
        uid = b_create["user"]["id"]

        s_upd, b_upd, _ = http_json(
            "PUT",
            f"/api/users/{uid}",
            payload={"name": f"Updated {uid_tag}", "email": f"upd{uid_tag}@example.com"},
        )
        self.assertEqual(s_upd, 200)
        self.assertEqual(b_upd["user"]["name"], f"Updated {uid_tag}")

        s_del, _, _ = http_json("DELETE", f"/api/users/{uid}")
        self.assertEqual(s_del, 200)

        s_get, _, _ = http_json("GET", f"/api/users/{uid}")
        self.assertEqual(s_get, 404)


class TestFrontendUXStatic(unittest.TestCase):
    """Kiểm tra tự động các tiêu chí UX / WCAG có thể xác minh tĩnh trên mã nguồn Frontend."""

    @classmethod
    def setUpClass(cls):
        cls.app_jsx = (PROJECT_ROOT / "frontend" / "src" / "App.jsx").read_text(encoding="utf-8")
        cls.styles_css = (PROJECT_ROOT / "frontend" / "src" / "styles.css").read_text(encoding="utf-8")
        cls.index_html = (PROJECT_ROOT / "frontend" / "index.html").read_text(encoding="utf-8")

    # AC16, AC17: tiêu đề tiếng Việt, đủ <label>, thông tin kỹ thuật thu gọn mặc định trong <details>
    def test_ux_labels_headings_and_tech_details(self):
        self.assertIn("Quản lý vé", self.app_jsx)
        self.assertIn("Quản lý người dùng", self.app_jsx)
        self.assertGreaterEqual(len(re.findall(r"<label\b", self.app_jsx)), 8)
        self.assertIn("<details", self.app_jsx)
        self.assertIn("Thông tin kỹ thuật (dành cho demo)", self.app_jsx)
        self.assertIn("<LoadBalancer />", self.app_jsx)

    # AC22, AC24, AC25, AC27: cỡ chữ >= 14px, line-height >= 1.4, không outline:none, min-height 44px, reduced-motion
    def test_ux_typography_focus_touch_and_motion(self):
        font_sizes = [int(m) for m in re.findall(r"font-size:\s*(\d+)px", self.styles_css)]
        self.assertTrue(font_sizes, "Không tìm thấy khai báo font-size")
        self.assertGreaterEqual(min(font_sizes), 14)

        line_heights = [float(m) for m in re.findall(r"line-height:\s*([0-9.]+)", self.styles_css)]
        self.assertTrue(line_heights, "Không tìm thấy khai báo line-height")
        self.assertGreaterEqual(min(line_heights), 1.4)

        self.assertIsNone(re.search(r"outline\s*:\s*(none|0)\b", self.styles_css))
        self.assertIn(":focus-visible", self.styles_css)
        self.assertIn("min-height: 44px", self.styles_css)
        self.assertIn("prefers-reduced-motion: reduce", self.styles_css)

    # AC23: kiểm tra toán học độ tương phản màu WCAG 2.1 AA (chữ >= 4.5:1, viền ô nhập/nút >= 3:1)
    def test_ux_wcag_contrast_ratios(self):
        css_vars = dict(re.findall(r"(--color-[a-z-]+):\s*(#[0-9a-fA-F]{3,6})", self.styles_css))
        surface = css_vars["--color-surface"]
        bg = css_vars["--color-bg"]
        self.assertGreaterEqual(contrast_ratio(css_vars["--color-text"], surface), 4.5)
        self.assertGreaterEqual(contrast_ratio(css_vars["--color-text-muted"], surface), 4.5)
        self.assertGreaterEqual(contrast_ratio(css_vars["--color-text-muted"], bg), 4.5)
        self.assertGreaterEqual(contrast_ratio("#ffffff", css_vars["--color-accent"]), 4.5)
        self.assertGreaterEqual(contrast_ratio(css_vars["--color-accent-text"], css_vars["--color-accent-soft"]), 4.5)
        self.assertGreaterEqual(contrast_ratio(css_vars["--color-danger"], css_vars["--color-danger-bg"]), 4.5)
        self.assertGreaterEqual(contrast_ratio(css_vars["--color-success"], css_vars["--color-success-bg"]), 4.5)
        # Viền điều khiển >= 3:1 (WCAG 1.4.11)
        self.assertGreaterEqual(contrast_ratio(css_vars["--color-control-border"], surface), 3.0)
        self.assertGreaterEqual(contrast_ratio(css_vars["--color-control-border"], bg), 3.0)

    # AC26, AC30, AC34, AC35, AC36, AC37, AC38: ARIA, thông báo lỗi chuẩn, hướng dẫn, bảo mật & quyền riêng tư
    def test_ux_aria_messages_and_security(self):
        self.assertIn('aria-live="polite"', self.app_jsx)
        self.assertIn('role="alert"', self.app_jsx)
        self.assertIn("Không kết nối được máy chủ. Vui lòng thử lại sau.", self.app_jsx)
        self.assertIn("Hướng dẫn nhanh", self.app_jsx)
        self.assertIn("Cần hỗ trợ? Liên hệ quản trị viên hệ thống.", self.app_jsx)
        self.assertIn("Thông tin chỉ dùng để quản lý vé trong hệ thống này.", self.app_jsx)
        self.assertIn("Bộ nhớ đệm", self.app_jsx)
        self.assertIn("Cơ sở dữ liệu", self.app_jsx)
        self.assertIn("maxLength={100}", self.app_jsx)
        self.assertIn("maxLength={150}", self.app_jsx)
        self.assertNotIn("dangerouslySetInnerHTML", self.app_jsx)
        self.assertNotIn("localStorage", self.app_jsx)
        for src in (self.index_html, self.styles_css, self.app_jsx):
            cleaned = re.sub(r"https://github\.com/anh-pc/doanhephantan(\.git)?", "", src)
            self.assertIsNone(re.search(r"https?://", cleaned))


if __name__ == "__main__":
    unittest.main(verbosity=2)

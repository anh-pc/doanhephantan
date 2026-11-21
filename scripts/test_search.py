#!/usr/bin/env python3
"""Kiểm thử tự động API tìm kiếm, lọc danh mục, phân trang và cache cho Ticket Service.

Chỉ dùng thư viện chuẩn Python (unittest + urllib).
Chạy với hệ thống đang khởi động:
    python3 scripts/test_search.py
Tuỳ chọn đổi URL gateway:
    BASE_URL=http://localhost:8080 python3 scripts/test_search.py
"""
import json
import os
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")


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
        # Thêm thêm vé để kiểm thử phân trang (> 10 vé thuộc prefix)
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

        # Từ khoá rỗng / chỉ khoảng trắng -> không lọc, vẫn giữ tương thích ngược và cache-aside
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
        # Không truyền page & page_size -> trả toàn bộ vé khớp (13 vé) + có total
        status, body_all, _ = http_json("GET", "/api/tickets", {"q": self.prefix})
        self.assertEqual(status, 200)
        self.assertEqual(body_all["total"], len(self.created))
        self.assertEqual(len(body_all["items"]), len(self.created))
        self.assertEqual(body_all["page"], 1)
        self.assertEqual(body_all["total_pages"], 1)
        self.assertIn("served_by", body_all)
        self.assertIn("elapsed_ms", body_all)

        # Chỉ truyền page=1 -> page_size mặc định 10
        status_p1, body_p1, _ = http_json("GET", "/api/tickets", {"q": self.prefix, "page": 1})
        self.assertEqual(status_p1, 200)
        self.assertEqual(body_p1["page"], 1)
        self.assertEqual(body_p1["page_size"], 10)
        self.assertEqual(body_p1["total"], len(self.created))
        self.assertEqual(body_p1["total_pages"], 2)
        self.assertEqual(len(body_p1["items"]), 10)

        # Trang 2 giữ thứ tự ổn định theo id, không trùng lặp với trang 1
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
        # Tìm '%' chỉ khớp vé chứa ký tự '%' thật, không khớp tất cả vé
        s_pct, b_pct, _ = http_json("GET", "/api/tickets", {"q": f"{self.prefix} Giam 50%"})
        self.assertEqual(s_pct, 200)
        self.assertEqual(b_pct["total"], 1)
        self.assertIn("50%", b_pct["items"][0]["event"])

        # Tìm '%' đơn lẻ trong phạm vi category chứa nhiều vé -> không khớp vé không có '%'
        s_pct_cat, b_pct_cat, _ = http_json(
            "GET", "/api/tickets", {"q": "%", "category": self.cat_conf}
        )
        self.assertEqual(s_pct_cat, 200)
        self.assertEqual(b_pct_cat["items"], [])

        # Tìm '_' khớp đúng vé có '_'
        s_us, b_us, _ = http_json("GET", "/api/tickets", {"q": "_Ve_", "category": self.cat_special})
        self.assertEqual(s_us, 200)
        self.assertEqual(b_us["total"], 1)
        self.assertIn("Ma_Ve_VIP", b_us["items"][0]["event"])

        # Tìm '\' khớp đúng vé có '\'
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
        # Không trùng lặp
        self.assertEqual(len(body["items"]), len(set(body["items"])))

        # Escape ký tự đặc biệt trong tìm kiếm danh mục
        s_esc, b_esc, _ = http_json("GET", "/api/tickets/categories", {"q": f"{self.prefix}-Cat_%_\\"})
        self.assertEqual(s_esc, 200)
        self.assertEqual(b_esc["items"], [self.cat_special])

        # Giới hạn limit
        s_lim, b_lim, _ = http_json("GET", "/api/tickets/categories", {"q": self.prefix, "limit": 1})
        self.assertEqual(s_lim, 200)
        self.assertEqual(len(b_lim["items"]), 1)

        # Không có danh mục khớp -> rỗng, 200
        s_none, b_none, _ = http_json("GET", "/api/tickets/categories", {"q": f"{self.prefix}-khongco"})
        self.assertEqual(s_none, 200)
        self.assertEqual(b_none["items"], [])

    # AC15: nhất quán giữa các bản sao và thấy ngay sau POST (không bị cache cũ làm lệch)
    def test_ac15_distributed_consistency_after_create(self):
        # Đổ đầy cache tickets:list trước
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

        # Gọi nhiều lần qua load balancer để đi qua nhiều replica (nếu scale > 1)
        for _ in range(6):
            s_search, b_search, h_search = http_json(
                "GET", "/api/tickets", {"q": unique_event, "category": fresh_cat}
            )
            self.assertEqual(s_search, 200)
            self.assertEqual(h_search.get("X-Cache"), "BYPASS")
            self.assertEqual([t["id"] for t in b_search["items"]], [new_id])

        # Danh sách không lọc cũng đã xoá cache và thấy ngay vé mới
        s_list, b_list, _ = http_json("GET", "/api/tickets")
        self.assertEqual(s_list, 200)
        self.assertTrue(any(t["id"] == new_id for t in b_list["items"]))

    # AC20 (server): page không hợp lệ -> 200 (không 4xx); page_size > 100 bị giới hạn về 100
    def test_ac20_invalid_page_and_page_size_bounds(self):
        for bad_page in ("0", "-5", "abc"):
            s, b, _ = http_json("GET", "/api/tickets", {"q": self.prefix, "page": bad_page, "page_size": 5})
            self.assertEqual(s, 200)
            self.assertEqual(b["page"], 1)

        # page quá lớn -> tự đưa về trang cuối
        s_big, b_big, _ = http_json("GET", "/api/tickets", {"q": self.prefix, "page": 9999, "page_size": 5})
        self.assertEqual(s_big, 200)
        self.assertEqual(b_big["page"], b_big["total_pages"])
        self.assertGreater(len(b_big["items"]), 0)

        # page_size > 100 -> bị giới hạn về 100
        s_ps, b_ps, _ = http_json("GET", "/api/tickets", {"q": self.prefix, "page": 1, "page_size": 500})
        self.assertEqual(s_ps, 200)
        self.assertEqual(b_ps["page_size"], 100)

    # AC21 (server): q dài > 100 ký tự không gây 5xx; SQL injection coi là từ khoá thường -> rỗng, 200
    def test_ac21_security_sanitization_and_sqli(self):
        long_q = "a" * 250 + "\x00\x07\n"
        s_long, b_long, _ = http_json("GET", "/api/tickets", {"q": long_q})
        self.assertEqual(s_long, 200)
        self.assertIsInstance(b_long["items"], list)

        s_sqli, b_sqli, _ = http_json("GET", "/api/tickets", {"q": "' OR 1=1 --"})
        self.assertEqual(s_sqli, 200)
        self.assertEqual(b_sqli["items"], [])
        self.assertEqual(b_sqli["total"], 0)

    # Kiểm tra dữ liệu mẫu mặc định khi chạy trên DB sạch
    def test_seed_data_if_present(self):
        status, body, _ = http_json("GET", "/api/tickets", {"q": "Su kien mau"})
        self.assertEqual(status, 200)
        by_event = {t["event"]: t for t in body["items"]}
        if "Su kien mau A" in by_event:
            self.assertEqual(by_event["Su kien mau A"]["category"], "Hoi thao")
            self.assertEqual(by_event["Su kien mau B"]["category"], "Hoi thao")
            self.assertEqual(by_event["Su kien mau C"]["category"], "Am nhac")


if __name__ == "__main__":
    unittest.main(verbosity=2)

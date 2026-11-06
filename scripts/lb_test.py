#!/usr/bin/env python3
"""Kiểm thử phân phối tải & độ trễ qua gateway (chỉ dùng thư viện chuẩn).

Ví dụ:
  python3 scripts/lb_test.py --url http://localhost:8080 --n 300
Đầu ra: số request mỗi replica, tỉ lệ lỗi, độ trễ trung bình/p50/p95/max.
"""
import argparse, json, statistics, time, urllib.request, urllib.error
from collections import Counter

def get(url, timeout=10):
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            body = json.loads(r.read().decode())
            return r.status, body, (time.perf_counter() - t0) * 1000, r.headers.get("X-Cache")
    except urllib.error.HTTPError as e:
        return e.code, {}, (time.perf_counter() - t0) * 1000, None
    except Exception:
        return 0, {}, (time.perf_counter() - t0) * 1000, None

def pct(sorted_vals, p):
    return sorted_vals[min(len(sorted_vals) - 1, int(round(p / 100 * (len(sorted_vals) - 1))))]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8080")
    ap.add_argument("--n", type=int, default=300)
    ap.add_argument("--path", default="/api/tickets/whoami")
    a = ap.parse_args()

    served, lat, errors = Counter(), [], 0
    for _ in range(a.n):
        status, body, ms, _ = get(a.url + a.path)
        lat.append(ms)
        if status == 200: served[body.get("served_by", "?")] += 1
        else: errors += 1
    lat.sort()
    print(f"Path: {a.path}  | Tổng request: {a.n} | Lỗi: {errors} ({errors / a.n:.1%})")
    for k, v in sorted(served.items()): print(f"  {k:20s} {v:5d}  ({v / a.n:.1%})")
    print(f"Độ trễ ms: avg={statistics.mean(lat):.1f}  p50={pct(lat,50):.1f}  p95={pct(lat,95):.1f}  max={lat[-1]:.1f}")

if __name__ == "__main__":
    main()

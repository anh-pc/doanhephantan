#!/usr/bin/env python3
"""So sánh độ trễ truy vấn nặng /api/tickets/stats: MISS (truy vấn DB) và HIT (Redis)."""
import argparse, statistics, subprocess, sys, json, time, urllib.request

ap = argparse.ArgumentParser()
ap.add_argument("--url", default="http://localhost:8080")
ap.add_argument("--n", type=int, default=50)
a = ap.parse_args()

def call():
    t0 = time.perf_counter()
    with urllib.request.urlopen(a.url + "/api/tickets/stats", timeout=10) as r:
        body = json.loads(r.read().decode())
    return body["cache"], (time.perf_counter() - t0) * 1000

hits, misses = [], []
for _ in range(a.n):
    c, ms = call()
    (hits if c == "HIT" else misses).append(ms)
def fmt(x): return f"n={len(x)} avg={statistics.mean(x):.1f} ms" if x else "n=0"
print("MISS:", fmt(misses)); print("HIT :", fmt(hits))
print("Gợi ý: để đo MISS nhiều lần, chạy `docker compose exec redis redis-cli FLUSHALL` trước mỗi lần.")

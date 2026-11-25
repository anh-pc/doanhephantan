"""Ticket Service - Flask + PostgreSQL + Redis (cache-aside).

Dịch vụ KHÔNG giữ trạng thái (stateless): dữ liệu bền vững ở PostgreSQL,
dữ liệu cache ở Redis dùng chung -> có thể chạy nhiều bản sao (replica) phía sau load balancer.
"""
import json
import math
import os
import socket
import time
import unicodedata

import redis
from flask import Flask, jsonify, request
from psycopg2 import pool
from psycopg2.extras import RealDictCursor
from werkzeug.exceptions import HTTPException

app = Flask(__name__)

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@postgres:5432/tickets_db")
REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")
LIST_TTL = int(os.environ.get("LIST_TTL", "30"))    # giây
STATS_TTL = int(os.environ.get("STATS_TTL", "60"))  # giây
HOSTNAME = os.environ.get("INSTANCE_NAME") or socket.gethostname()

MAX_TEXT_LEN = 100
MAX_EVENT_LEN = 150
DEFAULT_CATEGORY = "Khac"
DEFAULT_PAGE_SIZE = 10
MAX_PAGE_SIZE = 100
DEFAULT_CAT_LIMIT = 20
MAX_CAT_LIMIT = 50

_pool = None
_redis = redis.Redis.from_url(REDIS_URL, decode_responses=True,
                              socket_connect_timeout=1, socket_timeout=1)


def db():
    """Connection pool PostgreSQL (tạo lười; mỗi tiến trình gunicorn có một pool)."""
    global _pool
    if _pool is None:
        _pool = pool.ThreadedConnectionPool(1, 5, DATABASE_URL)
    return _pool


def query(sql, params=None, fetch=True, commit=False):
    p = db()
    conn = p.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            rows = cur.fetchall() if fetch else None
        if commit:
            conn.commit()
        else:
            conn.rollback()
        return rows
    except Exception:
        conn.rollback()
        raise
    finally:
        p.putconn(conn)


def cache_get(key):
    """Redis lỗi -> coi như cache miss (suy giảm êm, hệ thống vẫn chạy)."""
    try:
        raw = _redis.get(key)
        return json.loads(raw) if raw else None
    except redis.RedisError:
        return None


def cache_set(key, value, ttl):
    try:
        _redis.setex(key, ttl, json.dumps(value))
    except redis.RedisError:
        pass


def cache_delete(*keys):
    try:
        _redis.delete(*keys)
    except redis.RedisError:
        pass


def clean_text(raw, max_len=MAX_TEXT_LEN):
    """Loại bỏ ký tự điều khiển, bỏ khoảng trắng đầu/cuối và cắt độ dài tối đa."""
    if raw is None:
        return ""
    cleaned = "".join(ch for ch in str(raw) if unicodedata.category(ch) != "Cc")
    return cleaned.strip()[:max_len].strip()


def escape_like(value):
    """Escape ký tự đặc biệt của ILIKE (\\, %, _) để khớp như ký tự thường."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def parse_bounded_int(raw, default, min_val, max_val=None):
    if raw is None or str(raw).strip() == "":
        return default
    try:
        val = int(str(raw).strip())
    except ValueError:
        return default
    if val < min_val:
        val = min_val
    if max_val is not None and val > max_val:
        val = max_val
    return val


def serialize(row):
    return {
        "id": row["id"],
        "event": row["event"],
        "price": float(row["price"]),
        "quantity": row["quantity"],
        "category": row.get("category") or DEFAULT_CATEGORY,
        "created_at": row["created_at"].isoformat(),
    }


@app.errorhandler(Exception)
def handle_unexpected_error(err):
    if isinstance(err, HTTPException):
        return jsonify(error=err.description), err.code
    app.logger.error("Unhandled server error: %s", type(err).__name__)
    return jsonify(error="Lỗi hệ thống nội bộ"), 500


@app.get("/api/tickets/health")
def health():
    return jsonify(status="ok", served_by=HOSTNAME)


@app.get("/api/tickets/whoami")
def whoami():
    return jsonify(served_by=HOSTNAME)


@app.get("/api/tickets/categories")
def list_categories():
    q = clean_text(request.args.get("q"), MAX_TEXT_LEN)
    limit = parse_bounded_int(request.args.get("limit"), DEFAULT_CAT_LIMIT, 1, MAX_CAT_LIMIT)
    if q:
        rows = query(
            "SELECT DISTINCT category FROM tickets "
            "WHERE category ILIKE %s ESCAPE '\\' "
            "ORDER BY category ASC LIMIT %s",
            (f"%{escape_like(q)}%", limit),
        )
    else:
        rows = query(
            "SELECT DISTINCT category FROM tickets ORDER BY category ASC LIMIT %s",
            (limit,),
        )
    items = [r["category"] for r in rows]
    return jsonify(items=items, total=len(items), served_by=HOSTNAME)


@app.get("/api/tickets")
def list_tickets():
    t0 = time.perf_counter()
    q = clean_text(request.args.get("q"), MAX_TEXT_LEN)
    category = clean_text(request.args.get("category"), MAX_TEXT_LEN)
    raw_page = request.args.get("page")
    raw_page_size = request.args.get("page_size")

    has_page = raw_page is not None and raw_page.strip() != ""
    has_page_size = raw_page_size is not None and raw_page_size.strip() != ""
    has_params = bool(q or category or has_page or has_page_size)

    if not has_params:
        data = cache_get("tickets:list")
        status = "HIT"
        if data is None:
            status = "MISS"
            data = [serialize(r) for r in query("SELECT * FROM tickets ORDER BY id ASC")]
            cache_set("tickets:list", data, LIST_TTL)
        total = len(data)
        page = 1
        page_size = total
        total_pages = 1 if total > 0 else 0
    else:
        status = "BYPASS"
        clauses = []
        params = []
        if q:
            clauses.append("event ILIKE %s ESCAPE '\\'")
            params.append(f"%{escape_like(q)}%")
        if category:
            clauses.append("category = %s")
            params.append(category)
        where_sql = (" WHERE " + " AND ".join(clauses)) if clauses else ""

        if has_page or has_page_size:
            page_size = parse_bounded_int(raw_page_size, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE)
            count_row = query(f"SELECT COUNT(*) AS cnt FROM tickets{where_sql}", tuple(params) or None)[0]
            total = int(count_row["cnt"])
            total_pages = (total + page_size - 1) // page_size if total > 0 else 0
            req_page = parse_bounded_int(raw_page, 1, 1)
            page = min(req_page, total_pages) if total_pages > 0 else 1
            if total == 0:
                data = []
            else:
                offset = (page - 1) * page_size
                rows = query(
                    f"SELECT * FROM tickets{where_sql} ORDER BY id ASC LIMIT %s OFFSET %s",
                    tuple(params) + (page_size, offset),
                )
                data = [serialize(r) for r in rows]
        else:
            rows = query(
                f"SELECT * FROM tickets{where_sql} ORDER BY id ASC",
                tuple(params) or None,
            )
            data = [serialize(r) for r in rows]
            total = len(data)
            page = 1
            page_size = total
            total_pages = 1 if total > 0 else 0

    resp = jsonify(
        items=data,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        cache=status,
        served_by=HOSTNAME,
        elapsed_ms=round((time.perf_counter() - t0) * 1000, 2),
    )
    resp.headers["X-Cache"] = status
    return resp


@app.get("/api/tickets/stats")
def stats():
    """Truy vấn 'nặng' MÔ PHỎNG: pg_sleep(0.5) giả lập phép tổng hợp tốn thời gian."""
    t0 = time.perf_counter()
    data = cache_get("tickets:stats")
    status = "HIT"
    if data is None:
        status = "MISS"
        row = query("""SELECT count(*) AS events, COALESCE(sum(quantity),0) AS total_tickets,
                              COALESCE(sum(price*quantity),0) AS potential_revenue
                       FROM tickets, pg_sleep(0.5)""")[0]
        data = {"events": int(row["events"]), "total_tickets": int(row["total_tickets"]),
                "potential_revenue": float(row["potential_revenue"])}
        cache_set("tickets:stats", data, STATS_TTL)
    resp = jsonify(stats=data, cache=status, served_by=HOSTNAME,
                   elapsed_ms=round((time.perf_counter() - t0) * 1000, 2))
    resp.headers["X-Cache"] = status
    return resp


@app.get("/api/tickets/<int:ticket_id>")
def get_ticket(ticket_id):
    rows = query("SELECT * FROM tickets WHERE id=%s", (ticket_id,))
    if not rows:
        return jsonify(error="not found"), 404
    return jsonify(ticket=serialize(rows[0]), served_by=HOSTNAME)


@app.post("/api/tickets")
def create_ticket():
    body = request.get_json(silent=True) or {}
    raw_event = body.get("event", "")
    raw_category = body.get("category")
    event = "".join(ch for ch in str(raw_event or "") if unicodedata.category(ch) != "Cc").strip()
    cat_clean = "".join(ch for ch in str(raw_category or "") if unicodedata.category(ch) != "Cc").strip()
    if len(event) > MAX_EVENT_LEN or len(cat_clean) > MAX_TEXT_LEN:
        return jsonify(error="dữ liệu vượt quá độ dài cho phép"), 400
    category = cat_clean or DEFAULT_CATEGORY

    raw_price = body.get("price")
    raw_qty = body.get("quantity")
    if isinstance(raw_price, bool) or isinstance(raw_qty, bool):
        return jsonify(error="price và quantity phải là số"), 400
    try:
        price = float(raw_price)
        quantity = int(raw_qty)
        if float(raw_qty) != quantity:
            return jsonify(error="quantity phải là số nguyên"), 400
    except (TypeError, ValueError):
        return jsonify(error="price và quantity phải là số"), 400
    if not math.isfinite(price) or not event or price < 0 or price > 9999999999.99 or quantity < 0:
        return jsonify(error="dữ liệu không hợp lệ"), 400
    row = query(
        "INSERT INTO tickets (event, price, quantity, category) VALUES (%s,%s,%s,%s) RETURNING *",
        (event, price, quantity, category),
        commit=True,
    )[0]
    cache_delete("tickets:list", "tickets:stats")  # vô hiệu hoá cache khi dữ liệu đổi
    return jsonify(ticket=serialize(row), served_by=HOSTNAME), 201

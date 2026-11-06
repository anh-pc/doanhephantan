import { useEffect, useState } from 'react';

// Frontend chỉ biết MỘT địa chỉ: gateway (đường dẫn tương đối /api/...)
async function api(path, options) {
  const t0 = performance.now();
  const res = await fetch(path, options);
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body, ms: Math.round(performance.now() - t0),
           upstream: res.headers.get('X-Upstream-Addr'), cache: res.headers.get('X-Cache') };
}

function Users() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ name: '', email: '' });
  const [msg, setMsg] = useState('');
  const load = async () => setItems((await api('/api/users')).body.items ?? []);
  useEffect(() => { load(); }, []);
  const submit = async (e) => {
    e.preventDefault();
    const r = await api('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    setMsg(r.ok ? `Đã tạo (served_by ${r.body.served_by})` : r.body.error);
    if (r.ok) { setForm({ name: '', email: '' }); load(); }
  };
  return (
    <section className="card"><h2>User Service <small>/api/users</small></h2>
      <ul>{items.map(u => <li key={u.id}>#{u.id} {u.name} — {u.email}</li>)}</ul>
      <form onSubmit={submit}>
        <input placeholder="Tên" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        <input placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
        <button>Thêm</button>
      </form><p className="msg">{msg}</p>
    </section>
  );
}

function Tickets() {
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState(null);
  const [form, setForm] = useState({ event: '', price: '', quantity: '' });
  const [msg, setMsg] = useState('');
  const load = async () => { const r = await api('/api/tickets'); setItems(r.body.items ?? []);
    setMeta({ cache: r.cache, ms: r.ms, upstream: r.upstream, by: r.body.served_by }); };
  useEffect(() => { load(); }, []);
  const submit = async (e) => {
    e.preventDefault();
    const r = await api('/api/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    setMsg(r.ok ? `Đã tạo (served_by ${r.body.served_by})` : r.body.error);
    if (r.ok) { setForm({ event: '', price: '', quantity: '' }); load(); }
  };
  return (
    <section className="card"><h2>Ticket Service <small>/api/tickets</small></h2>
      {meta && <p className="meta">cache: <b>{meta.cache}</b> · {meta.ms} ms · replica: <b>{meta.by}</b></p>}
      <ul>{items.map(t => <li key={t.id}>#{t.id} {t.event} — {t.price.toLocaleString('vi-VN')}đ × {t.quantity}</li>)}</ul>
      <button onClick={load}>Tải lại</button>
      <form onSubmit={submit}>
        <input placeholder="Sự kiện" value={form.event} onChange={e => setForm({ ...form, event: e.target.value })} />
        <input placeholder="Giá" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} />
        <input placeholder="Số lượng" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} />
        <button>Thêm</button>
      </form><p className="msg">{msg}</p>
    </section>
  );
}

function LoadBalancer() {
  const [counts, setCounts] = useState({});
  const [stats, setStats] = useState(null);
  const [busy, setBusy] = useState(false);
  const fire = async () => {
    setBusy(true); const c = {}; let errors = 0;
    for (let i = 0; i < 30; i++) {
      const r = await api('/api/tickets/whoami');
      if (r.ok) c[r.body.served_by] = (c[r.body.served_by] || 0) + 1; else errors++;
    }
    if (errors) c['(lỗi)'] = errors;
    setCounts(c); setBusy(false);
  };
  const heavy = async () => { const r = await api('/api/tickets/stats'); setStats({ cache: r.cache, ms: r.ms, by: r.body.served_by }); };
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  return (
    <section className="card wide"><h2>Giám sát cân bằng tải</h2>
      <div className="row">
        <div><button disabled={busy} onClick={fire}>Gửi 30 request /api/tickets/whoami</button>
          {Object.entries(counts).map(([k, v]) => (
            <div key={k} className="bar"><span>{k}</span><i style={{ width: `${(v / total) * 100}%` }} /><b>{v}</b></div>))}</div>
        <div><button onClick={heavy}>Gọi truy vấn nặng /api/tickets/stats</button>
          {stats && <p className="meta">cache: <b>{stats.cache}</b> · {stats.ms} ms · replica: <b>{stats.by}</b></p>}
          <p className="hint">Gọi lần 1 (MISS) chậm ≈ 0,5 s do truy vấn mô phỏng; lần sau (HIT) lấy từ Redis.</p></div>
      </div>
    </section>
  );
}

export default function App() {
  return (<main><h1>Microservices · API Gateway · Load Balancing</h1>
    <div className="grid"><Users /><Tickets /><LoadBalancer /></div></main>);
}

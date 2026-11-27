import { useEffect, useRef, useState } from 'react';

const PAGE_SIZE = 12;
const DEBOUNCE_MS = 300;
const LOADING_DELAY_MS = 150;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SERVER_UNREACHABLE_MSG = 'Không kết nối được máy chủ. Vui lòng thử lại sau.';

async function api(path, options) {
  const t0 = performance.now();
  try {
    const res = await fetch(path, options);
    const body = await res.json().catch(() => ({}));
    return {
      ok: res.ok,
      status: res.status,
      body,
      ms: Math.round(performance.now() - t0),
      upstream: res.headers.get('X-Upstream-Addr'),
      cache: res.headers.get('X-Cache'),
      networkError: false,
      aborted: false,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: {},
      ms: Math.round(performance.now() - t0),
      upstream: null,
      cache: null,
      networkError: true,
      aborted: err?.name === 'AbortError',
    };
  }
}

function getFriendlyError(r, action) {
  if (!r || r.networkError || r.status === 0 || r.status >= 500) {
    return SERVER_UNREACHABLE_MSG;
  }
  if (action === 'save-user') {
    if (r.status === 409) return 'Email này đã được sử dụng.';
    if (r.status === 404) return 'Khách hàng không còn tồn tại.';
    if (r.status === 400) return 'Họ tên hoặc email chưa hợp lệ.';
  }
  if (action === 'delete-user' && r.status === 404) {
    return 'Khách hàng đã được xoá trước đó.';
  }
  if (action === 'save-ticket') {
    if (r.status === 404) return 'Vé không còn tồn tại.';
    if (r.status === 400) return 'Vui lòng kiểm tra lại tên sự kiện, giá và số lượng.';
  }
  if (action === 'delete-ticket' && r.status === 404) {
    return 'Vé đã được xoá trước đó.';
  }
  return 'Yêu cầu chưa thực hiện được. Vui lòng thử lại.';
}

function formatCacheSource(cacheValue) {
  if (cacheValue === 'HIT') return 'Bộ nhớ đệm (Redis — HIT)';
  if (cacheValue === 'MISS') return 'Cơ sở dữ liệu (PostgreSQL — MISS)';
  if (cacheValue === 'BYPASS') return 'Cơ sở dữ liệu (trực tiếp)';
  return 'Chưa gọi';
}

function formatShortDate(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function getInitial(name) {
  const s = String(name || '').trim();
  return s ? s[0].toUpperCase() : 'K';
}

function getPosterTheme(category, id) {
  const cat = String(category || '').toLowerCase();
  if (cat.includes('nhạc') || cat.includes('nhac') || cat.includes('music') || cat.includes('concert')) {
    return { cls: 'poster-music', icon: 'music' };
  }
  if (cat.includes('công nghệ') || cat.includes('hội') || cat.includes('hoi') || cat.includes('tech')) {
    return { cls: 'poster-conf', icon: 'stage' };
  }
  if (cat.includes('thể thao') || cat.includes('the thao') || cat.includes('sport')) {
    return { cls: 'poster-ocean', icon: 'trophy' };
  }
  if (cat.includes('sân khấu') || cat.includes('triển lãm') || cat.includes('nghệ thuật')) {
    return { cls: 'poster-royal', icon: 'mask' };
  }
  if (cat.includes('workshop')) {
    return { cls: 'poster-fest', icon: 'star' };
  }
  if (cat.includes('giải trí') || cat.includes('du lịch')) {
    return { cls: 'poster-sunset', icon: 'star' };
  }
  const variants = ['poster-fest', 'poster-sunset', 'poster-ocean', 'poster-royal'];
  return { cls: variants[(Number(id) || 0) % variants.length], icon: 'star' };
}

/* ===== Biểu tượng SVG nội tuyến ===== */
function PosterArtwork({ kind }) {
  if (kind === 'music') {
    return (
      <svg className="poster-svg" viewBox="0 0 320 120" fill="none" aria-hidden="true">
        <circle cx="265" cy="24" r="64" fill="rgba(255,255,255,0.12)" />
        <path d="M205 86V36l44-9v41" stroke="rgba(255,255,255,0.85)" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="196" cy="88" r="9" fill="rgba(255,255,255,0.9)" />
        <circle cx="240" cy="72" r="9" fill="rgba(255,255,255,0.9)" />
        <path d="M24 96h10M44 82v28M64 68v42M84 86v24M104 76v34" stroke="rgba(255,255,255,0.4)" strokeWidth="4.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'stage') {
    return (
      <svg className="poster-svg" viewBox="0 0 320 120" fill="none" aria-hidden="true">
        <polygon points="0,0 110,0 55,120 0,120" fill="rgba(255,255,255,0.08)" />
        <rect x="192" y="26" width="98" height="64" rx="9" stroke="rgba(255,255,255,0.78)" strokeWidth="2.8" />
        <path d="M210 48h60M210 64h38" stroke="rgba(255,255,255,0.82)" strokeWidth="3.2" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'trophy') {
    return (
      <svg className="poster-svg" viewBox="0 0 320 120" fill="none" aria-hidden="true">
        <circle cx="255" cy="60" r="60" fill="rgba(255,255,255,0.1)" />
        <path d="M220 32h46v22a23 23 0 0 1-46 0V32Z" stroke="rgba(255,255,255,0.88)" strokeWidth="3" />
        <path d="M243 77v15M228 92h30" stroke="rgba(255,255,255,0.88)" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'mask') {
    return (
      <svg className="poster-svg" viewBox="0 0 320 120" fill="none" aria-hidden="true">
        <rect x="206" y="24" width="76" height="70" rx="35" stroke="rgba(255,255,255,0.82)" strokeWidth="2.8" />
        <circle cx="230" cy="52" r="3.8" fill="rgba(255,255,255,0.9)" />
        <circle cx="258" cy="52" r="3.8" fill="rgba(255,255,255,0.9)" />
        <path d="M230 70c7 7 21 7 28 0" stroke="rgba(255,255,255,0.88)" strokeWidth="2.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg className="poster-svg" viewBox="0 0 320 120" fill="none" aria-hidden="true">
      <circle cx="252" cy="60" r="66" fill="rgba(255,255,255,0.1)" />
      <path d="M226 38h48a7 7 0 0 1 7 7v9a7 7 0 0 0 0 14v9a7 7 0 0 1-7 7h-48a7 7 0 0 1-7-7v-9a7 7 0 0 0 0-14v-9a7 7 0 0 1 7-7Z" stroke="rgba(255,255,255,0.85)" strokeWidth="2.8" />
    </svg>
  );
}

function IconTicketNav() {
  return (
    <svg className="icon-18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 6v2m0 4v2" />
    </svg>
  );
}

function IconUsersNav() {
  return (
    <svg className="icon-18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconPulseNav() {
  return (
    <svg className="icon-18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg className="icon-18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
    </svg>
  );
}

/* ===== BẢN ĐỒ TOPOLOGY SỐNG & KIỂM TRA SỨC KHOẺ CỤM (MÀN HÌNH KỸ THUẬT) ===== */
function ClusterTopology({ activeDataNode }) {
  const [probes, setProbes] = useState({
    gateway: { ok: null, ms: null },
    tickets: { ok: null, ms: null, by: '-' },
    users: { ok: null, ms: null, by: '-' },
  });
  const [probing, setProbing] = useState(false);

  const runHealthProbe = async () => {
    setProbing(true);
    const t0 = performance.now();
    let gwOk = false;
    try {
      const rGw = await fetch('/healthz');
      gwOk = rGw.ok;
    } catch {
      gwOk = false;
    }
    const gwMs = Math.round(performance.now() - t0);

    const [rTk, rUs] = await Promise.all([
      api('/api/tickets/health'),
      api('/api/users/health'),
    ]);

    setProbes({
      gateway: { ok: gwOk, ms: gwMs },
      tickets: { ok: rTk.ok, ms: rTk.ms, by: rTk.body?.served_by || '-' },
      users: { ok: rUs.ok, ms: rUs.ms, by: rUs.body?.served_by || '-' },
    });
    setProbing(false);
  };

  useEffect(() => {
    runHealthProbe();
  }, []);

  const isRedisActive = activeDataNode === 'HIT';
  const isPgActive = activeDataNode === 'MISS' || activeDataNode === 'BYPASS';

  return (
    <div className="topology-card">
      <div className="topology-head">
        <div>
          <span className="eyebrow-tech">LIVE ARCHITECTURE TOPOLOGY</span>
          <h3 className="topology-title">Sơ đồ kiến trúc &amp; trạng thái nút thời gian thực</h3>
        </div>
        <div className="topology-actions">
          {activeDataNode && (
            <span className={`live-route-badge ${isRedisActive ? 'is-redis' : 'is-pg'}`}>
              {isRedisActive ? '⚡ Luồng đọc gần nhất: Redis HIT' : '🗄 Luồng đọc gần nhất: PostgreSQL'}
            </span>
          )}
          <button
            type="button"
            className="btn-secondary btn-compact"
            disabled={probing}
            onClick={runHealthProbe}
          >
            {probing ? 'Đang dò...' : '↻ Kiểm tra sức khoẻ cụm'}
          </button>
        </div>
      </div>

      <div
        className="topology-grid"
        role="img"
        aria-label="Sơ đồ kiến trúc: Trình duyệt qua Nginx Gateway tới cụm Ticket Service và User Service, kết nối Redis và PostgreSQL"
      >
        {/* Cột 1: Gateway */}
        <div className="topo-node topo-gateway">
          <div className="topo-node-top">
            <span className={`dot-indicator ${probes.gateway.ok === false ? 'is-down' : 'is-up'}`} />
            <span className="topo-port">:8080 · Mạng edge</span>
          </div>
          <strong>Nginx API Gateway</strong>
          <span className="topo-desc">Reverse Proxy · Round-Robin · Passive Failover</span>
          {probes.gateway.ms !== null && (
            <span className="topo-latency">{probes.gateway.ok ? `OK · ${probes.gateway.ms} ms` : 'Mất kết nối'}</span>
          )}
        </div>

        <div className="topo-connector" aria-hidden="true">
          <span className="connector-line" />
          <span className="connector-arrow">▶</span>
        </div>

        {/* Cột 2: Application Services */}
        <div className="topo-stack">
          <div className="topo-node">
            <div className="topo-node-top">
              <span className={`dot-indicator ${probes.tickets.ok === false ? 'is-down' : 'is-up'}`} />
              <span className="topo-port">:5000 ×N bản sao</span>
            </div>
            <strong>Ticket Service (Flask)</strong>
            <span className="topo-desc">Stateless · Gunicorn Workers</span>
            {probes.tickets.ms !== null && (
              <span className="topo-latency">
                {probes.tickets.ok ? `Replica: ${probes.tickets.by} (${probes.tickets.ms} ms)` : 'Ngừng phản hồi'}
              </span>
            )}
          </div>

          <div className="topo-node">
            <div className="topo-node-top">
              <span className={`dot-indicator ${probes.users.ok === false ? 'is-down' : 'is-up'}`} />
              <span className="topo-port">:3000 · Độc lập</span>
            </div>
            <strong>User Service (Node.js)</strong>
            <span className="topo-desc">Express · Cô lập lỗi riêng</span>
            {probes.users.ms !== null && (
              <span className="topo-latency">
                {probes.users.ok ? `Node: ${probes.users.by} (${probes.users.ms} ms)` : 'Ngừng phản hồi'}
              </span>
            )}
          </div>
        </div>

        <div className="topo-connector" aria-hidden="true">
          <span className="connector-line" />
          <span className="connector-arrow">▶</span>
        </div>

        {/* Cột 3: Data Tier (Mạng data cô lập) */}
        <div className="topo-stack">
          <div className={`topo-node${isRedisActive ? ' is-active-redis' : ''}`}>
            <div className="topo-node-top">
              <span className="dot-indicator is-up" />
              <span className="topo-port">:6379 · Mạng data</span>
            </div>
            <strong>Redis 7 Cache-Aside</strong>
            <span className="topo-desc">TTL 30–60s · Suy giảm êm khi tắt</span>
          </div>

          <div className={`topo-node${isPgActive ? ' is-active-pg' : ''}`}>
            <div className="topo-node-top">
              <span className="dot-indicator is-up" />
              <span className="topo-port">:5432 · Mạng data</span>
            </div>
            <strong>PostgreSQL 16 (×2 DB)</strong>
            <span className="topo-desc">tickets_db · users_db riêng biệt</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===== BÀN THÍ NGHIỆM 3 KỊCH BẢN PHÂN TÁN (ẤN TƯỢNG & TRỰC QUAN) ===== */
function LoadBalancer() {
  const [burstSize, setBurstSize] = useState(30);
  const [progress, setProgress] = useState(0);
  const [counts, setCounts] = useState({});
  const [prevRunSummary, setPrevRunSummary] = useState('');
  const [latencySummary, setLatencySummary] = useState(null);
  const [runErrors, setRunErrors] = useState(0);

  const [stats, setStats] = useState(null);
  const [cacheHistory, setCacheHistory] = useState({ missMs: null, hitMs: null });
  const [busyWhoami, setBusyWhoami] = useState(false);
  const [busyStats, setBusyStats] = useState(false);
  const [lbError, setLbError] = useState('');
  const [copiedCmd, setCopiedCmd] = useState('');

  const fire = async (nReq = burstSize) => {
    setBusyWhoami(true);
    setProgress(0);
    setLbError('');

    const existingEntries = Object.entries(counts);
    if (existingEntries.length > 0) {
      setPrevRunSummary(`${existingEntries.length} replica (${existingEntries.map(([, v]) => v).join(' / ')})`);
    }

    const c = {};
    const lats = [];
    let errors = 0;
    for (let i = 0; i < nReq; i++) {
      const r = await api('/api/tickets/whoami');
      lats.push(r.ms);
      if (r.ok) {
        c[r.body.served_by] = (c[r.body.served_by] || 0) + 1;
      } else {
        errors++;
      }
      if ((i + 1) % 5 === 0 || i + 1 === nReq) {
        setProgress(i + 1);
      }
    }

    if (errors === nReq) {
      setLbError(SERVER_UNREACHABLE_MSG);
    }
    if (lats.length > 0) {
      const sum = lats.reduce((a, b) => a + b, 0);
      setLatencySummary({
        avg: (sum / lats.length).toFixed(1),
        max: Math.max(...lats),
        total: nReq,
      });
    }
    setRunErrors(errors);
    setCounts(c);
    setBusyWhoami(false);
  };

  const heavy = async () => {
    setBusyStats(true);
    setLbError('');
    const r = await api('/api/tickets/stats');
    setBusyStats(false);
    if (!r.ok) {
      setLbError(SERVER_UNREACHABLE_MSG);
      return;
    }
    const cacheState = r.cache || r.body.cache;
    setStats({
      cache: cacheState,
      ms: r.ms,
      by: r.body.served_by,
      events: r.body.stats?.events,
      totalTickets: r.body.stats?.total_tickets,
    });
    setCacheHistory(prev => ({
      missMs: cacheState === 'MISS' ? r.ms : prev.missMs,
      hitMs: cacheState === 'HIT' ? r.ms : prev.hitMs,
    }));
  };

  const copyCli = (cmd) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(cmd).then(() => {
        setCopiedCmd(cmd);
        setTimeout(() => setCopiedCmd(''), 1800);
      }).catch(() => {});
    }
  };

  const entries = Object.entries(counts);
  const total = entries.reduce((a, [, b]) => a + b, 0) || 1;
  const speedupFactor =
    cacheHistory.missMs && cacheHistory.hitMs && cacheHistory.hitMs > 0
      ? (cacheHistory.missMs / cacheHistory.hitMs).toFixed(1)
      : null;

  return (
    <div className="lab-scenarios" aria-labelledby="lb-heading">
      <div className="lab-header-row">
        <div>
          <span className="eyebrow-tech">INTERACTIVE VERIFICATION BENCH</span>
          <h3 id="lb-heading" className="lb-heading">Ba kịch bản kiểm chứng hệ phân tán trực tiếp</h3>
        </div>
      </div>

      {lbError && (
        <p className="feedback feedback-error" role="alert">⚠ {lbError}</p>
      )}

      <div className="scenario-grid">
        {/* KỊCH BẢN 01: CÂN BẰNG TẢI */}
        <article className="scenario-card">
          <div className="scenario-top">
            <span className="scenario-badge">01 · LOAD BALANCING</span>
            <div className="burst-selector" role="group" aria-label="Chọn số lượng request">
              {[30, 60, 100].map(n => (
                <button
                  key={n}
                  type="button"
                  className={`burst-chip${burstSize === n ? ' is-selected' : ''}`}
                  onClick={() => setBurstSize(n)}
                >
                  {n} req
                </button>
              ))}
            </div>
          </div>

          <h4 className="scenario-title">Phân phối tải Round-Robin</h4>

          <button
            type="button"
            className="btn-primary"
            disabled={busyWhoami}
            onClick={() => fire(burstSize)}
          >
            {busyWhoami ? `Đang bắn ${progress}/${burstSize} request...` : `Gửi ${burstSize} request`}
          </button>

          <div className="bar-list" aria-live="polite">
            {entries.length === 0 && !busyWhoami && (
              <p className="empty-lab-hint">Bấm nút trên để đo tỷ lệ phân phối giữa các container replica.</p>
            )}

            {entries.length > 0 && (
              <div className="compare-strip">
                <div className="compare-row">
                  <span><b>{entries.length} bản sao</b> nhận tải</span>
                  <span className={runErrors === 0 ? 'ok-pill' : 'err-pill'}>{runErrors} lỗi</span>
                </div>
                {latencySummary && (
                  <span className="compare-prev">
                    TB: {latencySummary.avg} ms · Max: {latencySummary.max} ms (vạch đứt = mốc 33,3%)
                  </span>
                )}
                {prevRunSummary && (
                  <span className="compare-prev">Đối chiếu lần trước: {prevRunSummary}</span>
                )}
              </div>
            )}

            {entries.map(([k, v]) => {
              const pct = ((v / total) * 100).toFixed(1);
              return (
                <div key={k} className="replica-bar-block">
                  <div className="replica-bar-head">
                    <span className="mono-label" title={k}>📦 {k}</span>
                    <b className="mono-num">{v} req ({pct}%)</b>
                  </div>
                  <div className="bar-track bar-track-ideal">
                    <i style={{ width: `${(v / total) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </article>

        {/* KỊCH BẢN 02: BỘ NHỚ ĐỆM REDIS */}
        <article className="scenario-card">
          <div className="scenario-top">
            <span className="scenario-badge">02 · REDIS CACHE-ASIDE</span>
            {speedupFactor && (
              <span className="speedup-pill">⚡ Nhanh hơn {speedupFactor}×</span>
            )}
          </div>

          <h4 className="scenario-title">Đo tốc độ MISS (DB) vs HIT (RAM)</h4>

          <button
            type="button"
            className="btn-secondary"
            disabled={busyStats}
            onClick={heavy}
          >
            {busyStats ? 'Đang chạy truy vấn nặng...' : 'Gọi truy vấn nặng (/stats)'}
          </button>

          {!stats && !busyStats && (
            <p className="empty-lab-hint">Lần 1 tính toán trên PostgreSQL (~500 ms); lần 2 trả tức thì từ Redis.</p>
          )}

          {stats && (
            <div className="cache-result-box" aria-live="polite">
              <div className="cache-result-top">
                <span className={`cache-badge ${stats.cache === 'HIT' ? 'is-hit' : 'is-miss'}`}>
                  {stats.cache === 'HIT' ? '✓ REDIS · HIT' : '● POSTGRES · MISS'}
                </span>
                <b className="latency-big">{stats.ms} ms</b>
              </div>

              <p className="meta">Replica xử lý: <span className="mono-label">{stats.by}</span></p>

              {(cacheHistory.missMs !== null || cacheHistory.hitMs !== null) && (
                <div className="cache-compare-bars">
                  <div className="cache-bar-row">
                    <span>DB MISS</span>
                    <div className="bar-track">
                      <i className="bar-amber" style={{ width: cacheHistory.missMs ? '100%' : '0%' }} />
                    </div>
                    <b className="mono-num">{cacheHistory.missMs !== null ? `${cacheHistory.missMs} ms` : '—'}</b>
                  </div>
                  <div className="cache-bar-row">
                    <span>Redis HIT</span>
                    <div className="bar-track">
                      <i
                        className="bar-green"
                        style={{
                          width:
                            cacheHistory.hitMs !== null && cacheHistory.missMs
                              ? `${Math.max(4, Math.min(100, (cacheHistory.hitMs / cacheHistory.missMs) * 100))}%`
                              : cacheHistory.hitMs !== null
                                ? '18%'
                                : '0%',
                        }}
                      />
                    </div>
                    <b className="mono-num">{cacheHistory.hitMs !== null ? `${cacheHistory.hitMs} ms` : '—'}</b>
                  </div>
                </div>
              )}
            </div>
          )}
        </article>

        {/* KỊCH BẢN 03: CONSOLE LỆNH CHỊU LỖI & SCALE */}
        <article className="scenario-card scenario-terminal">
          <div className="scenario-top">
            <span className="scenario-badge badge-dark">03 · CHAOS &amp; SCALING CLI</span>
          </div>

          <h4 className="scenario-title title-light">Điều khiển cụm trên Ubuntu</h4>

          <div className="term-block">
            <div className="term-label-row">
              <span>1. Nhân bản 3 container Ticket Service:</span>
              <button type="button" className="copy-btn" onClick={() => copyCli('./scripts/scale.sh 3')}>
                {copiedCmd === './scripts/scale.sh 3' ? '✓ Đã chép' : 'Chép'}
              </button>
            </div>
            <code className="term-code" tabIndex={0}>./scripts/scale.sh 3</code>
          </div>

          <div className="term-block">
            <div className="term-label-row">
              <span>2. Giả lập sự cố dừng 1 bản sao:</span>
              <button type="button" className="copy-btn" onClick={() => copyCli('./scripts/kill-one.sh')}>
                {copiedCmd === './scripts/kill-one.sh' ? '✓ Đã chép' : 'Chép'}
              </button>
            </div>
            <code className="term-code" tabIndex={0}>./scripts/kill-one.sh</code>
          </div>

          <div className="term-block">
            <div className="term-label-row">
              <span>3. Xoá trắng Redis để đo lại MISS:</span>
              <button
                type="button"
                className="copy-btn"
                onClick={() => copyCli('sudo docker compose exec redis redis-cli FLUSHALL')}
              >
                {copiedCmd === 'sudo docker compose exec redis redis-cli FLUSHALL' ? '✓ Đã chép' : 'Chép'}
              </button>
            </div>
            <code className="term-code" tabIndex={0}>sudo docker compose exec redis redis-cli FLUSHALL</code>
          </div>
        </article>
      </div>
    </div>
  );
}

function TechnicalEvidenceSection() {
  const replicas = [
    { name: 'ticket-service-1', count: 99, pct: 33.0 },
    { name: 'ticket-service-2', count: 99, pct: 33.0 },
    { name: 'ticket-service-3', count: 102, pct: 34.0 },
  ];

  return (
    <div className="surface-card evidence-block">
      <div className="form-header-row">
        <div>
          <span className="eyebrow-tech">VERIFIED BENCHMARK METRICS</span>
          <h3 className="lb-heading">Bảng đối chiếu kết quả thực nghiệm chuẩn (300 request)</h3>
        </div>
        <span className="active-tag">scripts/lb_test.py --n 300</span>
      </div>

      <dl className="evidence-metrics">
        <div className="metric-tile">
          <dt>Độ tin cậy (300 request)</dt>
          <dd className="metric-number is-good">0 lỗi (100%)</dd>
          <span className="metric-sub">Chia đều 99 / 99 / 102</span>
        </div>

        <div className="metric-tile">
          <dt>Độ trễ vận hành (3 replica)</dt>
          <dd className="metric-number">p95: 2,2 ms</dd>
          <span className="metric-sub">Độ trễ tối đa: 11,7 ms</span>
        </div>

        <div className="metric-tile">
          <dt>Failover dừng 1 replica</dt>
          <dd className="metric-number is-warn">≈ 1006 ms</dd>
          <span className="metric-sub">Timeout 1s rồi tự chuyển tiếp</span>
        </div>

        <div className="metric-tile">
          <dt>Tăng tốc Redis (/stats)</dt>
          <dd className="metric-number is-good">-97,2%</dd>
          <span className="metric-sub">MISS 563,9 ms → HIT 15,9 ms</span>
        </div>
      </dl>

      <div className="evidence-bars" role="group" aria-label="Phân phối 300 request">
        {replicas.map(r => (
          <div key={r.name} className="bar">
            <span className="mono-label">{r.name}</span>
            <div className="bar-track bar-track-ideal">
              <i style={{ width: `${r.pct}%` }} />
            </div>
            <b className="mono-num">{r.count} req ({r.pct.toFixed(1).replace('.', ',')}%)</b>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ===== MÀN HÌNH 2: QUẢN LÝ KHÁCH HÀNG (QUẢN LÝ NGƯỜI DÙNG CHUYÊN NGHIỆP) ===== */
function Users({ onTechInfo, onCountChange }) {
  const [items, setItems] = useState([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadNonce, setReloadNonce] = useState(0);

  const [userFilter, setUserFilter] = useState('');
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const [form, setForm] = useState({ name: '', email: '' });
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState({ type: '', text: '' });
  const [bannerMsg, setBannerMsg] = useState('');

  const nameInputRef = useRef(null);
  const emailInputRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);

    (async () => {
      const r = await api('/api/users', { signal: controller.signal });
      if (!active || r.aborted) return;
      setLoading(false);
      if (!r.ok) {
        setLoadError(getFriendlyError(r, 'load-users'));
        onTechInfo?.({ service: 'users', ok: false });
        return;
      }
      const nextItems = Array.isArray(r.body.items) ? r.body.items : [];
      setItems(nextItems);
      setLoadError('');
      setHasLoaded(true);
      onCountChange?.(nextItems.length);
      onTechInfo?.({
        service: 'users',
        ok: true,
        ms: r.ms,
        servedBy: r.body.served_by || '-',
        upstream: r.upstream || '-',
      });
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadNonce, onTechInfo, onCountChange]);

  useEffect(() => {
    if (!showUserModal) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setShowUserModal(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showUserModal]);

  const openAddUser = () => {
    setEditingUser(null);
    setForm({ name: '', email: '' });
    setFeedback({ type: '', text: '' });
    setShowUserModal(true);
    setTimeout(() => nameInputRef.current?.focus(), 20);
  };

  const openEditUser = (user) => {
    setEditingUser(user);
    setConfirmDeleteId(null);
    setForm({ name: user.name, email: user.email });
    setFeedback({ type: '', text: '' });
    setShowUserModal(true);
    setTimeout(() => nameInputRef.current?.focus(), 20);
  };

  const handleDelete = async (user) => {
    if (deletingId) return;
    setDeletingId(user.id);

    const r = await api(`/api/users/${user.id}`, { method: 'DELETE' });
    setDeletingId(null);
    setConfirmDeleteId(null);

    if (r.ok) {
      setBannerMsg(`Đã xoá khách hàng '${user.name}'.`);
      setReloadNonce(n => n + 1);
    } else {
      if (r.status === 404) setReloadNonce(n => n + 1);
      setLoadError(getFriendlyError(r, 'delete-user'));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;

    const trimmedName = form.name.trim();
    const trimmedEmail = form.email.trim();

    if (!trimmedName) {
      setFeedback({ type: 'error', text: 'Vui lòng nhập họ và tên.' });
      nameInputRef.current?.focus();
      return;
    }
    if (trimmedName.length > 100) {
      setFeedback({ type: 'error', text: 'Họ tên tối đa 100 ký tự.' });
      nameInputRef.current?.focus();
      return;
    }
    if (!trimmedEmail || !EMAIL_RE.test(trimmedEmail)) {
      setFeedback({ type: 'error', text: 'Email chưa đúng định dạng (vd: ten@mien.com).' });
      emailInputRef.current?.focus();
      return;
    }
    if (trimmedEmail.length > 150) {
      setFeedback({ type: 'error', text: 'Email tối đa 150 ký tự.' });
      emailInputRef.current?.focus();
      return;
    }

    setSubmitting(true);
    setFeedback({ type: '', text: '' });

    const isEdit = Boolean(editingUser);
    const url = isEdit ? `/api/users/${editingUser.id}` : '/api/users';
    const method = isEdit ? 'PUT' : 'POST';

    const r = await api(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmedName, email: trimmedEmail }),
    });
    setSubmitting(false);

    if (r.ok) {
      setBannerMsg(isEdit ? `Đã cập nhật '${trimmedName}'.` : `Đã thêm khách hàng '${trimmedName}'.`);
      setEditingUser(null);
      setForm({ name: '', email: '' });
      setShowUserModal(false);
      setReloadNonce(n => n + 1);
    } else {
      if (r.status === 404) {
        setEditingUser(null);
        setReloadNonce(n => n + 1);
      }
      setFeedback({ type: 'error', text: getFriendlyError(r, 'save-user') });
    }
  };

  const qNorm = userFilter.trim().toLowerCase();
  const filteredUsers = qNorm
    ? items.filter(u => u.name.toLowerCase().includes(qNorm) || u.email.toLowerCase().includes(qNorm))
    : items;

  return (
    <section className="view-panel" aria-labelledby="users-heading">
      {/* KPI Quản lý khách hàng */}
      <div className="kpi-row kpi-3">
        <div className="kpi-card">
          <span className="kpi-label">Tổng khách hàng</span>
          <strong className="kpi-value">{items.length}</strong>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Đang hiển thị</span>
          <strong className="kpi-value">{filteredUsers.length}</strong>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Cơ sở dữ liệu riêng</span>
          <strong className="kpi-value kpi-mono">users_db</strong>
        </div>
      </div>

      {/* Thanh công cụ Quản lý người dùng / khách hàng */}
      <div className="admin-toolbar">
        <div className="toolbar-left">
          <h2 id="users-heading" className="sr-only">Quản lý người dùng</h2>
          <label className="sr-only" htmlFor="user-search-input">Tìm khách hàng</label>
          <input
            id="user-search-input"
            type="text"
            className="field-input toolbar-search"
            placeholder="Tìm theo họ tên hoặc email khách hàng..."
            maxLength={100}
            value={userFilter}
            onChange={e => setUserFilter(e.target.value)}
          />
          {userFilter && (
            <button type="button" className="btn-secondary btn-compact" onClick={() => setUserFilter('')}>
              Xoá lọc
            </button>
          )}
        </div>

        <button type="button" className="btn-primary" onClick={openAddUser}>
          <IconPlus />
          <span>Thêm khách hàng</span>
        </button>
      </div>

      {bannerMsg && (
        <div className="toast-strip" role="status" aria-live="polite">
          <span>✓ {bannerMsg}</span>
          <button type="button" className="toast-close" onClick={() => setBannerMsg('')} aria-label="Đóng">×</button>
        </div>
      )}

      {loadError && (
        <div className="state-box state-error" role="alert">
          <p className="state-text">⚠ {loadError}</p>
          <button type="button" className="btn-secondary" onClick={() => setReloadNonce(n => n + 1)}>
            Thử lại
          </button>
        </div>
      )}

      <div className="surface-card table-card" aria-live="polite">
        {loading && !hasLoaded && (
          <div className="state-box state-loading" role="status">
            <p className="state-text">Đang tải danh sách khách hàng...</p>
          </div>
        )}

        {!loading && !loadError && hasLoaded && filteredUsers.length === 0 && (
          <div className="state-box">
            <p className="state-text">Không tìm thấy khách hàng phù hợp.</p>
          </div>
        )}

        {filteredUsers.length > 0 && (
          <div className="table-scroll">
            <table className="admin-table" aria-label="Bảng danh sách khách hàng">
              <thead>
                <tr>
                  <th>Mã KH</th>
                  <th>Họ và tên</th>
                  <th>Email liên hệ</th>
                  <th>Ngày đăng ký</th>
                  <th className="col-right">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map(u => {
                  const isConfirming = confirmDeleteId === u.id;
                  return (
                    <tr key={u.id}>
                      <td className="mono-num">#KH{String(u.id).padStart(3, '0')}</td>
                      <td>
                        <div className="user-cell">
                          <span className="user-avatar" aria-hidden="true">{getInitial(u.name)}</span>
                          <span className="entity-primary">{u.name}</span>
                        </div>
                      </td>
                      <td className="entity-secondary">{u.email}</td>
                      <td className="mono-num">{formatShortDate(u.created_at)}</td>
                      <td className="col-right">
                        {isConfirming ? (
                          <div className="confirm-inline justify-end">
                            <button
                              type="button"
                              className="btn-danger btn-compact"
                              disabled={deletingId === u.id}
                              onClick={() => handleDelete(u)}
                            >
                              {deletingId === u.id ? '...' : 'Xoá ngay'}
                            </button>
                            <button
                              type="button"
                              className="btn-secondary btn-compact"
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              Huỷ
                            </button>
                          </div>
                        ) : (
                          <div className="row-actions justify-end">
                            <button
                              type="button"
                              className="btn-secondary btn-compact"
                              onClick={() => openEditUser(u)}
                            >
                              Sửa
                            </button>
                            <button
                              type="button"
                              className="btn-danger-outline btn-compact"
                              onClick={() => setConfirmDeleteId(u.id)}
                            >
                              Xoá
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Thêm / Sửa Khách hàng */}
      <div
        className="modal-backdrop"
        hidden={!showUserModal}
        onMouseDown={e => {
          if (e.target === e.currentTarget) setShowUserModal(false);
        }}
      >
        <div className="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="modal-user-title">
          <div className="modal-header">
            <h3 id="modal-user-title" className="modal-title">
              {editingUser ? `Chỉnh sửa khách hàng #KH${String(editingUser.id).padStart(3, '0')}` : 'Thêm khách hàng mới'}
            </h3>
            <button type="button" className="modal-close-btn" onClick={() => setShowUserModal(false)} aria-label="Đóng">
              ×
            </button>
          </div>

          <form className="seller-form" onSubmit={handleSubmit} noValidate>
            <div className="form-stack">
              <div className="field">
                <label className="field-label" htmlFor="user-name-input">Họ và tên *</label>
                <input
                  ref={nameInputRef}
                  id="user-name-input"
                  type="text"
                  className="field-input"
                  placeholder="Nguyễn Văn An"
                  maxLength={100}
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="user-email-input">Địa chỉ email *</label>
                <input
                  ref={emailInputRef}
                  id="user-email-input"
                  type="email"
                  className="field-input"
                  placeholder="an.nguyen@vietticket.vn"
                  maxLength={150}
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  required
                />
              </div>
            </div>

            {feedback.type === 'error' && (
              <p className="feedback feedback-error" role="alert">⚠ {feedback.text}</p>
            )}

            <p className="privacy-note">
              Thông tin chỉ dùng để quản lý vé trong hệ thống này.
            </p>

            <div className="modal-footer-actions">
              <button type="button" className="btn-secondary" onClick={() => setShowUserModal(false)}>
                Huỷ
              </button>
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? 'Đang lưu...' : editingUser ? 'Lưu thay đổi' : 'Thêm khách hàng'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}

/* ===== ỨNG DỤNG QUẢN TRỊ VÉ, KHÁCH HÀNG & HỆ PHÂN TÁN ===== */
export default function App() {
  const [activeView, setActiveView] = useState('tickets'); // 'tickets' | 'users' | 'lab'
  const [ticketLayout, setTicketLayout] = useState('grid'); // 'grid' | 'table'
  const [userCount, setUserCount] = useState(null);
  const [techState, setTechState] = useState({ tickets: null, users: null });

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [showLoading, setShowLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadNonce, setReloadNonce] = useState(0);

  const [searchInput, setSearchInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [quickCategories, setQuickCategories] = useState([]);

  const [catInput, setCatInput] = useState('');
  const [catOpen, setCatOpen] = useState(false);
  const [catTyping, setCatTyping] = useState(false);
  const [catDebouncedQuery, setCatDebouncedQuery] = useState('');
  const [catOptions, setCatOptions] = useState([]);
  const [catShowLoading, setCatShowLoading] = useState(false);
  const [catError, setCatError] = useState('');
  const [catActiveIndex, setCatActiveIndex] = useState(0);

  // Thêm / Sửa / Xoá vé
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [editingTicket, setEditingTicket] = useState(null);
  const [confirmDeleteTicketId, setConfirmDeleteTicketId] = useState(null);
  const [deletingTicketId, setDeletingTicketId] = useState(null);
  const [form, setForm] = useState({ event: '', category: '', price: '', quantity: '' });
  const [createStatus, setCreateStatus] = useState({ type: '', text: '' });
  const [storeBannerNotice, setStoreBannerNotice] = useState('');
  const [creating, setCreating] = useState(false);

  const searchInputRef = useRef(null);
  const searchTimerRef = useRef(null);
  const catTimerRef = useRef(null);
  const catBoxRef = useRef(null);

  const ticketEventInputRef = useRef(null);
  const ticketCategoryInputRef = useRef(null);
  const ticketPriceInputRef = useRef(null);
  const ticketQtyInputRef = useRef(null);

  const handleTechInfo = useRef((info) => {
    setTechState(prev => ({ ...prev, [info.service]: info }));
  }).current;

  const hasActiveFilter = Boolean(searchInput.trim() || appliedQuery || selectedCategory);
  const effectiveCatQuery = catTyping ? catDebouncedQuery.trim() : '';
  const visibleCatOptions = effectiveCatQuery === ''
    ? [{ value: '', label: 'Tất cả danh mục' }, ...catOptions.map(c => ({ value: c, label: c }))]
    : catOptions.map(c => ({ value: c, label: c }));

  useEffect(() => () => {
    clearTimeout(searchTimerRef.current);
    clearTimeout(catTimerRef.current);
  }, []);

  useEffect(() => {
    if (!catOpen) return undefined;
    const onDocMouseDown = (e) => {
      if (catBoxRef.current && !catBoxRef.current.contains(e.target)) {
        setCatOpen(false);
        setCatInput(selectedCategory);
        setCatTyping(false);
        setCatDebouncedQuery('');
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [catOpen, selectedCategory]);

  useEffect(() => {
    if (!showTicketModal) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setShowTicketModal(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showTicketModal]);

  useEffect(() => {
    let active = true;
    (async () => {
      const r = await api('/api/tickets/categories?limit=10');
      if (active && r.ok && Array.isArray(r.body.items)) {
        setQuickCategories(r.body.items);
      }
    })();
    return () => { active = false; };
  }, [reloadNonce]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const loadingTimer = setTimeout(() => {
      if (active) setShowLoading(true);
    }, hasLoaded ? LOADING_DELAY_MS : 0);

    const params = new URLSearchParams();
    if (appliedQuery) params.set('q', appliedQuery);
    if (selectedCategory) params.set('category', selectedCategory);
    params.set('page', String(page));
    params.set('page_size', String(PAGE_SIZE));

    (async () => {
      const r = await api(`/api/tickets?${params.toString()}`, { signal: controller.signal });
      clearTimeout(loadingTimer);
      if (!active || r.aborted) return;
      setShowLoading(false);

      if (!r.ok) {
        setError(getFriendlyError(r, 'load-tickets'));
        handleTechInfo({ service: 'tickets', ok: false });
        return;
      }

      const nextItems = Array.isArray(r.body.items) ? r.body.items : [];
      const nextTotal = typeof r.body.total === 'number' ? r.body.total : nextItems.length;
      const nextTotalPages = typeof r.body.total_pages === 'number' ? r.body.total_pages : 0;

      setItems(nextItems);
      setTotal(nextTotal);
      setTotalPages(nextTotalPages);
      if (typeof r.body.page === 'number' && r.body.page !== page) {
        setPage(r.body.page);
      }
      setError('');
      setHasLoaded(true);

      handleTechInfo({
        service: 'tickets',
        ok: true,
        cache: r.cache || r.body.cache || '-',
        ms: r.ms,
        servedBy: r.body.served_by || '-',
        upstream: r.upstream || '-',
      });
    })();

    return () => {
      active = false;
      controller.abort();
      clearTimeout(loadingTimer);
    };
  }, [appliedQuery, selectedCategory, page, reloadNonce, hasLoaded, handleTechInfo]);

  useEffect(() => {
    if (!catOpen) return undefined;
    const controller = new AbortController();
    let active = true;
    const loadingTimer = setTimeout(() => {
      if (active) setCatShowLoading(true);
    }, LOADING_DELAY_MS);

    const params = new URLSearchParams({ limit: '20' });
    if (effectiveCatQuery) params.set('q', effectiveCatQuery);

    (async () => {
      const r = await api(`/api/tickets/categories?${params.toString()}`, { signal: controller.signal });
      clearTimeout(loadingTimer);
      if (!active || r.aborted) return;
      setCatShowLoading(false);

      if (!r.ok) {
        setCatError(getFriendlyError(r, 'load-categories'));
        return;
      }
      setCatOptions(Array.isArray(r.body.items) ? r.body.items : []);
      setCatError('');
      setCatActiveIndex(0);
    })();

    return () => {
      active = false;
      controller.abort();
      clearTimeout(loadingTimer);
    };
  }, [catOpen, effectiveCatQuery, reloadNonce]);

  const handleSearchChange = (value) => {
    setSearchInput(value);
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setAppliedQuery(value.trim());
      setPage(1);
    }, DEBOUNCE_MS);
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(searchTimerRef.current);
      const next = searchInput.trim();
      if (next === appliedQuery && page === 1) setReloadNonce(n => n + 1);
      else {
        setAppliedQuery(next);
        setPage(1);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      clearTimeout(searchTimerRef.current);
      setSearchInput('');
      setAppliedQuery('');
      setPage(1);
    }
  };

  const clearSearchInput = () => {
    clearTimeout(searchTimerRef.current);
    setSearchInput('');
    setAppliedQuery('');
    setPage(1);
    searchInputRef.current?.focus();
  };

  const openCategoryDropdown = () => {
    setCatOpen(true);
    setCatTyping(false);
    setCatDebouncedQuery('');
    setCatActiveIndex(0);
  };

  const closeCategoryDropdown = () => {
    clearTimeout(catTimerRef.current);
    setCatOpen(false);
    setCatInput(selectedCategory);
    setCatTyping(false);
    setCatDebouncedQuery('');
  };

  const selectCategory = (val) => {
    clearTimeout(catTimerRef.current);
    setSelectedCategory(val);
    setCatInput(val);
    setCatTyping(false);
    setCatDebouncedQuery('');
    setCatOpen(false);
    setPage(1);
  };

  const handleCatInputChange = (val) => {
    setCatInput(val);
    setCatOpen(true);
    setCatTyping(true);
    setCatActiveIndex(0);
    clearTimeout(catTimerRef.current);
    catTimerRef.current = setTimeout(() => {
      setCatDebouncedQuery(val.trim());
    }, DEBOUNCE_MS);
  };

  const handleCatKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!catOpen) openCategoryDropdown();
      else if (visibleCatOptions.length > 0) setCatActiveIndex(i => (i + 1) % visibleCatOptions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!catOpen) openCategoryDropdown();
      else if (visibleCatOptions.length > 0) {
        setCatActiveIndex(i => (i - 1 + visibleCatOptions.length) % visibleCatOptions.length);
      }
    } else if (e.key === 'Enter') {
      if (catOpen) {
        e.preventDefault();
        if (!catShowLoading && !catError && visibleCatOptions.length > 0) {
          const idx = Math.min(Math.max(catActiveIndex, 0), visibleCatOptions.length - 1);
          selectCategory(visibleCatOptions[idx].value);
        }
      }
    } else if (e.key === 'Escape') {
      if (catOpen) {
        e.preventDefault();
        closeCategoryDropdown();
      }
    } else if (e.key === 'Tab' && catOpen) {
      closeCategoryDropdown();
    }
  };

  const clearAllFilters = () => {
    clearTimeout(searchTimerRef.current);
    clearTimeout(catTimerRef.current);
    setSearchInput('');
    setAppliedQuery('');
    setSelectedCategory('');
    setCatInput('');
    setCatTyping(false);
    setCatDebouncedQuery('');
    setCatOpen(false);
    setPage(1);
  };

  const openAddTicketModal = () => {
    setEditingTicket(null);
    setForm({ event: '', category: '', price: '', quantity: '' });
    setCreateStatus({ type: '', text: '' });
    setShowTicketModal(true);
    setTimeout(() => ticketEventInputRef.current?.focus(), 20);
  };

  const openEditTicketModal = (ticket) => {
    setEditingTicket(ticket);
    setConfirmDeleteTicketId(null);
    setForm({
      event: ticket.event,
      category: ticket.category || '',
      price: String(ticket.price),
      quantity: String(ticket.quantity),
    });
    setCreateStatus({ type: '', text: '' });
    setShowTicketModal(true);
    setTimeout(() => ticketEventInputRef.current?.focus(), 20);
  };

  const handleDeleteTicket = async (ticket) => {
    if (deletingTicketId) return;
    setDeletingTicketId(ticket.id);

    const r = await api(`/api/tickets/${ticket.id}`, { method: 'DELETE' });
    setDeletingTicketId(null);
    setConfirmDeleteTicketId(null);

    if (r.ok) {
      setStoreBannerNotice(`Đã xoá vé '${ticket.event}'.`);
      setReloadNonce(n => n + 1);
    } else {
      if (r.status === 404) setReloadNonce(n => n + 1);
      setError(getFriendlyError(r, 'delete-ticket'));
    }
  };

  const handleSaveTicket = async (e) => {
    e.preventDefault();
    if (creating) return;

    const trimmedEvent = form.event.trim();
    const trimmedCat = form.category.trim();
    const rawPrice = String(form.price).trim();
    const rawQty = String(form.quantity).trim();

    if (!trimmedEvent) {
      setCreateStatus({ type: 'error', text: 'Vui lòng nhập tên sự kiện.' });
      ticketEventInputRef.current?.focus();
      return;
    }
    if (trimmedEvent.length > 150) {
      setCreateStatus({ type: 'error', text: 'Tên sự kiện tối đa 150 ký tự.' });
      ticketEventInputRef.current?.focus();
      return;
    }
    if (trimmedCat.length > 100) {
      setCreateStatus({ type: 'error', text: 'Danh mục tối đa 100 ký tự.' });
      ticketCategoryInputRef.current?.focus();
      return;
    }

    const parsedPrice = Number(rawPrice);
    if (!rawPrice || Number.isNaN(parsedPrice) || !Number.isFinite(parsedPrice) || parsedPrice < 0 || parsedPrice > 9999999999.99) {
      setCreateStatus({ type: 'error', text: 'Giá vé không hợp lệ (vd: 150000).' });
      ticketPriceInputRef.current?.focus();
      return;
    }

    if (!rawQty || !/^\d+$/.test(rawQty)) {
      setCreateStatus({ type: 'error', text: 'Số lượng phải là số nguyên không âm (vd: 100).' });
      ticketQtyInputRef.current?.focus();
      return;
    }
    const parsedQty = Number(rawQty);

    setCreating(true);
    setCreateStatus({ type: '', text: '' });

    const payload = {
      event: trimmedEvent,
      price: parsedPrice,
      quantity: parsedQty,
    };
    if (trimmedCat) payload.category = trimmedCat;

    const isEdit = Boolean(editingTicket);
    const url = isEdit ? `/api/tickets/${editingTicket.id}` : '/api/tickets';
    const method = isEdit ? 'PUT' : 'POST';

    const r = await api(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setCreating(false);

    if (r.ok) {
      const msg = isEdit ? `Đã cập nhật vé '${trimmedEvent}'.` : `Đã thêm vé '${trimmedEvent}'.`;
      setCreateStatus({ type: 'success', text: msg });
      setStoreBannerNotice(msg);
      setEditingTicket(null);
      setForm({ event: '', category: '', price: '', quantity: '' });
      setReloadNonce(n => n + 1);
      setShowTicketModal(false);
    } else {
      setCreateStatus({ type: 'error', text: getFriendlyError(r, 'save-ticket') });
    }
  };

  const gatewayStatus =
    techState.tickets?.ok || techState.users?.ok
      ? 'online'
      : techState.tickets?.ok === false && techState.users?.ok === false
        ? 'offline'
        : 'checking';

  const activeFilterParts = [];
  if (appliedQuery) activeFilterParts.push(`"${appliedQuery}"`);
  if (selectedCategory) activeFilterParts.push(selectedCategory);
  const activeFilterLabel = activeFilterParts.join(' · ');
  const displayTotalPages = Math.max(totalPages, 1);

  const pageQuantitySum = items.reduce((s, t) => s + Number(t.quantity || 0), 0);
  const lowStockCount = items.filter(t => Number(t.quantity) <= 10).length;

  return (
    <>
      {/* ===== THANH ĐIỀU HƯỚNG QUẢN TRỊ CHUYÊN NGHIỆP (GHIM CỐ ĐỊNH KHI CUỘN) ===== */}
      <header className="admin-header">
        <div className="container admin-header-inner">
          <button
            type="button"
            className="admin-brand"
            onClick={() => {
              setActiveView('tickets');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          >
            <span className="brand-badge"><IconTicketNav /></span>
            <div className="brand-texts">
              <h1 className="brand-title">Bán vé giá rẻ</h1>
              <span className="brand-subtitle">Quản lý Vé · Khách hàng · Hệ phân tán</span>
            </div>
          </button>

          <nav className="admin-tabs" role="tablist" aria-label="Chuyển phân hệ quản trị">
            <button
              type="button"
              role="tab"
              aria-selected={activeView === 'tickets'}
              className={`admin-tab${activeView === 'tickets' ? ' is-active' : ''}`}
              onClick={() => setActiveView('tickets')}
            >
              <IconTicketNav />
              <span>Quản lý vé</span>
              <span className="tab-pill">{total}</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeView === 'users'}
              className={`admin-tab${activeView === 'users' ? ' is-active' : ''}`}
              onClick={() => setActiveView('users')}
            >
              <IconUsersNav />
              <span>Quản lý khách hàng</span>
              {userCount !== null && <span className="tab-pill">{userCount}</span>}
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeView === 'lab'}
              className={`admin-tab${activeView === 'lab' ? ' is-active' : ''}`}
              onClick={() => setActiveView('lab')}
            >
              <IconPulseNav />
              <span>Giám sát hệ thống</span>
            </button>
          </nav>

          <div className="header-status" aria-live="polite">
            {gatewayStatus === 'online' && <span className="gw-pill is-online">● Gateway :8080</span>}
            {gatewayStatus === 'offline' && <span className="gw-pill is-offline">▲ Mất kết nối</span>}
            {gatewayStatus === 'checking' && <span className="gw-pill">◌ Đang kết nối</span>}
          </div>
        </div>

        {/* Thanh tìm kiếm & lọc vé gắn liền dưới Header (chỉ hiện ở phân hệ Quản lý vé, luôn ghim cố định) */}
        <div className="sticky-ticket-bar" hidden={activeView !== 'tickets'}>
          <div className="container ticket-bar-inner" role="search" aria-label="Tìm kiếm và lọc vé">
            <div className="ticket-bar-filters">
              <label className="sr-only" htmlFor="ts-search-input">Tìm theo tên sự kiện</label>
              <div className="search-field-wrap">
                <input
                  ref={searchInputRef}
                  id="ts-search-input"
                  type="text"
                  className="field-input input-with-action"
                  placeholder="Tìm tên sự kiện..."
                  maxLength={100}
                  value={searchInput}
                  onChange={e => handleSearchChange(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                />
                {searchInput && (
                  <button
                    type="button"
                    className="inline-icon-btn"
                    onClick={clearSearchInput}
                    aria-label="Xoá từ khoá"
                  >
                    ×
                  </button>
                )}
              </div>

              <label className="sr-only" htmlFor="ts-category-input">Danh mục</label>
              <div className="combobox-wrap catalog-combo" ref={catBoxRef}>
                <input
                  id="ts-category-input"
                  type="text"
                  role="combobox"
                  className="field-input input-with-action"
                  placeholder="Tất cả danh mục"
                  maxLength={100}
                  autoComplete="off"
                  aria-expanded={catOpen}
                  aria-controls="ts-category-listbox"
                  aria-autocomplete="list"
                  aria-activedescendant={
                    catOpen && !catShowLoading && !catError && visibleCatOptions[catActiveIndex]
                      ? `ts-cat-opt-${catActiveIndex}`
                      : undefined
                  }
                  value={catInput}
                  onFocus={e => {
                    openCategoryDropdown();
                    e.target.select();
                  }}
                  onClick={() => {
                    if (!catOpen) openCategoryDropdown();
                  }}
                  onChange={e => handleCatInputChange(e.target.value)}
                  onKeyDown={handleCatKeyDown}
                />
                <button
                  type="button"
                  className="inline-icon-btn"
                  tabIndex={-1}
                  aria-label={catOpen ? 'Đóng danh mục' : 'Mở danh mục'}
                  onMouseDown={e => {
                    e.preventDefault();
                    if (catOpen) closeCategoryDropdown();
                    else openCategoryDropdown();
                  }}
                >
                  ▾
                </button>

                {catOpen && (
                  <ul id="ts-category-listbox" role="listbox" aria-label="Danh mục" className="dropdown-list">
                    {catShowLoading && (
                      <li role="option" aria-selected="false" aria-disabled="true" className="dropdown-status">
                        Đang tải...
                      </li>
                    )}
                    {!catShowLoading && catError && (
                      <li role="option" aria-selected="false" aria-disabled="true" className="dropdown-status dropdown-error">
                        ⚠ {catError}
                      </li>
                    )}
                    {!catShowLoading && !catError && visibleCatOptions.length === 0 && (
                      <li role="option" aria-selected="false" aria-disabled="true" className="dropdown-status">
                        Không tìm thấy danh mục
                      </li>
                    )}
                    {!catShowLoading && !catError && visibleCatOptions.map((opt, idx) => {
                      const isSelected = opt.value === selectedCategory;
                      const isActive = idx === catActiveIndex;
                      return (
                        <li
                          key={opt.value === '' ? '__all__' : opt.value}
                          id={`ts-cat-opt-${idx}`}
                          role="option"
                          aria-selected={isSelected}
                          className={`dropdown-option${isActive ? ' is-active' : ''}${isSelected ? ' is-selected' : ''}`}
                          onMouseEnter={() => setCatActiveIndex(idx)}
                          onMouseDown={e => {
                            e.preventDefault();
                            selectCategory(opt.value);
                          }}
                        >
                          <span>{opt.label}</span>
                          {isSelected && <span aria-hidden="true">✓</span>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <button
                type="button"
                className="btn-secondary btn-compact"
                disabled={!hasActiveFilter}
                onClick={clearAllFilters}
              >
                Xoá bộ lọc
              </button>
            </div>

            <div className="ticket-bar-actions">
              <div className="view-toggle" role="group" aria-label="Chế độ xem vé">
                <button
                  type="button"
                  className={`toggle-btn${ticketLayout === 'grid' ? ' is-selected' : ''}`}
                  onClick={() => setTicketLayout('grid')}
                >
                  Thẻ vé
                </button>
                <button
                  type="button"
                  className={`toggle-btn${ticketLayout === 'table' ? ' is-selected' : ''}`}
                  onClick={() => setTicketLayout('table')}
                >
                  Bảng
                </button>
              </div>

              <button type="button" className="btn-primary" onClick={openAddTicketModal}>
                <IconPlus />
                <span>Thêm vé mới</span>
              </button>
            </div>
          </div>

          {quickCategories.length > 0 && (
            <div className="container quick-cat-strip">
              <button
                type="button"
                className={`cat-chip${selectedCategory === '' ? ' is-selected' : ''}`}
                onClick={() => selectCategory('')}
              >
                Tất cả ({total})
              </button>
              {quickCategories.map(cat => (
                <button
                  key={cat}
                  type="button"
                  className={`cat-chip${selectedCategory === cat ? ' is-selected' : ''}`}
                  onClick={() => selectCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <main className="container main-body">
        {/* ===== MÀN HÌNH 1: QUẢN LÝ VÉ SỰ KIỆN ===== */}
        <div hidden={activeView !== 'tickets'}>
          {/* 4 Thẻ chỉ số kho vé (KPI) */}
          <div className="kpi-row">
            <div className="kpi-card">
              <span className="kpi-label">Sự kiện khớp lọc</span>
              <strong className="kpi-value">{total}</strong>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Tồn kho trang hiện tại</span>
              <strong className="kpi-value">{pageQuantitySum.toLocaleString('vi-VN')} vé</strong>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Danh mục đang có</span>
              <strong className="kpi-value">{quickCategories.length}</strong>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Sắp hết vé (≤ 10)</span>
              <strong className={`kpi-value${lowStockCount > 0 ? ' is-warn' : ''}`}>{lowStockCount}</strong>
            </div>
          </div>

          {activeFilterLabel && (
            <div className="filter-status-row" aria-live="polite">
              <span>Đang lọc: <b>{activeFilterLabel}</b> — Tìm thấy <b>{total}</b> vé</span>
            </div>
          )}

          {storeBannerNotice && (
            <div className="toast-strip" role="status" aria-live="polite">
              <span>✓ {storeBannerNotice}</span>
              <button type="button" className="toast-close" onClick={() => setStoreBannerNotice('')} aria-label="Đóng">
                ×
              </button>
            </div>
          )}

          {error && (
            <div className="state-box state-error" role="alert">
              <p className="state-text">⚠ {error}</p>
              <button type="button" className="btn-primary" disabled={showLoading} onClick={() => setReloadNonce(n => n + 1)}>
                Thử lại
              </button>
            </div>
          )}

          <section className="product-shelf" aria-label="Danh sách vé" aria-live="polite">
            {showLoading && (
              <div className="state-box state-loading" role="status">
                <p className="state-text">Đang tải danh sách vé...</p>
              </div>
            )}

            {!showLoading && !error && hasLoaded && items.length === 0 && (
              <div className="state-box state-empty">
                <p className="state-title">Không tìm thấy vé phù hợp</p>
                <button type="button" className="btn-primary" onClick={clearAllFilters}>
                  Xoá bộ lọc
                </button>
              </div>
            )}

            {/* Chế độ 1: Thẻ vé trực quan có nút Sửa / Xoá quản trị */}
            {items.length > 0 && ticketLayout === 'grid' && (
              <ul className="product-grid">
                {items.map(t => {
                  const theme = getPosterTheme(t.category, t.id);
                  const qty = Number(t.quantity);
                  const isConfirming = confirmDeleteTicketId === t.id;
                  return (
                    <li key={t.id} className="product-card">
                      <div className={`product-poster ${theme.cls}`}>
                        <PosterArtwork kind={theme.icon} />
                        <span className="ticket-id-badge">#{t.id}</span>
                        <span className="poster-cat-pill">{t.category || 'Khac'}</span>
                      </div>

                      <div className="product-body">
                        <h3 className="product-title">{t.event}</h3>

                        <div className="ticket-perforation" aria-hidden="true">
                          <span className="punch-left" />
                          <span className="punch-line" />
                          <span className="punch-right" />
                        </div>

                        <div className="product-footer">
                          <span className="product-price">
                            {Number(t.price).toLocaleString('vi-VN')} đ
                          </span>
                          <span className={`stock-pill${qty <= 10 ? ' is-low' : ''}`}>
                            {qty > 0 ? `Tồn: ${qty.toLocaleString('vi-VN')}` : 'Hết vé'}
                          </span>
                        </div>

                        <div className="card-admin-bar">
                          {isConfirming ? (
                            <div className="confirm-inline full-w">
                              <button
                                type="button"
                                className="btn-danger btn-compact flex-1"
                                disabled={deletingTicketId === t.id}
                                onClick={() => handleDeleteTicket(t)}
                              >
                                {deletingTicketId === t.id ? '...' : 'Xoá ngay'}
                              </button>
                              <button
                                type="button"
                                className="btn-secondary btn-compact"
                                onClick={() => setConfirmDeleteTicketId(null)}
                              >
                                Huỷ
                              </button>
                            </div>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="btn-secondary btn-compact flex-1"
                                onClick={() => openEditTicketModal(t)}
                              >
                                Sửa vé
                              </button>
                              <button
                                type="button"
                                className="btn-danger-outline btn-compact"
                                onClick={() => setConfirmDeleteTicketId(t.id)}
                              >
                                Xoá
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Chế độ 2: Bảng quản trị chuyên nghiệp */}
            {items.length > 0 && ticketLayout === 'table' && (
              <div className="surface-card table-card">
                <div className="table-scroll">
                  <table className="admin-table" aria-label="Bảng quản lý vé">
                    <thead>
                      <tr>
                        <th>Mã</th>
                        <th>Sự kiện</th>
                        <th>Danh mục</th>
                        <th className="col-right">Giá niêm yết</th>
                        <th className="col-right">Tồn kho</th>
                        <th className="col-right">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(t => {
                        const qty = Number(t.quantity);
                        const isConfirming = confirmDeleteTicketId === t.id;
                        return (
                          <tr key={t.id}>
                            <td className="mono-num">#{t.id}</td>
                            <td className="entity-primary">{t.event}</td>
                            <td><span className="active-tag">{t.category || 'Khac'}</span></td>
                            <td className="col-right mono-num"><b>{Number(t.price).toLocaleString('vi-VN')} đ</b></td>
                            <td className="col-right">
                              <span className={`stock-pill${qty <= 10 ? ' is-low' : ''}`}>{qty} vé</span>
                            </td>
                            <td className="col-right">
                              {isConfirming ? (
                                <div className="confirm-inline justify-end">
                                  <button
                                    type="button"
                                    className="btn-danger btn-compact"
                                    disabled={deletingTicketId === t.id}
                                    onClick={() => handleDeleteTicket(t)}
                                  >
                                    Xoá ngay
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-secondary btn-compact"
                                    onClick={() => setConfirmDeleteTicketId(null)}
                                  >
                                    Huỷ
                                  </button>
                                </div>
                              ) : (
                                <div className="row-actions justify-end">
                                  <button
                                    type="button"
                                    className="btn-secondary btn-compact"
                                    onClick={() => openEditTicketModal(t)}
                                  >
                                    Sửa
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-danger-outline btn-compact"
                                    onClick={() => setConfirmDeleteTicketId(t.id)}
                                  >
                                    Xoá
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {totalPages > 1 && (
            <nav className="pagination-bar" aria-label="Phân trang">
              <button
                type="button"
                className="btn-secondary"
                disabled={page <= 1 || showLoading}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                ← Trước
              </button>
              <span className="page-indicator">Trang {page} / {displayTotalPages}</span>
              <button
                type="button"
                className="btn-secondary"
                disabled={page >= displayTotalPages || showLoading}
                onClick={() => setPage(p => Math.min(displayTotalPages, p + 1))}
              >
                Sau →
              </button>
            </nav>
          )}
        </div>

        {/* ===== MÀN HÌNH 2: QUẢN LÝ KHÁCH HÀNG ===== */}
        <div hidden={activeView !== 'users'}>
          <Users onTechInfo={handleTechInfo} onCountChange={setUserCount} />
        </div>

        {/* ===== MÀN HÌNH 3: GIÁM SÁT HỆ THỐNG PHÂN TÁN ===== */}
        <div hidden={activeView !== 'lab'}>
          <section className="view-panel" aria-labelledby="lab-view-heading">
            <h2 id="lab-view-heading" className="sr-only">Giám sát hệ thống phân tán</h2>

            <ClusterTopology activeDataNode={techState.tickets?.cache} />

            <div className="surface-card">
              <LoadBalancer />

              <details className="tech-details">
                <summary className="tech-summary">Thông tin kỹ thuật (dành cho demo)</summary>
                <div className="tech-content">
                  <div className="tech-telemetry">
                    <div className="tech-metric-card">
                      <p className="meta">
                        <b>/api/tickets:</b>{' '}
                        {techState.tickets?.ok ? (
                          <>
                            {formatCacheSource(techState.tickets.cache)} ·{' '}
                            <b className="mono-num">{techState.tickets.ms} ms</b> ·{' '}
                            <span className="mono-label">{techState.tickets.servedBy}</span> · Upstream:{' '}
                            <span className="mono-label">{techState.tickets.upstream}</span>
                          </>
                        ) : (
                          'Chưa gọi'
                        )}
                      </p>
                    </div>
                    <div className="tech-metric-card">
                      <p className="meta">
                        <b>/api/users:</b>{' '}
                        {techState.users?.ok ? (
                          <>
                            Cơ sở dữ liệu (users_db) · <b className="mono-num">{techState.users.ms} ms</b> ·{' '}
                            <span className="mono-label">{techState.users.servedBy}</span> · Upstream:{' '}
                            <span className="mono-label">{techState.users.upstream}</span>
                          </>
                        ) : (
                          'Chưa gọi'
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              </details>
            </div>

            <TechnicalEvidenceSection />
          </section>
        </div>
      </main>

      {/* ===== MODAL THÊM / SỬA VÉ SỰ KIỆN ===== */}
      <div
        className="modal-backdrop"
        hidden={!showTicketModal}
        onMouseDown={e => {
          if (e.target === e.currentTarget) setShowTicketModal(false);
        }}
      >
        <div className="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="modal-ticket-title">
          <div className="modal-header">
            <h2 id="modal-ticket-title" className="modal-title">
              {editingTicket ? `Chỉnh sửa vé #${editingTicket.id}` : 'Thêm vé sự kiện mới'}
            </h2>
            <button
              type="button"
              className="modal-close-btn"
              onClick={() => setShowTicketModal(false)}
              aria-label="Đóng"
            >
              ×
            </button>
          </div>

          <form className="seller-form" onSubmit={handleSaveTicket} noValidate>
            <div className="form-stack">
              <div className="field">
                <label className="field-label" htmlFor="ticket-event-input">Tên sự kiện *</label>
                <input
                  ref={ticketEventInputRef}
                  id="ticket-event-input"
                  type="text"
                  className="field-input"
                  placeholder="VD: Live Concert Những Thành Phố Mơ Màng"
                  maxLength={150}
                  value={form.event}
                  onChange={e => setForm({ ...form, event: e.target.value })}
                  required
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="ticket-category-create-input">Danh mục</label>
                <input
                  ref={ticketCategoryInputRef}
                  id="ticket-category-create-input"
                  type="text"
                  className="field-input"
                  placeholder="VD: Âm nhạc, Công nghệ, Thể thao..."
                  maxLength={100}
                  value={form.category}
                  onChange={e => setForm({ ...form, category: e.target.value })}
                />
              </div>

              <div className="create-two-col">
                <div className="field">
                  <label className="field-label" htmlFor="ticket-price-input">Giá vé (VNĐ) *</label>
                  <input
                    ref={ticketPriceInputRef}
                    id="ticket-price-input"
                    type="text"
                    inputMode="numeric"
                    className="field-input"
                    placeholder="450000"
                    value={form.price}
                    onChange={e => setForm({ ...form, price: e.target.value })}
                    required
                  />
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="ticket-qty-input">Số lượng tồn *</label>
                  <input
                    ref={ticketQtyInputRef}
                    id="ticket-qty-input"
                    type="text"
                    inputMode="numeric"
                    className="field-input"
                    placeholder="100"
                    value={form.quantity}
                    onChange={e => setForm({ ...form, quantity: e.target.value })}
                    required
                  />
                </div>
              </div>
            </div>

            {createStatus.type === 'error' && (
              <p className="feedback feedback-error" role="alert">⚠ {createStatus.text}</p>
            )}

            <div className="modal-footer-actions">
              <button type="button" className="btn-secondary" onClick={() => setShowTicketModal(false)}>
                Huỷ
              </button>
              <button type="submit" className="btn-primary" disabled={creating}>
                {creating ? 'Đang lưu...' : editingTicket ? 'Lưu thay đổi' : 'Tạo vé mới'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* ===== CHÂN TRANG ===== */}
      <footer className="admin-footer">
        <div className="container footer-grid">
          <p className="support-note">
            Bán vé giá rẻ · Đồ án Hệ phân tán · Cần hỗ trợ? Liên hệ quản trị viên hệ thống.
          </p>
          <a className="footer-link" href="https://github.com/anh-pc/doanhephantan.git" target="_blank" rel="noreferrer">
            GitHub: anh-pc/doanhephantan
          </a>
        </div>
      </footer>
    </>
  );
}

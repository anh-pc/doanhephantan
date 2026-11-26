import { useEffect, useRef, useState } from 'react';

const PAGE_SIZE = 12;
const DEBOUNCE_MS = 300;
const LOADING_DELAY_MS = 150;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SERVER_UNREACHABLE_MSG = 'Không kết nối được máy chủ. Vui lòng thử lại sau.';

// Gọi API qua Gateway (/api/...), bắt toàn bộ lỗi mạng an toàn
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
    if (r.status === 409) {
      return 'Email này đã được sử dụng. Vui lòng nhập một địa chỉ email khác.';
    }
    if (r.status === 404) {
      return 'Người dùng này không còn tồn tại. Danh sách đã được cập nhật lại.';
    }
    if (r.status === 400) {
      return 'Thông tin người dùng chưa hợp lệ. Vui lòng kiểm tra lại họ tên và định dạng email.';
    }
  }
  if (action === 'delete-user' && r.status === 404) {
    return 'Người dùng này đã được xoá trước đó.';
  }
  if (action === 'create-ticket' && r.status === 400) {
    return 'Thông tin vé chưa hợp lệ. Vui lòng kiểm tra lại tên sự kiện, giá vé và số lượng.';
  }
  return 'Yêu cầu chưa thực hiện được. Vui lòng kiểm tra lại thông tin và thử lại.';
}

function formatCacheSource(cacheValue) {
  if (cacheValue === 'HIT') {
    return 'Bộ nhớ đệm (Redis — HIT)';
  }
  if (cacheValue === 'MISS') {
    return 'Cơ sở dữ liệu (PostgreSQL — MISS, đã lưu vào bộ nhớ đệm)';
  }
  if (cacheValue === 'BYPASS') {
    return 'Cơ sở dữ liệu (PostgreSQL — truy vấn trực tiếp khi lọc/phân trang)';
  }
  return 'Chưa có dữ liệu';
}

function getInitial(name) {
  const s = String(name || '').trim();
  return s ? s[0].toUpperCase() : 'U';
}

// Chọn chủ đề màu poster cho từng thẻ vé dựa trên danh mục / id (0 KB ảnh ngoài)
function getPosterTheme(category, id) {
  const cat = String(category || '').toLowerCase();
  if (cat.includes('nhac') || cat.includes('music') || cat.includes('concert') || cat.includes('live')) {
    return { cls: 'poster-music', tag: 'Âm nhạc & Live', icon: 'music' };
  }
  if (cat.includes('hoi') || cat.includes('tech') || cat.includes('thao') || cat.includes('work')) {
    return { cls: 'poster-conf', tag: 'Sự kiện & Hội thảo', icon: 'stage' };
  }
  const variants = ['poster-fest', 'poster-sunset', 'poster-ocean', 'poster-royal'];
  return { cls: variants[(Number(id) || 0) % variants.length], tag: 'Vé chính thức', icon: 'star' };
}

/* ===== Bộ Icon & Minh hoạ SVG nội tuyến ===== */
function PosterArtwork({ kind }) {
  if (kind === 'music') {
    return (
      <svg className="poster-svg" viewBox="0 0 320 140" fill="none" aria-hidden="true">
        <circle cx="260" cy="30" r="70" fill="rgba(255,255,255,0.12)" />
        <circle cx="60" cy="120" r="55" fill="rgba(255,255,255,0.08)" />
        <path d="M185 95V42l48-10v45" stroke="rgba(255,255,255,0.85)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="175" cy="97" r="10" fill="rgba(255,255,255,0.9)" />
        <circle cx="223" cy="80" r="10" fill="rgba(255,255,255,0.9)" />
        <path d="M28 106h10M48 92v28M68 78v42M88 96v24M108 86v34M128 100v20" stroke="rgba(255,255,255,0.5)" strokeWidth="5" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'stage') {
    return (
      <svg className="poster-svg" viewBox="0 0 320 140" fill="none" aria-hidden="true">
        <polygon points="0,0 120,0 60,140 0,140" fill="rgba(255,255,255,0.08)" />
        <polygon points="210,0 320,0 320,140 160,140" fill="rgba(255,255,255,0.1)" />
        <rect x="176" y="34" width="108" height="68" rx="10" stroke="rgba(255,255,255,0.75)" strokeWidth="3" />
        <path d="M196 58h68M196 74h44" stroke="rgba(255,255,255,0.8)" strokeWidth="3.5" strokeLinecap="round" />
        <circle cx="230" cy="116" r="5" fill="rgba(255,255,255,0.8)" />
      </svg>
    );
  }
  return (
    <svg className="poster-svg" viewBox="0 0 320 140" fill="none" aria-hidden="true">
      <circle cx="250" cy="70" r="80" fill="rgba(255,255,255,0.1)" />
      <circle cx="250" cy="70" r="48" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeDasharray="6 6" />
      <path d="M225 46h50a8 8 0 0 1 8 8v10a8 8 0 0 0 0 16v10a8 8 0 0 1-8 8h-50a8 8 0 0 1-8-8V80a8 8 0 0 0 0-16V54a8 8 0 0 1 8-8Z" stroke="rgba(255,255,255,0.88)" strokeWidth="3" />
    </svg>
  );
}

function IconBrandLogo() {
  return (
    <svg className="brand-logo-svg" viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <rect width="36" height="36" rx="10" fill="#FFFFFF" />
      <path d="M7 13.5V11a2.5 2.5 0 0 1 2.5-2.5h17A2.5 2.5 0 0 1 29 11v2.5a2.5 2.5 0 0 0 0 5V21a2.5 2.5 0 0 1-2.5 2.5h-17A2.5 2.5 0 0 1 7 21v-2.5a2.5 2.5 0 0 0 0-5Z" fill="#C8372D" />
      <path d="M18 11.5v9" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 3" />
      <path d="m13 27 5-2.5L23 27" stroke="#C8372D" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg className="icon-18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m20 20-3.8-3.8" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg className="icon-18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
    </svg>
  );
}

/* ===== Sơ đồ Luồng Kiến trúc (dùng trong màn hình Demo Hệ phân tán) ===== */
function ArchitectureBanner({ activeDataNode }) {
  const isRedisActive = activeDataNode === 'HIT';
  const isPgActive = activeDataNode === 'MISS' || activeDataNode === 'BYPASS';

  return (
    <div
      className="arch-diagram"
      role="img"
      aria-label="Sơ đồ luồng yêu cầu: Trình duyệt qua Nginx Gateway cổng 8080 tới User Service và cụm Ticket Service, kết nối PostgreSQL và bộ nhớ đệm Redis"
    >
      <div className="arch-caption">
        <span>Sơ đồ luồng kiến trúc hệ thống trực tiếp</span>
        {activeDataNode && (
          <span className={`arch-live-pill ${isRedisActive ? 'is-redis' : 'is-pg'}`}>
            {isRedisActive ? '⚡ Vừa đọc từ: Bộ nhớ đệm Redis (HIT)' : '🗄 Vừa đọc từ: Cơ sở dữ liệu PostgreSQL'}
          </span>
        )}
      </div>

      <div className="arch-flow">
        <div className="arch-node arch-gateway">
          <span className="arch-node-role">Cổng vào duy nhất</span>
          <strong>Nginx Gateway :8080</strong>
          <span className="arch-node-sub">Round-Robin · Failover</span>
        </div>

        <div className="arch-arrow" aria-hidden="true">→</div>

        <div className="arch-stack">
          <div className="arch-node">
            <strong>Ticket Service ×N</strong>
            <span className="arch-node-sub">Flask · Stateless</span>
          </div>
          <div className="arch-node">
            <strong>User Service</strong>
            <span className="arch-node-sub">Node.js · Express</span>
          </div>
        </div>

        <div className="arch-arrow" aria-hidden="true">→</div>

        <div className="arch-stack">
          <div className={`arch-node${isRedisActive ? ' is-lit-redis' : ''}`}>
            <strong>Redis Cache</strong>
            <span className="arch-node-sub">Cache-aside · TTL 30–60s</span>
          </div>
          <div className={`arch-node${isPgActive ? ' is-lit-pg' : ''}`}>
            <strong>PostgreSQL ×2 DB</strong>
            <span className="arch-node-sub">tickets_db · users_db</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===== TRANG 2: QUẢN LÝ NGƯỜI DÙNG (CRM Khách hàng) ===== */
function Users({ onTechInfo, onCountChange }) {
  const [items, setItems] = useState([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadNonce, setReloadNonce] = useState(0);

  const [editingUser, setEditingUser] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const [form, setForm] = useState({ name: '', email: '' });
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState({ type: '', text: '' });

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

  const startEdit = (user) => {
    setEditingUser(user);
    setConfirmDeleteId(null);
    setForm({ name: user.name, email: user.email });
    setFeedback({ type: '', text: '' });
    setTimeout(() => nameInputRef.current?.focus(), 0);
  };

  const cancelEdit = () => {
    setEditingUser(null);
    setForm({ name: '', email: '' });
    setFeedback({ type: '', text: '' });
    nameInputRef.current?.focus();
  };

  const handleDelete = async (user) => {
    if (deletingId) return;
    setDeletingId(user.id);
    setFeedback({ type: '', text: '' });

    const r = await api(`/api/users/${user.id}`, { method: 'DELETE' });
    setDeletingId(null);
    setConfirmDeleteId(null);

    if (r.ok) {
      if (editingUser && editingUser.id === user.id) {
        setEditingUser(null);
        setForm({ name: '', email: '' });
      }
      setFeedback({ type: 'success', text: `Đã xoá người dùng '${user.name}'.` });
      setReloadNonce(n => n + 1);
    } else {
      if (r.status === 404) setReloadNonce(n => n + 1);
      setFeedback({ type: 'error', text: getFriendlyError(r, 'delete-user') });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;

    const trimmedName = form.name.trim();
    const trimmedEmail = form.email.trim();

    if (!trimmedName) {
      setFeedback({ type: 'error', text: 'Vui lòng nhập họ và tên người dùng.' });
      nameInputRef.current?.focus();
      return;
    }
    if (trimmedName.length > 100) {
      setFeedback({ type: 'error', text: 'Họ và tên không được vượt quá 100 ký tự.' });
      nameInputRef.current?.focus();
      return;
    }
    if (!trimmedEmail || !EMAIL_RE.test(trimmedEmail)) {
      setFeedback({
        type: 'error',
        text: 'Địa chỉ email chưa đúng định dạng. Vui lòng nhập theo mẫu ten@mien.com.',
      });
      emailInputRef.current?.focus();
      return;
    }
    if (trimmedEmail.length > 150) {
      setFeedback({ type: 'error', text: 'Địa chỉ email không được vượt quá 150 ký tự.' });
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
      setFeedback({
        type: 'success',
        text: isEdit
          ? `Đã cập nhật người dùng '${trimmedName}'.`
          : `Đã thêm người dùng '${trimmedName}'.`,
      });
      setEditingUser(null);
      setForm({ name: '', email: '' });
      setReloadNonce(n => n + 1);
      nameInputRef.current?.focus();
    } else {
      if (r.status === 404) {
        setEditingUser(null);
        setReloadNonce(n => n + 1);
      }
      setFeedback({ type: 'error', text: getFriendlyError(r, 'save-user') });
    }
  };

  return (
    <section className="view-panel" aria-labelledby="users-heading">
      <div className="section-banner">
        <div>
          <h2 id="users-heading">Quản lý người dùng</h2>
          <p className="section-sub">Danh sách khách hàng và quản trị viên đăng ký trên hệ thống</p>
        </div>
        {hasLoaded && <span className="pill-count">{items.length} tài khoản</span>}
      </div>

      <div className="crm-layout">
        <div className="surface-card">
          {loadError && (
            <div className="state-box state-error" role="alert">
              <p className="state-text">⚠ Lỗi: {loadError}</p>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setReloadNonce(n => n + 1)}
              >
                Thử lại
              </button>
            </div>
          )}

          <div className="list-region user-list-region" aria-live="polite">
            {loading && !hasLoaded && (
              <div className="state-box state-loading" role="status">
                <p className="state-text">Đang tải danh sách người dùng...</p>
              </div>
            )}

            {!loading && !loadError && hasLoaded && items.length === 0 && (
              <div className="state-box">
                <p className="state-text">Chưa có người dùng nào trong hệ thống.</p>
              </div>
            )}

            {items.length > 0 && (
              <ul className="crm-list" aria-label="Danh sách người dùng">
                {items.map(u => {
                  const isBeingEdited = editingUser?.id === u.id;
                  const isConfirmingDelete = confirmDeleteId === u.id;
                  return (
                    <li
                      key={u.id}
                      className={`crm-row${isBeingEdited ? ' is-editing' : ''}`}
                    >
                      <div className="user-info">
                        <span className="user-avatar" aria-hidden="true">{getInitial(u.name)}</span>
                        <div className="user-text">
                          <span className="entity-primary">{u.name}</span>
                          <span className="entity-secondary">{u.email}</span>
                        </div>
                      </div>

                      <div className="row-actions">
                        {isConfirmingDelete ? (
                          <div className="confirm-inline" role="group" aria-label={`Xác nhận xoá ${u.name}`}>
                            <span className="confirm-label">Xoá tài khoản này?</span>
                            <button
                              type="button"
                              className="btn-danger btn-compact"
                              disabled={deletingId === u.id}
                              onClick={() => handleDelete(u)}
                            >
                              {deletingId === u.id ? 'Đang xoá...' : 'Đồng ý'}
                            </button>
                            <button
                              type="button"
                              className="btn-secondary btn-compact"
                              disabled={deletingId === u.id}
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              Huỷ
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="btn-secondary btn-compact"
                              onClick={() => startEdit(u)}
                              aria-label={`Sửa người dùng ${u.name}`}
                            >
                              Sửa
                            </button>
                            <button
                              type="button"
                              className="btn-danger-outline btn-compact"
                              onClick={() => setConfirmDeleteId(u.id)}
                              aria-label={`Xoá người dùng ${u.name}`}
                            >
                              Xoá
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <aside className="surface-card sticky-side">
          <form
            className="seller-form"
            onSubmit={handleSubmit}
            noValidate
            aria-label={editingUser ? 'Chỉnh sửa người dùng' : 'Thêm người dùng mới'}
          >
            <div className="form-header-row">
              <h3 className="form-heading">
                {editingUser ? 'Cập nhật tài khoản' : 'Thêm khách hàng mới'}
              </h3>
              {editingUser && (
                <span className="active-tag">Mã #{editingUser.id}</span>
              )}
            </div>

            <div className="form-stack">
              <div className="field">
                <label className="field-label" htmlFor="user-name-input">
                  Họ và tên <span aria-hidden="true">*</span>
                </label>
                <input
                  ref={nameInputRef}
                  id="user-name-input"
                  type="text"
                  className="field-input"
                  placeholder="Ví dụ: Nguyễn Văn An"
                  maxLength={100}
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  aria-describedby="user-name-hint"
                  required
                />
                <p id="user-name-hint" className="field-hint">
                  Tối đa 100 ký tự.
                </p>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="user-email-input">
                  Địa chỉ email <span aria-hidden="true">*</span>
                </label>
                <input
                  ref={emailInputRef}
                  id="user-email-input"
                  type="email"
                  className="field-input"
                  placeholder="Ví dụ: an.nguyen@example.com"
                  maxLength={150}
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  aria-describedby="user-email-hint"
                  required
                />
                <p id="user-email-hint" className="field-hint">
                  Định dạng hợp lệ ten@mien.com (tối đa 150 ký tự).
                </p>
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting
                  ? 'Đang gửi...'
                  : editingUser
                    ? 'Lưu cập nhật'
                    : 'Thêm người dùng'}
              </button>
              {editingUser && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={submitting}
                  onClick={cancelEdit}
                >
                  Huỷ
                </button>
              )}
            </div>

            {feedback.type === 'success' && (
              <p className="feedback feedback-success" role="status" aria-live="polite">
                ✓ Thành công: {feedback.text}
              </p>
            )}
            {feedback.type === 'error' && (
              <p className="feedback feedback-error" role="alert">
                ⚠ Lỗi: {feedback.text}
              </p>
            )}

            <p className="privacy-note">
              Thông tin chỉ dùng để quản lý vé trong hệ thống này.
            </p>
          </form>
        </aside>
      </div>
    </section>
  );
}

/* ===== KHU VỰC GIÁM SÁT CÂN BẰNG TẢI & 3 KỊCH BẢN ===== */
function LoadBalancer() {
  const [counts, setCounts] = useState({});
  const [prevRunSummary, setPrevRunSummary] = useState('');
  const [runErrors, setRunErrors] = useState(0);
  const [stats, setStats] = useState(null);
  const [cacheHistory, setCacheHistory] = useState({ missMs: null, hitMs: null });
  const [busyWhoami, setBusyWhoami] = useState(false);
  const [busyStats, setBusyStats] = useState(false);
  const [lbError, setLbError] = useState('');

  const fire = async () => {
    setBusyWhoami(true);
    setLbError('');

    const existingEntries = Object.entries(counts);
    if (existingEntries.length > 0) {
      const summary = `${existingEntries.length} bản sao (${existingEntries.map(([, v]) => v).join('/')})`;
      setPrevRunSummary(summary);
    }

    const c = {};
    let errors = 0;
    for (let i = 0; i < 30; i++) {
      const r = await api('/api/tickets/whoami');
      if (r.ok) {
        c[r.body.served_by] = (c[r.body.served_by] || 0) + 1;
      } else {
        errors++;
      }
    }
    if (errors === 30) {
      setLbError(SERVER_UNREACHABLE_MSG);
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
    setStats({ cache: cacheState, ms: r.ms, by: r.body.served_by });
    setCacheHistory(prev => ({
      missMs: cacheState === 'MISS' ? r.ms : prev.missMs,
      hitMs: cacheState === 'HIT' ? r.ms : prev.hitMs,
    }));
  };

  const entries = Object.entries(counts);
  const total = entries.reduce((a, [, b]) => a + b, 0) || 1;

  return (
    <div className="lab-scenarios" aria-labelledby="lb-heading">
      <div className="lab-intro">
        <h3 id="lb-heading" className="lb-heading">Giám sát cân bằng tải &amp; 3 kịch bản kiểm chứng</h3>
        <p className="field-hint">
          Thực hiện trực tiếp trên cụm container đang chạy để kiểm chứng Round-Robin, bộ nhớ đệm Redis và chịu lỗi.
        </p>
      </div>

      {lbError && (
        <p className="feedback feedback-error" role="alert">
          ⚠ Lỗi: {lbError}
        </p>
      )}

      <div className="scenario-grid">
        <article className="scenario-card">
          <div className="scenario-step">Kịch bản 01 · Cân bằng tải</div>
          <h4 className="scenario-title">Gửi 30 request liên tiếp</h4>
          <p className="field-hint">
            Chia đều qua các bản sao <code className="inline-code">ticket-service</code>. Vạch đứng là mốc lý tưởng 33,3%.
          </p>
          <button
            type="button"
            className="btn-primary"
            disabled={busyWhoami}
            onClick={fire}
          >
            {busyWhoami ? 'Đang gửi 30 yêu cầu...' : 'Gửi 30 request'}
          </button>

          <div className="bar-list" aria-live="polite">
            {entries.length > 0 && (
              <div className="compare-strip">
                <span>
                  Hiện tại: <b>{entries.length} bản sao</b> ({entries.map(([, v]) => v).join('/')}) ·{' '}
                  <b>{runErrors} lỗi</b>
                </span>
                {prevRunSummary && (
                  <span className="compare-prev">Lần trước: {prevRunSummary}</span>
                )}
              </div>
            )}
            {entries.map(([k, v]) => (
              <div key={k} className="bar">
                <span className="mono-label" title={k}>{k}</span>
                <div className="bar-track bar-track-ideal">
                  <i style={{ width: `${(v / total) * 100}%` }} />
                </div>
                <b className="mono-num">{v}</b>
              </div>
            ))}
          </div>
        </article>

        <article className="scenario-card">
          <div className="scenario-step">Kịch bản 02 · Cache-aside</div>
          <h4 className="scenario-title">Truy vấn nặng MISS → HIT</h4>
          <p className="field-hint">
            Lần 1 đọc PostgreSQL (~500 ms); lần 2 trong 60 giây trả ngay từ bộ nhớ đệm Redis.
          </p>
          <button
            type="button"
            className="btn-secondary"
            disabled={busyStats}
            onClick={heavy}
          >
            {busyStats ? 'Đang tải thống kê...' : 'Gọi truy vấn nặng (/stats)'}
          </button>

          {stats && (
            <div className="cache-result-box" aria-live="polite">
              <span className={`cache-badge ${stats.cache === 'HIT' ? 'is-hit' : 'is-miss'}`}>
                {stats.cache === 'HIT' ? '✓ REDIS · HIT' : '● DB · MISS'}
              </span>
              <p className="meta">
                Nguồn: <b>{formatCacheSource(stats.cache)}</b>
              </p>
              <p className="meta">
                Độ trễ: <b className="mono-num">{stats.ms} ms</b> · Bản sao: <b className="mono-label">{stats.by}</b>
              </p>
              {cacheHistory.missMs !== null && cacheHistory.hitMs !== null && (
                <p className="speedup-note">
                  Đối chiếu: MISS <b>{cacheHistory.missMs} ms</b> → HIT <b>{cacheHistory.hitMs} ms</b>
                </p>
              )}
            </div>
          )}
        </article>

        <article className="scenario-card">
          <div className="scenario-step">Kịch bản 03 · Chịu lỗi (HA)</div>
          <h4 className="scenario-title">Dừng 1 bản sao bằng CLI</h4>
          <p className="field-hint">
            1. Chạy lệnh trong Terminal để dừng 1 container:
          </p>
          <code className="cli-box" tabIndex={0} aria-label="Lệnh dừng một bản sao ticket-service">
            ./scripts/kill-one.sh
          </code>
          <p className="field-hint">
            2. Bấm lại <b>&ldquo;Gửi 30 request&rdquo;</b> ở Kịch bản 01 để thấy tải tự chuyển sang bản sao còn sống (0 lỗi).
          </p>
          <p className="field-hint">3. Khôi phục đủ 3 bản sao:</p>
          <code className="cli-box" tabIndex={0} aria-label="Lệnh khôi phục 3 bản sao ticket-service">
            ./scripts/scale.sh 3
          </code>
        </article>
      </div>
    </div>
  );
}

function TechnicalEvidenceSection() {
  const replicas = [
    { name: 'Bản sao 01', count: 99, pct: 33.0 },
    { name: 'Bản sao 02', count: 99, pct: 33.0 },
    { name: 'Bản sao 03', count: 102, pct: 34.0 },
  ];

  return (
    <div className="surface-card evidence-block">
      <div className="form-header-row">
        <h3 className="lb-heading">Kết quả đo kiểm thực nghiệm (300 request)</h3>
        <span className="active-tag">Số liệu thực tế của nhóm</span>
      </div>

      <dl className="evidence-metrics">
        <div className="metric-tile">
          <dt>Độ tin cậy (300 request)</dt>
          <dd className="metric-number is-good">0 lỗi</dd>
          <span className="metric-sub">Phân phối 99 / 99 / 102 trên 3 bản sao</span>
        </div>

        <div className="metric-tile">
          <dt>Độ trễ bình thường</dt>
          <dd className="metric-number">p95: 2,2 ms</dd>
          <span className="metric-sub">Độ trễ tối đa: 11,7 ms</span>
        </div>

        <div className="metric-tile">
          <dt>Khi dừng 1 bản sao</dt>
          <dd className="metric-number is-warn">≈ 1006 ms</dd>
          <span className="metric-sub">Tối đa lúc Nginx chờ 1s chuyển tiếp</span>
        </div>

        <div className="metric-tile metric-unmeasured">
          <dt>Độ trễ bộ nhớ đệm Redis</dt>
          <dd className="metric-placeholder">Chưa đo</dd>
          <span className="metric-sub">Đo trực tiếp tại Kịch bản 02 phía trên</span>
        </div>
      </dl>

      <div className="evidence-bars" role="group" aria-label="Phân phối thực nghiệm 300 request trên 3 bản sao">
        <p className="evidence-bars-title">Tỷ lệ chia tải thực tế 300 request qua Nginx Round-Robin:</p>
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

      <p className="evidence-source">
        Nguồn số đo: <code className="inline-code">scripts/lb_test.py --n 300</code> qua cổng Gateway <code className="inline-code">:8080</code> trên Docker Compose cục bộ (<code className="inline-code">--scale ticket-service=3</code>).
      </p>
    </div>
  );
}

/* ===== ỨNG DỤNG SÀN VÉ TRỰC TUYẾN (PHONG CÁCH SHOPEE / TICKETBOX THẬT) ===== */
export default function App() {
  const [activeView, setActiveView] = useState('tickets'); // 'tickets' | 'users' | 'lab'
  const [userCount, setUserCount] = useState(null);
  const [techState, setTechState] = useState({ tickets: null, users: null });

  // Trạng thái Cửa hàng Vé & Tìm kiếm ngay trên Header như Shopee
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

  // Combobox tìm danh mục phía server
  const [catInput, setCatInput] = useState('');
  const [catOpen, setCatOpen] = useState(false);
  const [catTyping, setCatTyping] = useState(false);
  const [catDebouncedQuery, setCatDebouncedQuery] = useState('');
  const [catOptions, setCatOptions] = useState([]);
  const [catShowLoading, setCatShowLoading] = useState(false);
  const [catError, setCatError] = useState('');
  const [catActiveIndex, setCatActiveIndex] = useState(0);

  // Modal / Drawer Đăng bán vé mới (không chiếm chỗ cố định trên trang hàng!)
  const [showCreateModal, setShowCreateModal] = useState(false);
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

  // Đóng dropdown danh mục khi click ra ngoài
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

  // Đóng modal đăng vé bằng phím Esc
  useEffect(() => {
    if (!showCreateModal) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setShowCreateModal(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showCreateModal]);

  // Tải danh sách danh mục nổi bật ban đầu cho dải pill gợi ý giống Shopee
  useEffect(() => {
    let active = true;
    (async () => {
      const r = await api('/api/tickets/categories?limit=8');
      if (active && r.ok && Array.isArray(r.body.items)) {
        setQuickCategories(r.body.items);
      }
    })();
    return () => { active = false; };
  }, [reloadNonce]);

  // Tải danh sách vé
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

  // Tìm danh mục phía server khi mở combobox
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
    if (activeView !== 'tickets') setActiveView('tickets');
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setAppliedQuery(value.trim());
      setPage(1);
    }, DEBOUNCE_MS);
  };

  const triggerImmediateSearch = () => {
    if (activeView !== 'tickets') setActiveView('tickets');
    clearTimeout(searchTimerRef.current);
    const next = searchInput.trim();
    if (next === appliedQuery && page === 1) {
      setReloadNonce(n => n + 1);
    } else {
      setAppliedQuery(next);
      setPage(1);
    }
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      triggerImmediateSearch();
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
    if (activeView !== 'tickets') setActiveView('tickets');
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

  const openCreateTicketModal = () => {
    setCreateStatus({ type: '', text: '' });
    setShowCreateModal(true);
    setTimeout(() => ticketEventInputRef.current?.focus(), 20);
  };

  const handleCreateTicket = async (e) => {
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
      setCreateStatus({ type: 'error', text: 'Tên sự kiện không được vượt quá 150 ký tự.' });
      ticketEventInputRef.current?.focus();
      return;
    }
    if (trimmedCat.length > 100) {
      setCreateStatus({ type: 'error', text: 'Danh mục không được vượt quá 100 ký tự.' });
      ticketCategoryInputRef.current?.focus();
      return;
    }

    const parsedPrice = Number(rawPrice);
    if (!rawPrice || Number.isNaN(parsedPrice) || !Number.isFinite(parsedPrice) || parsedPrice < 0 || parsedPrice > 9999999999.99) {
      setCreateStatus({
        type: 'error',
        text: 'Giá vé phải là số không âm tính bằng đồng (ví dụ: 150000).',
      });
      ticketPriceInputRef.current?.focus();
      return;
    }

    if (!rawQty || !/^\d+$/.test(rawQty)) {
      setCreateStatus({
        type: 'error',
        text: 'Số lượng vé phải là số nguyên không âm (ví dụ: 50).',
      });
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

    const r = await api('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setCreating(false);

    if (r.ok) {
      const msg = `Đã thêm vé '${trimmedEvent}'.`;
      setCreateStatus({ type: 'success', text: msg });
      setStoreBannerNotice(msg);
      setForm({ event: '', category: '', price: '', quantity: '' });
      setReloadNonce(n => n + 1);
      ticketEventInputRef.current?.focus();
    } else {
      setCreateStatus({ type: 'error', text: getFriendlyError(r, 'create-ticket') });
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

  return (
    <>
      {/* ===== HEADER SÀN THƯƠNG MẠI VÉ (PHONG CÁCH SHOPEE / TICKETBOX) — GHIM KHI CUỘN ===== */}
      <header className="market-header">
        {/* Dải điều hướng trên cùng (Top Utility Bar) */}
        <div className="utility-bar">
          <div className="container utility-inner">
            <div className="utility-left">
              <span>Kênh Quản Trị Bán Vé Chính Thức</span>
              <span className="utility-sep" aria-hidden="true">|</span>
              <span aria-live="polite">
                {gatewayStatus === 'online' && '● Hệ thống trực tuyến (:8080)'}
                {gatewayStatus === 'offline' && '▲ Mất kết nối máy chủ'}
                {gatewayStatus === 'checking' && '◌ Đang kiểm tra kết nối...'}
              </span>
            </div>

            <nav className="utility-nav" role="tablist" aria-label="Chuyển phân hệ">
              <button
                type="button"
                role="tab"
                aria-selected={activeView === 'tickets'}
                className={`utility-tab${activeView === 'tickets' ? ' is-active' : ''}`}
                onClick={() => setActiveView('tickets')}
              >
                Quản lý vé ({total})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeView === 'users'}
                className={`utility-tab${activeView === 'users' ? ' is-active' : ''}`}
                onClick={() => setActiveView('users')}
              >
                Khách hàng {userCount !== null ? `(${userCount})` : ''}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeView === 'lab'}
                className={`utility-tab${activeView === 'lab' ? ' is-active' : ''}`}
                onClick={() => setActiveView('lab')}
              >
                Hệ thống phân tán (Demo)
              </button>
            </nav>
          </div>
        </div>

        {/* Thanh chính: Logo + Ô tìm kiếm lớn như Shopee + Nút Đăng bán vé */}
        <div className="container header-main-row">
          <button
            type="button"
            className="brand-home-btn"
            onClick={() => {
              setActiveView('tickets');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          >
            <IconBrandLogo />
            <div className="brand-wordmark">
              <span className="brand-name">VéSựKiện</span>
              <span className="brand-tag">Sàn vé Microservices</span>
            </div>
          </button>

          <div className="header-search-zone" role="search" aria-label="Tìm kiếm sự kiện">
            <label className="sr-only" htmlFor="ts-search-input">
              Tìm theo tên sự kiện
            </label>
            <div className="shopee-search-box">
              <input
                ref={searchInputRef}
                id="ts-search-input"
                type="text"
                className="shopee-search-input"
                placeholder="Tìm sự kiện, đêm nhạc, hội thảo... (VD: Su kien mau)"
                maxLength={100}
                value={searchInput}
                onChange={e => handleSearchChange(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                aria-describedby="ts-search-hint"
              />
              {searchInput && (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={clearSearchInput}
                  aria-label="Xoá từ khoá tìm kiếm"
                >
                  ×
                </button>
              )}
              <button
                type="button"
                className="shopee-search-submit"
                onClick={triggerImmediateSearch}
                aria-label="Tìm kiếm ngay"
              >
                <IconSearch />
              </button>
            </div>

            <div className="header-hotwords">
              <span id="ts-search-hint" className="hotword-hint">
                Tìm một phần tên, không phân biệt hoa/thường:
              </span>
              <button
                type="button"
                className={`hotword-chip${selectedCategory === '' ? ' is-selected' : ''}`}
                onClick={() => selectCategory('')}
              >
                Tất cả
              </button>
              {quickCategories.slice(0, 5).map(cat => (
                <button
                  key={cat}
                  type="button"
                  className={`hotword-chip${selectedCategory === cat ? ' is-selected' : ''}`}
                  onClick={() => selectCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="header-cta-col">
            <button
              type="button"
              className="btn-post-ticket"
              onClick={openCreateTicketModal}
            >
              <IconPlus />
              <span>Đăng bán vé</span>
            </button>
          </div>
        </div>
      </header>

      <main className="container main-body">
        {/* ===== MÀN HÌNH 1: CỬA HÀNG & QUẢN LÝ VÉ (LƯỚI SẢN PHẨM NHƯ SHOPEE / TICKETBOX) ===== */}
        <div hidden={activeView !== 'tickets'}>
          {/* Banner nổi bật đầu trang cửa hàng */}
          <section className="promo-hero" aria-labelledby="store-hero-h1">
            <div className="promo-banner-main">
              <div className="promo-copy">
                <span className="promo-badge">SÀN VÉ SỰ KIỆN TRỰC TUYẾN</span>
                <h1 id="store-hero-h1">Đặt &amp; Quản Lý Vé Sự Kiện Nhanh Chóng</h1>
                <p>
                  Vận hành trên cụm Microservices cân bằng tải Nginx và bộ nhớ đệm Redis — tìm vé tức thì, cập nhật tồn kho theo thời gian thực.
                </p>
                <div className="promo-actions">
                  <button type="button" className="btn-banner-white" onClick={openCreateTicketModal}>
                    + Mở bán sự kiện mới
                  </button>
                  <button type="button" className="btn-banner-ghost" onClick={() => setActiveView('lab')}>
                    Xem cân bằng tải &amp; Cache →
                  </button>
                </div>
              </div>
              <div className="promo-art" aria-hidden="true">
                <PosterArtwork kind="music" />
              </div>
            </div>

            <div className="promo-side-cards">
              <div className="promo-mini-card mini-indigo">
                <span className="mini-kicker">Kho sự kiện đang mở</span>
                <strong className="mini-big">{total} sự kiện</strong>
                <span className="mini-sub">Phân trang tự động · {PAGE_SIZE} vé / trang</span>
              </div>
              <div className="promo-mini-card mini-teal">
                <span className="mini-kicker">Hạ tầng phân tán</span>
                <strong className="mini-big">Nginx + Redis</strong>
                <span className="mini-sub">Tự động chuyển tiếp khi sự cố</span>
              </div>
            </div>
          </section>

          {storeBannerNotice && (
            <div className="toast-strip" role="status" aria-live="polite">
              <span>✓ Thành công: {storeBannerNotice}</span>
              <button
                type="button"
                className="toast-close"
                onClick={() => setStoreBannerNotice('')}
                aria-label="Đóng thông báo"
              >
                ×
              </button>
            </div>
          )}

          {/* Thanh lọc Danh mục ghim gọn phía trên kệ vé */}
          <section className="catalog-filter-bar" aria-label="Bộ lọc danh mục vé">
            <div className="catalog-filter-left">
              <label className="filter-bar-label" htmlFor="ts-category-input">
                Danh mục:
              </label>

              <div className="combobox-wrap catalog-combo" ref={catBoxRef}>
                <input
                  id="ts-category-input"
                  type="text"
                  role="combobox"
                  className="field-input input-with-action"
                  placeholder="Tất cả danh mục (gõ để tìm...)"
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
                  aria-label={catOpen ? 'Đóng danh sách danh mục' : 'Mở danh sách danh mục'}
                  onMouseDown={e => {
                    e.preventDefault();
                    if (catOpen) closeCategoryDropdown();
                    else openCategoryDropdown();
                  }}
                >
                  ▾
                </button>

                {catOpen && (
                  <ul
                    id="ts-category-listbox"
                    role="listbox"
                    aria-label="Danh sách danh mục"
                    className="dropdown-list"
                  >
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
                className="btn-secondary"
                disabled={!hasActiveFilter}
                onClick={clearAllFilters}
              >
                Xoá bộ lọc
              </button>
            </div>

            <div className="catalog-filter-right" aria-live="polite" aria-atomic="true">
              <span className="result-count-text">Tìm thấy <b>{total}</b> vé</span>
              {activeFilterLabel && (
                <span className="active-tag">Đang lọc: {activeFilterLabel}</span>
              )}
              {total > 0 && (
                <span className="mini-pager">Trang {page}/{displayTotalPages}</span>
              )}
            </div>
          </section>

          {/* Lỗi kết nối */}
          {error && (
            <div className="state-box state-error" role="alert">
              <p className="state-text">⚠ Lỗi: {error}</p>
              <button
                type="button"
                className="btn-primary"
                disabled={showLoading}
                onClick={() => setReloadNonce(n => n + 1)}
              >
                {showLoading ? 'Đang tải...' : 'Thử lại'}
              </button>
            </div>
          )}

          {/* Kệ Thẻ Sản Phẩm Vé (3–4 cột như Shopee / Ticketbox) */}
          <section className="product-shelf" aria-label="Danh sách vé đang mở bán" aria-live="polite">
            {showLoading && (
              <div className="state-box state-loading" role="status">
                <p className="state-text">Đang tải danh sách vé...</p>
              </div>
            )}

            {!showLoading && !error && hasLoaded && items.length === 0 && (
              <div className="state-box state-empty">
                <p className="state-title">Không tìm thấy vé phù hợp</p>
                <p className="state-hint">
                  Thử bỏ bớt từ khoá hoặc chọn &ldquo;Tất cả danh mục&rdquo; để xem lại toàn bộ sự kiện.
                </p>
                <button type="button" className="btn-primary" onClick={clearAllFilters}>
                  Xoá bộ lọc
                </button>
              </div>
            )}

            {items.length > 0 && (
              <ul className="product-grid">
                {items.map(t => {
                  const theme = getPosterTheme(t.category, t.id);
                  const qty = Number(t.quantity);
                  return (
                    <li key={t.id} className="product-card">
                      <div className={`product-poster ${theme.cls}`}>
                        <PosterArtwork kind={theme.icon} />
                        <span className="mall-ribbon">{theme.tag}</span>
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
                          <div className="price-group">
                            <span className="price-label">Giá vé</span>
                            <span className="product-price">
                              {Number(t.price).toLocaleString('vi-VN')} đ
                            </span>
                          </div>
                          <span className={`stock-pill${qty <= 10 ? ' is-low' : ''}`}>
                            {qty > 0 ? `Còn ${qty.toLocaleString('vi-VN')} vé` : 'Hết vé'}
                          </span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Phân trang kiểu sàn thương mại điện tử */}
          {total > 0 && (
            <nav className="pagination-bar" aria-label="Phân trang danh sách vé">
              <button
                type="button"
                className="btn-secondary"
                disabled={page <= 1 || showLoading}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                ← Trước
              </button>
              <span className="page-indicator">
                Trang {page} / {displayTotalPages}
              </span>
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

        {/* ===== MÀN HÌNH 2: QUẢN LÝ NGƯỜI DÙNG ===== */}
        <div hidden={activeView !== 'users'}>
          <Users onTechInfo={handleTechInfo} onCountChange={setUserCount} />
        </div>

        {/* ===== MÀN HÌNH 3: HỆ THỐNG PHÂN TÁN & DEMO ===== */}
        <div hidden={activeView !== 'lab'}>
          <section className="view-panel" aria-labelledby="lab-view-heading">
            <div className="section-banner">
              <div>
                <h2 id="lab-view-heading">Trung tâm Kiểm chứng Hệ phân tán</h2>
                <p className="section-sub">
                  Kiểm tra trực tiếp cân bằng tải Nginx Round-Robin, bộ nhớ đệm Redis và chịu lỗi đa bản sao
                </p>
              </div>
            </div>

            <ArchitectureBanner activeDataNode={techState.tickets?.cache} />

            <div className="surface-card">
              <LoadBalancer />

              <details className="tech-details">
                <summary className="tech-summary">Thông tin kỹ thuật (dành cho demo)</summary>
                <div className="tech-content">
                  <div className="tech-telemetry">
                    <div className="tech-metric-card">
                      <p className="meta">
                        <b>Truy vấn vé gần nhất (/api/tickets):</b>{' '}
                        {techState.tickets?.ok ? (
                          <>
                            Nguồn: <b>{formatCacheSource(techState.tickets.cache)}</b> ·{' '}
                            <b className="mono-num">{techState.tickets.ms} ms</b> · Bản sao:{' '}
                            <b className="mono-label">{techState.tickets.servedBy}</b> · Upstream:{' '}
                            <b className="mono-label">{techState.tickets.upstream}</b>
                          </>
                        ) : (
                          'Chưa có dữ liệu'
                        )}
                      </p>
                    </div>
                    <div className="tech-metric-card">
                      <p className="meta">
                        <b>Truy vấn người dùng gần nhất (/api/users):</b>{' '}
                        {techState.users?.ok ? (
                          <>
                            Nguồn: <b>Cơ sở dữ liệu (PostgreSQL)</b> ·{' '}
                            <b className="mono-num">{techState.users.ms} ms</b> · Bản sao:{' '}
                            <b className="mono-label">{techState.users.servedBy}</b> · Upstream:{' '}
                            <b className="mono-label">{techState.users.upstream}</b>
                          </>
                        ) : (
                          'Chưa có dữ liệu'
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

      {/* ===== HỘP THOẠI (MODAL) ĐĂNG BÁN VÉ MỚI — GỌN ĐẸP NHƯ KÊNH NGƯỜI BÁN ===== */}
      <div
        className="modal-backdrop"
        hidden={!showCreateModal}
        onMouseDown={e => {
          if (e.target === e.currentTarget) setShowCreateModal(false);
        }}
      >
        <div
          className="modal-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-create-ticket-title"
        >
          <div className="modal-header">
            <div>
              <h2 id="modal-create-ticket-title" className="modal-title">Đăng bán vé sự kiện mới</h2>
              <p className="field-hint">Điền thông tin sự kiện và nhấn Enter để mở bán ngay lên sàn</p>
            </div>
            <button
              type="button"
              className="modal-close-btn"
              onClick={() => setShowCreateModal(false)}
              aria-label="Đóng cửa sổ đăng vé"
            >
              ×
            </button>
          </div>

          <form className="seller-form" onSubmit={handleCreateTicket} noValidate>
            <div className="form-stack">
              <div className="field">
                <label className="field-label" htmlFor="ticket-event-input">
                  Tên sự kiện <span aria-hidden="true">*</span>
                </label>
                <input
                  ref={ticketEventInputRef}
                  id="ticket-event-input"
                  type="text"
                  className="field-input"
                  placeholder="Ví dụ: Đêm nhạc Acoustic Mùa Thu"
                  maxLength={150}
                  value={form.event}
                  onChange={e => setForm({ ...form, event: e.target.value })}
                  aria-describedby="ticket-event-hint"
                  required
                />
                <p id="ticket-event-hint" className="field-hint">
                  Tên sự kiện hiển thị trên thẻ vé (tối đa 150 ký tự).
                </p>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="ticket-category-create-input">
                  Danh mục sự kiện
                </label>
                <input
                  ref={ticketCategoryInputRef}
                  id="ticket-category-create-input"
                  type="text"
                  className="field-input"
                  placeholder="Ví dụ: Am nhac, Hoi thao..."
                  maxLength={100}
                  value={form.category}
                  onChange={e => setForm({ ...form, category: e.target.value })}
                  aria-describedby="ticket-category-create-hint"
                />
                <p id="ticket-category-create-hint" className="field-hint">
                  Để trống hệ thống sẽ tự phân vào mục &ldquo;Khac&rdquo; (tối đa 100 ký tự).
                </p>
              </div>

              <div className="create-two-col">
                <div className="field">
                  <label className="field-label" htmlFor="ticket-price-input">
                    Giá bán (VNĐ) <span aria-hidden="true">*</span>
                  </label>
                  <input
                    ref={ticketPriceInputRef}
                    id="ticket-price-input"
                    type="text"
                    inputMode="numeric"
                    className="field-input"
                    placeholder="Ví dụ: 150000"
                    value={form.price}
                    onChange={e => setForm({ ...form, price: e.target.value })}
                    aria-describedby="ticket-price-hint"
                    required
                  />
                  <p id="ticket-price-hint" className="field-hint">
                    Giá tính bằng đồng, ví dụ 150000.
                  </p>
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="ticket-qty-input">
                    Số lượng mở bán <span aria-hidden="true">*</span>
                  </label>
                  <input
                    ref={ticketQtyInputRef}
                    id="ticket-qty-input"
                    type="text"
                    inputMode="numeric"
                    className="field-input"
                    placeholder="Ví dụ: 100"
                    value={form.quantity}
                    onChange={e => setForm({ ...form, quantity: e.target.value })}
                    aria-describedby="ticket-qty-hint"
                    required
                  />
                  <p id="ticket-qty-hint" className="field-hint">
                    Số nguyên không âm, ví dụ 100.
                  </p>
                </div>
              </div>
            </div>

            {createStatus.type === 'success' && (
              <p className="feedback feedback-success" role="status" aria-live="polite">
                ✓ Thành công: {createStatus.text}
              </p>
            )}
            {createStatus.type === 'error' && (
              <p className="feedback feedback-error" role="alert">
                ⚠ Lỗi: {createStatus.text}
              </p>
            )}

            <div className="modal-footer-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowCreateModal(false)}
              >
                Đóng
              </button>
              <button type="submit" className="btn-primary" disabled={creating}>
                {creating ? 'Đang gửi...' : 'Đăng bán ngay'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* ===== CHÂN TRANG KIỂU SÀN THƯƠNG MẠI ĐIỆN TỬ ===== */}
      <footer className="market-footer">
        <div className="container footer-grid">
          <div>
            <strong className="footer-brand">VéSựKiện · Sàn Vé Sự Kiện Trực Tuyến</strong>
            <p className="support-note">
              Đồ án môn Hệ phân tán — Nginx API Gateway · Flask · Node.js · PostgreSQL · Redis
            </p>
            <p className="support-note">Cần hỗ trợ? Liên hệ quản trị viên hệ thống.</p>
          </div>
          <div className="footer-links">
            <a href="https://github.com/anh-pc/doanhephantan.git" target="_blank" rel="noreferrer">
              Mã nguồn GitHub (anh-pc/doanhephantan)
            </a>
          </div>
        </div>
      </footer>
    </>
  );
}

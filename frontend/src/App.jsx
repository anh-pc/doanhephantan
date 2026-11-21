import { useEffect, useRef, useState } from 'react';

const PAGE_SIZE = 10;
const DEBOUNCE_MS = 300;
const LOADING_DELAY_MS = 150;

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
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [showLoading, setShowLoading] = useState(false);
  const [error, setError] = useState('');
  const [reloadNonce, setReloadNonce] = useState(0);

  // Bộ lọc tìm kiếm
  const [searchInput, setSearchInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');

  // Dropdown danh mục có tìm kiếm phía server
  const [catInput, setCatInput] = useState('');
  const [catOpen, setCatOpen] = useState(false);
  const [catTyping, setCatTyping] = useState(false);
  const [catDebouncedQuery, setCatDebouncedQuery] = useState('');
  const [catOptions, setCatOptions] = useState([]);
  const [catShowLoading, setCatShowLoading] = useState(false);
  const [catError, setCatError] = useState(false);
  const [catActiveIndex, setCatActiveIndex] = useState(0);

  // Form tạo vé
  const [form, setForm] = useState({ event: '', price: '', quantity: '', category: '' });
  const [createStatus, setCreateStatus] = useState({ type: '', text: '' });
  const [creating, setCreating] = useState(false);

  const searchTimerRef = useRef(null);
  const catTimerRef = useRef(null);
  const catBoxRef = useRef(null);

  const hasActiveFilter = Boolean(searchInput.trim() || appliedQuery || selectedCategory);
  const effectiveCatQuery = catTyping ? catDebouncedQuery.trim() : '';
  const visibleCatOptions = effectiveCatQuery === ''
    ? [{ value: '', label: 'Tất cả danh mục' }, ...catOptions.map(c => ({ value: c, label: c }))]
    : catOptions.map(c => ({ value: c, label: c }));

  // Dọn timer khi unmount
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

  // Tải danh sách vé (có AbortController chống race condition & loading trễ 150ms)
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const loadingTimer = setTimeout(() => {
      if (active) setShowLoading(true);
    }, LOADING_DELAY_MS);

    const params = new URLSearchParams();
    if (appliedQuery) params.set('q', appliedQuery);
    if (selectedCategory) params.set('category', selectedCategory);
    params.set('page', String(page));
    params.set('page_size', String(PAGE_SIZE));

    (async () => {
      try {
        const r = await api(`/api/tickets?${params.toString()}`, { signal: controller.signal });
        if (!active) return;
        if (!r.ok) {
          setError('Không tải được danh sách vé. Vui lòng thử lại.');
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
      } catch (err) {
        if (!active || err?.name === 'AbortError') return;
        setError('Không tải được danh sách vé. Vui lòng thử lại.');
      } finally {
        clearTimeout(loadingTimer);
        if (active) setShowLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
      clearTimeout(loadingTimer);
    };
  }, [appliedQuery, selectedCategory, page, reloadNonce]);

  // Tải danh sách danh mục phía server khi mở dropdown hoặc gõ tìm
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
      try {
        const r = await api(`/api/tickets/categories?${params.toString()}`, { signal: controller.signal });
        if (!active) return;
        if (!r.ok) {
          setCatError(true);
          return;
        }
        setCatOptions(Array.isArray(r.body.items) ? r.body.items : []);
        setCatError(false);
        setCatActiveIndex(0);
      } catch (err) {
        if (!active || err?.name === 'AbortError') return;
        setCatError(true);
      } finally {
        clearTimeout(loadingTimer);
        if (active) setCatShowLoading(false);
      }
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
      if (next === appliedQuery && page === 1) {
        setReloadNonce(n => n + 1);
      } else {
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
      if (!catOpen) {
        openCategoryDropdown();
      } else if (visibleCatOptions.length > 0) {
        setCatActiveIndex(i => (i + 1) % visibleCatOptions.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!catOpen) {
        openCategoryDropdown();
      } else if (visibleCatOptions.length > 0) {
        setCatActiveIndex(i => (i - 1 + visibleCatOptions.length) % visibleCatOptions.length);
      }
    } else if (e.key === 'Enter') {
      if (catOpen) {
        e.preventDefault();
        if (visibleCatOptions.length > 0) {
          const idx = Math.min(Math.max(catActiveIndex, 0), visibleCatOptions.length - 1);
          selectCategory(visibleCatOptions[idx].value);
        }
      }
    } else if (e.key === 'Escape') {
      if (catOpen) {
        e.preventDefault();
        closeCategoryDropdown();
      }
    } else if (e.key === 'Tab') {
      if (catOpen) {
        closeCategoryDropdown();
      }
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

  const handleCreateTicket = async (e) => {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setCreateStatus({ type: '', text: '' });
    try {
      const payload = {
        event: form.event,
        price: form.price,
        quantity: form.quantity,
      };
      if (form.category.trim()) {
        payload.category = form.category.trim();
      }
      const r = await api('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (r.ok) {
        setCreateStatus({ type: 'success', text: 'Đã tạo vé thành công' });
        setForm({ event: '', price: '', quantity: '', category: '' });
        setReloadNonce(n => n + 1);
      } else if (r.status >= 400 && r.status < 500 && typeof r.body?.error === 'string') {
        setCreateStatus({ type: 'error', text: `Không tạo được vé: ${r.body.error}` });
      } else {
        setCreateStatus({ type: 'error', text: 'Không tạo được vé. Vui lòng thử lại.' });
      }
    } catch {
      setCreateStatus({ type: 'error', text: 'Không tạo được vé. Vui lòng thử lại.' });
    } finally {
      setCreating(false);
    }
  };

  const activeFilterParts = [];
  if (appliedQuery) activeFilterParts.push(appliedQuery);
  if (selectedCategory) activeFilterParts.push(selectedCategory);
  const activeFilterLabel = activeFilterParts.join(' / ');
  const displayTotalPages = Math.max(totalPages, 1);

  return (
    <section className="card ticket-panel">
      <h2>Ticket Service <small>/api/tickets</small></h2>

      {/* Thẻ bộ lọc riêng phía trên danh sách */}
      <div className="ts-filter-card" role="search" aria-label="Bộ lọc tìm kiếm vé">
        <div className="ts-filter-stack">
          <div className="ts-field">
            <label className="ts-label" htmlFor="ts-search-input">Tìm theo tên sự kiện</label>
            <div className="ts-input-wrap">
              <input
                id="ts-search-input"
                type="text"
                className="ts-input ts-input-has-clear"
                placeholder="VD: Su kien mau"
                maxLength={100}
                value={searchInput}
                onChange={e => handleSearchChange(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                aria-describedby="ts-search-hint"
              />
              {searchInput && (
                <button
                  type="button"
                  className="ts-clear-inline"
                  onClick={clearSearchInput}
                  aria-label="Xoá nhanh từ khoá tìm kiếm"
                  title="Xoá từ khoá"
                >
                  ×
                </button>
              )}
            </div>
            <p id="ts-search-hint" className="ts-hint">
              Tìm một phần tên, không phân biệt hoa/thường
            </p>
          </div>

          <div className="ts-filter-row">
            <div className="ts-field" ref={catBoxRef}>
              <label className="ts-label" htmlFor="ts-category-input">Danh mục</label>
              <div className="ts-combobox">
                <input
                  id="ts-category-input"
                  type="text"
                  role="combobox"
                  className="ts-input ts-input-has-toggle"
                  placeholder="Tất cả danh mục"
                  maxLength={100}
                  autoComplete="off"
                  aria-expanded={catOpen}
                  aria-controls="ts-category-listbox"
                  aria-autocomplete="list"
                  aria-activedescendant={
                    catOpen && visibleCatOptions[catActiveIndex]
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
                  className="ts-combo-toggle"
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
                  <div
                    id="ts-category-listbox"
                    role="listbox"
                    aria-label="Danh sách danh mục"
                    className="ts-dropdown"
                  >
                    {catShowLoading && (
                      <div className="ts-dropdown-status" role="status">Đang tải...</div>
                    )}
                    {!catShowLoading && catError && (
                      <div className="ts-dropdown-status">Không tải được danh mục</div>
                    )}
                    {!catShowLoading && !catError && visibleCatOptions.length === 0 && (
                      <div className="ts-dropdown-status">Không tìm thấy danh mục</div>
                    )}
                    {!catShowLoading && !catError && visibleCatOptions.map((opt, idx) => {
                      const isSelected = opt.value === selectedCategory;
                      const isActive = idx === catActiveIndex;
                      return (
                        <div
                          key={opt.value === '' ? '__all__' : opt.value}
                          id={`ts-cat-opt-${idx}`}
                          role="option"
                          aria-selected={isSelected}
                          className={`ts-dropdown-option${isActive ? ' is-active' : ''}${isSelected ? ' is-selected' : ''}`}
                          onMouseEnter={() => setCatActiveIndex(idx)}
                          onMouseDown={e => {
                            e.preventDefault();
                            selectCategory(opt.value);
                          }}
                        >
                          <span>{opt.label}</span>
                          {isSelected && <span aria-hidden="true">✓</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="ts-filter-actions">
              <button
                type="button"
                className="ts-btn-secondary"
                disabled={!hasActiveFilter}
                onClick={clearAllFilters}
              >
                Xoá bộ lọc
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tóm tắt kết quả và phạm vi dữ liệu đang xem */}
      <div className="ts-summary" aria-live="polite" aria-atomic="true">
        <span className="ts-summary-count">Tìm thấy {total} vé</span>
        {activeFilterLabel && (
          <span className="ts-summary-filter">Đang lọc: {activeFilterLabel}</span>
        )}
        {total > 0 && (
          <span className="ts-summary-page">Trang {page}/{displayTotalPages}</span>
        )}
      </div>

      {/* Thông báo lỗi (vẫn giữ danh sách cũ bên dưới nếu có) */}
      {error && (
        <div className="ts-state-box ts-state-error" role="alert">
          <p className="ts-state-text">{error}</p>
          <button
            type="button"
            className="ts-btn-primary"
            onClick={() => setReloadNonce(n => n + 1)}
          >
            Thử lại
          </button>
        </div>
      )}

      {/* Vùng danh sách / đang tải / trạng thái rỗng */}
      <div className="ts-list-region" aria-live="polite">
        {showLoading && (
          <div className="ts-state-box ts-state-loading" role="status">
            <p className="ts-state-text">Đang tải...</p>
          </div>
        )}

        {!showLoading && !error && hasLoaded && items.length === 0 && (
          <div className="ts-state-box ts-state-empty">
            <p className="ts-state-title">Không tìm thấy vé phù hợp</p>
            <p className="ts-state-hint">
              Thử bỏ bớt từ khoá hoặc chọn &apos;Tất cả danh mục&apos;
            </p>
            <button
              type="button"
              className="ts-btn-secondary"
              onClick={clearAllFilters}
            >
              Xoá bộ lọc
            </button>
          </div>
        )}

        {items.length > 0 && (
          <ul className="ts-list" aria-label="Danh sách vé">
            {items.map(t => (
              <li key={t.id} className="ts-item">
                <div className="ts-item-main">
                  <span className="ts-event">{t.event}</span>
                  <span className="ts-chip">{t.category || 'Khac'}</span>
                </div>
                <div className="ts-item-numbers">
                  <span className="ts-price">{Number(t.price).toLocaleString('vi-VN')} ₫</span>
                  <span className="ts-qty">SL: {t.quantity}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Điều khiển phân trang */}
      {total > 0 && (
        <nav className="ts-pagination" aria-label="Phân trang danh sách vé">
          <button
            type="button"
            className="ts-btn-secondary"
            disabled={page <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
          >
            Trước
          </button>
          <span className="ts-page-indicator">
            Trang {page} / {displayTotalPages}
          </span>
          <button
            type="button"
            className="ts-btn-secondary"
            disabled={page >= displayTotalPages}
            onClick={() => setPage(p => Math.min(displayTotalPages, p + 1))}
          >
            Sau
          </button>
        </nav>
      )}

      {/* Form thêm vé mới */}
      <form className="ts-create-form" onSubmit={handleCreateTicket} aria-label="Thêm vé mới">
        <div className="ts-create-grid">
          <input
            className="ts-input"
            aria-label="Tên sự kiện mới"
            placeholder="Sự kiện"
            value={form.event}
            onChange={e => setForm({ ...form, event: e.target.value })}
          />
          <input
            className="ts-input"
            aria-label="Danh mục mới"
            placeholder="Danh mục (VD: Hoi thao)"
            maxLength={100}
            value={form.category}
            onChange={e => setForm({ ...form, category: e.target.value })}
          />
          <input
            className="ts-input"
            aria-label="Giá vé"
            placeholder="Giá"
            value={form.price}
            onChange={e => setForm({ ...form, price: e.target.value })}
          />
          <input
            className="ts-input"
            aria-label="Số lượng vé"
            placeholder="Số lượng"
            value={form.quantity}
            onChange={e => setForm({ ...form, quantity: e.target.value })}
          />
        </div>
        <button type="submit" className="ts-btn-primary" disabled={creating}>
          Thêm vé
        </button>
      </form>

      {createStatus.text && (
        <p
          className={`ts-feedback ts-feedback-${createStatus.type}`}
          role={createStatus.type === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          {createStatus.text}
        </p>
      )}
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

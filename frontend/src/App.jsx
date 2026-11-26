import { useEffect, useRef, useState } from 'react';

const PAGE_SIZE = 10;
const DEBOUNCE_MS = 300;
const LOADING_DELAY_MS = 150;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SERVER_UNREACHABLE_MSG = 'Không kết nối được máy chủ. Vui lòng thử lại sau.';

// Gọi API qua cổng Gateway tương đối (/api/...), bắt toàn bộ lỗi mạng an toàn
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

/* ===== Biểu tượng SVG nội tuyến sắc nét (0 KB mạng ngoài) ===== */
function IconTicket() {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 6v2m0 4v2" />
    </svg>
  );
}

function IconUsers() {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconActivity() {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

/* ===== Sơ đồ luồng Kiến trúc Sống (dùng trong trang Kiểm chứng phân tán) ===== */
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
        <span>Luồng kiến trúc hệ thống đang vận hành</span>
        {activeDataNode && (
          <span className={`arch-live-pill ${isRedisActive ? 'is-redis' : 'is-pg'}`}>
            {isRedisActive ? '⚡ Phản hồi gần nhất: Redis HIT' : '🗄 Phản hồi gần nhất: PostgreSQL'}
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
          <div className="arch-node arch-service">
            <strong>Ticket Service ×N</strong>
            <span className="arch-node-sub">Flask · Stateless</span>
          </div>
          <div className="arch-node arch-service">
            <strong>User Service</strong>
            <span className="arch-node-sub">Node.js · Express</span>
          </div>
        </div>

        <div className="arch-arrow" aria-hidden="true">→</div>

        <div className="arch-stack">
          <div className={`arch-node arch-data${isRedisActive ? ' is-lit-redis' : ''}`}>
            <strong>Redis Cache</strong>
            <span className="arch-node-sub">Cache-aside · TTL 30–60s</span>
          </div>
          <div className={`arch-node arch-data${isPgActive ? ' is-lit-pg' : ''}`}>
            <strong>PostgreSQL ×2 DB</strong>
            <span className="arch-node-sub">tickets_db · users_db</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===== TRANG 1: QUẢN LÝ VÉ ===== */
function Tickets({ searchInputRef, onTechInfo, onCountChange, onOpenLab }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [showLoading, setShowLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadNonce, setReloadNonce] = useState(0);

  // Bộ lọc tìm kiếm
  const [searchInput, setSearchInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');

  // Combobox danh mục tìm phía server
  const [catInput, setCatInput] = useState('');
  const [catOpen, setCatOpen] = useState(false);
  const [catTyping, setCatTyping] = useState(false);
  const [catDebouncedQuery, setCatDebouncedQuery] = useState('');
  const [catOptions, setCatOptions] = useState([]);
  const [catShowLoading, setCatShowLoading] = useState(false);
  const [catError, setCatError] = useState('');
  const [catActiveIndex, setCatActiveIndex] = useState(0);

  // Biểu mẫu thêm vé
  const [form, setForm] = useState({ event: '', category: '', price: '', quantity: '' });
  const [createStatus, setCreateStatus] = useState({ type: '', text: '' });
  const [creating, setCreating] = useState(false);

  const searchTimerRef = useRef(null);
  const catTimerRef = useRef(null);
  const catBoxRef = useRef(null);

  const ticketEventInputRef = useRef(null);
  const ticketCategoryInputRef = useRef(null);
  const ticketPriceInputRef = useRef(null);
  const ticketQtyInputRef = useRef(null);

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
        onTechInfo?.({ service: 'tickets', ok: false });
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
      onCountChange?.(nextTotal);

      onTechInfo?.({
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
  }, [appliedQuery, selectedCategory, page, reloadNonce, hasLoaded, onTechInfo, onCountChange]);

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
    searchInputRef?.current?.focus();
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
    if (trimmedCat) {
      payload.category = trimmedCat;
    }

    const r = await api('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setCreating(false);

    if (r.ok) {
      setCreateStatus({ type: 'success', text: `Đã thêm vé '${trimmedEvent}'.` });
      setForm({ event: '', category: '', price: '', quantity: '' });
      setReloadNonce(n => n + 1);
      ticketEventInputRef.current?.focus();
    } else {
      setCreateStatus({ type: 'error', text: getFriendlyError(r, 'create-ticket') });
    }
  };

  const activeFilterParts = [];
  if (appliedQuery) activeFilterParts.push(`"${appliedQuery}"`);
  if (selectedCategory) activeFilterParts.push(selectedCategory);
  const activeFilterLabel = activeFilterParts.join(' · ');
  const displayTotalPages = Math.max(totalPages, 1);

  return (
    <section className="view-panel" aria-labelledby="tickets-heading">
      {/* Dải giới thiệu ngắn 5 giây ngay đầu trang vé */}
      <div className="intro-strip">
        <div className="intro-strip-text">
          <h2 id="tickets-heading">Quản lý vé</h2>
          <p>
            Tra cứu vé sự kiện, lọc theo danh mục và mở bán vé mới trên cụm Ticket Service phi trạng thái.
          </p>
        </div>
        <div className="summary-inline" aria-live="polite" aria-atomic="true">
          <span className="count-badge">Tìm thấy {total} vé</span>
          {activeFilterLabel && (
            <span className="filter-pill">Đang lọc: {activeFilterLabel}</span>
          )}
          {total > 0 && (
            <span className="page-meta">Trang {page}/{displayTotalPages}</span>
          )}
          <button type="button" className="btn-secondary btn-compact" onClick={onOpenLab}>
            Kiểm thử 30 request →
          </button>
        </div>
      </div>

      <div className="workbench-grid">
        {/* Cột trái: Bộ lọc + Danh sách cuống vé + Phân trang */}
        <div className="card card-ops">
          <div className="filter-toolbar" role="search" aria-label="Bộ lọc tìm kiếm vé">
            <div className="filter-toolbar-grid">
              <div className="field">
                <label className="field-label" htmlFor="ts-search-input">
                  Tìm theo tên sự kiện
                </label>
                <div className="input-wrap">
                  <input
                    ref={searchInputRef}
                    id="ts-search-input"
                    type="text"
                    className="field-input input-with-action"
                    placeholder="Ví dụ: Su kien mau"
                    maxLength={100}
                    value={searchInput}
                    onChange={e => handleSearchChange(e.target.value)}
                    onKeyDown={handleSearchKeyDown}
                    aria-describedby="ts-search-hint"
                  />
                  {searchInput && (
                    <button
                      type="button"
                      className="inline-icon-btn"
                      onClick={clearSearchInput}
                      aria-label="Xoá từ khoá tìm kiếm"
                      title="Xoá từ khoá"
                    >
                      ×
                    </button>
                  )}
                </div>
                <p id="ts-search-hint" className="field-hint">
                  Tìm một phần tên sự kiện, không phân biệt chữ hoa/thường.
                </p>
              </div>

              <div className="field" ref={catBoxRef}>
                <label className="field-label" htmlFor="ts-category-input">
                  Danh mục
                </label>
                <div className="combobox-wrap">
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
                    aria-describedby="ts-category-hint"
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
                <p id="ts-category-hint" className="field-hint">
                  Mở để chọn hoặc gõ tìm danh mục.
                </p>
              </div>

              <div className="filter-clear-col">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={!hasActiveFilter}
                  onClick={clearAllFilters}
                >
                  Xoá bộ lọc
                </button>
              </div>
            </div>
          </div>

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

          <div className="list-region ticket-list-region" aria-live="polite">
            {showLoading && (
              <div className="state-box state-loading" role="status">
                <p className="state-text">Đang tải...</p>
              </div>
            )}

            {!showLoading && !error && hasLoaded && items.length === 0 && (
              <div className="state-box state-empty">
                <p className="state-title">Không tìm thấy vé phù hợp</p>
                <p className="state-hint">
                  Thử bỏ bớt từ khoá hoặc chọn &ldquo;Tất cả danh mục&rdquo; để xem lại danh sách.
                </p>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={clearAllFilters}
                >
                  Xoá bộ lọc
                </button>
              </div>
            )}

            {items.length > 0 && (
              <ul className="ticket-stub-list" aria-label="Danh sách vé">
                {items.map(t => (
                  <li key={t.id} className="ticket-stub-row">
                    <div className="ticket-stub-body">
                      <span className="ticket-event">{t.event}</span>
                      <span className="ticket-chip">{t.category || 'Khac'}</span>
                    </div>
                    <div className="tear-line" aria-hidden="true" />
                    <div className="ticket-stub-meta">
                      <span className="ticket-price">{Number(t.price).toLocaleString('vi-VN')} đ</span>
                      <span className="ticket-qty">{Number(t.quantity).toLocaleString('vi-VN')} vé</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {total > 0 && (
            <nav className="pagination-bar" aria-label="Phân trang danh sách vé">
              <button
                type="button"
                className="btn-secondary"
                disabled={page <= 1 || showLoading}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                Trước
              </button>
              <span className="page-indicator">
                Trang {page}/{displayTotalPages}
              </span>
              <button
                type="button"
                className="btn-secondary"
                disabled={page >= displayTotalPages || showLoading}
                onClick={() => setPage(p => Math.min(displayTotalPages, p + 1))}
              >
                Sau
              </button>
            </nav>
          )}
        </div>

        {/* Cột phải: Biểu mẫu Thêm vé mới */}
        <aside className="card card-form">
          <form className="create-form" onSubmit={handleCreateTicket} noValidate aria-label="Thêm vé mới">
            <h3 className="form-heading">Thêm vé mới</h3>

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
                  placeholder="Ví dụ: Đêm nhạc Mùa Thu"
                  maxLength={150}
                  value={form.event}
                  onChange={e => setForm({ ...form, event: e.target.value })}
                  aria-describedby="ticket-event-hint"
                  required
                />
                <p id="ticket-event-hint" className="field-hint">
                  Tối đa 150 ký tự.
                </p>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="ticket-category-input">
                  Danh mục
                </label>
                <input
                  ref={ticketCategoryInputRef}
                  id="ticket-category-input"
                  type="text"
                  className="field-input"
                  placeholder="Ví dụ: Am nhac"
                  maxLength={100}
                  value={form.category}
                  onChange={e => setForm({ ...form, category: e.target.value })}
                  aria-describedby="ticket-category-create-hint"
                />
                <p id="ticket-category-create-hint" className="field-hint">
                  Để trống mặc định là &ldquo;Khac&rdquo; (tối đa 100 ký tự).
                </p>
              </div>

              <div className="create-two-col">
                <div className="field">
                  <label className="field-label" htmlFor="ticket-price-input">
                    Giá vé (đồng) <span aria-hidden="true">*</span>
                  </label>
                  <input
                    ref={ticketPriceInputRef}
                    id="ticket-price-input"
                    type="text"
                    inputMode="numeric"
                    className="field-input"
                    placeholder="150000"
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
                    Số lượng <span aria-hidden="true">*</span>
                  </label>
                  <input
                    ref={ticketQtyInputRef}
                    id="ticket-qty-input"
                    type="text"
                    inputMode="numeric"
                    className="field-input"
                    placeholder="50"
                    value={form.quantity}
                    onChange={e => setForm({ ...form, quantity: e.target.value })}
                    aria-describedby="ticket-qty-hint"
                    required
                  />
                  <p id="ticket-qty-hint" className="field-hint">
                    Số nguyên, ví dụ 50.
                  </p>
                </div>
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn-primary" disabled={creating}>
                {creating ? 'Đang gửi...' : 'Thêm vé'}
              </button>
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
          </form>
        </aside>
      </div>
    </section>
  );
}

/* ===== TRANG 2: QUẢN LÝ NGƯỜI DÙNG ===== */
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
      <div className="intro-strip">
        <div className="intro-strip-text">
          <h2 id="users-heading">Quản lý người dùng</h2>
          <p>
            Quản trị danh sách tài khoản trên dịch vụ User Service độc lập (cơ sở dữ liệu riêng users_db).
          </p>
        </div>
        {hasLoaded && <span className="count-badge">{items.length} người dùng</span>}
      </div>

      <div className="workbench-grid workbench-users">
        <div className="card card-ops">
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
              <ul className="entity-list" aria-label="Danh sách người dùng">
                {items.map(u => {
                  const isBeingEdited = editingUser?.id === u.id;
                  const isConfirmingDelete = confirmDeleteId === u.id;
                  return (
                    <li
                      key={u.id}
                      className={`entity-item${isBeingEdited ? ' is-editing' : ''}`}
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
                            <span className="confirm-label">Xoá?</span>
                            <button
                              type="button"
                              className="btn-danger btn-compact"
                              disabled={deletingId === u.id}
                              onClick={() => handleDelete(u)}
                            >
                              {deletingId === u.id ? 'Đang xoá...' : 'Xác nhận'}
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

        <aside className="card card-form">
          <form
            className="create-form"
            onSubmit={handleSubmit}
            noValidate
            aria-label={editingUser ? 'Chỉnh sửa người dùng' : 'Thêm người dùng mới'}
          >
            <div className="pane-header-inline">
              <h3 className="form-heading">
                {editingUser ? 'Chỉnh sửa người dùng' : 'Thêm người dùng mới'}
              </h3>
              {editingUser && (
                <span className="filter-pill">Đang sửa #{editingUser.id}</span>
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
                  Tối đa 100 ký tự, ví dụ Nguyễn Văn An.
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
                  Định dạng ten@mien.com (tối đa 150 ký tự).
                </p>
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting
                  ? 'Đang gửi...'
                  : editingUser
                    ? 'Lưu thay đổi'
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

/* ===== COMPONENT GIÁM SÁT CÂN BẰNG TẢI & 3 KỊCH BẢN ===== */
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
        <h3 id="lb-heading" className="lb-heading">Ba kịch bản kiểm chứng trực tiếp</h3>
        <p className="field-hint">
          Bấm chạy trực tiếp từng kịch bản để quan sát cân bằng tải Round-Robin, bộ nhớ đệm Redis và chịu lỗi.
        </p>
      </div>

      {lbError && (
        <p className="feedback feedback-error" role="alert">
          ⚠ Lỗi: {lbError}
        </p>
      )}

      <div className="scenario-grid">
        {/* Kịch bản 01 */}
        <article className="scenario-card">
          <div className="scenario-step">Kịch bản 01 · Cân bằng tải</div>
          <h4 className="scenario-title">Phân phối 30 request Round-Robin</h4>
          <p className="field-hint">
            Gửi 30 yêu cầu tới <code className="inline-code">/api/tickets/whoami</code>. Vạch đứng là mốc lý tưởng 33,3% khi chạy 3 bản sao.
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
                <div className="bar-track bar-track-ideal" title="Vạch mốc lý thuyết 33,3%">
                  <i style={{ width: `${(v / total) * 100}%` }} />
                </div>
                <b className="mono-num">{v}</b>
              </div>
            ))}
          </div>
        </article>

        {/* Kịch bản 02 */}
        <article className="scenario-card">
          <div className="scenario-step">Kịch bản 02 · Cache-aside</div>
          <h4 className="scenario-title">So sánh truy vấn nặng MISS rồi HIT</h4>
          <p className="field-hint">
            Bấm lần 1 truy vấn cơ sở dữ liệu (~500 ms); bấm lần 2 trong vòng 60 giây lấy ngay từ Redis.
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
                Thời gian phản hồi: <b className="mono-num">{stats.ms} ms</b> · Bản sao:{' '}
                <b className="mono-label">{stats.by}</b>
              </p>
              {cacheHistory.missMs !== null && cacheHistory.hitMs !== null && (
                <p className="speedup-note">
                  Đối chiếu: MISS <b>{cacheHistory.missMs} ms</b> → HIT <b>{cacheHistory.hitMs} ms</b>
                </p>
              )}
            </div>
          )}
        </article>

        {/* Kịch bản 03 */}
        <article className="scenario-card">
          <div className="scenario-step">Kịch bản 03 · Chịu lỗi (HA)</div>
          <h4 className="scenario-title">Dừng 1 bản sao bằng dòng lệnh</h4>
          <p className="field-hint">
            1. Chạy lệnh dưới đây trong Terminal để dừng đột ngột 1 container (nhấp vào ô để chọn):
          </p>
          <code className="cli-box" tabIndex={0} aria-label="Lệnh dừng một bản sao ticket-service">
            ./scripts/kill-one.sh
          </code>
          <p className="field-hint">
            2. Bấm lại <b>&ldquo;Gửi 30 request&rdquo;</b> ở Kịch bản 01: tải tự dồn sang bản sao còn sống với <b>0 lỗi</b>.
          </p>
          <p className="field-hint">
            3. Khôi phục lại đủ 3 bản sao:
          </p>
          <code className="cli-box" tabIndex={0} aria-label="Lệnh khôi phục 3 bản sao ticket-service">
            ./scripts/scale.sh 3
          </code>
        </article>
      </div>
    </div>
  );
}

/* ===== BẢNG BẰNG CHỨNG KỸ THUẬT (Số đo thực nghiệm thật) ===== */
function TechnicalEvidenceSection() {
  const replicas = [
    { name: 'Bản sao 01', count: 99, pct: 33.0 },
    { name: 'Bản sao 02', count: 99, pct: 33.0 },
    { name: 'Bản sao 03', count: 102, pct: 34.0 },
  ];

  return (
    <div className="card card-tech evidence-block">
      <div className="pane-header-inline">
        <h3 className="lb-heading">Bằng chứng kỹ thuật thực nghiệm (300 request)</h3>
        <span className="section-tag tag-tech">Số đo thực tế của nhóm</span>
      </div>

      <dl className="evidence-metrics">
        <div className="metric-tile">
          <dt>Độ tin cậy (300 request)</dt>
          <dd className="metric-number is-good">0 lỗi</dd>
          <span className="metric-sub">Chia đều 99 / 99 / 102 qua 3 bản sao</span>
        </div>

        <div className="metric-tile">
          <dt>Độ trễ vận hành bình thường</dt>
          <dd className="metric-number">p95: 2,2 ms</dd>
          <span className="metric-sub">Độ trễ tối đa: 11,7 ms</span>
        </div>

        <div className="metric-tile">
          <dt>Khi dừng đột ngột 1 bản sao</dt>
          <dd className="metric-number is-warn">≈ 1006 ms</dd>
          <span className="metric-sub">Độ trễ tối đa lúc Nginx chờ 1s chuyển tiếp</span>
        </div>

        <div className="metric-tile metric-unmeasured">
          <dt>Độ trễ bộ nhớ đệm Redis</dt>
          <dd className="metric-placeholder">Chưa đo</dd>
          <span className="metric-sub">Đo trực tiếp tại Kịch bản 02 phía trên</span>
        </div>
      </dl>

      <div className="evidence-bars" role="group" aria-label="Phân phối thực nghiệm 300 request trên 3 bản sao">
        <p className="evidence-bars-title">
          Phân phối thực tế 300 request qua Nginx Round-Robin:
        </p>
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
        Nguồn số đo: Đo kiểm thực tế bằng <code className="inline-code">scripts/lb_test.py --n 300</code> qua cổng Gateway <code className="inline-code">:8080</code> trên Docker Compose cục bộ (<code className="inline-code">--scale ticket-service=3</code>).
      </p>
    </div>
  );
}

/* ===== KHUNG ỨNG DỤNG CHÍNH: THANH ĐIỀU HƯỚNG 3 PHÂN HỆ NHƯ WEB THẬT ===== */
export default function App() {
  const [activeView, setActiveView] = useState('tickets'); // 'tickets' | 'users' | 'lab'
  const [counts, setCounts] = useState({ tickets: null, users: null });
  const [techState, setTechState] = useState({ tickets: null, users: null });
  const searchInputRef = useRef(null);

  const handleTechInfo = useRef((info) => {
    setTechState(prev => ({ ...prev, [info.service]: info }));
  }).current;

  const handleTicketCount = useRef((n) => {
    setCounts(prev => ({ ...prev, tickets: n }));
  }).current;

  const handleUserCount = useRef((n) => {
    setCounts(prev => ({ ...prev, users: n }));
  }).current;

  const gatewayStatus =
    techState.tickets?.ok || techState.users?.ok
      ? 'online'
      : techState.tickets?.ok === false && techState.users?.ok === false
        ? 'offline'
        : 'checking';

  const switchView = (viewName) => {
    setActiveView(viewName);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleTabKeyDown = (e, currentIdx) => {
    const order = ['tickets', 'users', 'lab'];
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = order[(currentIdx + 1) % order.length];
      setActiveView(next);
      document.getElementById(`nav-tab-${next}`)?.focus();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = order[(currentIdx - 1 + order.length) % order.length];
      setActiveView(prev);
      document.getElementById(`nav-tab-${prev}`)?.focus();
    }
  };

  return (
    <>
      {/* HEADER ỨNG DỤNG VỚI THANH CHUYỂN TAB HIỆN ĐẠI (Bấm chuyển trang tức thì, không còn gạch chân xấu) */}
      <header className="app-topbar">
        <div className="app-topbar-inner">
          <div className="app-brand">
            <span className="app-brand-mark"><IconTicket /></span>
            <div>
              <h1 className="app-brand-title">Hệ thống Quản lý Vé Sự kiện</h1>
              <span className="app-brand-sub">Kiến trúc Microservices · Cân bằng tải &amp; Redis Cache</span>
            </div>
          </div>

          <nav className="app-nav-tabs" role="tablist" aria-label="Chuyển trang chức năng">
            <button
              id="nav-tab-tickets"
              type="button"
              role="tab"
              aria-selected={activeView === 'tickets'}
              aria-controls="panel-tickets"
              tabIndex={activeView === 'tickets' ? 0 : -1}
              className={`nav-tab-btn${activeView === 'tickets' ? ' is-active' : ''}`}
              onClick={() => switchView('tickets')}
              onKeyDown={e => handleTabKeyDown(e, 0)}
            >
              <IconTicket />
              <span>Quản lý vé</span>
              {counts.tickets !== null && <span className="nav-tab-badge">{counts.tickets}</span>}
            </button>

            <button
              id="nav-tab-users"
              type="button"
              role="tab"
              aria-selected={activeView === 'users'}
              aria-controls="panel-users"
              tabIndex={activeView === 'users' ? 0 : -1}
              className={`nav-tab-btn${activeView === 'users' ? ' is-active' : ''}`}
              onClick={() => switchView('users')}
              onKeyDown={e => handleTabKeyDown(e, 1)}
            >
              <IconUsers />
              <span>Người dùng</span>
              {counts.users !== null && <span className="nav-tab-badge">{counts.users}</span>}
            </button>

            <button
              id="nav-tab-lab"
              type="button"
              role="tab"
              aria-selected={activeView === 'lab'}
              aria-controls="panel-lab"
              tabIndex={activeView === 'lab' ? 0 : -1}
              className={`nav-tab-btn${activeView === 'lab' ? ' is-active' : ''}`}
              onClick={() => switchView('lab')}
              onKeyDown={e => handleTabKeyDown(e, 2)}
            >
              <IconActivity />
              <span>Kiểm chứng phân tán</span>
            </button>
          </nav>

          <div className="gateway-status" aria-live="polite">
            {gatewayStatus === 'online' && (
              <span className="status-pill is-online">● Gateway :8080 sẵn sàng</span>
            )}
            {gatewayStatus === 'offline' && (
              <span className="status-pill is-offline">▲ Mất kết nối Gateway</span>
            )}
            {gatewayStatus === 'checking' && (
              <span className="status-pill">◌ Đang kết nối...</span>
            )}
          </div>
        </div>
      </header>

      <main>
        {/* Hướng dẫn nhanh thu gọn mặc định */}
        <details className="quick-guide">
          <summary className="quick-guide-summary">Hướng dẫn nhanh</summary>
          <ul className="quick-guide-list">
            <li>Bấm các nút trên thanh điều hướng (<b>Quản lý vé</b>, <b>Người dùng</b>, <b>Kiểm chứng phân tán</b>) để chuyển màn hình làm việc ngay lập tức.</li>
            <li>Trong <b>Quản lý vé</b>: gõ tên sự kiện hoặc chọn danh mục để lọc tự động; nhấn <b>Enter</b> trong biểu mẫu để thêm vé mới.</li>
            <li>Trong <b>Người dùng</b>: hỗ trợ đầy đủ Thêm mới, Sửa trực tiếp và Xoá có xác nhận an toàn.</li>
            <li>Trong <b>Kiểm chứng phân tán</b>: bấm &ldquo;Gửi 30 request&rdquo; để xem chia tải Round-Robin và kiểm tra bộ nhớ đệm Redis.</li>
          </ul>
        </details>

        {/* MÀN HÌNH 1: QUẢN LÝ VÉ */}
        <div
          id="panel-tickets"
          role="tabpanel"
          aria-labelledby="nav-tab-tickets"
          hidden={activeView !== 'tickets'}
        >
          <Tickets
            searchInputRef={searchInputRef}
            onTechInfo={handleTechInfo}
            onCountChange={handleTicketCount}
            onOpenLab={() => switchView('lab')}
          />
        </div>

        {/* MÀN HÌNH 2: NGƯỜI DÙNG */}
        <div
          id="panel-users"
          role="tabpanel"
          aria-labelledby="nav-tab-users"
          hidden={activeView !== 'users'}
        >
          <Users
            onTechInfo={handleTechInfo}
            onCountChange={handleUserCount}
          />
        </div>

        {/* MÀN HÌNH 3: KIỂM CHỨNG PHÂN TÁN */}
        <div
          id="panel-lab"
          role="tabpanel"
          aria-labelledby="nav-tab-lab"
          hidden={activeView !== 'lab'}
        >
          <section className="view-panel" aria-labelledby="lab-section-heading">
            <div className="intro-strip">
              <div className="intro-strip-text">
                <h2 id="lab-section-heading">Giám sát cân bằng tải &amp; bộ nhớ đệm</h2>
                <p>
                  Bàn thí nghiệm trực tiếp kiểm chứng chia tải đa bản sao, Cache-aside Redis và khả năng chịu lỗi.
                </p>
              </div>
            </div>

            <ArchitectureBanner activeDataNode={techState.tickets?.cache} />

            <div className="card card-tech lab-main-card">
              <LoadBalancer />

              {/* Chi tiết kỹ thuật thu gọn mặc định (AC17, AC35, AC37) */}
              <details className="tech-details">
                <summary className="tech-summary">Thông tin kỹ thuật (dành cho demo)</summary>
                <div className="tech-content">
                  <div className="tech-telemetry">
                    <div className="tech-metric-card">
                      <p className="meta">
                        <b>Truy vấn vé gần nhất (/api/tickets):</b>{' '}
                        {techState.tickets?.ok ? (
                          <>
                            Nguồn: <b>{formatCacheSource(techState.tickets.cache)}</b> · Thời gian:{' '}
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
                            Nguồn: <b>Cơ sở dữ liệu (PostgreSQL)</b> · Thời gian:{' '}
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

      <footer className="site-footer">
        <div className="site-footer-inner">
          <div>
            <strong>Đồ án môn Hệ phân tán</strong> · Nginx API Gateway · Flask · Node.js · PostgreSQL · Redis
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

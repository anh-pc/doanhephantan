import { useEffect, useRef, useState } from 'react';

const PAGE_SIZE = 10;
const DEBOUNCE_MS = 300;
const LOADING_DELAY_MS = 150;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SERVER_UNREACHABLE_MSG = 'Không kết nối được máy chủ. Vui lòng thử lại sau.';

// Frontend chỉ gọi đường dẫn tương đối qua API Gateway (/api/...), bắt mọi lỗi mạng an toàn
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
  if (action === 'create-user') {
    if (r.status === 409) {
      return 'Email này đã được sử dụng. Vui lòng nhập một địa chỉ email khác.';
    }
    if (r.status === 400) {
      return 'Thông tin người dùng chưa hợp lệ. Vui lòng kiểm tra lại họ tên và định dạng email.';
    }
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

function Users({ onTechInfo }) {
  const [items, setItems] = useState([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadNonce, setReloadNonce] = useState(0);

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
        return;
      }
      setItems(Array.isArray(r.body.items) ? r.body.items : []);
      setLoadError('');
      setHasLoaded(true);
      onTechInfo?.({
        service: 'users',
        ms: r.ms,
        servedBy: r.body.served_by || '-',
        upstream: r.upstream || '-',
      });
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadNonce, onTechInfo]);

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
    const r = await api('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmedName, email: trimmedEmail }),
    });
    setSubmitting(false);

    if (r.ok) {
      setFeedback({ type: 'success', text: `Đã thêm người dùng '${trimmedName}'.` });
      setForm({ name: '', email: '' });
      setReloadNonce(n => n + 1);
      nameInputRef.current?.focus();
    } else {
      // Giữ nguyên dữ liệu đã nhập để sửa ngay (AC20, AC32)
      setFeedback({ type: 'error', text: getFriendlyError(r, 'create-user') });
    }
  };

  return (
    <section className="card panel" aria-labelledby="users-heading">
      <h2 id="users-heading">Quản lý người dùng</h2>

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
            {items.map(u => (
              <li key={u.id} className="entity-item">
                <span className="entity-primary">{u.name}</span>
                <span className="entity-secondary">{u.email}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form className="create-form" onSubmit={handleSubmit} noValidate aria-label="Thêm người dùng mới">
        <h3 className="form-heading">Thêm người dùng mới</h3>
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
              Nhập họ tên người dùng (tối đa 100 ký tự).
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
              Nhập đúng định dạng email ten@mien.com (tối đa 150 ký tự).
            </p>
          </div>
        </div>

        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Đang gửi...' : 'Thêm người dùng'}
        </button>

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
    </section>
  );
}

function Tickets({ onTechInfo }) {
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

  // Combobox danh mục có tìm kiếm phía server
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

  // Đóng dropdown danh mục khi nhấp ra ngoài
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

  // Tải danh sách vé (chống race condition bằng AbortController)
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

      onTechInfo?.({
        service: 'tickets',
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
  }, [appliedQuery, selectedCategory, page, reloadNonce, hasLoaded, onTechInfo]);

  // Tìm danh mục phía server qua GET /api/tickets/categories?q=&limit=
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
      // Giữ nguyên dữ liệu đã nhập để sửa ngay (AC20, AC32)
      setCreateStatus({ type: 'error', text: getFriendlyError(r, 'create-ticket') });
    }
  };

  const activeFilterParts = [];
  if (appliedQuery) activeFilterParts.push(`từ khoá "${appliedQuery}"`);
  if (selectedCategory) activeFilterParts.push(`danh mục "${selectedCategory}"`);
  const activeFilterLabel = activeFilterParts.join(', ');
  const displayTotalPages = Math.max(totalPages, 1);

  return (
    <section className="card panel ticket-panel" aria-labelledby="tickets-heading">
      <h2 id="tickets-heading">Quản lý vé</h2>

      {/* Khối tìm kiếm và lọc vé */}
      <div className="filter-card" role="search" aria-label="Bộ lọc tìm kiếm vé">
        <div className="filter-stack">
          <div className="field">
            <label className="field-label" htmlFor="ts-search-input">
              Tìm theo tên sự kiện
            </label>
            <div className="input-wrap">
              <input
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
              Tìm theo một phần tên sự kiện, không phân biệt chữ hoa hay chữ thường.
            </p>
          </div>

          <div className="filter-row">
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
                          {isSelected && <span aria-hidden="true">✓ Đang chọn</span>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <p id="ts-category-hint" className="field-hint">
                Mở để chọn danh mục hoặc gõ tên danh mục cần lọc.
              </p>
            </div>

            <div className="filter-actions">
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
      </div>

      {/* Dòng tóm tắt kết quả */}
      <div className="summary-bar" aria-live="polite" aria-atomic="true">
        <span className="summary-count">Tìm thấy {total} vé</span>
        {activeFilterLabel && (
          <span className="summary-filter">Đang lọc theo {activeFilterLabel}</span>
        )}
        {total > 0 && (
          <span className="summary-page">Trang {page}/{displayTotalPages}</span>
        )}
      </div>

      {/* Thông báo lỗi tải vé */}
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

      {/* Danh sách vé / đang tải / rỗng (giữ min-height chống nhảy bố cục) */}
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
          <ul className="ticket-list" aria-label="Danh sách vé">
            {items.map(t => (
              <li key={t.id} className="ticket-item">
                <div className="ticket-main">
                  <span className="ticket-event">{t.event}</span>
                  <span className="ticket-chip">{t.category || 'Khac'}</span>
                </div>
                <div className="ticket-numbers">
                  <span className="ticket-price">{Number(t.price).toLocaleString('vi-VN')} đ</span>
                  <span className="ticket-qty">{Number(t.quantity).toLocaleString('vi-VN')} vé</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Điều khiển phân trang */}
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

      {/* Biểu mẫu thêm vé mới */}
      <form className="create-form" onSubmit={handleCreateTicket} noValidate aria-label="Thêm vé mới">
        <h3 className="form-heading">Thêm vé mới</h3>
        <div className="create-grid">
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
              Tên sự kiện mở bán (tối đa 150 ký tự).
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
              Tối đa 100 ký tự; bỏ trống sẽ mặc định là &ldquo;Khac&rdquo;.
            </p>
          </div>

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
              Số lượng vé <span aria-hidden="true">*</span>
            </label>
            <input
              ref={ticketQtyInputRef}
              id="ticket-qty-input"
              type="text"
              inputMode="numeric"
              className="field-input"
              placeholder="Ví dụ: 50"
              value={form.quantity}
              onChange={e => setForm({ ...form, quantity: e.target.value })}
              aria-describedby="ticket-qty-hint"
              required
            />
            <p id="ticket-qty-hint" className="field-hint">
              Số nguyên không âm, ví dụ 50.
            </p>
          </div>
        </div>

        <button type="submit" className="btn-primary" disabled={creating}>
          {creating ? 'Đang gửi...' : 'Thêm vé'}
        </button>

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
    </section>
  );
}

function LoadBalancer() {
  const [counts, setCounts] = useState({});
  const [stats, setStats] = useState(null);
  const [busyWhoami, setBusyWhoami] = useState(false);
  const [busyStats, setBusyStats] = useState(false);
  const [lbError, setLbError] = useState('');

  const fire = async () => {
    setBusyWhoami(true);
    setLbError('');
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
    } else if (errors > 0) {
      c['(lỗi kết nối)'] = errors;
    }
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
    setStats({ cache: r.cache || r.body.cache, ms: r.ms, by: r.body.served_by });
  };

  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;

  return (
    <div className="lb-monitor" aria-labelledby="lb-heading">
      <h3 id="lb-heading" className="lb-heading">Giám sát cân bằng tải</h3>
      {lbError && (
        <p className="feedback feedback-error" role="alert">
          ⚠ Lỗi: {lbError}
        </p>
      )}
      <div className="row">
        <div className="lb-col">
          <button
            type="button"
            className="btn-secondary"
            disabled={busyWhoami}
            onClick={fire}
          >
            {busyWhoami ? 'Đang gửi 30 yêu cầu...' : 'Gửi 30 request /api/tickets/whoami'}
          </button>
          <div className="bar-list" aria-live="polite">
            {Object.entries(counts).map(([k, v]) => (
              <div key={k} className="bar">
                <span>{k}</span>
                <i style={{ width: `${(v / total) * 100}%` }} />
                <b>{v}</b>
              </div>
            ))}
          </div>
        </div>
        <div className="lb-col">
          <button
            type="button"
            className="btn-secondary"
            disabled={busyStats}
            onClick={heavy}
          >
            {busyStats ? 'Đang tải thống kê...' : 'Gọi truy vấn nặng /api/tickets/stats'}
          </button>
          {stats && (
            <p className="meta" aria-live="polite">
              Nguồn: <b>{formatCacheSource(stats.cache)}</b> · Thời gian: <b>{stats.ms} ms</b> · Bản sao: <b>{stats.by}</b>
            </p>
          )}
          <p className="field-hint">
            Gọi lần 1 (chưa có đệm) chậm khoảng 0,5 giây do truy vấn cơ sở dữ liệu; lần sau lấy nhanh từ bộ nhớ đệm Redis.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [techState, setTechState] = useState({
    tickets: null,
    users: null,
  });

  const handleTechInfo = useRef((info) => {
    setTechState(prev => ({ ...prev, [info.service]: info }));
  }).current;

  return (
    <main>
      <header className="page-header">
        <h1>Hệ thống quản lý vé sự kiện</h1>
        <details className="quick-guide">
          <summary className="quick-guide-summary">Hướng dẫn nhanh</summary>
          <ul className="quick-guide-list">
            <li>Gõ tên sự kiện vào ô tìm kiếm để lọc vé tự động (không cần bấm nút Tìm).</li>
            <li>Mở ô Danh mục để chọn hoặc gõ tìm danh mục; bấm &ldquo;Xoá bộ lọc&rdquo; để quay về danh sách ban đầu.</li>
            <li>Điền biểu mẫu và nhấn phím Enter ở bất kỳ ô nào để thêm người dùng hoặc thêm vé mới.</li>
            <li>Mở mục &ldquo;Thông tin kỹ thuật (dành cho demo)&rdquo; phía dưới khi cần kiểm tra bộ nhớ đệm và cân bằng tải.</li>
          </ul>
        </details>
      </header>

      <div className="grid">
        <Users onTechInfo={handleTechInfo} />
        <Tickets onTechInfo={handleTechInfo} />

        {/* Khối kỹ thuật thu gọn mặc định (AC17, AC35, AC37) */}
        <details className="card wide tech-details">
          <summary className="tech-summary">Thông tin kỹ thuật (dành cho demo)</summary>
          <div className="tech-content">
            <div className="tech-telemetry">
              <p className="meta">
                <b>Truy vấn vé gần nhất (/api/tickets):</b>{' '}
                {techState.tickets ? (
                  <>
                    Nguồn dữ liệu: <b>{formatCacheSource(techState.tickets.cache)}</b> · Thời gian:{' '}
                    <b>{techState.tickets.ms} ms</b> · Bản sao xử lý: <b>{techState.tickets.servedBy}</b> · Upstream:{' '}
                    <b>{techState.tickets.upstream}</b>
                  </>
                ) : (
                  'Chưa có dữ liệu'
                )}
              </p>
              <p className="meta">
                <b>Truy vấn người dùng gần nhất (/api/users):</b>{' '}
                {techState.users ? (
                  <>
                    Nguồn dữ liệu: <b>Cơ sở dữ liệu (PostgreSQL)</b> · Thời gian:{' '}
                    <b>{techState.users.ms} ms</b> · Bản sao xử lý: <b>{techState.users.servedBy}</b> · Upstream:{' '}
                    <b>{techState.users.upstream}</b>
                  </>
                ) : (
                  'Chưa có dữ liệu'
                )}
              </p>
            </div>
            <LoadBalancer />
          </div>
        </details>
      </div>

      <footer className="app-footer">
        <p className="support-note">Cần hỗ trợ? Liên hệ quản trị viên hệ thống.</p>
      </footer>
    </main>
  );
}

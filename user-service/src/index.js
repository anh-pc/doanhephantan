// User Service - Express + PostgreSQL (database riêng: users_db)
const express = require('express');
const os = require('os');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@postgres:5432/users_db',
  max: 5,
});
const HOSTNAME = os.hostname();
const PORT = Number(process.env.PORT || 3000);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateUserInput(body) {
  const name = String(body?.name ?? '').trim();
  const email = String(body?.email ?? '').trim();
  if (!name || name.length > 100 || !EMAIL_RE.test(email) || email.length > 150) {
    return null;
  }
  return { name, email };
}

app.get('/api/users/health', (_req, res) => res.json({ status: 'ok', served_by: HOSTNAME }));

app.get('/api/users', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, email, created_at FROM users ORDER BY id');
    res.json({ items: rows, served_by: HOSTNAME });
  } catch (e) { console.error(e); res.status(500).json({ error: 'internal error' }); }
});

app.get(/^\/api\/users\/(\d+)$/, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, email, created_at FROM users WHERE id=$1', [req.params[0]]);
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json({ user: rows[0], served_by: HOSTNAME });
  } catch (e) { console.error(e); res.status(500).json({ error: 'internal error' }); }
});

app.post('/api/users', async (req, res) => {
  const valid = validateUserInput(req.body);
  if (!valid) return res.status(400).json({ error: 'name/email không hợp lệ' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (name, email) VALUES ($1,$2) RETURNING id, name, email, created_at',
      [valid.name, valid.email]
    );
    res.status(201).json({ user: rows[0], served_by: HOSTNAME });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'email đã tồn tại' });
    console.error(e); res.status(500).json({ error: 'internal error' });
  }
});

app.put(/^\/api\/users\/(\d+)$/, async (req, res) => {
  const valid = validateUserInput(req.body);
  if (!valid) return res.status(400).json({ error: 'name/email không hợp lệ' });
  try {
    const { rows } = await pool.query(
      'UPDATE users SET name=$1, email=$2 WHERE id=$3 RETURNING id, name, email, created_at',
      [valid.name, valid.email, req.params[0]]
    );
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json({ user: rows[0], served_by: HOSTNAME });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'email đã tồn tại' });
    console.error(e); res.status(500).json({ error: 'internal error' });
  }
});

app.delete(/^\/api\/users\/(\d+)$/, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM users WHERE id=$1 RETURNING id, name, email',
      [req.params[0]]
    );
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json({ deleted: rows[0], served_by: HOSTNAME });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'internal error' });
  }
});

const server = app.listen(PORT, '0.0.0.0', () => console.log(`user-service listening on :${PORT} (${HOSTNAME})`));
process.on('SIGTERM', () => server.close(() => pool.end().then(() => process.exit(0))));

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const db = require('../config/db');

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, email: user.email, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// Patients self-register. Doctors are created by admin (see admin.controller).
async function register(req, res, next) {
  try {
    const { name, email, password, phone } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email, password are required' });
    }
    const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const id = uuid();
    const hash = await bcrypt.hash(password, 10);
    db.prepare(
      `INSERT INTO users (id, role, name, email, password_hash, phone) VALUES (?,?,?,?,?,?)`
    ).run(id, 'patient', name, email, hash, phone || null);

    const user = { id, role: 'patient', name, email };
    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const safeUser = { id: user.id, role: user.role, name: user.name, email: user.email };
    res.json({ token: signToken(safeUser), user: safeUser });
  } catch (err) {
    next(err);
  }
}

async function me(req, res) {
  res.json({ user: req.user });
}

module.exports = { register, login, me };

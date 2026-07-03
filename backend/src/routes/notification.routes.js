const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const db = require('../config/db');

router.get('/', authenticate, (req, res) => {
  const rows = db
    .prepare(`SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`)
    .all(req.user.id);
  res.json(rows);
});

router.post('/:id/read', authenticate, (req, res) => {
  db.prepare(`UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?`).run(req.params.id, req.user.id);
  res.json({ ok: true });
});

module.exports = router;

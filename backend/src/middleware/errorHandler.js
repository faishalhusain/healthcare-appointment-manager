function errorHandler(err, req, res, next) {
  console.error('[ERROR]', err.message);
  if (err.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed/.test(err.message)) {
    return res.status(409).json({ error: 'This slot was just taken. Please pick another.' });
  }
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
}

module.exports = errorHandler;

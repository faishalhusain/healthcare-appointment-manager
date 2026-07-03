const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const calendarService = require('../services/calendar.service');

// Frontend calls this to get the Google consent URL for the logged-in user
router.get('/oauth/url', authenticate, (req, res) => {
  const url = calendarService.getAuthUrl(req.user.id); // state = userId
  res.json({ url });
});

// Google redirects here after consent
router.get('/oauth/callback', async (req, res) => {
  try {
    const { code, state: userId } = req.query;
    await calendarService.handleOAuthCallback(code, userId);
    res.redirect(`${process.env.CLIENT_URL}/calendar-connected`);
  } catch (err) {
    res.redirect(`${process.env.CLIENT_URL}/calendar-connected?error=1`);
  }
});

module.exports = router;

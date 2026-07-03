require('dotenv').config();
const express = require('express');
const cors = require('cors');

require('./config/db'); // initialises schema on startup

const authRoutes = require('./routes/auth.routes');
const doctorRoutes = require('./routes/doctor.routes');
const appointmentRoutes = require('./routes/appointment.routes');
const adminRoutes = require('./routes/admin.routes');
const calendarRoutes = require('./routes/calendar.routes');
const notificationRoutes = require('./routes/notification.routes');
const errorHandler = require('./middleware/errorHandler');
const reminderJob = require('./jobs/reminderJob');

const app = express();
app.use(cors({ origin: process.env.CLIENT_URL || '*' }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'healthcare-appointment-api' }));

app.use('/api/auth', authRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/notifications', notificationRoutes);

app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
  reminderJob.start();
});

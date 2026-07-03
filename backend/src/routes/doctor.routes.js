const router = require('express').Router();
const ctrl = require('../controllers/doctor.controller');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/', authenticate, ctrl.searchDoctors);
router.get('/:id/availability', authenticate, ctrl.getAvailability);
router.get('/me/appointments', authenticate, authorize('doctor'), ctrl.myAppointments);

module.exports = router;

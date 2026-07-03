const router = require('express').Router();
const ctrl = require('../controllers/appointment.controller');
const { authenticate, authorize } = require('../middleware/auth');

router.post('/hold', authenticate, authorize('patient'), ctrl.holdSlot);
router.post('/:id/confirm', authenticate, authorize('patient'), ctrl.confirmAppointment);
router.post('/:id/reschedule', authenticate, authorize('patient'), ctrl.rescheduleAppointment);
router.post('/:id/cancel', authenticate, ctrl.cancelAppointment);
router.post('/:id/post-visit', authenticate, authorize('doctor'), ctrl.submitPostVisit);
router.get('/me', authenticate, authorize('patient'), ctrl.myPatientAppointments);
router.get('/:id', authenticate, ctrl.getAppointment);

module.exports = router;

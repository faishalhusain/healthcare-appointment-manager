const router = require('express').Router();
const ctrl = require('../controllers/admin.controller');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize('admin'));

router.post('/doctors', ctrl.createDoctor);
router.get('/doctors', ctrl.listDoctors);
router.put('/doctors/:id', ctrl.updateDoctor);
router.delete('/doctors/:id', ctrl.deleteDoctor);
router.post('/doctors/:id/leave', ctrl.markLeave);
router.get('/doctors/:id/leave', ctrl.listLeaves);

module.exports = router;

import { Router } from 'express';
import {
  getApplications,
  getAutomationConfig,
  getTeachers,
  getTuitionAutomationOverview,
  getTuitions,
  processAll,
  processOneTuition,
  putTeacherAutomation,
} from '../controllers/automationController.js';

const router = Router();

router.get('/teachers', getTeachers);
router.get('/tuitions', getTuitions);
router.get('/automation/config', getAutomationConfig);
router.put('/automation/teachers/:teacherId', putTeacherAutomation);
router.post('/automation/process-all', processAll);
router.post('/automation/process/:tuitionId', processOneTuition);
router.get('/applications', getApplications);
router.get('/tuition-automation-overview', getTuitionAutomationOverview);

export default router;

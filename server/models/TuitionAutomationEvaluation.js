import mongoose from 'mongoose';

const evaluationMatchSchema = new mongoose.Schema({
  ruleScore: { type: Number, min: 0, max: 100, default: 0 },
  geminiScore: { type: Number, min: 0, max: 100, default: null },
  confidence: { type: Number, min: 0, max: 1, default: null },
  decision: { type: String, default: 'REJECT' },
  matchedRequirements: { type: [String], default: [] },
  missingRequirements: { type: [String], default: [] },
  concerns: { type: [String], default: [] },
  reason: { type: String, default: '' },
}, { _id: false });

// This collection persists non-application results without representing them as applications.
const tuitionAutomationEvaluationSchema = new mongoose.Schema({
  teacherId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'TeacherProfile', index: true },
  tuitionId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Tuition', index: true },
  source: { type: String, enum: ['manual-process', 'scheduler'], required: true },
  dryRun: { type: Boolean, required: true },
  outcome: {
    type: String,
    enum: ['SKIPPED_RULE', 'AI_FAILED', 'REVIEW_ONLY', 'ALREADY_APPLIED', 'INVALID_TUITION', 'ERROR'],
    required: true,
  },
  wouldApply: { type: Boolean, default: false },
  errorCode: { type: String, default: null },
  match: { type: evaluationMatchSchema, required: true },
}, { collection: 'tuitionAutomationEvaluations', timestamps: true });

tuitionAutomationEvaluationSchema.index({ tuitionId: 1, createdAt: -1 });
tuitionAutomationEvaluationSchema.index({ teacherId: 1, createdAt: -1 });
tuitionAutomationEvaluationSchema.index({ teacherId: 1, tuitionId: 1, createdAt: -1 });

export default mongoose.models.TuitionAutomationEvaluation
  || mongoose.model('TuitionAutomationEvaluation', tuitionAutomationEvaluationSchema);

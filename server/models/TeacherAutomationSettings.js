import mongoose from 'mongoose';

const teacherAutomationSettingsSchema = new mongoose.Schema({
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    unique: true,
    index: true,
    ref: 'TeacherProfile',
  },
  autoApply: { type: Boolean, default: false },
}, { collection: 'teacherAutomationSettings', timestamps: true });

export default mongoose.models.TeacherAutomationSettings
  || mongoose.model('TeacherAutomationSettings', teacherAutomationSettingsSchema);

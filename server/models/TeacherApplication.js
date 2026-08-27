import mongoose from 'mongoose';

// Existing main-website collection. It remains schema-less because this standalone
// service must create the same flexible records as the production application flow.
const teacherApplicationSchema = new mongoose.Schema({}, {
  strict: false,
  strictQuery: false,
  collection: 'teacherapplications',
  timestamps: true,
});

// Supports the scheduler's inexpensive "already applied?" pair lookup.
// It is deliberately not unique because this is also the main website's existing collection.
teacherApplicationSchema.index({ userId: 1, jobId: 1 });

export default mongoose.models.TeacherApplication
  || mongoose.model('TeacherApplication', teacherApplicationSchema);

import mongoose from 'mongoose';

// Existing production collection: intentionally schema-less and read-only in this project.
const teacherProfileSchema = new mongoose.Schema({}, {
  strict: false,
  strictQuery: false,
  collection: 'teacherprofiles',
});

export default mongoose.models.TeacherProfile
  || mongoose.model('TeacherProfile', teacherProfileSchema);

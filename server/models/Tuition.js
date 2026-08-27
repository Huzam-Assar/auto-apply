import mongoose from 'mongoose';

// Existing production collection. It is read during matching; a successful automatic
// application updates only its established numeric `applications` counter so the main
// website exposes the new application in the same way as a normal application.
const tuitionSchema = new mongoose.Schema({}, {
  strict: false,
  strictQuery: false,
  collection: 'studenttuitiondetails',
});

export default mongoose.models.Tuition || mongoose.model('Tuition', tuitionSchema);

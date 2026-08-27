import { connectDatabase, disconnectDatabase } from '../config/db.js';
import TeacherProfile from '../models/TeacherProfile.js';
import Tuition from '../models/Tuition.js';

function collectFields(value, prefix = '', fields = new Set()) {
  if (value === null || value === undefined) return fields;
  if (Array.isArray(value)) {
    value.forEach((item) => collectFields(item, prefix, fields));
    return fields;
  }
  if (typeof value !== 'object' || value instanceof Date) {
    if (prefix) fields.add(prefix);
    return fields;
  }
  Object.entries(value).forEach(([key, item]) => collectFields(item, prefix ? `${prefix}.${key}` : key, fields));
  return fields;
}

try {
  await connectDatabase();
  const client = TeacherProfile.db.getClient();
  let collectionDatabases = [];
  try {
    const { databases } = await client.db().admin().listDatabases({ nameOnly: true });
    const findings = await Promise.all(databases
      .filter((database) => !['admin', 'config', 'local'].includes(database.name))
      .map(async (database) => {
        const names = await client.db(database.name).listCollections().toArray();
        const matchingNames = names.filter((item) => ['teacherprofiles', 'studenttuitiondetails'].includes(item.name));
        return matchingNames.length ? { database: database.name, collections: matchingNames.map((item) => item.name) } : null;
      }));
    collectionDatabases = findings.filter(Boolean);
  } catch (error) {
    collectionDatabases = [{ warning: `Unable to list databases: ${error.message}` }];
  }
  const [teacherCount, tuitionCount, teachers, tuitions, statusRows] = await Promise.all([
    TeacherProfile.countDocuments(),
    Tuition.countDocuments(),
    TeacherProfile.find({}, { userId: 0, firstName: 0, lastName: 0, fatherName: 0, gender: 0, religion: 0, dateOfBirth: 0 }).limit(10).lean(),
    Tuition.find({}, { userId: 0, gender: 0 }).limit(10).lean(),
    Tuition.aggregate([
      { $group: { _id: { $toLower: { $ifNull: ['$status', 'missing'] } }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
  ]);
  const teacherFields = new Set();
  const tuitionFields = new Set();
  teachers.forEach((teacher) => collectFields(teacher, '', teacherFields));
  tuitions.forEach((tuition) => collectFields(tuition, '', tuitionFields));
  console.log(JSON.stringify({
    connectedDatabase: TeacherProfile.db.name,
    collectionDatabases,
    teacherCount,
    tuitionCount,
    teacherFields: [...teacherFields].sort(),
    tuitionFields: [...tuitionFields].sort(),
    tuitionStatusCounts: statusRows,
  }, null, 2));
} catch (error) {
  console.error(`[ERROR] Database inspection failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}

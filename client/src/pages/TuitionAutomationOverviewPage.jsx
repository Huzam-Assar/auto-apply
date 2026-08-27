import { useEffect, useState } from 'react';
import { api } from '../api.js';

function teacherName(teacher) {
  return teacher ? [teacher.firstName, teacher.lastName].filter(Boolean).join(' ') || 'Unnamed teacher' : 'Teacher unavailable';
}

function text(value) {
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'Not specified';
  return value === undefined || value === null || value === '' ? 'Not specified' : String(value);
}

function tuitionTitle(tuition) {
  return tuition.tuitionDetails || tuition.subject || 'Untitled tuition';
}

function Requirement({ label, value }) {
  return <div><dt>{label}</dt><dd>{text(value)}</dd></div>;
}

export default function TuitionAutomationOverviewPage() {
  const [overview, setOverview] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    setMessage('');
    try {
      const response = await api.getTuitionAutomationOverview();
      setOverview(response.overview);
    } catch (error) { setMessage(error.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  return (
    <section>
      <div className="page-title-row">
        <div>
          <p className="eyebrow">Page 3 of 3</p>
          <h2>Tuition Requirements &amp; Teacher Applications</h2>
          <p>Available tuition requirements alongside each teacher’s newest automatic result.</p>
        </div>
        <button className="secondary" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      {message && <p className="alert error">{message}</p>}
      {!loading && overview.length === 0 && !message && <p className="empty">No available tuitions were returned.</p>}
      <div className="tuition-overview-list">
        {overview.map(({ tuition, teacherResults }) => {
          const applications = teacherResults.filter((result) => result.resultType === 'APPLICATION');
          return (
          <article className="tuition-overview-card" key={tuition._id}>
            <div className="card-heading">
              <div><h3>{tuitionTitle(tuition)}</h3><p className="muted">Grade {tuition.classGrade || 'Not specified'} · {tuition.status}</p></div>
              <span className="badge good">{applications.length} application{applications.length === 1 ? '' : 's'}</span>
            </div>
            <div className="tuition-detail-columns">
              <section>
                <h4>Tuition requirements</h4>
                <dl className="requirements-grid">
                  <Requirement label="Subject" value={tuition.subject || tuition.tuitionDetails} />
                  <Requirement label="Mode" value={tuition.mode} />
                  <Requirement label="Language" value={tuition.preferredLanguage} />
                  <Requirement label="Location" value={[tuition.sector, tuition.city, tuition.country].filter(Boolean)} />
                  <Requirement label="Grade" value={tuition.classGrade} />
                  <Requirement label="Schedule" value={tuition.classTiming || tuition.preferredDays} />
                  <Requirement label="Time slots" value={tuition.preferredTimeSlots} />
                  <Requirement label="Classes/week" value={tuition.classesPerWeek} />
                  <Requirement label="Price" value={tuition.priceMin || tuition.priceMax ? `${tuition.priceMin ?? '—'}–${tuition.priceMax ?? '—'} ${tuition.currency || ''} / ${tuition.rateType || ''}` : null} />
                  <Requirement label="Notes" value={tuition.additionalInfo} />
                </dl>
              </section>
              <section>
                <h4>Teacher applications</h4>
                {applications.length === 0 && <p className="muted">No automatic applications for this tuition yet.</p>}
                <div className="teacher-result-list">
                  {applications.map((result) => (
                    <article className="teacher-result" key={`${result.resultType}-${result._id}`}>
                      <div className="card-heading"><strong>{teacherName(result.teacher)}</strong><span className={`badge ${result.resultType === 'APPLICATION' ? 'good' : ''}`}>{result.status || result.outcome}</span></div>
                      <p>Rule: <strong>{result.match?.ruleScore ?? '—'}</strong> · Gemini: <strong>{result.match?.geminiScore ?? '—'}</strong> · Decision: <strong>{result.match?.decision || '—'}</strong></p>
                      <small>{result.match?.reason || 'No reason recorded.'}</small>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          </article>
          );
        })}
      </div>
    </section>
  );
}

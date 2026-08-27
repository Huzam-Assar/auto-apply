import { useEffect, useState } from 'react';
import { api } from '../api.js';

function name(teacher) {
  return teacher ? [teacher.firstName, teacher.lastName].filter(Boolean).join(' ') || 'Unnamed teacher' : 'Teacher unavailable';
}

function tuitionTitle(tuition) {
  return tuition ? `${tuition.tuitionDetails || tuition.subject || 'Untitled'} · Grade ${tuition.classGrade || '—'}` : 'Tuition unavailable';
}

export default function ApplicationsPage() {
  const [results, setResults] = useState([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setMessage('');
    try {
      const response = await api.getApplications();
      setResults(response.results.filter((item) => item.resultType === 'APPLICATION'));
    } catch (error) { setMessage(error.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);
  return (
    <section>
      <div className="page-title-row">
        <div>
          <p className="eyebrow">Page 2 of 3</p>
          <h2>Automatic Applications</h2>
          <p>Live applications created by the automation, with their tuition details.</p>
        </div>
        <button className="secondary" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      {message && <p className="alert error">{message}</p>}
      {!loading && results.length === 0 && !message && <p className="empty">No live automatic applications yet.</p>}
      <div className="application-list">
        {results.map((item) => (
          <article className="application-card" key={`${item.resultType}-${item._id}`}>
            <div className="card-heading"><h3>{name(item.teacher)}</h3><span className={`badge ${item.resultType === 'APPLICATION' ? 'good' : ''}`}>{item.resultType === 'APPLICATION' ? 'AUTO · APPLIED' : item.outcome}</span></div>
            <p><strong>Tuition:</strong> {tuitionTitle(item.tuition)}</p>
            <div className="metric-row"><span>Rule score <strong>{item.match?.ruleScore ?? '—'}%</strong></span><span>Gemini score <strong>{item.match?.geminiScore ?? '—'}%</strong></span><span>Confidence <strong>{item.match?.confidence ?? '—'}</strong></span></div>
            <p><strong>Decision:</strong> {item.match?.decision || '—'} · <strong>Status:</strong> {item.status || item.outcome}</p>
            <p className="reason">{item.match?.reason || 'No reason recorded.'}</p>
            <div className="requirements"><span>Matched: {item.match?.matchedRequirements?.join(', ') || '—'}</span><span>Missing: {item.match?.missingRequirements?.join(', ') || '—'}</span></div>
            <small>{new Date(item.createdAt).toLocaleString()} · LIVE {item.source ? `· ${item.source}` : ''}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

function teacherName(teacher) {
  return [teacher.firstName, teacher.lastName].filter(Boolean).join(' ') || 'Unnamed teacher';
}

function tuitionLabel(tuition) {
  return `${tuition.tuitionDetails || tuition.subject || 'Untitled'} · Grade ${tuition.classGrade || '—'} · ${tuition.city || 'Unknown city'}`;
}

function ResultPanel({ result, title = 'Latest result' }) {
  if (!result) return null;
  const rows = result.outcomes || [result];
  return (
    <section className="result-panel" aria-live="polite">
      <h3>{title}</h3>
      <p className="muted">LIVE MODE — eligible applications may have been created.</p>
      <div className="result-list">
        {rows.map((row, index) => (
          <article className="mini-result" key={`${row.outcome}-${index}`}>
            <strong>{row.teacher?.name || `Candidate ${index + 1}`}</strong>
            <span className={`badge ${row.outcome === 'AUTO_APPLIED' ? 'good' : ''}`}>{row.outcome}</span>
            <span>Gate: {row.match?.ruleScore === null || row.match?.ruleScore === undefined ? '—' : row.match.ruleScore ? 'Passed' : 'Blocked'} · Gemini: {row.match?.geminiScore ?? '—'}</span>
            <small>{row.match?.reason}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function TeacherAutomationPage() {
  const [teachers, setTeachers] = useState([]);
  const [tuitions, setTuitions] = useState([]);
  const [config, setConfig] = useState(null);
  const [selectedTuitionId, setSelectedTuitionId] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState(null);

  const selectedTuition = useMemo(() => tuitions.find((tuition) => tuition._id === selectedTuitionId), [tuitions, selectedTuitionId]);

  async function load() {
    setMessage('');
    try {
      const [teacherData, tuitionData, configData] = await Promise.all([api.getTeachers(), api.getTuitions(), api.getConfig()]);
      setTeachers(teacherData.teachers);
      setTuitions(tuitionData.tuitions);
      setConfig(configData);
      if (!selectedTuitionId && tuitionData.tuitions[0]) setSelectedTuitionId(tuitionData.tuitions[0]._id);
    } catch (error) { setMessage(error.message); }
  }

  useEffect(() => { load(); }, []);

  async function saveSettings(teacher, changes) {
    setBusy(`settings-${teacher._id}`);
    setMessage('');
    try {
      const { settings } = await api.updateTeacher(teacher._id, { ...teacher.automation, ...changes });
      setTeachers((current) => current.map((item) => item._id === teacher._id ? { ...item, automation: settings } : item));
    } catch (error) { setMessage(error.message); }
    finally { setBusy(''); }
  }

  async function run(label, action) {
    setBusy(label);
    setMessage('');
    setResult(null);
    try {
      const response = await action();
      setResult(response.result || { outcomes: response.results.flatMap((item) => item.outcomes || []) });
    } catch (error) { setMessage(error.message); }
    finally { setBusy(''); }
  }

  return (
    <section className="page-grid">
      <div className="main-column">
        <div className="page-title-row">
          <div>
            <p className="eyebrow">Page 1 of 3</p>
            <h2>Teacher Automation</h2>
            <p>Real teacher profiles with separate, persistent automation settings.</p>
          </div>
          <button className="secondary" onClick={load} disabled={Boolean(busy)}>Refresh data</button>
        </div>
        {message && <p className="alert error">{message}</p>}
        {teachers.length === 0 && !message && <p className="empty">No teachers were returned.</p>}
        <div className="teacher-grid">
          {teachers.map((teacher) => (
            <article className="teacher-card" key={teacher._id}>
              <div className="card-heading">
                <h3>{teacherName(teacher)}</h3>
                <span className={`badge ${teacher.automation.autoApply ? 'good' : ''}`}>{teacher.automation.autoApply ? 'Auto apply on' : 'Auto apply off'}</span>
              </div>
              <dl>
                <div><dt>Skills</dt><dd>{teacher.skills?.join(', ') || 'Not provided'}</dd></div>
                <div><dt>Languages</dt><dd>{teacher.languages?.join(', ') || 'Not provided'}</dd></div>
                <div><dt>Location</dt><dd>{[teacher.city, teacher.country].filter(Boolean).join(', ') || 'Not provided'}</dd></div>
              </dl>
              <div className="controls two-up">
                <label className="switch-row"><input type="checkbox" checked={teacher.automation.autoApply} disabled={busy === `settings-${teacher._id}`} onChange={(event) => saveSettings(teacher, { autoApply: event.target.checked })} /> Auto apply</label>
              </div>
            </article>
          ))}
        </div>
      </div>
      <aside className="testing-panel">
        <p className="eyebrow">Live controls</p>
        <h2>Run auto apply</h2>
        {config && <>
          <p className="alert warning">LIVE MODE — eligible matches create applications.</p>
          <p className="muted">Backend Gemini quality requirement: match = true and score at least {config.geminiAutoApplyMinimum}/100. Teachers cannot change this.</p>
          {!config.geminiConfigured && <p className="alert warning">Gemini is not configured. Automation will return AI_FAILED.</p>}
        </>}
        <label>Choose available tuition
          <select value={selectedTuitionId} onChange={(event) => setSelectedTuitionId(event.target.value)}>
            <option value="">Select tuition</option>
            {tuitions.map((tuition) => <option key={tuition._id} value={tuition._id}>{tuitionLabel(tuition)}</option>)}
          </select>
        </label>
        {selectedTuition && <p className="muted">Status: {selectedTuition.status} · Mode: {selectedTuition.mode || 'Unknown'}</p>}
        <button className="wide secondary" disabled={!selectedTuitionId || Boolean(busy)} onClick={() => run('process-one', () => api.processOne(selectedTuitionId))}>Process selected tuition</button>
        <button className="wide danger" disabled={Boolean(busy)} onClick={() => run('process-all', () => api.processAll())}>Process all eligible tuitions</button>
        {result && <ResultPanel result={result} title="Automation output" />}
      </aside>
    </section>
  );
}

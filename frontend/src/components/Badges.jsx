export function UrgencyBadge({ level }) {
  const cls = (level || 'low').toLowerCase();
  return <span className={`badge ${cls}`}>{level || 'Low'}</span>;
}

export function StatusBadge({ status }) {
  return <span className={`badge status-${status}`}>{status.replace('_', ' ')}</span>;
}

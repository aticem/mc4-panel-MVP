import React from 'react';

export default function HistoryModal({ isOpen, onClose, dailyLog }) {
  if (!isOpen) return null;

  const sorted = [...dailyLog].sort((a, b) => new Date(b.date) - new Date(a.date));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🗒️ Submission History</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="history-table">
          {sorted.length === 0 && (
            <div className="history-empty">No submissions yet.</div>
          )}
          {sorted.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Subcontractor</th>
                  <th>Workers</th>
                  <th>Installed</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, idx) => (
                  <tr key={idx}>
                    <td>{r.date}</td>
                    <td>{r.subcontractor || '-'}</td>
                    <td>{r.workers}</td>
                    <td>{r.installed_panels}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

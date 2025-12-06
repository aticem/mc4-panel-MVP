import React, { useState } from 'react';

export default function SubmitModal({ isOpen, onClose, onSubmit, dailyInstalled }) {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [subcontractor, setSubcontractor] = useState('');
  const [workers, setWorkers] = useState(1);

  const handleSubmit = (e) => {
    e.preventDefault();
    
    const record = {
      date,
      installed_panels: dailyInstalled,
      subcontractor,
      workers: parseInt(workers) || 1,
    };
    
    onSubmit(record);
    
    // Reset form
    setSubcontractor('');
    setWorkers(1);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>📋 Submit Daily Work</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="date">Date</label>
            <input
              type="date"
              id="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="subcontractor">Subcontractor</label>
            <input
              type="text"
              id="subcontractor"
              value={subcontractor}
              onChange={(e) => setSubcontractor(e.target.value)}
              placeholder="Enter subcontractor name"
              required
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="workers">Number of Workers</label>
            <input
              type="number"
              id="workers"
              value={workers}
              onChange={(e) => setWorkers(e.target.value)}
              min="1"
              required
            />
          </div>
          
          <div className="form-group">
            <label>Daily Installed (MC4)</label>
            <div className="daily-installed-display">
              <strong>{dailyInstalled}</strong> ends completed
            </div>
          </div>
          
          <div className="modal-actions">
            <button type="button" className="btn-cancel" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-submit">
              Submit
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

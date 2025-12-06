import React from 'react';

export default function ProgressStats({ mc4, termination, dailyLog }) {
  return (
    <div className="progress-stats">
      <div className="counters">
        <div className="counter-row">
          <span className="counter-label">MC4 Install:</span>
          <span className="counter-item">Total: <strong>{mc4.total}</strong></span>
          <span className="counter-item completed">Done: <strong>{mc4.completed}</strong></span>
          <span className="counter-item remaining">Remaining: <strong>{mc4.remaining}</strong></span>
        </div>
        <div className="counter-row">
          <span className="counter-label">Cable Termination:</span>
          <span className="counter-item">Total: <strong>{termination.total}</strong></span>
          <span className="counter-item completed">Done: <strong>{termination.completed}</strong></span>
          <span className="counter-item remaining">Remaining: <strong>{termination.remaining}</strong></span>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';

export function OnlineStatus() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const update = () => setOnline(navigator.onLine);
    update();

    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const label = online ? 'Online' : 'Offline';
  const dotColor = online ? 'var(--success)' : 'var(--error)';

  return (
    <div
      title={online ? '' : ''}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 12,
        color: 'var(--muted-fg)',
        padding: '6px 10px',
        borderRadius: 999,
        border: '1px solid var(--border)',
        background: 'var(--surface)',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: dotColor,
          boxShadow: `0 0 0 2px color-mix(in srgb, ${dotColor} 25%, transparent)`,
        }}
      />
      <span>{label}</span>
    </div>
  );
}

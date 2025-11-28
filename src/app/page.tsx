'use client';

import { useState } from 'react';

type Role = 'user' | 'assistant';

interface Message {
  role: Role;
  content: string;
}

export default function Page() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const newMessage: Message = { role: 'user', content: input.trim() };
    const nextMessages = [...messages, newMessage];

    setMessages(nextMessages);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const choice = data.choices?.[0]?.message;
      const reply: Message = {
        role: choice?.role || 'assistant',
        content: choice?.content || '',
      };

      setMessages((prev) => [...prev, reply]);
    } catch (err: any) {
      setError(err.message || 'Request failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>BotCow Code Assistant</h1>

      <div
        style={{
          border: '1px solid #ddd',
          borderRadius: 8,
          padding: 12,
          height: 400,
          overflowY: 'auto',
          marginBottom: 12,
          background: '#fafafa',
        }}
      >
        {messages.length === 0 && (
          <div style={{ color: '#777' }}>Начни диалог. Я — код-ассистент.</div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              marginBottom: 8,
              textAlign: m.role === 'user' ? 'right' : 'left',
            }}
          >
            <div
              style={{
                display: 'inline-block',
                padding: '6px 10px',
                borderRadius: 6,
                background: m.role === 'user' ? '#d0ebff' : '#e9ecef',
                whiteSpace: 'pre-wrap',
              }}
            >
              <strong>{m.role === 'user' ? 'Ты' : 'Ассистент'}: </strong>
              {m.content}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div style={{ color: 'red', marginBottom: 8 }}>Ошибка: {error}</div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Напиши запрос..."
          style={{ flex: 1, padding: 8, borderRadius: 4, border: '1px solid #ccc' }}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          style={{
            padding: '8px 16px',
            borderRadius: 4,
            border: 'none',
            cursor: loading ? 'default' : 'pointer',
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? 'Ждём...' : 'Отправить'}
        </button>
      </form>
    </main>
  );
}

import type { FormEvent } from 'react';

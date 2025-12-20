'use client';

import { useEffect, useState, useRef, useLayoutEffect } from 'react';
import type { FormEvent, ChangeEvent } from 'react';
import { clearRecentMessages, loadRecentMessages, saveRecentMessages, type Message } from './pwa/chatStore';

type Role = 'user' | 'assistant';

export default function Page() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePath, setFilePath] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
  const [branchName, setBranchName] = useState('botcow-assistant');
  const [commitLoading, setCommitLoading] = useState(false);
  const [commitResult, setCommitResult] = useState<string | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);

  const [viewPath, setViewPath] = useState('');
  const [viewLoading, setViewLoading] = useState(false);
  const [viewContent, setViewContent] = useState<string | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);

  const [workflowId, setWorkflowId] = useState('ci.yml');
  const [workflowRef, setWorkflowRef] = useState('main');
  const [workflowRunId, setWorkflowRunId] = useState('');
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [workflowStatusLoading, setWorkflowStatusLoading] = useState(false);
  const [workflowMessage, setWorkflowMessage] = useState<string | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);

  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    loadRecentMessages().then((loaded) => {
      if (loaded.length > 0) setMessages(loaded);
    });

    const updateOnline = () => setIsOffline(!navigator.onLine);
    updateOnline();

    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);

    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    function onNewChat() {
      setMessages([]);
      setInput('');
      setChatError(null);
      setChatLoading(false);
      void clearRecentMessages();
    }

    window.addEventListener('botcow:new-chat', onNewChat);
    return () => window.removeEventListener('botcow:new-chat', onNewChat);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    void saveRecentMessages(messages);
  }, [messages]);

  function getMaxHeight(): number {
    const ta = taRef.current;
    if (!ta || typeof window === 'undefined') return 0;
    const style = window.getComputedStyle(ta);
    const lineHeight = parseFloat(style.lineHeight) || (parseFloat(style.fontSize) * 1.2) || 18;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const paddingBottom = parseFloat(style.paddingBottom) || 0;
    const borderTop = parseFloat(style.borderTopWidth) || 0;
    const borderBottom = parseFloat(style.borderBottomWidth) || 0;
    return Math.round(lineHeight * 6 + paddingTop + paddingBottom + borderTop + borderBottom);
  }

  function adjustHeight() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const maxH = getMaxHeight();
    const newH = Math.min(ta.scrollHeight, maxH || ta.scrollHeight);
    ta.style.height = `${newH}px`;
    if (ta.scrollHeight > (maxH || Infinity)) {
      ta.scrollTop = ta.scrollHeight;
    }
  }

  useLayoutEffect(() => {
    adjustHeight();
    function onResize() {
      adjustHeight();
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [input]);

  async function handleChatSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || chatLoading) return;

    if (typeof window !== 'undefined' && !navigator.onLine) {
      setIsOffline(true);
      setChatError('Offline: cannot send message. Showing the last saved messages.');
      return;
    }

    const newMessage: Message = { role: 'user', content: input.trim() };
    const nextMessages = [...messages, newMessage];

    setMessages(nextMessages);
    setInput('');
    setChatLoading(true);
    setChatError(null);

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
        role: (choice?.role as Role) || 'assistant',
        content: choice?.content || '',
      };

      setMessages((prev) => [...prev, reply]);
    } catch (err: any) {
      setChatError(err?.message || 'Chat request failed');
    } finally {
      setChatLoading(false);
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    setCommitResult(null);
    setCommitError(null);
  }

  async function handleCommitFile() {
    if (!selectedFile) {
      setCommitError('2430393b 3d35 324b3140303d');
      return;
    }
    if (!filePath.trim()) {
      setCommitError('233a3036384235 3f43424c 32 40353f3e (path)');
      return;
    }
    if (!commitMessage.trim()) {
      setCommitError('233a3036384235 commit message');
      return;
    }
    if (!branchName.trim()) {
      setCommitError('233a3036384235 3235423a43');
      return;
    }

    setCommitLoading(true);
    setCommitResult(null);
    setCommitError(null);

    try {
      const text = await selectedFile.text();

      const res = await fetch('/api/github/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: filePath.trim(),
          content: text,
          message: commitMessage.trim(),
          branch: branchName.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setCommitResult('Commit 43413f35483d3e 3e423f4030323b353d 32 GitHub');
    } catch (err: any) {
      setCommitError(err?.message || 'Commit failed');
    } finally {
      setCommitLoading(false);
    }
  }

  async function handleViewFile() {
    if (!viewPath.trim()) {
      setViewError('233a3036384235 3f43424c 4430393b30');
      return;
    }

    setViewLoading(true);
    setViewError(null);
    setViewContent(null);

    try {
      const res = await fetch('/api/github/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: viewPath.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setViewContent(String(data.content ?? ''));
    } catch (err: any) {
      setViewError(err?.message || 'Read file failed');
    } finally {
      setViewLoading(false);
    }
  }

  async function handleRunWorkflow() {
    setWorkflowLoading(true);
    setWorkflowMessage(null);
    setWorkflowError(null);

    try {
      const res = await fetch('/api/github/workflow/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_id: workflowId.trim() || undefined,
          ref: workflowRef.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setWorkflowMessage(
        `Workflow 37303f4349353d (id=${data.result?.workflow_id ?? workflowId}, ref=${data.result?.ref ?? workflowRef})`,
      );
    } catch (err: any) {
      setWorkflowError(err?.message || 'Run workflow failed');
    } finally {
      setWorkflowLoading(false);
    }
  }

  async function handleCheckWorkflowStatus() {
    const id = Number(workflowRunId);
    if (!Number.isFinite(id)) {
      setWorkflowError('run_id 343e3b36353d 314b424c 4738413b3e3c');
      return;
    }

    setWorkflowStatusLoading(true);
    setWorkflowError(null);

    try {
      const res = await fetch('/api/github/workflow/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: id }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const status = data.result?.status ?? data.result?.conclusion ?? 'unknown';
      setWorkflowMessage(`214230424341 workflow (run_id=${id}): ${status}`);
    } catch (err: any) {
      setWorkflowError(err?.message || 'Get workflow status failed');
    } finally {
      setWorkflowStatusLoading(false);
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        margin: 0,
        padding: '16px 32px 32px 32px',
        background: 'var(--bg)',
      }}
    >
      <div
        style={{
          maxWidth: 1400,
          margin: '0 auto 0 40px',
          display: 'grid',
          gridTemplateColumns: 'auto minmax(320px, 1fr)',
          gap: 24,
        }}
      >
        <section
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            width: 880,
            maxWidth: 880,
            flexShrink: 0,
          }}
        >
          <div className="card">
            <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>BotCow Code Assistant</h1>
            <p className="small-muted" style={{ margin: 0 }}>
              273042-304141384142353d42 343b4f 4030313e424b 41 3a3e343e3c 38 GitHub.
            </p>
          </div>

          {isOffline && (
            <div className="card" style={{ border: '1px solid var(--border)', background: 'var(--muted)' }}>
              <div style={{ fontSize: 13, color: 'var(--muted-fg)' }}>
                Offline: showing the last saved 20 messages. Online features are disabled.
              </div>
            </div>
          )}

          <div
            className="card"
            style={{
              display: 'flex',
              flexDirection: 'column',
              height: 420,
              width: '100%',
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                paddingRight: 4,
                marginBottom: 8,
              }}
            >
              {messages.length === 0 && (
                <div style={{ color: 'var(--muted-fg)' }}>
                  1d30473d38 3438303b3e33. 2f 14 3a3e34-304141384142353d42.
                </div>
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
                      background: m.role === 'user' ? 'var(--primary)' : 'var(--surface)',
                      color: m.role === 'user' ? 'var(--primary-fg)' : 'var(--fg)',
                      whiteSpace: 'pre-wrap',
                      maxWidth: '100%',
                      wordBreak: 'break-word',
                    }}
                  >
                    <strong>{m.role === 'user' ? '224b' : '104141384142353d42'}: </strong>
                    {m.content}
                  </div>
                </div>
              ))}
            </div>

            {chatError && (
              <div style={{ color: 'var(--error)', fontSize: 13, marginBottom: 4 }}>
                1e4838313a30: {chatError}
              </div>
            )}

            <form
              onSubmit={handleChatSubmit}
              style={{
                display: 'flex',
                gap: 8,
                width: '100%',
              }}
            >
              <textarea
                ref={taRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onInput={adjustHeight}
                placeholder="1d303f384838 37303f403e41 304141384142353d4243..."
                style={{
                  flex: '1 1 0',
                  minWidth: 0,
                  padding: 8,
                  borderRadius: 4,
                  border: '1px solid var(--border)',
                  fontSize: 14,
                  resize: 'none',
                  overflow: 'auto',
                  boxSizing: 'border-box',
                }}
              />
              <button
                type="submit"
                disabled={chatLoading || !input.trim()}
                className="button button-primary"
                style={{
                  cursor: chatLoading ? 'default' : 'pointer',
                  opacity: chatLoading ? 0.6 : 1,
                  fontSize: 14,
                }}
              >
                {chatLoading ? '1634513c...' : '1e423f40303238424c'}
              </button>
            </form>
          </div>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={viewPath}
                onChange={(e) => setViewPath(e.target.value)}
                placeholder="1f43424c 4430393b30 32 40353f3e (3d303f40383c3540, src/app/page.tsx)"
                style={{
                  flex: 1,
                  padding: 6,
                  borderRadius: 4,
                  border: '1px solid var(--border)',
                  fontSize: 13,
                }}
              />
              <button
                type="button"
                onClick={handleViewFile}
                disabled={viewLoading || !viewPath.trim()}
                className="button button-secondary"
                style={{
                  cursor: viewLoading ? 'default' : 'pointer',
                  opacity: viewLoading ? 0.6 : 1,
                  fontSize: 13,
                  whiteSpace: 'nowrap',
                }}
              >
                {viewLoading ? '2742353d3835...' : '1f3e3a303730424c 4430393b'}
              </button>
            </div>

            {viewError && <div style={{ color: 'var(--error)', fontSize: 13 }}>1e4838313a30: {viewError}</div>}

            <div
              style={{
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--muted)',
                padding: 8,
                fontFamily:
                  'SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                fontSize: 12,
                minHeight: 120,
                maxHeight: 220,
                overflow: 'auto',
                whiteSpace: 'pre',
                color: 'var(--fg)',
              }}
            >
              {viewContent || '213e34354036383c3e35 4430393b30 3143343542 3f3e3a3037303d3e 373435414c.'}
            </div>
          </div>
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h2 style={{ fontSize: 16, margin: 0 }}>1730334043373a30 4430393b30  3e GitHub commit</h2>

            <input type="file" onChange={handleFileChange} />

            <input
              type="text"
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              placeholder="1f43424c 32 40353f3e (3d303f40383c3540, docs/ARCHITECTURE.md)"
              style={{ padding: 6, borderRadius: 4, border: '1px solid var(--border)', fontSize: 13 }}
            />

            <input
              type="text"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder="Commit message"
              style={{ padding: 6, borderRadius: 4, border: '1px solid var(--border)', fontSize: 13 }}
            />

            <input
              type="text"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder="1235423a30 (3d303f40383c3540, botcow-assistant)"
              style={{ padding: 6, borderRadius: 4, border: '1px solid var(--border)', fontSize: 13 }}
            />

            <button
              type="button"
              onClick={handleCommitFile}
              disabled={commitLoading}
              className="button button-primary"
              style={{ cursor: commitLoading ? 'default' : 'pointer', opacity: commitLoading ? 0.6 : 1, fontSize: 14 }}
            >
              {commitLoading ? '1a3e3c3c3842383c 3f' : '1e423f40303238424c 3a3e3c3c3842'}
            </button>

            {commitError && <div style={{ color: 'var(--error)', fontSize: 13 }}>{commitError}</div>}
            {commitResult && <div style={{ color: 'var(--success)', fontSize: 13 }}>{commitResult}</div>}
          </div>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h2 style={{ fontSize: 16, margin: 0 }}>GitHub Actions workflow</h2>

            <input
              type="text"
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              placeholder="workflow_id (3d303f40383c3540, ci.yml)"
              style={{ padding: 6, borderRadius: 4, border: '1px solid var(--border)', fontSize: 13 }}
            />

            <input
              type="text"
              value={workflowRef}
              onChange={(e) => setWorkflowRef(e.target.value)}
              placeholder="ref (3235423a30, 3f3e 433c3e3b47303d384e main)"
              style={{ padding: 6, borderRadius: 4, border: '1px solid var(--border)', fontSize: 13 }}
            />

            <button
              type="button"
              onClick={handleRunWorkflow}
              disabled={workflowLoading}
              className="button button-secondary"
              style={{ cursor: workflowLoading ? 'default' : 'pointer', opacity: workflowLoading ? 0.6 : 1, fontSize: 14 }}
            >
              {workflowLoading ? '17303f43413a 3f' : '17303f43414238424c workflow'}
            </button>

            <input
              type="text"
              value={workflowRunId}
              onChange={(e) => setWorkflowRunId(e.target.value)}
              placeholder="run_id 343b4f 3f403e3235403a38 41423042434130"
              style={{ padding: 6, borderRadius: 4, border: '1px solid var(--border)', fontSize: 13 }}
            />

            <button
              type="button"
              onClick={handleCheckWorkflowStatus}
              disabled={workflowStatusLoading}
              className="button button-secondary"
              style={{ cursor: workflowStatusLoading ? 'default' : 'pointer', opacity: workflowStatusLoading ? 0.6 : 1, fontSize: 14 }}
            >
              {workflowStatusLoading ? '1f403e3235404f353c 3f' : '1f403e32354038424c 414230424341'}
            </button>

            {workflowError && <div style={{ color: 'var(--error)', fontSize: 13 }}>{workflowError}</div>}
            {workflowMessage && <div style={{ color: 'var(--info)', fontSize: 13 }}>{workflowMessage}</div>}
          </div>
        </section>
      </div>
    </main>
  );
}

'use client';

import { useState, useRef, useLayoutEffect } from 'react';
import type { FormEvent, ChangeEvent } from 'react';

// ... (оставим без изменений импорты и типы)

type Role = 'user' | 'assistant';

interface Message {
  role: Role;
  content: string;
}

export default function Page() {
  // состояния и useState оставим как есть, дополнительно добавим индикацию загрузок и ошибки
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

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

  function getMaxHeight(): number {
    const ta = taRef.current;
    if (!ta || typeof window === 'undefined') return 0;
    const style = window.getComputedStyle(ta);
    // try to get numeric line-height, fallback to font-size * 1.2
    const lineHeight = parseFloat(style.lineHeight) || (parseFloat(style.fontSize) * 1.2) || 18;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const paddingBottom = parseFloat(style.paddingBottom) || 0;
    const borderTop = parseFloat(style.borderTopWidth) || 0;
    const borderBottom = parseFloat(style.borderBottomWidth) || 0;
    // max height equals 6 lines + vertical paddings and borders
    return Math.round(lineHeight * 6 + paddingTop + paddingBottom + borderTop + borderBottom);
  }

  function adjustHeight() {
    const ta = taRef.current;
    if (!ta) return;
    // reset to auto to measure scrollHeight correctly
    ta.style.height = 'auto';
    const maxH = getMaxHeight();
    const newH = Math.min(ta.scrollHeight, maxH || ta.scrollHeight);
    ta.style.height = `${newH}px`;
    // if content exceeds max, keep scroll pinned to bottom
    if (ta.scrollHeight > (maxH || Infinity)) {
      ta.scrollTop = ta.scrollHeight;
    }
  }

  useLayoutEffect(() => {
    // adjust when input changes (including mount)
    adjustHeight();
    // also adjust on window resize as computed styles may change
    function onResize() {
      adjustHeight();
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [input]);

  async function handleChatSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || chatLoading) return;

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
      setCommitError('Файл не выбран');
      return;
    }
    if (!filePath.trim()) {
      setCommitError('Укажите путь в репо (path)');
      return;
    }
    if (!commitMessage.trim()) {
      setCommitError('Укажите commit message');
      return;
    }
    if (!branchName.trim()) {
      setCommitError('Укажите ветку');
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

      setCommitResult('Commit успешно отправлен в GitHub');
    } catch (err: any) {
      setCommitError(err?.message || 'Commit failed');
    } finally {
      setCommitLoading(false);
    }
  }

  async function handleViewFile() {
    if (!viewPath.trim()) {
      setViewError('Укажите путь файла');
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

      setWorkflowMessage(`Workflow запущен (id=${data.result?.workflow_id ?? workflowId}, ref=${data.result?.ref ?? workflowRef})`);
    } catch (err: any) {
      setWorkflowError(err?.message || 'Run workflow failed');
    } finally {
      setWorkflowLoading(false);
    }
  }

  async function handleCheckWorkflowStatus() {
    const id = Number(workflowRunId);
    if (!Number.isFinite(id)) {
      setWorkflowError('run_id должен быть числом');
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
      setWorkflowMessage(`Статус workflow (run_id=${id}): ${status}`);
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
        padding: 16,
        background: 'var(--bg)',
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: '2fr 1.2fr',
          gap: 16,
        }}
      >
        {/* Левая колонка: чат + просмотр файла */}
        <section
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div className="card">
            <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>
              BotCow Code Assistant
            </h1>
            <p className="small-muted" style={{ margin: 0 }}>
              Чат-ассистент для работы с кодом и GitHub.
            </p>
          </div>

          {/* Чат */}
          <div
            className="card"
            style={{
              display: 'flex',
              flexDirection: 'column',
              height: 420,
              maxWidth: 640,        // ← фиксируем максимум
              width: '100%',        // ← растягиваемся только внутри этого лимита
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
                  Начни диалог. Я — код-ассистент.
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
                      wordBreak: 'break-word',    // или overflowWrap: 'anywhere'
                    }}
                  >
                    <strong>
                      {m.role === 'user' ? 'Ты' : 'Ассистент'}:{' '}
                    </strong>
                    {m.content}
                  </div>
                </div>
              ))}
            </div>

            {chatError && (
              <div
                style={{
                  color: 'var(--error)',
                  fontSize: 13,
                  marginBottom: 4,
                }}
              >
                Ошибка: {chatError}
              </div>
            )}

            <form
              onSubmit={handleChatSubmit}
                style={{
                  display: 'flex',
                  gap: 8,
                  width: '100%',          // форма не шире карты чата
                }}
            >
              <textarea
                ref={taRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onInput={adjustHeight}
                placeholder="Напиши запрос ассистенту..."
                style={{
                  flex: '1 1 0',        // можно сжимать
                  minWidth: 0,          // ключевой момент: не раздвигать родителя
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
                className={"button button-primary"}
                style={{
                  cursor: chatLoading ? 'default' : 'pointer',
                  opacity: chatLoading ? 0.6 : 1,
                  fontSize: 14,
                }}
              >
                {chatLoading ? 'Ждём...' : 'Отправить'}
              </button>
            </form>
          </div>

          {/* Окно просмотра файла */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={viewPath}
                onChange={(e) => setViewPath(e.target.value)}
                placeholder="Путь файла в репо (например, src/app/page.tsx)"
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
                {viewLoading ? 'Чтение...' : 'Показать файл'}
              </button>
            </div>

            {viewError && (
              <div
                style={{
                  color: 'var(--error)',
                  fontSize: 13,
                }}
              >
                Ошибка: {viewError}
              </div>
            )}

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
                color: 'var(--fg)'
              }}
            >
              {viewContent || 'Содержимое файла будет показано здесь.'}
            </div>
          </div>
        </section>

        {/* Правая колонка: загрузка файлов, GitHub действия, workflow */}
        <section
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          {/* Загрузка файла и commit */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h2 style={{ fontSize: 16, margin: 0 }}>
              Загрузка файла → GitHub commit
            </h2>

            <input type="file" onChange={handleFileChange} />

            <input
              type="text"
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              placeholder="Путь в репо (например, docs/ARCHITECTURE.md)"
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
              placeholder="Ветка (например, botcow-assistant)"
              style={{ padding: 6, borderRadius: 4, border: '1px solid var(--border)', fontSize: 13 }}
            />

            <button
              type="button"
              onClick={handleCommitFile}
              disabled={commitLoading}
              className="button button-primary"
              style={{
                cursor: commitLoading ? 'default' : 'pointer',
                opacity: commitLoading ? 0.6 : 1,
                fontSize: 14,
                alignSelf: 'flex-start',
              }}
            >
              {commitLoading ? 'Коммитим…' : 'Отправить коммит'}
            </button>

            {commitError && <div style={{ color: 'var(--error)', fontSize: 13 }}>{commitError}</div>}
            {commitResult && <div style={{ color: 'var(--success)', fontSize: 13 }}>{commitResult}</div>}
          </div>

          {/* GitHub Actions workflow */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h2 style={{ fontSize: 16, margin: 0 }}>GitHub Actions workflow</h2>

            <input
              type="text"
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              placeholder="workflow_id (например, ci.yml)"
              style={{ padding: 6, borderRadius: 4, border: '1px solid var(--border)', fontSize: 13 }}
            />

            <input
              type="text"
              value={workflowRef}
              onChange={(e) => setWorkflowRef(e.target.value)}
              placeholder="ref (ветка, по умолчанию main)"
              style={{ padding: 6, borderRadius: 4, border: '1px solid var(--border)', fontSize: 13 }}
            />

            <button
              type="button"
              onClick={handleRunWorkflow}
              disabled={workflowLoading}
              className="button button-secondary"
              style={{
                cursor: workflowLoading ? 'default' : 'pointer',
                opacity: workflowLoading ? 0.6 : 1,
                fontSize: 14,
                alignSelf: 'flex-start',
              }}
            >
              {workflowLoading ? 'Запуск…' : 'Запустить workflow'}
            </button>

            <input
              type="text"
              value={workflowRunId}
              onChange={(e) => setWorkflowRunId(e.target.value)}
              placeholder="run_id для проверки статуса"
              style={{ padding: 6, borderRadius: 4, border: '1px solid var(--border)', fontSize: 13 }}
            />

            <button
              type="button"
              onClick={handleCheckWorkflowStatus}
              disabled={workflowStatusLoading}
              className="button button-secondary"
              style={{
                cursor: workflowStatusLoading ? 'default' : 'pointer',
                opacity: workflowStatusLoading ? 0.6 : 1,
                fontSize: 14,
                alignSelf: 'flex-start',
              }}
            >
              {workflowStatusLoading ? 'Проверяем…' : 'Проверить статус'}
            </button>

            {workflowError && <div style={{ color: 'var(--error)', fontSize: 13 }}>{workflowError}</div>}
            {workflowMessage && <div style={{ color: 'var(--info)', fontSize: 13 }}>{workflowMessage}</div>}
          </div>
        </section>
      </div>
    </main>
  );
}

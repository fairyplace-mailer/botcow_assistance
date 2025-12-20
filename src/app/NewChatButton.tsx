'use client';

export function NewChatButton() {
  return (
    <button
      type="button"
      className="button button-secondary"
      style={{ fontSize: 13 }}
      onClick={() => {
        if (typeof window === 'undefined') return;
        window.dispatchEvent(new CustomEvent('botcow:new-chat'));
      }}
    >
      New Chat
    </button>
  );
}

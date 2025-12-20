import '../styles/globals.css';
import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { SwRegister } from './SwRegister';
import ThemeToggle from '../components/ThemeToggle';
import { OnlineStatus } from './OnlineStatus';
import { NewChatButton } from './NewChatButton';

export const metadata: Metadata = {
  title: 'BotCow Code Assistant',
  description: 'PWA чат и инструменты для BotCow',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#111827',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body style={{ margin: 0 }}>
        <header
          style={{
            padding: 12,
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <NewChatButton />
          <OnlineStatus />
          <ThemeToggle />
        </header>
        {children}
        <SwRegister />
      </body>
    </html>
  );
}

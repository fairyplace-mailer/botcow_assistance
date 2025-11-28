import type { ReactNode } from 'react';

export const metadata = {
  title: 'BotCow Code Assistant',
  description: 'Локальный код-ассистент',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}

import type { Metadata } from 'next';
import './globals.css';
import Providers from './providers';

export const metadata: Metadata = {
  title: 'Pithcharge',
  description: 'OCPP 2.0.1 / 1.6J CSMS Station Management Interface',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className=" antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
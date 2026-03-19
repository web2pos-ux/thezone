import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Web2POS - Table Order App Download',
  description: 'Download the Table Order Android app for Web2POS',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', backgroundColor: '#fafafa' }}>
        {children}
      </body>
    </html>
  );
}

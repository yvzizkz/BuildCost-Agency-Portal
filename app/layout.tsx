import './globals.css';
import { AuthProvider } from '@/lib/auth';
import AuthGate from '@/components/AuthGate';

export const metadata = {
  title: 'BuildCost Agency Portal',
  description: 'Owner-facing portal for BuildCost content generation, approvals, and media intake.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <AuthGate>
            {children}
          </AuthGate>
        </AuthProvider>
      </body>
    </html>
  );
}

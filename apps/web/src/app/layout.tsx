import type { Metadata } from 'next';
import './globals.css';
import Providers from './providers';
import { BrandProvider } from '@/components/brand';
import { getBrand } from '@/lib/brand';

// Branding comes from runtime env, so this layout must not be prerendered at build time.
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const brand = getBrand();
  return {
    title: { default: brand.name, template: `%s · ${brand.name}` },
    applicationName: brand.name,
    description: `${brand.name} – find, start and pay for EV charging.`,
    ...(brand.faviconUrl ? { icons: { icon: brand.faviconUrl, shortcut: brand.faviconUrl } } : {}),
  };
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const brand = getBrand();
  return (
    <html lang="en" suppressHydrationWarning>
      <body className=" antialiased">
        <BrandProvider value={{ name: brand.name, logoUrl: brand.logoUrl, logoSmallUrl: brand.logoSmallUrl }}>
          <Providers>{children}</Providers>
        </BrandProvider>
      </body>
    </html>
  );
}
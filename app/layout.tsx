import { Poppins } from 'next/font/google';
import './globals.css';

/*
 * next/font downloads Poppins at BUILD time and serves it from our own origin. There is
 * no request to fonts.googleapis.com at page load, which matters: this runs on a VPS in
 * India and must not depend on an external CDN being reachable for text to render.
 *
 * Three weights only - regular, semibold, bold. Every extra weight is another file over
 * a slow connection for a screen someone is waiting on during a rush.
 */
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  display: 'swap',
  variable: '--font-poppins',
});

export const metadata = { title: 'No Meat Naan — Management' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={poppins.variable}>
      <body>{children}</body>
    </html>
  );
}

import { Cinzel, Poppins } from 'next/font/google';
import './globals.css';

/*
 * next/font downloads these at BUILD time and serves them from our own origin. There is
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

/*
 * The brand book's primary face is Copperplate, which is not a web font and is not
 * licensed for us to serve. It IS installed on most Macs, so the display stack in
 * globals.css asks for it first and lands here otherwise.
 *
 * Cinzel is the closest free stand-in: the same broad, all-caps, inscriptional Roman
 * with small glyphic serifs, which is what makes Copperplate look like Copperplate at
 * a glance. One weight, because this face sets the wordmark and page headings and
 * nothing else - it is never body text and never small.
 */
const cinzel = Cinzel({
  subsets: ['latin'],
  weight: ['600'],
  display: 'swap',
  variable: '--font-display-web',
});

export const metadata = { title: 'No Meat Naan — Management' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${poppins.variable} ${cinzel.variable}`}>
      <body>{children}</body>
    </html>
  );
}

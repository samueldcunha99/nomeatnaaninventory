/**
 * Redirects a browser with no session cookie to /login, so the common case does not
 * render a page just to bounce it.
 *
 * This is NOT the access control. It only sees whether a cookie is present - it does
 * not validate it, and it never runs for a server action invoked directly. The real
 * check is requireSession() / requirePermission() inside each page and action.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from './src/lib/session-cookie.ts';

export function middleware(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!login|_next/static|_next/image|favicon.ico).*)'],
};

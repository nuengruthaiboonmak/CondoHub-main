import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

function safeReturnUrl(pathname: string, search: string): string {
  const full = `${pathname}${search}`;
  if (!full.startsWith('/')) return '/';
  if (full.startsWith('//')) return '/';
  return full;
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith('/api/')) return NextResponse.next();
  if (pathname === '/login' || pathname === '/change-password') return NextResponse.next();
  const hasSessionCookie =
    request.cookies.has('better-auth.session_token') ||
    request.cookies.has('better-auth-session_token') ||
    request.cookies.has('__Secure-better-auth.session_token');
  if (!hasSessionCookie) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('returnUrl', safeReturnUrl(pathname, search));
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

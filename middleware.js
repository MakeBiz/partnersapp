/**
 * /admin без куки сессии → на страницу входа.
 * Настоящая проверка роли — в API (requireSession), здесь только быстрый редирект.
 */
import { NextResponse } from 'next/server';

export function middleware(req) {
  if (!req.cookies.get('mb_session')) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/admin/:path*'] };

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { paths, publicPaths } from './lib/constants/paths';
import { getToken } from 'next-auth/jwt';
import { UserRoles } from './types';

export default async function middleware(
  req: NextRequest
): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  const isNotIndexing = process.env.INDEXING === 'false';
  const getHeaders = () => {
    if (isNotIndexing) {
      return;
    }
    return {
      headers: { 'X-Robots-Tag': 'noindex, nofollow' },
    };
  };
  const res = NextResponse.next();
  if (isNotIndexing) {
    res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }

  // Skip auth and static files
  if (
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/_next') ||
    pathname.includes('.')
  ) {
    return res;
  }

  if (pathname.startsWith('/api')) {
    return res;
  }

  if (Object.values(publicPaths).includes(pathname)) {
    return res;
  }

  // Protect non-API pages with NextAuth session
  const session = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  });

  if (session) {
    if ([publicPaths.login].includes(pathname)) {
      return NextResponse.redirect(new URL('/', req.url), getHeaders());
    }
  } else {
    const loginUrl = new URL(publicPaths.login, req.url);
    return NextResponse.redirect(loginUrl, getHeaders());
  }

  if (
    pathname.startsWith(paths.admin) &&
    ![UserRoles.ADMIN, UserRoles.SUPER].includes(session.role)
  ) {
    return new NextResponse('Access Denied', {
      status: 401,
      ...getHeaders(),
    });
  }

  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

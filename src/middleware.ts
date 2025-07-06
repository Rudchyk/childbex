import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { paths, publicPaths } from './lib/constants/paths';
import { getToken } from 'next-auth/jwt';
import { UserRoles } from './types';

export default async function middleware(
  req: NextRequest
): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  // Skip auth and static files
  if (
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/_next') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  if (Object.values(publicPaths).includes(pathname)) {
    return NextResponse.next();
  }

  // Protect non-API pages with NextAuth session
  const session = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  });

  if (session) {
    if ([publicPaths.login].includes(pathname)) {
      return NextResponse.redirect(new URL('/', req.url));
    }

    const res = await fetch(new URL(`/api/user-check/${session.id}`, req.url));

    if (res.status !== 201) {
      const signOutUrl = new URL('/api/auth/signout', req.url);
      // signOutUrl.searchParams.set('callbackUrl', req.nextUrl.pathname);
      return NextResponse.redirect(signOutUrl);
    }
  } else {
    const loginUrl = new URL(publicPaths.login, req.url);
    return NextResponse.redirect(loginUrl);
  }

  if (
    pathname.startsWith(paths.admin) &&
    ![UserRoles.ADMIN, UserRoles.SUPER].includes(session.role)
  ) {
    return new NextResponse('Access Denied', { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

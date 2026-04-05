import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

function shouldProtectDemo() {
  return Boolean(process.env.DEMO_PASSWORD?.trim());
}

function hasDemoAccess(req: NextRequest) {
  const configuredPassword = process.env.DEMO_PASSWORD?.trim();

  if (!configuredPassword) {
    return true;
  }

  const configuredUsername = process.env.DEMO_USERNAME?.trim() || 'demo';
  const authorization = req.headers.get('authorization');

  if (!authorization?.startsWith('Basic ')) {
    return false;
  }

  try {
    const credentials = atob(authorization.slice('Basic '.length));
    const separatorIndex = credentials.indexOf(':');

    if (separatorIndex < 0) {
      return false;
    }

    const username = credentials.slice(0, separatorIndex);
    const password = credentials.slice(separatorIndex + 1);

    return (
      username === configuredUsername && password === configuredPassword
    );
  } catch {
    return false;
  }
}

export function proxy(req: NextRequest) {
  if (!shouldProtectDemo()) {
    return NextResponse.next();
  }

  if (hasDemoAccess(req)) {
    return NextResponse.next();
  }

  return new NextResponse('Authentication required.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Patch Lens Demo"',
    },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
};

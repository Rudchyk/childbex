import { logger } from '@/lib/services/logger.service';
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  // logger.info({ url: req.url, method: req.method }, 'Incoming request');
  return NextResponse.json({ message: 'Hello, from API!' });
}

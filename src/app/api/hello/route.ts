import { logger } from '@/lib/services/logger.service';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  console.log('req.url', req.url);
  console.log('req.method', req.method);

  try {
    logger.info({ url: req.url, method: req.method }, 'Incoming request');
  } catch (error) {
    console.log('error', error);
  }
  return NextResponse.json({ message: 'Hello, from API!' });
}

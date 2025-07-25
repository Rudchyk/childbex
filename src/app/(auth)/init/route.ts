import { NextResponse } from 'next/server';
import { User } from '@/db/models/User.model';
import { UserRoles } from '@/types';

export async function GET() {
  try {
    const { SUPER_USER_EMAIL, SUPER_USER_PASSWORD } = process.env;

    if (SUPER_USER_EMAIL && SUPER_USER_PASSWORD) {
      await User.create({
        name: 'Sergii Rudchyk',
        email: SUPER_USER_EMAIL,
        password: SUPER_USER_PASSWORD,
        role: UserRoles.SUPER,
      });
    }

    return NextResponse.json('OK');
  } catch (error) {
    const err = error as Error;
    return NextResponse.json({ message: err?.message || err?.name });
  }
}

import { NextResponse } from 'next/server';
import { UserModel, UserRoles } from '../../../../db/models/User.model';

export async function GET() {
  try {
    const { SUPER_USER_EMAIL, SUPER_USER_PASSWORD } = process.env;

    if (SUPER_USER_EMAIL && SUPER_USER_PASSWORD) {
      await UserModel.create({
        name: 'Sergii Rudchyk',
        email: SUPER_USER_EMAIL,
        password: SUPER_USER_PASSWORD,
        role: UserRoles.SUPER,
      });
    }

    return NextResponse.json({ message: 'OK' });
  } catch (error) {
    const err = error as Error;
    return NextResponse.json({ message: err?.message || err?.name });
  }
}

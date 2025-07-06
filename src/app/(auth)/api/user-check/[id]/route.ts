import { NextResponse } from 'next/server';
import { UserModel } from '@/db/models/User.model';
import { syncDb } from '@/db';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    await syncDb();
    const { id } = await params;
    const user = await UserModel.findByPk(id);

    if (!user) {
      return NextResponse.json({ message: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ message: 'OK' }, { status: 201 });
  } catch (error) {
    const err = error as Error;
    return NextResponse.json({ message: err?.message || err?.name });
  }
}

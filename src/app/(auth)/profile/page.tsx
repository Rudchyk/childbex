import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth/auth.options';
import { UserModel } from '@/db/models/User.model';
import { Profile } from './_components/Profile';
import { redirect } from 'next/navigation';
import { syncDb } from '@/db';

export default async function Page() {
  const session = await getServerSession(authOptions);
  await syncDb();
  const _user = await UserModel.findByPk(session?.user?.id);
  const user = _user?.getPublic();

  if (!user) {
    redirect('/');
  }

  return <Profile data={user} />;
}

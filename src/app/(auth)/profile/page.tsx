import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth/auth.options';
import { UserModel } from '@/db/models/User.model';

export default async function Page() {
  const session = await getServerSession(authOptions);
  const _user = await UserModel.findByPk(session?.user?.id);
  const user = _user?.getPublic();

  return <pre>{JSON.stringify(user, null, 2)}</pre>;
}

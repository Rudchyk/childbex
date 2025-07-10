import { DefaultLayout } from '@/lib/layouts';
import { Home } from './Home';

export default function Page() {
  const { NODE_ENV } = process.env;

  return (
    <DefaultLayout>
      <Home nodeEnv={NODE_ENV} />
    </DefaultLayout>
  );
}

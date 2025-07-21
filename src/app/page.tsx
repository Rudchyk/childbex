import { DefaultLayout } from '../lib/layouts';
import { Home } from './Home';

export default function Page() {
  return (
    <DefaultLayout>
      <Home />
    </DefaultLayout>
  );
}

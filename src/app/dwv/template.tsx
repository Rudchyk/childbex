import { DefaultLayout } from '../../lib/layouts';

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DefaultLayout>{children}</DefaultLayout>;
}

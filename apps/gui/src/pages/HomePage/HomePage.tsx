import { DefaultLayout } from '../../layouts';
import { PageTmpl } from '../../templates';
import { libsSchemas } from '@childbex/libs-schemas';

export const Component = () => {
  return (
    <DefaultLayout>
      <PageTmpl>Hello from home {libsSchemas()}</PageTmpl>
    </DefaultLayout>
  );
};

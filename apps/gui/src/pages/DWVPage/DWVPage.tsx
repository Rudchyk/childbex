import { DefaultLayout } from '../../layouts';
import { PageTmpl } from '../../templates';
import { DicomViewer } from '../../components';

export const Component = () => {
  return (
    <DefaultLayout>
      <PageTmpl>
        <DicomViewer isClean={true} />
      </PageTmpl>
    </DefaultLayout>
  );
};

import { DefaultLayout } from '../../layouts';
import { ErrorTmpl } from '../../templates';
import { useRouteError } from 'react-router-dom';

interface CustomError {
  status?: number;
  message?: string;
}

const Component = () => {
  const error = useRouteError() as CustomError;
  console.log('dsfd');

  return (
    <DefaultLayout>
      <ErrorTmpl
        title="Nothing here"
        sx={{ flexGrow: 1 }}
        justifyContent="center"
        text={error.status}
      />
    </DefaultLayout>
  );
};

export default Component;

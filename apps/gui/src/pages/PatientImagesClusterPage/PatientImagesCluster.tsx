import { GetPatientClusterResponse } from '@libs/schemas';
import { WithLoader } from '../../hoc';
import { PatientBrockenImages } from './PatientBrockenImages';
import { PatientImages } from './PatientImages';

export const PatientImagesClusters = WithLoader<GetPatientClusterResponse>(
  ({ data }) => {
    const { cluster } = data;
    const isBrocken = cluster === -1;

    if (isBrocken) {
      return <PatientBrockenImages data={data} />;
    }

    return <PatientImages data={data} />;
  }
);

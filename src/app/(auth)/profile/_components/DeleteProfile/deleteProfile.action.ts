'use server';

import { syncDb } from '../../../../../db';
import { UserModel, UserRoles } from '../../../../../db/models/User.model';
import { DeleteProfileActionStates } from './DeleteProfileActionStates.enum';

export interface DeleteProfileActionState {
  status: DeleteProfileActionStates;
  message?: string;
}

export const deleteProfile = async (
  _: DeleteProfileActionState,
  id: string
): Promise<DeleteProfileActionState> => {
  try {
    await syncDb();

    const user = await UserModel.findByPk(id);

    if (!user) {
      return {
        status: DeleteProfileActionStates.USER_DO_NOT_EXIST,
      };
    }

    if (user.get('role') === UserRoles.SUPER) {
      return {
        status: DeleteProfileActionStates.UNABLE_TO_DELETE,
      };
    }

    await user.destroy();

    return { status: DeleteProfileActionStates.SUCCESS };
  } catch (error) {
    return {
      status: DeleteProfileActionStates.FAILED,
      message: (error as Error).message,
    };
  }
};

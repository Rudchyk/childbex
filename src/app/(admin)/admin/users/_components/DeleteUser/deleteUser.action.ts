'use server';

import { syncDb } from '@/db';
import { User } from '@/db/models/User.model';
import { DeleteUserActionStates } from './DeleteUserActionStates.enum';
import { UserRoles } from '@/types';

export interface DeleteProfileActionState {
  status: DeleteUserActionStates;
  message?: string;
}

export const deleteProfile = async (
  _: DeleteProfileActionState,
  id: string
): Promise<DeleteProfileActionState> => {
  try {
    await syncDb();

    const user = await User.findByPk(id);

    if (!user) {
      return {
        status: DeleteUserActionStates.USER_DO_NOT_EXIST,
      };
    }

    if (user.get('role') === UserRoles.SUPER) {
      return {
        status: DeleteUserActionStates.UNABLE_TO_DELETE,
      };
    }

    await user.destroy();

    return { status: DeleteUserActionStates.SUCCESS };
  } catch (error) {
    return {
      status: DeleteUserActionStates.FAILED,
      message: (error as Error).message,
    };
  }
};

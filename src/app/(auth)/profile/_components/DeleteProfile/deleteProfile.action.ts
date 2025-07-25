'use server';

import { syncDb } from '@/db';
import { User } from '@/db/models/User.model';
import { DeleteProfileActionStates } from './DeleteProfileActionStates.enum';
import { UserRoles } from '@/types';

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

    const user = await User.findByPk(id);

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

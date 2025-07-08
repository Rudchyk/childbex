'use server';

import { syncDb } from '@/db';
import { UserModel } from '@/db/models/User.model';
import { RestoreUserActionStates } from './RestoreUserActionStates.enum';
import { ValidationError as SequelizeValidationError } from 'sequelize';

export interface RestoreUserActionState {
  status: RestoreUserActionStates;
  message?: string;
}

export const restoreUser = async (
  _: RestoreUserActionState,
  id: string
): Promise<RestoreUserActionState> => {
  try {
    await syncDb();

    const user = await UserModel.findByPk(id, { paranoid: false });

    if (!user) {
      return {
        status: RestoreUserActionStates.USER_DO_NOT_EXIST,
      };
    }

    await user.restore();
    // await newUser.destroy({ force: true });

    return { status: RestoreUserActionStates.SUCCESS };
  } catch (error) {
    if (error instanceof SequelizeValidationError) {
      return {
        status: RestoreUserActionStates.UNABLE_TO_RESTORE,
        message: error.message,
      };
    }
    return {
      status: RestoreUserActionStates.FAILED,
      message: (error as Error).message,
    };
  }
};

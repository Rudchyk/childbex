'use server';

import { syncDb } from '@/db';
import { UserModel } from '@/db/models/User.model';
import { TrashedUsersActionStates } from './TrashedUsersActionStates.enum';
import { TrashedUsersActionTypes } from './TrashedUsersActionTypes.enum';
import { ValidationError as SequelizeValidationError } from 'sequelize';

export interface TrashedUsersActionState {
  status: TrashedUsersActionStates;
  message?: string;
}

export interface TrashedUsersData {
  id: string;
  type: TrashedUsersActionTypes;
}

export const trashedUsers = async (
  _: TrashedUsersActionState,
  data: TrashedUsersData
): Promise<TrashedUsersActionState> => {
  try {
    await syncDb();
    const { id, type } = data;

    const user = await UserModel.findByPk(id, { paranoid: false });

    if (!user) {
      return {
        status: TrashedUsersActionStates.USER_DO_NOT_EXIST,
      };
    }

    switch (type) {
      case TrashedUsersActionTypes.DELETE:
        await user.destroy({ force: true });
        break;
      case TrashedUsersActionTypes.RESTORE:
        await user.restore();
        break;
      default:
        throw new Error('Action does not exist!');
    }

    return { status: TrashedUsersActionStates.SUCCESS };
  } catch (error) {
    return {
      status: TrashedUsersActionStates.FAILED,
      message: (error as Error | SequelizeValidationError).message,
    };
  }
};

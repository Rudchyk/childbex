'use server';

import { syncDb } from '@/db';
import { UserModel } from '@/db/models/User.model';
import { TrashActionStates } from './TrashActionStates.enum';
import { TrashActionTypes } from './TrashActionTypes.enum';
import { ValidationError as SequelizeValidationError } from 'sequelize';

export interface TrashActionState {
  status: TrashActionStates;
  message?: string;
}

export interface TrashData {
  id: string;
  type: TrashActionTypes;
}

export const trash = async (
  _: TrashActionState,
  data: TrashData
): Promise<TrashActionState> => {
  try {
    await syncDb();
    const { id, type } = data;

    const user = await UserModel.findByPk(id, { paranoid: false });

    if (!user) {
      return {
        status: TrashActionStates.USER_DO_NOT_EXIST,
      };
    }

    switch (type) {
      case TrashActionTypes.DELETE:
        await user.destroy({ force: true });
        break;
      case TrashActionTypes.RESTORE:
        await user.restore();
        break;
      default:
        throw new Error('Action does not exist!');
    }

    return { status: TrashActionStates.SUCCESS };
  } catch (error) {
    return {
      status: TrashActionStates.FAILED,
      message: (error as Error | SequelizeValidationError).message,
    };
  }
};

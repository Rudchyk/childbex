'use server';

import { syncDb } from '@/db';
import { PublicUser, UserModel, UserRoles } from '@/db/models/User.model';
import { UpdateUserActionStates } from './UpdateUserActionStates.enum';
import * as Yup from 'yup';

export interface UpdateUserActionState {
  status: UpdateUserActionStates;
  message?: string;
}

export interface UpdateUserData {
  id: string;
  data: Partial<Pick<PublicUser, 'email' | 'name' | 'role'>>;
}

export const updateUser = async (
  _: UpdateUserActionState,
  { id, data }: UpdateUserData
): Promise<UpdateUserActionState> => {
  try {
    await syncDb();

    const user = await UserModel.findByPk(id);

    if (!user) {
      return {
        status: UpdateUserActionStates.USER_DO_NOT_EXIST,
      };
    }

    const update: UpdateUserData['data'] = {};
    if ('email' in data) {
      const schema = Yup.string().email().required();
      const email = await schema.validate(data.email);
      update.email = email;
    }

    if ('name' in data) {
      const schema = Yup.string().required();
      const name = await schema.validate(data.name);
      update.name = name;
    }

    if ('role' in data) {
      const schema = Yup.string().required();
      const role = await schema.validate(data.role);

      if (role === UserRoles.SUPER) {
        return { status: UpdateUserActionStates.UNABLE_TO_UPDATE };
      }

      update.role = role as UserRoles;
    }

    if (!Object.keys(update).length) {
      return { status: UpdateUserActionStates.NOTHING_TO_UPDATE };
    }

    await user.update(update);

    return { status: UpdateUserActionStates.SUCCESS };
  } catch (error) {
    if (error instanceof Yup.ValidationError) {
      return {
        status: UpdateUserActionStates.INVALID_DATA,
        message: error.message,
      };
    }
    return {
      status: UpdateUserActionStates.FAILED,
      message: (error as Error).message,
    };
  }
};

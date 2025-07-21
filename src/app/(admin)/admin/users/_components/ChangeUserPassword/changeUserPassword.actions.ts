'use server';

import { syncDb } from '../../../../../../db';
import { changeUserPasswordFormSchema } from './changeUserPassword.schema';
import { ValidationError } from 'yup';
import { UserModel } from '../../../../../../db/models/User.model';
import { ChangeUserPasswordActionStates } from './ChangeUserPasswordActionStates.enum';
import { decode } from 'next-auth/jwt';

export interface ChangeUserPasswordActionState {
  status: ChangeUserPasswordActionStates;
  message?: string;
}

export interface ChangeUserPasswordData {
  id: string;
  token: string;
}

export const changeUserPassword = async (
  _: ChangeUserPasswordActionState,
  { id, token }: ChangeUserPasswordData
): Promise<ChangeUserPasswordActionState> => {
  try {
    await syncDb();

    const user = await UserModel.findByPk(id);

    if (!user) {
      return {
        status: ChangeUserPasswordActionStates.USER_DO_NOT_EXIST,
      };
    }

    const data = await decode({
      token,
      secret: process.env.NEXT_PUBLIC_SECRET || '',
    });
    const { password } = await changeUserPasswordFormSchema.validate(data);

    await user.update({ password });

    return { status: ChangeUserPasswordActionStates.SUCCESS };
  } catch (error) {
    if (error instanceof ValidationError) {
      return {
        status: ChangeUserPasswordActionStates.INVALID_DATA,
        message: error.message,
      };
    }

    return {
      status: ChangeUserPasswordActionStates.FAILED,
      message: (error as Error).message,
    };
  }
};

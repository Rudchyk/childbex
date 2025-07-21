'use server';

import { syncDb } from '../../../../../db';
import { changePasswordProfileFormSchema } from './changePasswordProfile.schema';
import { ValidationError } from 'yup';
import { UserModel } from '../../../../../db/models/User.model';
import { ChangePasswordProfileActionStates } from './ChangePasswordProfileActionStates.enum';
import { decode } from 'next-auth/jwt';

export interface ChangePasswordProfileActionState {
  status: ChangePasswordProfileActionStates;
  message?: string;
}

export interface ChangePasswordProfileData {
  id: string;
  token: string;
}

export const changePasswordProfile = async (
  _: ChangePasswordProfileActionState,
  { id, token }: ChangePasswordProfileData
): Promise<ChangePasswordProfileActionState> => {
  try {
    await syncDb();

    const user = await UserModel.findByPk(id);

    if (!user) {
      return {
        status: ChangePasswordProfileActionStates.USER_DO_NOT_EXIST,
      };
    }

    const data = await decode({
      token,
      secret: process.env.NEXT_PUBLIC_SECRET || '',
    });
    const { password, oldPassword } =
      await changePasswordProfileFormSchema.validate(data);
    const isPasswordChecked = await user.comparePassword(oldPassword);
    if (!isPasswordChecked) {
      return {
        status: ChangePasswordProfileActionStates.OLD_PASSWORD_IS_WRONG,
      };
    }

    await user.update({ password });

    return { status: ChangePasswordProfileActionStates.SUCCESS };
  } catch (error) {
    if (error instanceof ValidationError) {
      return {
        status: ChangePasswordProfileActionStates.INVALID_DATA,
        message: error.message,
      };
    }

    return {
      status: ChangePasswordProfileActionStates.FAILED,
      message: (error as Error).message,
    };
  }
};

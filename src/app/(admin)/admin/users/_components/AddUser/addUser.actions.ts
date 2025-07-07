'use server';

import { sequelize } from '@/db';
import { registerFormDateSchema } from './addUserForm.schema';
import { decode } from 'next-auth/jwt';
import { ValidationError } from 'yup';
import { UserModel } from '@/db/models/User.model';
import { EmailVerificationModel } from '@/db/models/EmailVerification.model';
import { UserSettingsModel } from '@/db/models/UserSettings.model';
import { RegisterActionStateEnum } from './AddUserActionState.enum';

export interface RegisterActionState {
  status: RegisterActionStateEnum;
  message?: string;
}

export const register = async (
  _: RegisterActionState,
  token: string
): Promise<RegisterActionState> => {
  try {
    await sequelize.sync();
    const payload =
      (await decode({
        token,
        secret: process.env.NEXT_PUBLIC_SECRET || '',
      })) || {};
    const validated = await registerFormDateSchema
      .noUnknown()
      .validate(payload);
    const user = await UserModel.findOne({
      where: {
        email: validated.email,
      },
    });

    if (user) {
      return {
        status: RegisterActionStateEnum.USER_EXISTS,
      };
    }
    const newUser = await UserModel.create(validated);
    await UserSettingsModel.create({
      user_id: newUser.id,
      allow_extra_emails: validated.allowExtraEmails,
      theme: 'dark',
      locale: 'uk',
    });
    await EmailVerificationModel.create({
      user_id: newUser.id,
    });

    return { status: RegisterActionStateEnum.SUCCESS };
  } catch (error) {
    if (error instanceof ValidationError) {
      return {
        status: RegisterActionStateEnum.INVALID_DATA,
        message: error.message,
      };
    }

    return {
      status: RegisterActionStateEnum.FAILED,
      message: (error as Error).message,
    };
  }
};

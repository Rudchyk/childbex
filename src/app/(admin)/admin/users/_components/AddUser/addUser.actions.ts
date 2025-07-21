'use server';

import { sequelize } from '../../../../../../db';
import { addUserFormDataSchema } from './addUserForm.schema';
import { decode } from 'next-auth/jwt';
import { ValidationError } from 'yup';
import { ValidationError as SequelizeValidationError } from 'sequelize';
import { UserModel } from '../../../../../../db/models/User.model';
import { AddUserActionStates } from './AddUserActionStates.enum';
import { omit } from 'lodash';

export interface AddUserActionState {
  status: AddUserActionStates;
  message?: string;
}

export const addUser = async (
  _: AddUserActionState,
  token: string
): Promise<AddUserActionState> => {
  try {
    await sequelize.sync();
    const payload =
      (await decode({
        token,
        secret: process.env.NEXT_PUBLIC_SECRET || '',
      })) || {};
    const validated = await addUserFormDataSchema.noUnknown().validate(payload);
    const user = await UserModel.findOne({
      where: {
        email: validated.email,
      },
    });

    if (user) {
      return {
        status: AddUserActionStates.USER_EXISTS,
      };
    }

    const newUserCreationAttributes = omit(validated, 'confirmPassword');

    await UserModel.create(newUserCreationAttributes);

    return { status: AddUserActionStates.SUCCESS };
  } catch (error) {
    if (error instanceof ValidationError) {
      return {
        status: AddUserActionStates.INVALID_DATA,
        message: error.message,
      };
    }
    if (error instanceof SequelizeValidationError) {
      if (error.name === 'SequelizeUniqueConstraintError') {
        return {
          status: AddUserActionStates.USER_IN_TRASH,
          message: error.message,
        };
      }
      return {
        status: AddUserActionStates.FAILED,
        message: error.message,
      };
    }

    return {
      status: AddUserActionStates.FAILED,
      message: (error as Error).message,
    };
  }
};

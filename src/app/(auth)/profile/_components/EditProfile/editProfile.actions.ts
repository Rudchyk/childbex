'use server';

import { syncDb } from '@/db';
import {
  editNameProfileFormSchema,
  EditNameProfileFormData,
  editEmailProfileFormSchema,
  EditEmailProfileFormData,
} from './editProfileForms.schemas';
import { ValidationError } from 'yup';
import { User } from '@/db/models/User.model';
import { EditProfileActionStates } from './EditProfileActionStates.enum';

export interface EditProfileActionState {
  status: EditProfileActionStates;
  message?: string;
}

export interface EditProfileData {
  id: string;
  data: EditNameProfileFormData | EditEmailProfileFormData;
}

export const editProfile = async (
  _: EditProfileActionState,
  { id, data }: EditProfileData
): Promise<EditProfileActionState> => {
  try {
    await syncDb();

    const user = await User.findByPk(id);

    if (!user) {
      return {
        status: EditProfileActionStates.USER_DO_NOT_EXIST,
      };
    }

    const update: Partial<User> = {};
    if ('email' in data) {
      const { email } = await editEmailProfileFormSchema.validate(data);
      update.email = email;
    }

    if ('name' in data) {
      const { name } = await editNameProfileFormSchema.validate(data);
      update.name = name;
    }

    if (!Object.keys(update).length) {
      return { status: EditProfileActionStates.NOTHING_TO_UPDATE };
    }

    await user.update(update);

    return { status: EditProfileActionStates.SUCCESS };
  } catch (error) {
    if (error instanceof ValidationError) {
      return {
        status: EditProfileActionStates.INVALID_DATA,
        message: error.message,
      };
    }

    return {
      status: EditProfileActionStates.FAILED,
      message: (error as Error).message,
    };
  }
};

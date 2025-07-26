'use server';

import { sequelize } from '@/db';
import { ValidationError } from 'yup';
import { ValidationError as SequelizeValidationError } from 'sequelize';
import { PatientImageVoteActionStates } from './PatientImageVoteActionStates.enum';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.options';
import { PatientImageReviewVote } from '@/db/models/PatientImageReviewVote.model';
import {
  PatientImageReviewVote as IPatientImageReviewVote,
  PatientImageReviewVoteTypes,
} from '@/types';
import * as Yup from 'yup';

export interface PatientImageVoteActionState {
  status: PatientImageVoteActionStates;
  message?: string;
}

export interface PatientImageVoteData {
  id?: IPatientImageReviewVote['id'];
  patientImageId: IPatientImageReviewVote['patientImageId'];
  vote: IPatientImageReviewVote['vote'];
  comment: IPatientImageReviewVote['comment'];
}

export const patientImageVote = async (
  _: PatientImageVoteActionState,
  data: PatientImageVoteData
): Promise<PatientImageVoteActionState> => {
  try {
    await sequelize.sync();
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return {
        status: PatientImageVoteActionStates.FAILED,
        message: 'session does not exist',
      };
    }
    const voteValues = Object.values(PatientImageReviewVoteTypes);
    const schema = Yup.object().shape({
      vote: Yup.mixed<PatientImageReviewVoteTypes>()
        .oneOf(voteValues, `role must be one of: ${voteValues.join(', ')}`)
        .required(),
      comment: Yup.string().optional().notRequired(),
      patientImageId: Yup.string().required(),
      id: Yup.string().optional().notRequired(),
    });
    const { id, comment, vote, patientImageId } = await schema.validate(data);
    if (id) {
      const patientImageReviewVote = await PatientImageReviewVote.findByPk(id);
      if (patientImageReviewVote) {
        const update: Partial<
          Pick<PatientImageReviewVote, 'comment' | 'vote'>
        > = {};
        if (comment !== patientImageReviewVote.comment) {
          update.comment = comment;
        }
        if (vote !== patientImageReviewVote.vote) {
          update.vote = vote;
        }
        if (!Object.keys(update).length) {
          return { status: PatientImageVoteActionStates.NOTHING_TO_UPDATE };
        }
        await patientImageReviewVote.update(update);
      } else {
        return { status: PatientImageVoteActionStates.DO_NOT_EXIST };
      }
    } else {
      await PatientImageReviewVote.create({
        reviewerId: session.user.id,
        patientImageId,
        comment,
        vote,
      });
    }

    return { status: PatientImageVoteActionStates.SUCCESS };
  } catch (error) {
    if (error instanceof ValidationError) {
      return {
        status: PatientImageVoteActionStates.INVALID_DATA,
        message: error.message,
      };
    }
    if (error instanceof SequelizeValidationError) {
      if (error.name === 'SequelizeUniqueConstraintError') {
        return {
          status: PatientImageVoteActionStates.INVALID_DATA,
          message: error.message,
        };
      }
      return {
        status: PatientImageVoteActionStates.FAILED,
        message: error.message,
      };
    }

    return {
      status: PatientImageVoteActionStates.FAILED,
      message: (error as Error).message,
    };
  }
};

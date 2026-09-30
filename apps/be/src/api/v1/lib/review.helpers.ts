import { ReviewError, type Reviewer } from '../../../services/review.service';
import { getReviewHttpError } from './helpers';
import { getSecurityContentFromResponse } from './security.service';
import type { Ctx } from './types';

/** The authenticated user as a reviewer (id = token subject). */
export const getReviewer = (ctx: Ctx): Reviewer => {
  const content = getSecurityContentFromResponse(ctx);
  return {
    id: content.sub as string,
    name: content.name || content.preferred_username || content.email || '',
  };
};

/** Runs a review action, mapping review errors to HTTP errors. */
export const runReviewAction = async <T>(action: () => Promise<T>) => {
  try {
    return await action();
  } catch (error) {
    if (error instanceof ReviewError) throw getReviewHttpError(error);
    throw error;
  }
};

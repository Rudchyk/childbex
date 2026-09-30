import { Response } from 'fets';
import { router } from '../apiRouter';
import { apiRoutes } from '@libs/constants';
import {
  ReviewFreezeRequestBodySchema,
  ReviewFreezeStateSchema,
  Value,
} from '@libs/schemas';
import { defaultResponses, unauthorizedResponse } from '../schemas/schemas';
import { getInvalidRequestError } from '../lib/helpers';
import { getKeycloakSecurity } from '../lib/security.service';
import { Tags } from '../lib/tags.service';
import type { Ctx } from '../lib/types';
import { getReviewer, runReviewAction } from '../lib/review.helpers';
import {
  freezeReview,
  getReviewFreezeState,
  unfreezeReview,
} from '../../../services/review.service';

const tags = [Tags.PATIENTS];

router
  // Review freeze state
  .route({
    description: 'Get the global review freeze state',
    method: 'GET',
    path: apiRoutes.reviewFreeze,
    tags,
    ...getKeycloakSecurity(),
    schemas: {
      responses: {
        200: ReviewFreezeStateSchema,
        ...unauthorizedResponse,
        ...defaultResponses,
      },
    },
    async handler() {
      return Response.json(await getReviewFreezeState());
    },
  })
  // Freeze review
  .route({
    description:
      'Freeze review globally: no votes, resolutions or finished reviews until unfrozen (409 REVIEW_FROZEN)',
    method: 'POST',
    path: apiRoutes.reviewFreeze,
    tags,
    ...getKeycloakSecurity(['dashboard:admin']),
    schemas: {
      request: {
        json: ReviewFreezeRequestBodySchema,
      },
      responses: {
        200: ReviewFreezeStateSchema,
        ...unauthorizedResponse,
        ...defaultResponses,
      },
    },
    async handler(request, ctx) {
      const admin = getReviewer(ctx as Ctx);
      const body = await request.json().catch(() => null);
      if (!Value.Check(ReviewFreezeRequestBodySchema, body)) {
        throw getInvalidRequestError();
      }
      return Response.json(
        await runReviewAction(() => freezeReview(admin, body.reason))
      );
    },
  })
  // Unfreeze review
  .route({
    description: 'Unfreeze review',
    method: 'POST',
    path: apiRoutes.reviewUnfreeze,
    tags,
    ...getKeycloakSecurity(['dashboard:admin']),
    schemas: {
      responses: {
        200: ReviewFreezeStateSchema,
        ...unauthorizedResponse,
        ...defaultResponses,
      },
    },
    async handler(_request, ctx) {
      const admin = getReviewer(ctx as Ctx);
      return Response.json(await runReviewAction(() => unfreezeReview(admin)));
    },
  });

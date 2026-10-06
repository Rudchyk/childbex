import { HTTPError } from 'fets';
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

/**
 * Roles that may cast review opinions: the application's rule for the
 * review UI (`isDoctor || isAdmin`, apps/gui/src/auth/useAuth.ts), which
 * reads roles from the realm and from every client of the token.
 */
export const REVIEWER_ROLES: readonly string[] = ['doctor', 'admin'];

type TokenContent = {
  realm_access?: { roles?: unknown };
  resource_access?: Record<string, { roles?: unknown } | undefined>;
};

const asRoles = (value: unknown) =>
  Array.isArray(value) ? value.filter((role): role is string => typeof role === 'string') : [];

/** Realm roles and the roles of every client in the access token. */
export const tokenRoles = (content: TokenContent): string[] => [
  ...asRoles(content.realm_access?.roles),
  ...Object.values(content.resource_access ?? {}).flatMap((client) => asRoles(client?.roles)),
];

export const getForbiddenError = () =>
  new HTTPError(
    403,
    'Forbidden',
    {},
    { message: 'Only doctors and administrators can review images.' }
  );

/**
 * The authenticated user as a reviewer, refused with 403 unless they hold a
 * reviewer role (server-side; the UI restriction is not relied upon).
 */
export const getAuthorizedReviewer = (ctx: Ctx): Reviewer => {
  const content = getSecurityContentFromResponse(ctx) as TokenContent;
  if (!tokenRoles(content).some((role) => REVIEWER_ROLES.includes(role))) {
    throw getForbiddenError();
  }
  return getReviewer(ctx);
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

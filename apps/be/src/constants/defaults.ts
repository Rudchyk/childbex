export const isProd = process.env.NODE_ENV === 'production';

/**
 * Largest JSON request body. A Series review sends one id per image (bulk
 * vote: up to 5000 ids, about 200 KB; Complete review: every image of the
 * Series), more than express.json()'s 100 KB default.
 */
export const JSON_BODY_LIMIT = '1mb';

import type { OpenAPIV3 } from 'express-openapi-validator/dist/framework/types';
// import { ErrorSchema } from '@libs/schemas';

interface GetResponseOptions extends OpenAPIV3.ResponseObject {
  schema?: OpenAPIV3.SchemaObject | unknown;
  example?: string;
}

type GetResponseStatus = number | string;

export const getResponse = (
  status: GetResponseStatus = 'default',
  { schema, example, ...props }: GetResponseOptions
): Record<GetResponseStatus, OpenAPIV3.ResponseObject> => {
  const response = { ...props } as OpenAPIV3.ResponseObject;
  if (schema) {
    response.content = {
      'application/json': {
        schema,
      },
    };
  }
  if (example) {
    if (!response.content) {
      response.content = {
        'application/json': {
          example: {
            message: example,
          },
        },
      };
    } else {
      response.content['application/json'].example = {
        message: example,
      };
    }
  }
  return {
    [status]: response,
  };
};

// export const defaultResponses = {
//   ...getResponse(400, {
//     description:
//       'Invalid request. The request parameters are incorrect or missing.',
//     schema: ErrorSchema,
//     example:
//       'Invalid request. The request parameters are incorrect or missing.',
//   }),
//   ...getResponse(404, {
//     description: 'Not found. This resource does not exist.',
//     schema: ErrorSchema,
//     example:
//       'Not found. This resource does not exist. It does not indicate whether the absence is temporary or permanant.',
//   }),
//   ...getResponse(406, {
//     description: 'Not Acceptable. Cannot produce content of this type.',
//     schema: ErrorSchema,
//     example: `Not Acceptable. The server cannot produce a response matching the list of acceptable values defined in the request's proactive content negotiation headers.`,
//   }),
//   ...getResponse(429, {
//     description: 'Too Many Requests. Try again later',
//     schema: ErrorSchema,
//     example:
//       'Too Many Requests. the user has sent too many requests in a given amount of time ("rate limiting"). A Retry-After header might be included to this response indicating how long to wait before making a new request.',
//   }),
//   ...getResponse(500, {
//     description: 'Internal Server Error',
//     schema: ErrorSchema,
//     example: 'Internal Server Error',
//   }),
//   ...getResponse(501, {
//     description: 'Not Implemented. This service is currently not implemented.',
//     schema: ErrorSchema,
//     example:
//       'Not Implemented. This service is currently not implemented - the server does not support the functionality required to fulfill the request. This status can also send a Retry-After header, telling the requester when to check back to see if the functionality is supported by then.',
//   }),
//   ...getResponse(503, {
//     description:
//       'Service unavailable. The service is currently unavailable or experiencing issues.',
//     schema: ErrorSchema,
//     example: 'Service currently unavailable. Please try again later',
//   }),
//   ...getResponse(undefined, {
//     description: 'Unknown error.',
//     schema: ErrorSchema,
//     example: 'Unknown error.',
//   }),
// };

export const unauthorizedResponseMessage = 'Unauthorized';

export const unauthorizedResponse = getResponse(401, {
  description: unauthorizedResponseMessage,
  // schema: ErrorSchema,
  example: unauthorizedResponseMessage,
});

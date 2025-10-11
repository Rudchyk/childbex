export const defaultResponses = {
  400: {
    $ref: '#/components/schemas/ErrorSchema',
    description:
      'Invalid request. The request parameters are incorrect or missing.',
  },
  404: {
    $ref: '#/components/schemas/ErrorSchema',
    description: 'Not found. This resource does not exist.',
  },
  406: {
    $ref: '#/components/schemas/ErrorSchema',
    description: 'Not Acceptable. Cannot produce content of this type.',
  },
  429: {
    $ref: '#/components/schemas/ErrorSchema',
    description: 'Too Many Requests. Try again later',
  },
  500: {
    $ref: '#/components/schemas/ErrorSchema',
    description: 'Internal Server Error',
  },
  501: {
    $ref: '#/components/schemas/ErrorSchema',
    description: 'Not Implemented. This service is currently not implemented.',
  },
  503: {
    $ref: '#/components/schemas/ErrorSchema',
    description:
      'Service unavailable. The service is currently unavailable or experiencing issues.',
  },
  default: {
    $ref: '#/components/schemas/ErrorSchema',
    description: 'Unknown error.',
  },
};

export const unauthorizedResponse = {
  401: {
    $ref: '#/components/schemas/ErrorSchema',
    description: 'Unauthorized',
  },
};

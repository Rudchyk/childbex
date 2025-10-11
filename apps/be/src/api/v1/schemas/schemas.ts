import { schemas as sharedSchemas } from '@libs/schemas';
import * as localSchemas from './index';

export * from '@libs/schemas';
export * from './index';

export const schemas = {
  ...sharedSchemas,
  ...localSchemas,
};

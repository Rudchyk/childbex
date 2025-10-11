import { Type, type Static } from '@sinclair/typebox';

export const LocalPropSchema = Type.String();

export type LocalProp = Static<typeof LocalPropSchema>;

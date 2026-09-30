import { Response } from 'fets';
import { router } from '../apiRouter';
import { apiRoutes } from '@libs/constants';
import {
  CreateDatasetSnapshotRequestBodySchema,
  DatasetSnapshotItemsQuerySchema,
  DatasetSnapshotItemsResponseSchema,
  DatasetSnapshotListResponseSchema,
  DatasetSnapshotParamsSchema,
  DatasetSnapshotPreviewSchema,
  DatasetSnapshotSummarySchema,
  UpdateDatasetSnapshotRequestBodySchema,
  Value,
  type CreateDatasetSnapshotRequestBody,
  type UpdateDatasetSnapshotRequestBody,
} from '@libs/schemas';
import { defaultResponses, unauthorizedResponse } from '../schemas/schemas';
import { getKeycloakSecurity } from '../lib/security.service';
import { Tags } from '../lib/tags.service';
import type { Ctx } from '../lib/types';
import {
  getDatasetSnapshotHttpError,
  getInvalidRequestError,
  readJsonBody,
} from '../lib/helpers';
import { getReviewer } from '../lib/review.helpers';
import {
  archiveSnapshot,
  createSnapshot,
  DatasetSnapshotError,
  deleteDraft,
  finalizeSnapshot,
  getSnapshot,
  listSnapshotItems,
  listSnapshots,
  previewSnapshot,
  updateDraft,
} from '../../../services/dataset-snapshot/snapshot.service';

/**
 * ML dataset snapshots (dashboard:admin only). Responses carry ids, names
 * and counts; only the items manifest carries the verified file SHA-256.
 * Never stored paths, file names, DICOM UIDs or PHI.
 */
const tags = [Tags.DATA];
const admin = getKeycloakSecurity(['dashboard:admin']);

const run = async <T>(action: () => Promise<T>) => {
  try {
    return await action();
  } catch (error) {
    if (error instanceof DatasetSnapshotError) throw getDatasetSnapshotHttpError(error);
    throw error;
  }
};

const body = async <T>(request: { headers: Headers; json(): Promise<unknown> }, schema: Parameters<typeof Value.Check>[0]) => {
  const value = await readJsonBody(request);
  if (!Value.Check(schema, value)) throw getInvalidRequestError();
  return value as T;
};

router
  .route({
    description: 'Create a DRAFT dataset snapshot (configuration only)',
    method: 'POST',
    path: apiRoutes.datasetSnapshots,
    tags,
    ...admin,
    schemas: {
      request: { json: CreateDatasetSnapshotRequestBodySchema },
      responses: { 200: DatasetSnapshotSummarySchema, ...unauthorizedResponse, ...defaultResponses },
    },
    async handler(request, ctx) {
      const actor = getReviewer(ctx as Ctx);
      const input = await body<CreateDatasetSnapshotRequestBody>(
        request,
        CreateDatasetSnapshotRequestBodySchema
      );
      return Response.json(await run(() => createSnapshot(actor, input)));
    },
  })
  .route({
    description: 'List dataset snapshots',
    method: 'GET',
    path: apiRoutes.datasetSnapshots,
    tags,
    ...admin,
    schemas: {
      responses: { 200: DatasetSnapshotListResponseSchema, ...unauthorizedResponse, ...defaultResponses },
    },
    async handler() {
      return Response.json(await run(() => listSnapshots()));
    },
  })
  .route({
    description: 'A dataset snapshot (summary, configuration, split counts)',
    method: 'GET',
    path: apiRoutes.datasetSnapshot,
    tags,
    ...admin,
    schemas: {
      request: { params: DatasetSnapshotParamsSchema },
      responses: { 200: DatasetSnapshotSummarySchema, ...unauthorizedResponse, ...defaultResponses },
    },
    async handler(request) {
      return Response.json(await run(() => getSnapshot(request.params.id)));
    },
  })
  .route({
    description: 'Change name, description or configuration of a DRAFT',
    method: 'PATCH',
    path: apiRoutes.datasetSnapshot,
    tags,
    ...admin,
    schemas: {
      request: {
        params: DatasetSnapshotParamsSchema,
        json: UpdateDatasetSnapshotRequestBodySchema,
      },
      responses: { 200: DatasetSnapshotSummarySchema, ...unauthorizedResponse, ...defaultResponses },
    },
    async handler(request) {
      const input = await body<UpdateDatasetSnapshotRequestBody>(
        request,
        UpdateDatasetSnapshotRequestBodySchema
      );
      return Response.json(await run(() => updateDraft(request.params.id, input)));
    },
  })
  .route({
    description: 'Delete a DRAFT (a finalized snapshot can only be archived)',
    method: 'DELETE',
    path: apiRoutes.datasetSnapshot,
    tags,
    ...admin,
    schemas: {
      request: { params: DatasetSnapshotParamsSchema },
      responses: { 204: { description: 'deleted' }, ...unauthorizedResponse, ...defaultResponses },
    },
    async handler(request) {
      await run(() => deleteDraft(request.params.id));
      return Response.json(null, { status: 204 });
    },
  })
  .route({
    description:
      'Preview a DRAFT against the current data (no writes; cheap file checks: hash present, file exists, size)',
    method: 'POST',
    path: apiRoutes.datasetSnapshotPreview,
    tags,
    ...admin,
    schemas: {
      request: { params: DatasetSnapshotParamsSchema },
      responses: { 200: DatasetSnapshotPreviewSchema, ...unauthorizedResponse, ...defaultResponses },
    },
    async handler(request) {
      return Response.json(await run(() => previewSnapshot(request.params.id)));
    },
  })
  .route({
    description:
      'Finalize a DRAFT under the active review freeze: membership, patient split and exclusions are stored once, every included file re-hashed (SHA-256). For large datasets prefer the CLI (node migrate.js dataset-snapshot finalize).',
    method: 'POST',
    path: apiRoutes.datasetSnapshotFinalize,
    tags,
    ...admin,
    schemas: {
      request: { params: DatasetSnapshotParamsSchema },
      responses: { 200: DatasetSnapshotSummarySchema, ...unauthorizedResponse, ...defaultResponses },
    },
    async handler(request, ctx) {
      const actor = getReviewer(ctx as Ctx);
      return Response.json(await run(() => finalizeSnapshot(request.params.id, actor)));
    },
  })
  .route({
    description: 'Archive a FINALIZED snapshot (nothing else changes)',
    method: 'POST',
    path: apiRoutes.datasetSnapshotArchive,
    tags,
    ...admin,
    schemas: {
      request: { params: DatasetSnapshotParamsSchema },
      responses: { 200: DatasetSnapshotSummarySchema, ...unauthorizedResponse, ...defaultResponses },
    },
    async handler(request, ctx) {
      const actor = getReviewer(ctx as Ctx);
      return Response.json(await run(() => archiveSnapshot(request.params.id, actor)));
    },
  })
  .route({
    description:
      'Items manifest of a finalized snapshot (paged by patientImageId; includes the verified file SHA-256)',
    method: 'GET',
    path: apiRoutes.datasetSnapshotItems,
    tags,
    ...admin,
    schemas: {
      request: { params: DatasetSnapshotParamsSchema, query: DatasetSnapshotItemsQuerySchema },
      responses: { 200: DatasetSnapshotItemsResponseSchema, ...unauthorizedResponse, ...defaultResponses },
    },
    async handler(request) {
      const { split, after, limit } = request.query;
      const pageSize = limit === undefined ? undefined : Number(limit);
      if (pageSize !== undefined && !Number.isInteger(pageSize)) {
        throw getInvalidRequestError();
      }
      return Response.json(
        await run(() => listSnapshotItems(request.params.id, { split, after, limit: pageSize }))
      );
    },
  });

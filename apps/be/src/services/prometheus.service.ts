import { register, collectDefaultMetrics } from 'prom-client';
import type { Request, Response, NextFunction } from 'express';

collectDefaultMetrics({
  prefix: `${process.env.METRICS_PREFIX}_`,
});

export const promClient = register;

export const metricsRoute = '/metrics';

export const metricsController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  promClient
    .metrics()
    .then((result) => {
      res.set('Content-Type', promClient.contentType);
      return res.send(result);
    })
    .catch((error) => next(error));
};

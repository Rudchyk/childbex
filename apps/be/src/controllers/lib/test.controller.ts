import type { Request, Response, NextFunction } from 'express';

export const testController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    return res.json('Hello test!');
  } catch (error) {
    return res.json(error);
  }
};

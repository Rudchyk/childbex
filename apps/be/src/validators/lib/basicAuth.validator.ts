import type { Request, Response, NextFunction } from 'express';

const basicAuthUnauthorizedStatus = 401;

export type Credentials = [login: string, password: string, token: string];

export const getBasicAuthCredentials = (envPropName = 'BASIC_AUTH') =>
  (process.env[envPropName] || ':').split(':') as Credentials;

export const parseBasicAuthAuthorization = (auth: string): Credentials => {
  const token = auth.split(' ').pop();

  if (!token) {
    throw new Error('token does not exist!');
  }
  const [login, password] = Buffer.from(token, 'base64')
    .toString('ascii')
    .split(':');

  return [login, password, token];
};

const getAuthHeader = (req: Request) => {
  const authHeader = req.get('authorization') || req.get('Authorization');

  if (!authHeader) {
    return false;
  }

  return authHeader;
};

export const basicAuthValidator = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const auth = getAuthHeader(req);
  const setAuthenticate = () =>
    res.set('WWW-Authenticate', 'Basic realm="Authorization Required"');

  if (!auth) {
    setAuthenticate();
    return res
      .status(basicAuthUnauthorizedStatus)
      .send('Authorization Required');
  }

  const [login, password] = parseBasicAuthAuthorization(auth);
  const basicAuthCredentials = getBasicAuthCredentials();
  if (
    login === basicAuthCredentials[0] &&
    password === basicAuthCredentials[1]
  ) {
    return next();
  }

  setAuthenticate();

  return res
    .status(basicAuthUnauthorizedStatus)
    .send('Access Denied (incorrect credentials)');
};

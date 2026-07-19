import { NextFunction, Request, Response } from 'express';

const sensitiveKeys = new Set([
  'password',
  'uniquekey',
  'tokenversion',
  'otphash',
]);

const sanitize = (value: any, seen = new WeakSet<object>()): any => {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  if (seen.has(value)) return undefined;
  seen.add(value);

  if (Array.isArray(value)) return value.map(item => sanitize(item, seen));

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !sensitiveKeys.has(key.toLowerCase()))
      .map(([key, nestedValue]) => [key, sanitize(nestedValue, seen)]),
  );
};

export const sanitizeJsonResponses = (_req: Request, res: Response, next: NextFunction) => {
  const originalJson = res.json.bind(res);
  res.json = ((body: any) => originalJson(sanitize(body))) as Response['json'];
  next();
};

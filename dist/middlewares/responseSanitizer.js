"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeJsonResponses = void 0;
const sensitiveKeys = new Set([
    'password',
    'uniquekey',
    'tokenversion',
    'otphash',
]);
const sanitize = (value, seen = new WeakSet()) => {
    if (value === null || typeof value !== 'object')
        return value;
    if (value instanceof Date || Buffer.isBuffer(value))
        return value;
    if (seen.has(value))
        return undefined;
    seen.add(value);
    if (Array.isArray(value))
        return value.map(item => sanitize(item, seen));
    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !sensitiveKeys.has(key.toLowerCase()))
        .map(([key, nestedValue]) => [key, sanitize(nestedValue, seen)]));
};
const sanitizeJsonResponses = (_req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = ((body) => originalJson(sanitize(body)));
    next();
};
exports.sanitizeJsonResponses = sanitizeJsonResponses;

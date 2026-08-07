"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canAccessUser = exports.requestIsAdmin = exports.getRequestRoles = exports.getRequestUserId = void 0;
const getRequestUserId = (req) => {
    var _a, _b, _c;
    return ((_a = req.user) === null || _a === void 0 ? void 0 : _a.userId) || ((_b = req.user) === null || _b === void 0 ? void 0 : _b.sub) || ((_c = req.user) === null || _c === void 0 ? void 0 : _c.id);
};
exports.getRequestUserId = getRequestUserId;
const getRequestRoles = (req) => {
    var _a, _b;
    if (Array.isArray((_a = req.user) === null || _a === void 0 ? void 0 : _a.roles))
        return req.user.roles;
    if (typeof ((_b = req.user) === null || _b === void 0 ? void 0 : _b.role) === 'string')
        return [req.user.role];
    return [];
};
exports.getRequestRoles = getRequestRoles;
const requestIsAdmin = (req) => {
    const roles = (0, exports.getRequestRoles)(req);
    return roles.includes('ADMIN') || roles.includes('COMEX');
};
exports.requestIsAdmin = requestIsAdmin;
const canAccessUser = (req, targetUserId) => {
    const requesterId = (0, exports.getRequestUserId)(req);
    if (!targetUserId || !requesterId)
        return false;
    return requesterId === targetUserId || (0, exports.requestIsAdmin)(req);
};
exports.canAccessUser = canAccessUser;

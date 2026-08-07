"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAnyPermission = exports.requirePermission = exports.getEffectivePermissions = void 0;
const permissions_1 = require("../security/permissions");
const getEffectivePermissions = (req) => {
    var _a, _b;
    const groups = Array.isArray((_a = req.user) === null || _a === void 0 ? void 0 : _a.userGroups) ? req.user.userGroups : [];
    const permissions = (0, permissions_1.extractGroupPermissions)(groups);
    const roles = Array.isArray((_b = req.user) === null || _b === void 0 ? void 0 : _b.roles) ? req.user.roles : [];
    const isComex = roles.includes('COMEX') || groups.some((group) => {
        const groupName = typeof (group === null || group === void 0 ? void 0 : group.name) === 'string' ? group.name.trim().toUpperCase() : '';
        return groupName === 'COMEX' || groupName === 'COMMEX';
    });
    // Bootstrap safety: existing ADMIN accounts without groups keep access until
    // the first permission groups are configured and assigned. COMEX is the
    // governance group and keeps full access by design.
    const allAccess = isComex || (roles.includes('ADMIN') && groups.length === 0);
    return { permissions, allAccess };
};
exports.getEffectivePermissions = getEffectivePermissions;
const requirePermission = (permission) => {
    return (req, res, next) => {
        const { permissions, allAccess } = (0, exports.getEffectivePermissions)(req);
        if (!(0, permissions_1.hasPermission)(permissions, permission, allAccess)) {
            return res.status(403).json({
                error: 'Permission insuffisante pour cette action.',
                code: 'PERMISSION_DENIED',
                requiredPermission: permission,
            });
        }
        next();
    };
};
exports.requirePermission = requirePermission;
const requireAnyPermission = (requiredPermissions) => {
    return (req, res, next) => {
        const { permissions, allAccess } = (0, exports.getEffectivePermissions)(req);
        const allowed = requiredPermissions.some(permission => (0, permissions_1.hasPermission)(permissions, permission, allAccess));
        if (!allowed) {
            return res.status(403).json({
                error: 'Permission insuffisante pour cette action.',
                code: 'PERMISSION_DENIED',
                requiredPermissions,
            });
        }
        next();
    };
};
exports.requireAnyPermission = requireAnyPermission;

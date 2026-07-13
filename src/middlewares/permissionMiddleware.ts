import { Response, NextFunction } from 'express';
import { extractGroupPermissions, hasPermission } from '../security/permissions';

export const getEffectivePermissions = (req: any) => {
  const groups = Array.isArray(req.user?.userGroups) ? req.user.userGroups : [];
  const permissions = extractGroupPermissions(groups);
  const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
  const isComex = roles.includes('COMEX') || groups.some((group: any) => {
    const groupName = typeof group?.name === 'string' ? group.name.trim().toUpperCase() : '';
    return groupName === 'COMEX' || groupName === 'COMMEX';
  });

  // Bootstrap safety: existing ADMIN accounts without groups keep access until
  // the first permission groups are configured and assigned. COMEX is the
  // governance group and keeps full access by design.
  const allAccess = isComex || (roles.includes('ADMIN') && groups.length === 0);

  return { permissions, allAccess };
};

export const requirePermission = (permission: string) => {
  return (req: any, res: Response, next: NextFunction) => {
    const { permissions, allAccess } = getEffectivePermissions(req);

    if (!hasPermission(permissions, permission, allAccess)) {
      return res.status(403).json({
        error: 'Permission insuffisante pour cette action.',
        code: 'PERMISSION_DENIED',
        requiredPermission: permission,
      });
    }

    next();
  };
};

export const requireAnyPermission = (requiredPermissions: string[]) => {
  return (req: any, res: Response, next: NextFunction) => {
    const { permissions, allAccess } = getEffectivePermissions(req);
    const allowed = requiredPermissions.some(permission => hasPermission(permissions, permission, allAccess));

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

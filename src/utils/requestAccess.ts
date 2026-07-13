export const getRequestUserId = (req: any): string | undefined => {
  return req.user?.userId || req.user?.sub || req.user?.id;
};

export const getRequestRoles = (req: any): string[] => {
  if (Array.isArray(req.user?.roles)) return req.user.roles;
  if (typeof req.user?.role === 'string') return [req.user.role];
  return [];
};

export const requestIsAdmin = (req: any): boolean => {
  const roles = getRequestRoles(req);
  return roles.includes('ADMIN') || roles.includes('COMEX');
};

export const canAccessUser = (req: any, targetUserId?: string): boolean => {
  const requesterId = getRequestUserId(req);
  if (!targetUserId || !requesterId) return false;
  return requesterId === targetUserId || requestIsAdmin(req);
};


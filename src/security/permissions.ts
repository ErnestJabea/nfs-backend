export type PermissionAction = {
  id: string;
  label: string;
};

export type PermissionModule = {
  id: string;
  label: string;
  model: string;
  actions: PermissionAction[];
};

export const fullPermissionActions: PermissionAction[] = [
  { id: 'view', label: 'Voir' },
  { id: 'view_all', label: 'Voir tout' },
  { id: 'create', label: 'Créer' },
  { id: 'update', label: 'Modifier' },
  { id: 'restore', label: 'Restaurer' },
  { id: 'restore_all', label: 'Restaurer tout' },
  { id: 'duplicate', label: 'Dupliquer' },
  { id: 'reorder', label: 'Réorganiser' },
  { id: 'delete', label: 'Supprimer' },
  { id: 'delete_all', label: 'Supprimer tout' },
  { id: 'delete_force', label: 'Supprimer définitivement' },
  { id: 'delete_force_all', label: 'Supprimer tout définitivement' },
];

export const permissionCatalog: PermissionModule[] = [
  {
    id: 'bank_account',
    label: 'Compte Bancaire',
    model: 'App\\Models\\BankDetail',
    actions: fullPermissionActions,
  },
  {
    id: 'clients',
    label: 'Client',
    model: 'App\\Models\\Client',
    actions: fullPermissionActions,
  },
  {
    id: 'currencies',
    label: 'Devise',
    model: 'App\\Models\\Currency',
    actions: fullPermissionActions,
  },
  {
    id: 'onboarding',
    label: "Session D'onboarding",
    model: 'App\\Models\\OnboardingSession',
    actions: fullPermissionActions,
  },
  {
    id: 'products',
    label: 'Produit',
    model: 'App\\Models\\Product',
    actions: fullPermissionActions,
  },
  {
    id: 'roles',
    label: 'Rôle',
    model: 'Spatie\\Permission\\Models\\Role',
    actions: fullPermissionActions,
  },
  {
    id: 'subscriptions',
    label: 'Souscription',
    model: 'App\\Models\\Subscription',
    actions: fullPermissionActions,
  },
  {
    id: 'users',
    label: 'Utilisateur',
    model: 'App\\Models\\User',
    actions: fullPermissionActions,
  },
  {
    id: 'transactions',
    label: 'Transaction',
    model: 'App\\Models\\Transaction',
    actions: fullPermissionActions,
  },
  {
    id: 'cotisations',
    label: 'Cotisation / Tontine',
    model: 'App\\Models\\CotisationGroup',
    actions: fullPermissionActions,
  },
  {
    id: 'loans',
    label: 'Prêt et Crédit',
    model: 'App\\Models\\Loan',
    actions: fullPermissionActions,
  },
  {
    id: 'settings',
    label: 'Paramètres & Frais',
    model: 'App\\Modules\\Settings',
    actions: fullPermissionActions,
  },
];

export const permissionKey = (moduleId: string, actionId: string) => `${moduleId}.${actionId}`;

export const allPermissionKeys = new Set(
  permissionCatalog.flatMap(module => module.actions.map(action => permissionKey(module.id, action.id)))
);

export const normalizePermissions = (permissions: unknown): string[] => {
  if (!Array.isArray(permissions)) return [];

  return Array.from(new Set(
    permissions
      .filter((permission): permission is string => typeof permission === 'string')
      .map(permission => permission.trim())
      .filter(permission => permission === '*' || allPermissionKeys.has(permission) || permission.endsWith('.*'))
  ));
};

export const extractGroupPermissions = (groups: any[] = []) => {
  return normalizePermissions(groups.flatMap(group => group?.permissions || []));
};

export const hasPermission = (permissions: string[], permission: string, allowAllAccess = false) => {
  if (allowAllAccess) return true;
  if (permissions.includes('*')) return true;
  if (permissions.includes(permission)) return true;

  const [moduleId] = permission.split('.');
  return permissions.includes(`${moduleId}.*`);
};

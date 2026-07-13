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

const commonReadActions: PermissionAction[] = [
  { id: 'view', label: 'Voir' },
  { id: 'view_all', label: 'Voir tout' },
];

const commonWriteActions: PermissionAction[] = [
  { id: 'create', label: 'Creer' },
  { id: 'update', label: 'Modifier' },
  { id: 'delete', label: 'Supprimer' },
  { id: 'delete_all', label: 'Supprimer tout' },
];

export const permissionCatalog: PermissionModule[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    model: 'App\\Modules\\Dashboard',
    actions: commonReadActions,
  },
  {
    id: 'clients',
    label: 'Clients',
    model: 'App\\Models\\User',
    actions: [
      ...commonReadActions,
      { id: 'create', label: 'Creer' },
      { id: 'update', label: 'Modifier' },
      { id: 'activate', label: 'Activer / Desactiver' },
      { id: 'kyc', label: 'Gerer KYC' },
      { id: 'credit', label: 'Crediter' },
      { id: 'export', label: 'Exporter' },
    ],
  },
  {
    id: 'staff',
    label: 'Administrateurs',
    model: 'App\\Models\\AdminUser',
    actions: [
      ...commonReadActions,
      { id: 'create', label: 'Creer' },
      { id: 'update', label: 'Modifier' },
      { id: 'activate', label: 'Activer / Desactiver' },
      { id: 'reset_password', label: 'Reinitialiser mot de passe' },
    ],
  },
  {
    id: 'groups',
    label: 'Groupes et habilitations',
    model: 'App\\Models\\UserGroup',
    actions: [
      ...commonReadActions,
      { id: 'create', label: 'Creer' },
      { id: 'update', label: 'Modifier' },
      { id: 'manage_permissions', label: 'Gerer les habilitations' },
    ],
  },
  {
    id: 'transactions',
    label: 'Transactions Backoffice',
    model: 'App\\Models\\Transaction',
    actions: [
      ...commonReadActions,
      { id: 'validate', label: 'Valider' },
      { id: 'reject', label: 'Rejeter' },
      { id: 'export', label: 'Exporter' },
    ],
  },
  {
    id: 'mobile_transactions',
    label: 'Transactions Mobile',
    model: 'App\\Models\\MobileTransaction',
    actions: [...commonReadActions, { id: 'export', label: 'Exporter' }],
  },
  {
    id: 'transfers',
    label: 'Transferts',
    model: 'App\\Models\\Transfer',
    actions: [
      ...commonReadActions,
      { id: 'create', label: 'Creer' },
      { id: 'validate', label: 'Valider' },
      { id: 'reject', label: 'Rejeter' },
    ],
  },
  {
    id: 'cotisations',
    label: 'Cotisations',
    model: 'App\\Models\\CotisationGroup',
    actions: [
      ...commonReadActions,
      { id: 'create', label: 'Creer' },
      { id: 'update', label: 'Modifier' },
      { id: 'manage_participants', label: 'Gerer participants' },
      { id: 'pay', label: 'Enregistrer paiement' },
    ],
  },
  {
    id: 'loans',
    label: 'Prets et credits',
    model: 'App\\Models\\Loan',
    actions: [
      ...commonReadActions,
      { id: 'create', label: 'Creer' },
      { id: 'validate', label: 'Valider' },
      { id: 'reject', label: 'Rejeter' },
      { id: 'configure', label: 'Configurer' },
    ],
  },
  {
    id: 'referral',
    label: 'Parrainage',
    model: 'App\\Modules\\Referral',
    actions: [...commonReadActions, { id: 'export', label: 'Exporter' }],
  },
  {
    id: 'settings',
    label: 'Parametres',
    model: 'App\\Modules\\Settings',
    actions: [...commonReadActions, ...commonWriteActions],
  },
  {
    id: 'currencies',
    label: 'Devises',
    model: 'App\\Models\\Currency',
    actions: [...commonReadActions, { id: 'sync', label: 'Synchroniser' }],
  },
  {
    id: 'transfer_fees',
    label: 'Frais de transfert',
    model: 'App\\Models\\TransferFeeConfig',
    actions: [...commonReadActions, ...commonWriteActions],
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


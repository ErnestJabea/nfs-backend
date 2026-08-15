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

export const PERMISSION_MODULES: PermissionModule[] = [
  {
    id: 'dashboard',
    label: 'Tableau de Bord',
    model: 'App\\Modules\\Dashboard',
    actions: [
      { id: 'view', label: 'Voir statistiques' },
      { id: 'export', label: 'Exporter données' },
    ],
  },
  {
    id: 'clients',
    label: 'Gestion de la Clientèle',
    model: 'App\\Models\\User',
    actions: [
      { id: 'view', label: 'Voir clients' },
      { id: 'create', label: 'Créer client' },
      { id: 'update', label: 'Modifier profil' },
      { id: 'activate', label: 'Activer / Suspendre' },
      { id: 'kyc', label: 'Valider / Rejeter KYC' },
      { id: 'credit', label: 'Créditer solde' },
      { id: 'export', label: 'Exporter liste' },
      { id: 'delete', label: 'Supprimer client (SuperAdmin)' },
    ],
  },
  {
    id: 'transactions',
    label: 'Transactions & Opérations',
    model: 'App\\Models\\Transaction',
    actions: [
      { id: 'view', label: 'Voir transactions' },
      { id: 'validate', label: 'Valider transaction' },
      { id: 'reject', label: 'Rejeter transaction' },
      { id: 'export', label: 'Exporter rapport' },
      { id: 'delete', label: 'Supprimer transaction (SuperAdmin)' },
    ],
  },
  {
    id: 'transfers',
    label: 'Transferts & Frais',
    model: 'App\\Models\\Transfer',
    actions: [
      { id: 'view', label: 'Voir transferts' },
      { id: 'create', label: 'Initier transfert' },
      { id: 'validate', label: 'Valider transfert' },
      { id: 'configure_fees', label: 'Configurer frais' },
    ],
  },
  {
    id: 'epargne',
    label: 'Épargne & Retraits',
    model: 'App\\Models\\Epargne',
    actions: [
      { id: 'view', label: 'Voir demandes épargne' },
      { id: 'validate', label: 'Valider épargne COMEX' },
      { id: 'create', label: 'Effectuer épargne' },
    ],
  },
  {
    id: 'cotisations',
    label: 'Cotisations & Tontines (Djangui)',
    model: 'App\\Models\\CotisationGroup',
    actions: [
      { id: 'view', label: 'Voir groupes' },
      { id: 'create', label: 'Créer groupe tontine' },
      { id: 'update', label: 'Modifier groupe' },
      { id: 'manage_participants', label: 'Gérer participants' },
      { id: 'pay', label: 'Enregistrer paiement' },
      { id: 'delete', label: 'Supprimer groupe (SuperAdmin)' },
    ],
  },
  {
    id: 'loans',
    label: 'Prêts, Crédits & Avalises',
    model: 'App\\Models\\Loan',
    actions: [
      { id: 'view', label: 'Voir demandes prêt' },
      { id: 'create', label: 'Créer prêt' },
      { id: 'validate', label: 'Valider prêt COMEX' },
      { id: 'reject', label: 'Rejeter prêt' },
      { id: 'configure', label: 'Configurer taux & conditions' },
      { id: 'delete', label: 'Supprimer prêt (SuperAdmin)' },
    ],
  },
  {
    id: 'referral',
    label: 'Parrainage & Filleuls',
    model: 'App\\Modules\\Referral',
    actions: [
      { id: 'view', label: 'Voir statistiques parrainage' },
      { id: 'export', label: 'Exporter arbre filleuls' },
    ],
  },
  {
    id: 'currencies',
    label: 'Devises & Taux de Change',
    model: 'App\\Models\\Currency',
    actions: [
      { id: 'view', label: 'Voir devises' },
      { id: 'sync', label: 'Synchroniser taux' },
    ],
  },
  {
    id: 'staff',
    label: 'Équipe Admin & Rôles (RBAC)',
    model: 'App\\Models\\AdminUser',
    actions: [
      { id: 'view', label: 'Voir administrateurs' },
      { id: 'create', label: 'Créer administrateur' },
      { id: 'update', label: 'Modifier administrateur' },
      { id: 'activate', label: 'Activer / Désactiver admin' },
      { id: 'reset_password', label: 'Réinitialiser mot de passe' },
      { id: 'manage_permissions', label: 'Gérer Rôles & Accréditations' },
    ],
  },
  {
    id: 'settings',
    label: 'Paramètres Système',
    model: 'App\\Modules\\Settings',
    actions: [
      { id: 'view', label: 'Voir paramètres' },
      { id: 'update', label: 'Modifier configuration' },
    ],
  },
];

export const permissionKey = (moduleId: string, actionId: string) => `${moduleId}.${actionId}`;

export const permissionCatalog = PERMISSION_MODULES;

export const allPermissionKeys = new Set(
  PERMISSION_MODULES.flatMap(module => module.actions.map(action => permissionKey(module.id, action.id)))
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

export const hasPermission = (
  permissionsOrPermission: string[] | string,
  permissionOrAllowAll?: string | boolean,
  allowAllAccess = false
): boolean => {
  if (typeof permissionsOrPermission === 'string') {
    const targetPermission = permissionsOrPermission;
    const permissions: string[] = [];
    if (permissions.includes('*') || permissions.includes(targetPermission)) return true;
    const [moduleId] = (targetPermission || '').split('.');
    return Boolean(moduleId && permissions.includes(`${moduleId}.*`));
  }

  const permissions = Array.isArray(permissionsOrPermission) ? permissionsOrPermission : [];
  const targetPermission = typeof permissionOrAllowAll === 'string' ? permissionOrAllowAll : '';
  const isAllowAll = typeof permissionOrAllowAll === 'boolean' ? permissionOrAllowAll : allowAllAccess;

  if (isAllowAll) return true;
  if (!targetPermission) return false;
  if (permissions.includes('*') || permissions.includes(targetPermission)) return true;

  const [moduleId] = targetPermission.split('.');
  return Boolean(moduleId && permissions.includes(`${moduleId}.*`));
};

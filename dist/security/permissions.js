"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasPermission = exports.extractGroupPermissions = exports.normalizePermissions = exports.allPermissionKeys = exports.permissionKey = exports.permissionCatalog = void 0;
const commonReadActions = [
    { id: 'view', label: 'Voir' },
    { id: 'view_all', label: 'Voir tout' },
];
const commonWriteActions = [
    { id: 'create', label: 'Creer' },
    { id: 'update', label: 'Modifier' },
    { id: 'delete', label: 'Supprimer' },
    { id: 'delete_all', label: 'Supprimer tout' },
];
exports.permissionCatalog = [
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
const permissionKey = (moduleId, actionId) => `${moduleId}.${actionId}`;
exports.permissionKey = permissionKey;
exports.allPermissionKeys = new Set(exports.permissionCatalog.flatMap(module => module.actions.map(action => (0, exports.permissionKey)(module.id, action.id))));
const normalizePermissions = (permissions) => {
    if (!Array.isArray(permissions))
        return [];
    return Array.from(new Set(permissions
        .filter((permission) => typeof permission === 'string')
        .map(permission => permission.trim())
        .filter(permission => permission === '*' || exports.allPermissionKeys.has(permission) || permission.endsWith('.*'))));
};
exports.normalizePermissions = normalizePermissions;
const extractGroupPermissions = (groups = []) => {
    return (0, exports.normalizePermissions)(groups.flatMap(group => (group === null || group === void 0 ? void 0 : group.permissions) || []));
};
exports.extractGroupPermissions = extractGroupPermissions;
const hasPermission = (permissions, permission, allowAllAccess = false) => {
    if (allowAllAccess)
        return true;
    if (permissions.includes('*'))
        return true;
    if (permissions.includes(permission))
        return true;
    const [moduleId] = permission.split('.');
    return permissions.includes(`${moduleId}.*`);
};
exports.hasPermission = hasPermission;

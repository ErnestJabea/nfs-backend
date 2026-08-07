"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getInterestSummary = exports.updateUserSettings = exports.getUserSettings = exports.resetPassword = exports.requestPasswordReset = exports.updateProfile = exports.getCountries = exports.updateUserInfo = exports.activateAccount = exports.getAvaliseCapacity = exports.getDashboardData = exports.getUserById = exports.getClientCurrencies = exports.getProfile = exports.logout = exports.getSession = exports.adminLogin = exports.login = exports.register = exports.debugLog = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const prisma_1 = __importDefault(require("../utils/prisma"));
const computeAvalise_1 = require("../utils/computeAvalise");
const mailService_1 = require("../services/mailService");
const errorResponse_1 = require("../utils/errorResponse");
const security_1 = require("../config/security");
const requestAccess_1 = require("../utils/requestAccess");
const passwordResetService_1 = require("../services/passwordResetService");
const balanceService_1 = require("../services/balanceService");
const debugLog = (msg) => {
    if (process.env.NODE_ENV !== 'production')
        console.debug(msg);
};
exports.debugLog = debugLog;
const createPublicIdentifier = (prefix, byteLength = 6) => {
    return `${prefix}-${crypto_1.default.randomBytes(byteLength).toString('hex').toUpperCase()}`;
};
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizePhone = (value) => String(value || '').trim().replace(/[\s()-]/g, '');
const passwordIsStrong = (value) => {
    const password = String(value || '');
    return password.length >= 12 && password.length <= 128 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password);
};
const createSession = (user) => {
    const csrf = crypto_1.default.randomBytes(32).toString('base64url');
    const token = jsonwebtoken_1.default.sign({
        userId: user.id,
        sub: user.id,
        roles: user.roles || [],
        tokenVersion: user.tokenVersion || 0,
        csrf,
    }, (0, security_1.getJwtSecret)(), { expiresIn: (0, security_1.getSessionTtlSeconds)() });
    return { token, csrf };
};
const publicSessionUser = (user) => {
    var _a;
    return ({
        id: user.id,
        phone: user.phone,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        referralCode: user.referralCode,
        kycStatus: user.kycStatus,
        country: user.country || 'Cameroun',
        roles: user.roles || [],
        role: ((_a = user.roles) === null || _a === void 0 ? void 0 : _a.includes('ADMIN')) ? 'ADMIN' : 'USER',
        isActivated: Boolean(user.activated),
    });
};
const register = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { password, firstName, lastName, referralCode } = req.body;
        const phone = normalizePhone(req.body.phone);
        const email = normalizeEmail(req.body.email) || null;
        if (!/^\+?[0-9]{8,15}$/.test(phone)) {
            return res.status(400).json({ error: 'Numero de telephone invalide.', code: 'INVALID_PHONE' });
        }
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'Adresse email invalide.', code: 'INVALID_EMAIL' });
        }
        if (!passwordIsStrong(password)) {
            return res.status(400).json({
                error: 'Le mot de passe doit contenir 12 a 128 caracteres, avec majuscule, minuscule et chiffre.',
                code: 'WEAK_PASSWORD',
            });
        }
        // Check if user already exists
        const existingUser = yield prisma_1.default.user.findFirst({
            where: { OR: [{ phone }, ...(email ? [{ email }] : [])] },
        });
        if (existingUser) {
            return res.status(400).json({ error: 'Ce numero de telephone est deja utilise' });
        }
        // Hash password
        const hashedPassword = yield bcryptjs_1.default.hash(password, 12);
        // Generate unique referral code for the new user
        const userReferralCode = crypto_1.default.randomBytes(4).toString('hex').toUpperCase();
        // Check if referredBy exists
        let referredBy = null;
        if (referralCode) {
            referredBy = yield prisma_1.default.user.findFirst({ where: { referralCode } });
        }
        const accountNumber = createPublicIdentifier('NFS');
        const uniqueKey = createPublicIdentifier('KEY', 8);
        const defaultAccountTypes = ['PRINCIPAL', 'CAUTION', 'EPARGNE', 'CREDIT', 'PRET', 'CREDIT_AVALISE', 'PARRAINAGE', 'AVALISE', 'DJANGUI_NON_PERCU', 'DJANGUI_PERCU'];
        const user = yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const createdUser = yield tx.user.create({
                data: {
                    phone,
                    password: hashedPassword,
                    firstName: String(firstName || '').trim().slice(0, 80),
                    lastName: String(lastName || '').trim().slice(0, 80),
                    email,
                    referralCode: userReferralCode,
                    referredById: (referredBy === null || referredBy === void 0 ? void 0 : referredBy.id) || null,
                    referrerName: referredBy ? `${referredBy.firstName} ${referredBy.lastName}` : null,
                    accountNumber,
                    uniqueKey,
                },
            });
            const createdAccounts = yield Promise.all(defaultAccountTypes.map(type => tx.account.create({
                data: { type, currentBalance: 0, availableBalance: 0, currency: 'XAF' },
            })));
            return tx.user.update({
                where: { id: createdUser.id },
                data: { accountIds: createdAccounts.map(account => account.id) },
            });
        }));
        res.status(201).json({ message: 'User registered successfully', userId: user.id });
    }
    catch (error) {
        console.error('Registration error:', error);
        return (0, errorResponse_1.sendErrorResponse)(res, error, "Impossible de creer le compte pour le moment.");
    }
});
exports.register = register;
const login = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { phone, username, email, identifier, password } = req.body;
        const loginIdentifier = String(identifier || phone || email || username || '').trim();
        if (!loginIdentifier || !password) {
            return res.status(400).json({ error: "Le telephone ou l'email est requis" });
        }
        // Normalisation du numéro de téléphone (on retire le + s'il existe)
        const phoneWithoutPlus = loginIdentifier.startsWith('+') ? loginIdentifier.substring(1) : loginIdentifier;
        const phoneWithPlus = loginIdentifier.startsWith('+') ? loginIdentifier : `+${loginIdentifier}`;
        const user = yield prisma_1.default.user.findFirst({
            where: {
                OR: [
                    { phone: loginIdentifier },
                    { phone: phoneWithoutPlus },
                    { phone: phoneWithPlus },
                    { email: loginIdentifier.toLowerCase() }
                ]
            }
        });
        if (!user) {
            yield bcryptjs_1.default.compare(String(password), '$2b$12$C6UzMDM.H6dfI/f/IKcEe.1efnHza4/XhC8wT7uD1qH6E9SkJXxCe');
            return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });
        }
        const isPasswordValid = yield bcryptjs_1.default.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });
        }
        if (!user.activated) {
            return res.status(403).json({ error: 'Compte inactif. Contactez un administrateur.', code: 'ACCOUNT_DISABLED' });
        }
        const session = createSession(user);
        res.cookie('token', session.token, (0, security_1.getSessionCookieOptions)());
        const safeUser = publicSessionUser(user);
        return res.json({
            csrfToken: session.csrf,
            data: {
                id: user.id,
                user: safeUser,
            },
            user: safeUser,
        });
    }
    catch (error) {
        console.error('Login error:', error);
        return (0, errorResponse_1.sendErrorResponse)(res, error, "Connexion impossible pour le moment.");
    }
});
exports.login = login;
const adminLogin = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { identifier, password } = req.body;
        const user = yield prisma_1.default.user.findFirst({
            where: {
                OR: [{ phone: identifier }, { email: identifier }],
                roles: { has: 'ADMIN' }
            }
        });
        if (!user || !user.activated || !(yield bcryptjs_1.default.compare(String(password || ''), user.password))) {
            return res.status(401).json({ error: 'Identifiants administrateur incorrects' });
        }
        const session = createSession(user);
        res.cookie('token', session.token, (0, security_1.getSessionCookieOptions)());
        res.json({ csrfToken: session.csrf, user: publicSessionUser(user) });
    }
    catch (error) {
        console.error('Admin login error:', error);
        return (0, errorResponse_1.sendErrorResponse)(res, error, "Connexion administrateur impossible pour le moment.");
    }
});
exports.adminLogin = adminLogin;
const getSession = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = yield prisma_1.default.user.findUnique({ where: { id: req.user.userId } });
        if (!user)
            return res.status(401).json({ error: 'Session invalide.', code: 'SESSION_INVALID' });
        return res.json({ user: publicSessionUser(user), csrfToken: req.user.csrf });
    }
    catch (error) {
        return (0, errorResponse_1.sendErrorResponse)(res, error, 'Impossible de verifier la session.');
    }
});
exports.getSession = getSession;
const logout = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield prisma_1.default.user.update({
            where: { id: req.user.userId },
            data: { tokenVersion: { increment: 1 } },
        });
        res.clearCookie('token', Object.assign(Object.assign({}, (0, security_1.getSessionCookieOptions)()), { maxAge: undefined }));
        return res.status(204).send();
    }
    catch (error) {
        return (0, errorResponse_1.sendErrorResponse)(res, error, 'Deconnexion impossible pour le moment.');
    }
});
exports.logout = logout;
const formatUserResponse = (user) => __awaiter(void 0, void 0, void 0, function* () {
    let mobileAccounts = [];
    try {
        const accounts = yield prisma_1.default.account.findMany({
            where: { id: { in: user.accountIds || [] } }
        });
        const computedAccounts = (0, computeAvalise_1.computeAvalise)(accounts);
        // Ordre strict pour le mobile (10 comptes pour couvrir tous les index jusqu'à 9)
        mobileAccounts = [
            computedAccounts.find(a => a.type === 'AVALISE') || { type: 'AVALISE', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' }, // 0
            computedAccounts.find(a => a.type === 'PRINCIPAL') || { type: 'PRINCIPAL', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' }, // 1
            computedAccounts.find(a => a.type === 'EPARGNE') || { type: 'EPARGNE', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' }, // 2
            computedAccounts.find(a => a.type === 'CREDIT') || { type: 'CREDIT', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' }, // 3
            computedAccounts.find(a => a.type === 'INTERET') || { type: 'INTERET', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' }, // 4
            computedAccounts.find(a => a.type === 'DJANGUI_NON_PERCU') || { type: 'DJANGUI_NON_PERCU', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' }, // 5
            computedAccounts.find(a => a.type === 'PRET') || { type: 'PRET', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' }, // 6
            { type: 'AUTRE_1', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' }, // 7
            computedAccounts.find(a => a.type === 'DJANGUI_NON_PERCU') || { type: 'DJANGUI_NON_PERCU', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' }, // 8 (Doublon pour compatibilité si nécessaire)
            { type: 'AUTRE_2', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' } // 9
        ];
    }
    catch (accError) {
        console.log("Warning: Failed to fetch accounts for user", user.id, accError);
        mobileAccounts = [
            { type: 'AVALISE', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' },
            { type: 'PRINCIPAL', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' },
            { type: 'EPARGNE', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' },
            { type: 'CREDIT', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' },
            { type: 'INTERET', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' },
            { type: 'DJANGUI_NON_PERCU', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' },
            { type: 'PRET', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' },
            { type: 'AUTRE_1', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' },
            { type: 'AUTRE_2', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' },
            { type: 'AUTRE_3', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' }
        ];
    }
    // On crée une version légère et structurée pour le mobile
    const { password, uniqueKey, tokenVersion, documentUrl, ribUrl, addressImageUrl } = user, lightUser = __rest(user, ["password", "uniqueKey", "tokenVersion", "documentUrl", "ribUrl", "addressImageUrl"]);
    return Object.assign(Object.assign({}, lightUser), { firstName: user.firstName || "", lastName: user.lastName || "", email: user.email || "", currency: user.currency || "XAF", fluxIn: user.fluxIn || 0, fluxOut: user.fluxOut || 0, address: {
            streetName: user.address || "",
            city: user.city || "",
            province: user.province || "",
            postalCode: user.postalCode || "",
        }, identity: {
            typeOfIdentification: user.documentType || "CNI",
            identificationNumber: user.documentNumber || "",
        }, cotisationList: user.cotisationList || [], tontineList: user.tontineList || [], accountList: mobileAccounts, accounts: mobileAccounts });
});
const getProfile = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const targetId = ((_a = req.user) === null || _a === void 0 ? void 0 : _a.sub) || ((_b = req.user) === null || _b === void 0 ? void 0 : _b.userId);
        if (!targetId) {
            return res.status(401).json({ error: "Session invalide. Veuillez vous reconnecter" });
        }
        const user = yield prisma_1.default.user.findUnique({
            where: { id: targetId }
        });
        if (user) {
            const structuredUser = yield formatUserResponse(user);
            return res.json({
                data: structuredUser,
                user: structuredUser
            });
        }
        res.status(404).json({ error: "Utilisateur introuvable" });
    }
    catch (error) {
        console.error("FATAL ERROR in getProfile:", error);
        return (0, errorResponse_1.sendErrorResponse)(res, error, "Impossible de charger le profil pour le moment.");
    }
});
exports.getProfile = getProfile;
const getClientCurrencies = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const currencies = yield prisma_1.default.currency.findMany({
            where: { isActive: true },
            select: {
                code: true,
                symbol: true,
                name: true,
                rateToBase: true,
                lastUpdated: true,
            },
            orderBy: { code: 'asc' },
        });
        return res.json({
            data: currencies.length > 0
                ? currencies
                : [{ code: 'XAF', symbol: 'FCFA', name: 'Franc CFA', rateToBase: 1, lastUpdated: null }],
        });
    }
    catch (error) {
        return (0, errorResponse_1.sendErrorResponse)(res, error, 'Impossible de charger les devises pour le moment.');
    }
});
exports.getClientCurrencies = getClientCurrencies;
const getUserById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = req.params.id;
        const authUser = req.user;
        const requesterId = (authUser === null || authUser === void 0 ? void 0 : authUser.userId) || (authUser === null || authUser === void 0 ? void 0 : authUser.sub);
        const requesterRoles = (authUser === null || authUser === void 0 ? void 0 : authUser.roles) || [];
        if (!id || id === 'undefined' || id === 'null' || !/^[0-9a-fA-F]{24}$/.test(id)) {
            return res.status(404).json({ error: "Identifiant utilisateur invalide" });
        }
        if (requesterId !== id && !requesterRoles.includes('ADMIN')) {
            return res.status(403).json({ error: "Acces refuse a cet utilisateur." });
        }
        const user = yield prisma_1.default.user.findUnique({
            where: { id }
        });
        if (!user) {
            return res.status(404).json({ error: "Utilisateur introuvable" });
        }
        const structuredUser = yield formatUserResponse(user);
        return res.json({
            data: structuredUser,
            user: structuredUser
        });
    }
    catch (error) {
        console.error("FATAL ERROR in getUserById:", error);
        return (0, errorResponse_1.sendErrorResponse)(res, error, "Impossible de charger cet utilisateur pour le moment.");
    }
});
exports.getUserById = getUserById;
const getDashboardData = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    (0, exports.debugLog)("DASHBOARD DATA REQUEST RECEIVED");
    try {
        const targetId = ((_a = req.user) === null || _a === void 0 ? void 0 : _a.sub) || ((_b = req.user) === null || _b === void 0 ? void 0 : _b.userId);
        if (!targetId)
            return res.status(401).json({ error: "Session invalide. Veuillez vous reconnecter" });
        const [user, cotisations] = yield Promise.all([
            prisma_1.default.user.findUnique({ where: { id: targetId } }),
            prisma_1.default.cotisationGroup.findMany(),
        ]);
        if (!user)
            return res.status(404).json({ error: "Utilisateur introuvable" });
        // Récupérer le solde global NFS (Liquidité = Total Épargne - Crédits Accordés)
        const globalBalance = yield balanceService_1.BalanceService.getGlobalBalance();
        const totalSystemSavings = (_c = globalBalance.availableLiquidity) !== null && _c !== void 0 ? _c : (globalBalance.totalSavings - (globalBalance.totalLoans || 0));
        const accounts = yield prisma_1.default.account.findMany({
            where: { id: { in: user.accountIds || [] } }
        });
        const computedAccounts = (0, computeAvalise_1.computeAvalise)(accounts);
        const defaultCurrency = user.currency || 'XAF';
        const mobileAccounts = [
            computedAccounts.find(a => a.type === 'AVALISE') || { type: 'AVALISE', currentBalance: 0, availableBalance: 0, currency: defaultCurrency },
            computedAccounts.find(a => a.type === 'PRINCIPAL') || { type: 'PRINCIPAL', currentBalance: 0, availableBalance: 0, currency: defaultCurrency },
            computedAccounts.find(a => a.type === 'EPARGNE') || { type: 'EPARGNE', currentBalance: 0, availableBalance: 0, currency: defaultCurrency },
            computedAccounts.find(a => a.type === 'CREDIT') || { type: 'CREDIT', currentBalance: 0, availableBalance: 0, currency: defaultCurrency },
            computedAccounts.find(a => a.type === 'INTERET') || { type: 'INTERET', currentBalance: 0, availableBalance: 0, currency: defaultCurrency },
            computedAccounts.find(a => a.type === 'DJANGUI_NON_PERCU') || { type: 'DJANGUI_NON_PERCU', currentBalance: 0, availableBalance: 0, currency: defaultCurrency },
            computedAccounts.find(a => a.type === 'PRET') || { type: 'PRET', currentBalance: 0, availableBalance: 0, currency: defaultCurrency },
            { type: 'AUTRE_1', currentBalance: 0, availableBalance: 0, currency: defaultCurrency },
            computedAccounts.find(a => a.type === 'DJANGUI_NON_PERCU') || { type: 'DJANGUI_NON_PERCU', currentBalance: 0, availableBalance: 0, currency: defaultCurrency },
            { type: 'AUTRE_2', currentBalance: 0, availableBalance: 0, currency: defaultCurrency }
        ];
        const _d = user, { password, uniqueKey, tokenVersion, documentUrl, ribUrl, addressImageUrl } = _d, lightUser = __rest(_d, ["password", "uniqueKey", "tokenVersion", "documentUrl", "ribUrl", "addressImageUrl"]);
        const structuredUser = Object.assign(Object.assign({}, lightUser), { firstName: user.firstName || "", lastName: user.lastName || "", email: user.email || "", currency: defaultCurrency, fluxIn: user.fluxIn || 0, fluxOut: user.fluxOut || 0, address: {
                streetName: user.address || "",
                city: user.city || "",
                province: user.province || "",
                postalCode: user.postalCode || "",
            }, identity: {
                typeOfIdentification: user.documentType || "CNI",
                identificationNumber: user.documentNumber || "",
            }, cotisationList: user.cotisationList || [], tontineList: user.tontineList || [], accountList: mobileAccounts, accounts: mobileAccounts });
        const currentPeriodKey = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`;
        const userPayments = yield prisma_1.default.cotisationPayment.findMany({
            where: { userId: targetId, periodKey: currentPeriodKey },
            select: { groupId: true }
        });
        const paidGroupIds = new Set(userPayments.map(p => p.groupId));
        const mappedCotisations = cotisations.map(c => {
            const rawMemberIds = Array.isArray(c.memberIds) ? c.memberIds : [];
            const memberIds = Array.from(new Set(rawMemberIds.map(id => String(id))));
            const userIndex = memberIds.indexOf(targetId);
            const isMember = userIndex !== -1;
            const myPosition = isMember ? userIndex + 1 : null;
            const isPaid = paidGroupIds.has(c.id);
            const max = c.limit_participant || c.maxParticipants || 10;
            const isGroupActive = (c.status === 'ACTIF' || c.status === 'ACTIVE') && memberIds.length >= max;
            let nextPaymentDue = c.dueDate || null;
            if (!nextPaymentDue) {
                if (isGroupActive) {
                    const now = new Date();
                    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                    nextPaymentDue = lastDayOfMonth.toISOString();
                }
                else {
                    nextPaymentDue = 'EN_ATTENTE';
                }
            }
            return Object.assign(Object.assign({}, c), { _id: c.id, status: isGroupActive ? 'ACTIF' : 'EN_ATTENTE', limit_participant: max, max_members: max, members_count: memberIds.length, nb_participant: memberIds.length, memberIds, my_position: myPosition, my_contribution_status: isPaid ? 'PAID' : 'UNPAID', next_payment_due: nextPaymentDue });
        });
        const responseData = {
            data: {
                user: structuredUser,
                cotisations: mappedCotisations,
                soldeNfs: totalSystemSavings
            }
        };
        res.json(responseData);
    }
    catch (error) {
        console.error("Dashboard error:", error);
        return (0, errorResponse_1.sendErrorResponse)(res, error, "Impossible de charger le tableau de bord pour le moment.");
    }
});
exports.getDashboardData = getDashboardData;
const getAvaliseCapacity = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const id = String(req.params.id || '');
    try {
        if (!(0, requestAccess_1.canAccessUser)(req, id)) {
            return res.status(403).json({ error: "Acces refuse a cet utilisateur." });
        }
        const user = yield prisma_1.default.user.findUnique({
            where: { id },
            select: { accountIds: true }
        });
        if (!user)
            return res.status(404).json({ error: "Utilisateur introuvable" });
        const accounts = yield prisma_1.default.account.findMany({
            where: { id: { in: user.accountIds || [] } }
        });
        const computed = (0, computeAvalise_1.computeAvalise)(accounts);
        const avaliseAcc = computed.find(a => a.type === 'AVALISE');
        return res.json({
            data: {
                capacity: (avaliseAcc === null || avaliseAcc === void 0 ? void 0 : avaliseAcc.currentBalance) || 0,
                currency: (avaliseAcc === null || avaliseAcc === void 0 ? void 0 : avaliseAcc.currency) || 'XAF',
                details: computed
            }
        });
    }
    catch (error) {
        console.error('Get avalise capacity error:', error);
        return (0, errorResponse_1.sendErrorResponse)(res, error, "Impossible de charger la capacite avalise pour le moment.");
    }
});
exports.getAvaliseCapacity = getAvaliseCapacity;
const activateAccount = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = String(req.params.id || '');
        const code = String(req.params.code || '');
        const user = yield prisma_1.default.user.findUnique({
            where: { id },
            select: { id: true, uniqueKey: true }
        });
        if (!user) {
            return res.status(404).json({ error: "Utilisateur introuvable" });
        }
        if (!user.uniqueKey || user.uniqueKey !== code) {
            return res.status(400).json({ error: "Code d'activation invalide" });
        }
        yield prisma_1.default.user.update({
            where: { id: id },
            data: { activated: true, uniqueKey: null }
        });
        res.json({ message: "Compte active avec succes", data: { id, status: "active" } });
    }
    catch (error) {
        console.error('Activate account error:', error);
        return (0, errorResponse_1.sendErrorResponse)(res, error, "Impossible d'activer le compte pour le moment.");
    }
});
exports.activateAccount = activateAccount;
const updateUserInfo = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { userId } = req.params;
        const authUser = req.user;
        const requesterId = (authUser === null || authUser === void 0 ? void 0 : authUser.userId) || (authUser === null || authUser === void 0 ? void 0 : authUser.sub);
        const requesterRoles = (authUser === null || authUser === void 0 ? void 0 : authUser.roles) || [];
        const updateData = req.body;
        if (requesterId !== userId && !requesterRoles.includes('ADMIN')) {
            return res.status(403).json({ error: "Acces refuse a cet utilisateur." });
        }
        const user = yield prisma_1.default.user.update({
            where: { id: userId },
            data: {
                firstName: updateData.firstName,
                lastName: updateData.lastName,
                address: updateData.province ? `${updateData.streetName}, ${updateData.city}` : updateData.address,
                profession: updateData.occupation,
                email: updateData.email === "" ? null : updateData.email
            }
        });
        const structuredUser = yield formatUserResponse(user);
        res.json({ data: structuredUser });
    }
    catch (error) {
        console.error('Update user info error:', error);
        return (0, errorResponse_1.sendErrorResponse)(res, error, "Impossible de modifier les informations pour le moment.");
    }
});
exports.updateUserInfo = updateUserInfo;
const getCountries = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const countries = [
        { code: 'CMR', name: 'Cameroun', currency: 'XAF' },
        { code: 'GAB', name: 'Gabon', currency: 'XAF' },
        { code: 'TCD', name: 'Tchad', currency: 'XAF' },
        { code: 'COG', name: 'République du Congo', currency: 'XAF' },
        { code: 'CAF', name: 'République centrafricaine', currency: 'XAF' },
        { code: 'GNQ', name: 'Guinée équatoriale', currency: 'XAF' },
        { code: 'COD', name: 'République démocratique du Congo', currency: 'CDF' },
        { code: 'NGA', name: 'Nigeria', currency: 'NGN' },
        { code: 'SEN', name: 'Sénégal', currency: 'XOF' },
        { code: 'CIV', name: 'Côte d’Ivoire', currency: 'XOF' },
        { code: 'BEN', name: 'Bénin', currency: 'XOF' },
        { code: 'TGO', name: 'Togo', currency: 'XOF' },
        { code: 'MLI', name: 'Mali', currency: 'XOF' },
        { code: 'BFA', name: 'Burkina Faso', currency: 'XOF' },
        { code: 'NER', name: 'Niger', currency: 'XOF' },
        { code: 'FRA', name: 'France', currency: 'EUR' },
        { code: 'BEL', name: 'Belgique', currency: 'EUR' },
        { code: 'DEU', name: 'Allemagne', currency: 'EUR' },
        { code: 'USA', name: 'États-Unis', currency: 'USD' },
        { code: 'CAN', name: 'Canada', currency: 'CAD' }
    ];
    return res.json({ data: countries, status: 'success' });
});
exports.getCountries = getCountries;
const updateProfile = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const userId = ((_a = req.user) === null || _a === void 0 ? void 0 : _a.userId) || ((_b = req.user) === null || _b === void 0 ? void 0 : _b.sub);
        if (!userId)
            return res.status(401).json({ error: 'Session non autorisée' });
        const { firstName, lastName, email, phone, profession, occupation, address, city, country } = req.body;
        const dataToUpdate = {};
        if (firstName !== undefined && firstName !== null)
            dataToUpdate.firstName = String(firstName);
        if (lastName !== undefined && lastName !== null)
            dataToUpdate.lastName = String(lastName);
        if (email !== undefined)
            dataToUpdate.email = (email && String(email).trim() !== '') ? String(email).trim() : null;
        if (phone !== undefined && phone !== null && String(phone).trim() !== '')
            dataToUpdate.phone = String(phone).trim();
        if (profession !== undefined || occupation !== undefined)
            dataToUpdate.profession = String(profession || occupation || '');
        if (address !== undefined || city !== undefined) {
            const parts = [address, city].filter(p => p && String(p).trim() !== '');
            if (parts.length > 0)
                dataToUpdate.address = parts.join(', ');
        }
        if (country !== undefined && country !== null && String(country).trim() !== '')
            dataToUpdate.country = String(country).trim();
        const updatedUser = yield prisma_1.default.user.update({
            where: { id: userId },
            data: dataToUpdate,
        });
        const structuredUser = yield formatUserResponse(updatedUser);
        return res.json({ message: 'Profil mis à jour avec succès.', user: structuredUser, data: structuredUser });
    }
    catch (error) {
        console.error('Update profile error:', error);
        return (0, errorResponse_1.sendErrorResponse)(res, error, 'Impossible de mettre à jour le profil pour le moment.');
    }
});
exports.updateProfile = updateProfile;
const requestPasswordReset = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const email = normalizeEmail((_a = req.body) === null || _a === void 0 ? void 0 : _a.email);
        if (!email)
            return res.status(400).json({ error: "L'email est requis" });
        const user = yield prisma_1.default.user.findUnique({ where: { email } });
        const genericResponse = { message: 'Si ce compte existe, un code de reinitialisation a ete envoye.' };
        if (!user)
            return res.json(genericResponse);
        const code = yield (0, passwordResetService_1.issuePasswordResetCode)(email);
        yield (0, mailService_1.sendResetCode)(email, code);
        return res.json(genericResponse);
    }
    catch (error) {
        console.error('Password reset request error:', error);
        return (0, errorResponse_1.sendErrorResponse)(res, error, "Impossible d'envoyer le code de reinitialisation pour le moment.");
    }
});
exports.requestPasswordReset = requestPasswordReset;
const resetPassword = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const email = normalizeEmail((_a = req.body) === null || _a === void 0 ? void 0 : _a.email);
        const code = String(((_b = req.body) === null || _b === void 0 ? void 0 : _b.code) || '').trim();
        const password = (_c = req.body) === null || _c === void 0 ? void 0 : _c.password;
        if (!email || !/^\d{8}$/.test(code) || !passwordIsStrong(password)) {
            return res.status(400).json({ error: 'Donnees de reinitialisation invalides.', code: 'INVALID_RESET_REQUEST' });
        }
        const resetEntry = yield prisma_1.default.passwordReset.findFirst({
            where: {
                email,
                expiresAt: { gt: new Date() },
                attempts: { lt: 5 },
            },
            orderBy: { createdAt: 'desc' },
        });
        const submittedHash = (0, passwordResetService_1.hashPasswordResetCode)(email, code);
        const storedHash = Buffer.from((resetEntry === null || resetEntry === void 0 ? void 0 : resetEntry.code) || '');
        const candidateHash = Buffer.from(submittedHash);
        const matches = Boolean(resetEntry) && storedHash.length === candidateHash.length && crypto_1.default.timingSafeEqual(storedHash, candidateHash);
        if (!resetEntry || !matches) {
            if (resetEntry) {
                yield prisma_1.default.passwordReset.update({ where: { id: resetEntry.id }, data: { attempts: { increment: 1 } } });
            }
            return res.status(400).json({ error: 'Code invalide ou expire' });
        }
        const hashedPassword = yield bcryptjs_1.default.hash(password, 12);
        yield prisma_1.default.$transaction([
            prisma_1.default.user.update({ where: { email }, data: { password: hashedPassword, tokenVersion: { increment: 1 } } }),
            prisma_1.default.passwordReset.deleteMany({ where: { email } }),
        ]);
        res.clearCookie('token', { path: '/' });
        return res.json({ message: 'Mot de passe reinitialise avec succes' });
    }
    catch (error) {
        console.error('Reset password error:', error);
        return (0, errorResponse_1.sendErrorResponse)(res, error, "Impossible de reinitialiser le mot de passe pour le moment.");
    }
});
exports.resetPassword = resetPassword;
const getUserSettings = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        return res.json({
            settings: {
                preferredTheme: 'SYSTEM',
                locale: 'fr',
                timezone: 'Africa/Douala',
                emailNotifications: true,
                transactionNotifications: true,
                securityNotifications: true,
                pushNotifications: true,
                balancePrivacy: false,
                mfaEnabled: false,
            },
        });
    }
    catch (error) {
        return (0, errorResponse_1.sendErrorResponse)(res, error, "Impossible de recuperer les parametres.");
    }
});
exports.getUserSettings = getUserSettings;
const updateUserSettings = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
    try {
        const patch = req.body || {};
        return res.json({
            message: 'Parametres mis a jour avec succes',
            settings: {
                preferredTheme: patch.preferredTheme || 'SYSTEM',
                locale: patch.locale || 'fr',
                timezone: patch.timezone || 'Africa/Douala',
                emailNotifications: (_a = patch.emailNotifications) !== null && _a !== void 0 ? _a : true,
                transactionNotifications: (_b = patch.transactionNotifications) !== null && _b !== void 0 ? _b : true,
                securityNotifications: (_c = patch.securityNotifications) !== null && _c !== void 0 ? _c : true,
                pushNotifications: (_d = patch.pushNotifications) !== null && _d !== void 0 ? _d : true,
                balancePrivacy: (_e = patch.balancePrivacy) !== null && _e !== void 0 ? _e : false,
                mfaEnabled: (_f = patch.mfaEnabled) !== null && _f !== void 0 ? _f : false,
            },
        });
    }
    catch (error) {
        return (0, errorResponse_1.sendErrorResponse)(res, error, "Impossible de mettre a jour les parametres.");
    }
});
exports.updateUserSettings = updateUserSettings;
const getInterestSummary = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const userId = ((_a = req.user) === null || _a === void 0 ? void 0 : _a.userId) || ((_b = req.user) === null || _b === void 0 ? void 0 : _b.id) || ((_c = req.user) === null || _c === void 0 ? void 0 : _c.sub);
        if (!userId) {
            return res.status(401).json({ error: "Utilisateur non authentifie." });
        }
        // 1. Récupérer tous les utilisateurs et leurs comptes pour calculer les capacités d'avalise (Ci)
        const allUsers = yield prisma_1.default.user.findMany({
            select: { id: true, accountIds: true }
        });
        const allAccountIds = allUsers.flatMap(u => u.accountIds || []);
        const allAccounts = yield prisma_1.default.account.findMany({
            where: { id: { in: allAccountIds } }
        });
        const accountMap = new Map();
        allAccounts.forEach(acc => accountMap.set(acc.id, acc));
        const userCapacities = new Map();
        let totalSystemCapacity = 0;
        allUsers.forEach(u => {
            const uAccounts = (u.accountIds || []).map(id => accountMap.get(id)).filter(Boolean);
            const computed = (0, computeAvalise_1.computeAvalise)(uAccounts);
            const avaliseAcc = computed.find((a) => a.type === 'AVALISE');
            const ci = Math.max(0, Number((avaliseAcc === null || avaliseAcc === void 0 ? void 0 : avaliseAcc.currentBalance) || 0));
            userCapacities.set(u.id, ci);
            totalSystemCapacity += ci;
        });
        const userCi = userCapacities.get(userId) || 0;
        // Récupérer le solde épargne de l'utilisateur demandé
        const userAccountIds = ((_d = allUsers.find(u => u.id === userId)) === null || _d === void 0 ? void 0 : _d.accountIds) || [];
        const savingsAcc = allAccounts.find(a => userAccountIds.includes(a.id) && a.type === 'EPARGNE');
        const savingsBalance = Number((savingsAcc === null || savingsAcc === void 0 ? void 0 : savingsAcc.currentBalance) || 0);
        // 2. Récupérer tous les crédits (Loans) pour calculer Iin et Ii
        const loans = yield prisma_1.default.loan.findMany({
            where: {
                status: { in: ['APPROVED', 'PAID'] }
            }
        });
        let totalRealizedInterest = 0; // Crédits remboursés (PAID)
        let totalProjectedInterest = 0; // Tous les crédits validés/actifs (APPROVED + PAID)
        let totalPendingInterest = 0; // Crédits en cours d'amortissement (APPROVED)
        loans.forEach(loan => {
            // In : intérêt global généré par le crédit n
            const In = Number(loan.totalInterest || 0);
            if (In <= 0)
                return;
            const avalistes = Array.isArray(loan.avalistes) ? loan.avalistes : [];
            // Avalistes excluant éventuellement l'emprunteur
            const otherAvalistes = avalistes.filter((a) => a.userId && String(a.userId) !== String(loan.userId));
            const hasAvalistes = otherAvalistes.length > 0;
            let Iin = 0;
            if (!hasAvalistes) {
                // 1er cas : Sans avaliste
                // Iin = In * (Ci / somme des Ci) * 70%
                if (totalSystemCapacity > 0) {
                    Iin = In * (userCi / totalSystemCapacity) * 0.70;
                }
            }
            else {
                // 2e cas : Avec des avalistes
                // Somme des avalistes des autres membres du crédit n
                const totalOtherAvalistesAmount = otherAvalistes.reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
                // Ain = montant de l'avalise du membre i dans le crédit n
                const memberAvalise = otherAvalistes.find((a) => String(a.userId) === String(userId));
                const Ain = memberAvalise ? Number(memberAvalise.amount || 0) : 0;
                // Part 1 : In * (Ci / somme des Ci) * 14%
                const partCapacity = totalSystemCapacity > 0 ? In * (userCi / totalSystemCapacity) * 0.14 : 0;
                // Part 2 : In * (Ain / somme des avalistes) * 56%
                const partAvalise = totalOtherAvalistesAmount > 0 ? In * (Ain / totalOtherAvalistesAmount) * 0.56 : 0;
                Iin = partCapacity + partAvalise;
            }
            totalProjectedInterest += Iin;
            if (loan.status === 'PAID') {
                totalRealizedInterest += Iin;
            }
            else if (loan.status === 'APPROVED') {
                totalPendingInterest += Iin;
            }
        });
        const realizedTotal = Math.round(totalRealizedInterest);
        const projectedTotal = Math.round(totalProjectedInterest);
        const pendingTotal = Math.round(totalPendingInterest);
        return res.json({
            data: {
                accountBalance: savingsBalance,
                realizedTotal: realizedTotal,
                projectedTotal: projectedTotal,
                pendingTotal: pendingTotal,
                totalGuaranteed: 0,
                history: [],
            },
        });
    }
    catch (error) {
        return (0, errorResponse_1.sendErrorResponse)(res, error, "Impossible de recuperer le resume des interets.");
    }
});
exports.getInterestSummary = getInterestSummary;

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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteTransferFee = exports.updateTransferFee = exports.createTransferFee = exports.getTransferFees = exports.calculateTransferFee = exports.adminTransfer = exports.updateUserKYC = exports.deleteLoanConfig = exports.updateLoanConfig = exports.createLoanConfig = exports.getLoanConfigs = exports.syncCurrencies = exports.getCurrencies = exports.assignUserGroups = exports.updateGroup = exports.createGroup = exports.getMyPermissions = exports.getPermissionCatalog = exports.getGroups = exports.getReferralStats = exports.getTransactions = exports.createLoan = exports.updateLoanStatus = exports.getLoan = exports.getLoans = exports.payCotisationInCash = exports.payCotisationFromCaution = exports.removeParticipantFromCotisation = exports.addParticipantToCotisation = exports.getCotisation = exports.getCotisations = exports.updateCotisationGroup = exports.createCotisationGroup = exports.getDashboardStats = exports.rejectTransaction = exports.validateTransaction = exports.creditUserAccount = exports.resetUserPassword = exports.updateUserProfile = exports.updateUserStatus = exports.createUser = exports.getUsers = void 0;
const crypto_1 = __importDefault(require("crypto"));
const prisma_1 = __importDefault(require("../utils/prisma"));
const currencyService_1 = require("../services/currencyService");
const computeAvalise_1 = require("../utils/computeAvalise");
const permissions_1 = require("../security/permissions");
const permissionMiddleware_1 = require("../middlewares/permissionMiddleware");
const passwordResetService_1 = require("../services/passwordResetService");
const mailService_1 = require("../services/mailService");
const errorResponse_1 = require("../utils/errorResponse");
const parseRoles = (body) => {
    const r = body.roles || body.role;
    if (!r)
        return undefined;
    const roles = Array.isArray(r) ? r : [r];
    const allowedRoles = new Set(['CLIENT', 'ADMIN', 'STAFF', 'COMEX']);
    const normalizedRoles = roles
        .filter((role) => typeof role === 'string' && role.trim() !== '')
        .map((role) => role.trim().toUpperCase())
        .filter((role) => allowedRoles.has(role));
    return normalizedRoles.length > 0 ? normalizedRoles : undefined;
};
const hasOwn = (body, key) => Object.prototype.hasOwnProperty.call(body, key);
const normalizeText = (value) => {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
};
const normalizeEmail = (value) => {
    if (value === undefined)
        return undefined;
    const trimmed = normalizeText(value);
    return trimmed ? trimmed.toLowerCase() : null;
};
const generateTemporaryPassword = () => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%';
    return Array.from({ length: 14 }, () => alphabet[crypto_1.default.randomInt(0, alphabet.length)]).join('');
};
const generatePublicCode = (prefix, byteLength = 6) => {
    return `${prefix}-${crypto_1.default.randomBytes(byteLength).toString('hex').toUpperCase()}`;
};
const uniqueConflictMessage = (error) => {
    var _a, _b;
    if ((error === null || error === void 0 ? void 0 : error.code) !== 'P2002')
        return undefined;
    const target = Array.isArray((_a = error === null || error === void 0 ? void 0 : error.meta) === null || _a === void 0 ? void 0 : _a.target) ? error.meta.target.join(',') : String(((_b = error === null || error === void 0 ? void 0 : error.meta) === null || _b === void 0 ? void 0 : _b.target) || '');
    if (target.includes('email'))
        return 'Cet email est deja utilise.';
    if (target.includes('phone'))
        return 'Ce numero de telephone est deja utilise.';
    if (target.includes('accountNumber'))
        return 'Ce numero de compte existe deja. Veuillez reessayer.';
    if (target.includes('uniqueKey'))
        return 'Cette cle unique existe deja. Veuillez reessayer.';
    return 'Une valeur unique existe deja.';
};
const findUserUniquenessConflict = (fields, currentUserId) => __awaiter(void 0, void 0, void 0, function* () {
    if (fields.email) {
        const existingByEmail = yield prisma_1.default.user.findUnique({
            where: { email: fields.email },
            select: { id: true }
        });
        if (existingByEmail && existingByEmail.id !== currentUserId) {
            return 'Cet email est deja utilise.';
        }
    }
    if (fields.phone) {
        const existingByPhone = yield prisma_1.default.user.findUnique({
            where: { phone: fields.phone },
            select: { id: true }
        });
        if (existingByPhone && existingByPhone.id !== currentUserId) {
            return 'Ce numero de telephone est deja utilise.';
        }
    }
    return undefined;
});
const getUsers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const roleParam = req.query.role;
        const role = typeof roleParam === 'string' ? roleParam : undefined;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 0;
        const summary = req.query.summary === '1' || req.query.summary === 'true';
        const whereClause = role ? { roles: { has: role } } : {};
        let users;
        let total = 0;
        if (summary) {
            const userSelect = {
                id: true,
                firstName: true,
                lastName: true,
                phone: true
            };
            if (limit > 0) {
                const skip = (page - 1) * limit;
                const [fetchedUsers, totalCount] = yield Promise.all([
                    prisma_1.default.user.findMany({
                        where: whereClause,
                        skip,
                        take: limit,
                        orderBy: { createdAt: 'desc' },
                        select: userSelect
                    }),
                    prisma_1.default.user.count({ where: whereClause })
                ]);
                return res.json({ data: fetchedUsers, total: totalCount, page, totalPages: Math.ceil(totalCount / limit) });
            }
            users = yield prisma_1.default.user.findMany({
                where: whereClause,
                orderBy: { createdAt: 'desc' },
                select: userSelect
            });
            return res.json(users);
        }
        if (limit > 0) {
            const skip = (page - 1) * limit;
            const [fetchedUsers, totalCount] = yield Promise.all([
                prisma_1.default.user.findMany({
                    where: whereClause,
                    skip,
                    take: limit,
                    orderBy: { createdAt: 'desc' },
                    include: { userGroups: true }
                }),
                prisma_1.default.user.count({ where: whereClause })
            ]);
            users = fetchedUsers;
            total = totalCount;
        }
        else {
            users = yield prisma_1.default.user.findMany({
                where: whereClause,
                orderBy: { createdAt: 'desc' },
                include: { userGroups: true }
            });
        }
        const allAccountIds = users.flatMap(u => u.accountIds || []);
        const accounts = yield prisma_1.default.account.findMany({
            where: { id: { in: allAccountIds } }
        });
        const mappedUsers = users.map(user => {
            const userAccounts = accounts.filter(a => (user.accountIds || []).includes(a.id));
            const computedAccounts = (0, computeAvalise_1.computeAvalise)(userAccounts);
            return Object.assign(Object.assign({}, user), { accounts: computedAccounts });
        });
        if (limit > 0) {
            return res.json({ data: mappedUsers, total, page, totalPages: Math.ceil(total / limit) });
        }
        res.json(mappedUsers);
    }
    catch (error) {
        console.error('getUsers error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.getUsers = getUsers;
const createUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { firstName, lastName, phone, email, country, referrerName, address, addressImageUrl } = req.body;
        const normalizedPhone = normalizeText(phone);
        const normalizedEmail = normalizeEmail(email) || null;
        const roles = parseRoles(req.body) || ["CLIENT"];
        if (!normalizedPhone) {
            return res.status(400).json({ error: 'Le numero de telephone est obligatoire.' });
        }
        if (roles.includes('ADMIN') && !normalizedEmail) {
            return res.status(400).json({ error: 'L email est obligatoire pour creer un administrateur.' });
        }
        const uniquenessConflict = yield findUserUniquenessConflict({
            email: normalizedEmail,
            phone: normalizedPhone
        });
        if (uniquenessConflict) {
            return res.status(409).json({ error: uniquenessConflict });
        }
        const plainPassword = generateTemporaryPassword();
        const bcrypt = require('bcryptjs');
        const hashedPassword = yield bcrypt.hash(plainPassword, 12);
        const defaultAccountTypes = ['PRINCIPAL', 'CAUTION', 'EPARGNE', 'CREDIT', 'PRET', 'CREDIT_AVALISE', 'PARRAINAGE', 'AVALISE', 'DJANGUI_NON_PERCU', 'DJANGUI_PERCU'];
        const accountNumber = generatePublicCode('NFS');
        const uniqueKey = generatePublicCode('KEY', 8);
        const newUser = yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const createdAccounts = yield Promise.all(defaultAccountTypes.map(type => tx.account.create({
                data: { type, currentBalance: 0, availableBalance: 0, currency: 'XAF' },
            })));
            return tx.user.create({
                data: Object.assign(Object.assign({ firstName,
                    lastName, phone: normalizedPhone }, (normalizedEmail ? { email: normalizedEmail } : {})), { password: hashedPassword, roles, activated: true, verified: false, country: country || 'Cameroun', referrerName,
                    address,
                    addressImageUrl, accountIds: createdAccounts.map(account => account.id), accountNumber,
                    uniqueKey }),
            });
        }));
        if (normalizedEmail) {
            try {
                const resetCode = yield (0, passwordResetService_1.issuePasswordResetCode)(normalizedEmail);
                yield (0, mailService_1.sendResetCode)(normalizedEmail, resetCode);
            }
            catch (emailError) {
                console.error('createUser activation email error:', emailError);
            }
        }
        res.status(201).json(newUser);
    }
    catch (error) {
        console.error('createUser error:', error);
        const conflictMessage = uniqueConflictMessage(error);
        if (conflictMessage) {
            return res.status(409).json({ error: conflictMessage });
        }
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.createUser = createUser;
const updateUserStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = String(req.params.id);
        const body = req.body || {};
        const data = {};
        if (hasOwn(body, 'isActivated'))
            data.activated = Boolean(body.isActivated);
        if (hasOwn(body, 'activated'))
            data.activated = Boolean(body.activated);
        if (hasOwn(body, 'isActive'))
            data.activated = Boolean(body.isActive);
        if (hasOwn(body, 'kycStatus')) {
            const kycStatus = String(body.kycStatus || '').toUpperCase();
            data.kycStatus = kycStatus;
            data.verified = ['VERIFIED', 'APPROVED'].includes(kycStatus);
        }
        if (hasOwn(body, 'verified'))
            data.verified = Boolean(body.verified);
        const editableFields = [
            'firstName', 'lastName', 'country', 'referrerName', 'address', 'addressImageUrl',
            'profession', 'matricule', 'service', 'documentType', 'documentNumber',
            'documentUrl', 'ribUrl', 'swiftCode'
        ];
        editableFields.forEach(field => {
            if (hasOwn(body, field))
                data[field] = body[field];
        });
        if (hasOwn(body, 'email')) {
            data.email = normalizeEmail(body.email);
        }
        if (hasOwn(body, 'phone')) {
            const normalizedPhone = normalizeText(body.phone);
            if (!normalizedPhone)
                return res.status(400).json({ error: 'Le numero de telephone est obligatoire.' });
            data.phone = normalizedPhone;
        }
        const parsedRoles = parseRoles(body);
        if (parsedRoles)
            data.roles = parsedRoles;
        if (hasOwn(body, 'joiningYear')) {
            data.joiningYear = body.joiningYear ? parseInt(body.joiningYear, 10) : null;
        }
        if (hasOwn(body, 'averageIncome')) {
            data.averageIncome = body.averageIncome ? parseFloat(body.averageIncome) : null;
        }
        if (Object.keys(data).length === 0) {
            return res.status(400).json({ error: 'Aucune donnee a mettre a jour.' });
        }
        const uniquenessConflict = yield findUserUniquenessConflict({
            email: typeof data.email === 'string' ? data.email : undefined,
            phone: data.phone
        }, id);
        if (uniquenessConflict) {
            return res.status(409).json({ error: uniquenessConflict });
        }
        const user = yield prisma_1.default.user.update({
            where: { id: id },
            data
        });
        res.json(user);
    }
    catch (error) {
        console.error('updateUserStatus error:', error);
        const conflictMessage = uniqueConflictMessage(error);
        if (conflictMessage)
            return res.status(409).json({ error: conflictMessage });
        if ((error === null || error === void 0 ? void 0 : error.code) === 'P2025')
            return res.status(404).json({ error: 'Utilisateur introuvable.' });
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.updateUserStatus = updateUserStatus;
const updateUserProfile = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = String(req.params.id);
        const data = Object.assign({}, req.body);
        delete data.id;
        delete data._id;
        delete data.password;
        delete data.tokenVersion;
        delete data.uniqueKey;
        delete data.activated;
        delete data.isActivated;
        delete data.isActive;
        delete data.verified;
        delete data.kycStatus;
        delete data.referralCode;
        delete data.fluxIn;
        delete data.fluxOut;
        delete data.createdAt;
        delete data.updatedAt;
        delete data.accountIds;
        delete data.accounts;
        delete data.userGroups;
        if (hasOwn(data, 'email')) {
            data.email = normalizeEmail(data.email);
        }
        if (hasOwn(data, 'phone')) {
            const normalizedPhone = normalizeText(data.phone);
            if (!normalizedPhone)
                return res.status(400).json({ error: 'Le numero de telephone est obligatoire.' });
            data.phone = normalizedPhone;
        }
        delete data.role;
        delete data.roles;
        const uniquenessConflict = yield findUserUniquenessConflict({
            email: typeof data.email === 'string' ? data.email : undefined,
            phone: data.phone
        }, id);
        if (uniquenessConflict) {
            return res.status(409).json({ error: uniquenessConflict });
        }
        const updatedUser = yield prisma_1.default.user.update({
            where: { id: id },
            data: Object.assign(Object.assign({}, data), { joiningYear: data.joiningYear ? parseInt(data.joiningYear, 10) : undefined, averageIncome: data.averageIncome ? parseFloat(data.averageIncome) : undefined }),
            include: { userGroups: true }
        });
        res.json(updatedUser);
    }
    catch (error) {
        console.error('updateUserProfile error:', error);
        const conflictMessage = uniqueConflictMessage(error);
        if (conflictMessage)
            return res.status(409).json({ error: conflictMessage });
        if ((error === null || error === void 0 ? void 0 : error.code) === 'P2025')
            return res.status(404).json({ error: 'Utilisateur introuvable.' });
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.updateUserProfile = updateUserProfile;
const resetUserPassword = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const id = String(req.params.id);
        const user = yield prisma_1.default.user.findUnique({
            where: { id },
            select: { id: true, email: true, firstName: true, lastName: true, roles: true }
        });
        if (!user) {
            return res.status(404).json({ error: 'Utilisateur introuvable.' });
        }
        if (!((_a = user.roles) === null || _a === void 0 ? void 0 : _a.includes('ADMIN'))) {
            return res.status(400).json({ error: 'Cet utilisateur n est pas un administrateur.' });
        }
        if (!user.email) {
            return res.status(400).json({ error: 'Impossible de reinitialiser le mot de passe: aucun email renseigne.' });
        }
        try {
            const code = yield (0, passwordResetService_1.issuePasswordResetCode)(user.email);
            yield (0, mailService_1.sendResetCode)(user.email, code);
        }
        catch (emailError) {
            console.error('resetUserPassword email error:', emailError);
            return res.status(500).json({ error: 'Mot de passe non reinitialise: echec de l envoi email.' });
        }
        res.json({ message: 'Un code de reinitialisation a ete envoye par email.' });
    }
    catch (error) {
        console.error('resetUserPassword error:', error);
        if ((error === null || error === void 0 ? void 0 : error.code) === 'P2025')
            return res.status(404).json({ error: 'Utilisateur introuvable.' });
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.resetUserPassword = resetUserPassword;
const creditUserAccount = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const { id } = req.params;
        const { amount, description, accountType = 'PRINCIPAL', sourceAccountType, currency = 'XAF' } = req.body;
        const adminId = ((_a = req.user) === null || _a === void 0 ? void 0 : _a.userId) || ((_b = req.user) === null || _b === void 0 ? void 0 : _b.sub) || ((_c = req.user) === null || _c === void 0 ? void 0 : _c.id);
        const adminUser = adminId ? yield prisma_1.default.user.findUnique({ where: { id: adminId } }) : null;
        const adminName = adminUser ? `${adminUser.firstName} ${adminUser.lastName}` : 'Admin SystÃ¨me';
        const transactionAmount = Number(amount);
        const maximumAmount = Number(process.env.MAX_TRANSACTION_AMOUNT_XAF || 100000000);
        if (!Number.isSafeInteger(transactionAmount) || transactionAmount <= 0 || transactionAmount > maximumAmount) {
            return res.status(400).json({ error: 'Montant invalide.' });
        }
        const upperType = String(accountType).toUpperCase();
        const allowedAccountTypes = ['PRINCIPAL', 'EPARGNE', 'CAUTION', 'CREDIT', 'PRET', 'PARRAINAGE', 'DJANGUI_NON_PERCU', 'DJANGUI_PERCU'];
        if (!allowedAccountTypes.includes(upperType))
            return res.status(400).json({ error: 'Type de compte invalide.' });
        if (!/^[A-Z]{3}$/.test(String(currency)))
            return res.status(400).json({ error: 'Devise invalide.' });
        let opType = 'deposit';
        let opCode = `DEPOT_${accountType}_${Date.now()}`;
        let opName = `DÃ©pÃ´t ${accountType}`;
        if (upperType === 'EPARGNE') {
            opType = 'epargne';
            opCode = `EPARGNE_${Date.now()}`;
            opName = 'DÃ©pÃ´t Ã‰pargne';
        }
        else if (upperType === 'CAUTION') {
            opType = 'caution';
            opCode = `CAUTION_${Date.now()}`;
            opName = 'DÃ©pÃ´t Caution';
        }
        else if (upperType === 'CREDIT' || upperType === 'PRET') {
            opType = 'credit';
            opCode = `EMPRUNT_${Date.now()}`;
            opName = 'DÃ©blocage CrÃ©dit';
        }
        else if (upperType === 'PRINCIPAL') {
            opType = 'principal';
            opCode = `DEPOT_WALLET_${Date.now()}`;
            opName = 'DÃ©pÃ´t Wallet';
        }
        else if (upperType === 'PARRAINAGE') {
            opType = 'parrainage';
            opCode = `PARRAINAGE_${Date.now()}`;
            opName = 'DÃ©pÃ´t Parrainage';
        }
        else if (upperType.includes('DJANGUI')) {
            opType = 'djangui';
            opCode = `DJANGUI_${Date.now()}`;
            opName = 'DÃ©pÃ´t Djangui';
        }
        const dateStr = new Date().toLocaleDateString('fr-FR').replace(/\//g, '-');
        const transaction = yield prisma_1.default.transaction.create({
            data: {
                userId: id,
                purpose: String(description || opName).trim().slice(0, 200),
                amount: transactionAmount,
                currency,
                status: 'PENDING',
                transactionRef: `NFS-${Date.now()}`,
                createdBy: adminName,
                createdById: adminId || null,
                sourceAccountType: sourceAccountType || null,
                targetAccountType: accountType,
                operation: {
                    type: opType,
                    code: opCode,
                    reference: `${dateStr}.${upperType.substring(0, 2)}.${id}`,
                    amount: transactionAmount,
                    date: new Date().toISOString()
                }
            }
        });
        res.json({ message: "OpÃ©ration soumise au COMEX", transaction });
    }
    catch (error) {
        console.error('creditUserAccount error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.creditUserAccount = creditUserAccount;
const validateTransaction = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const { txId } = req.params;
        const adminId = ((_a = req.user) === null || _a === void 0 ? void 0 : _a.userId) || ((_b = req.user) === null || _b === void 0 ? void 0 : _b.sub) || ((_c = req.user) === null || _c === void 0 ? void 0 : _c.id);
        const adminUser = adminId ? yield prisma_1.default.user.findUnique({ where: { id: adminId } }) : null;
        const adminName = adminUser ? `${adminUser.firstName} ${adminUser.lastName}` : '';
        const tx = yield prisma_1.default.transaction.findUnique({ where: { id: txId } });
        if (!tx || tx.status !== 'PENDING')
            return res.status(400).json({ error: "Transaction invalide." });
        // Vérifier les droits COMEX/ADMIN
        const isAuthorized = (adminUser === null || adminUser === void 0 ? void 0 : adminUser.roles.includes('COMEX')) || (adminUser === null || adminUser === void 0 ? void 0 : adminUser.roles.includes('ADMIN'));
        if (!isAuthorized) {
            return res.status(403).json({ error: "Seul un membre du COMEX peut valider une transaction." });
        }
        const validatorKey = String(adminId || adminName || '');
        if (!validatorKey)
            return res.status(401).json({ error: 'Session administrateur invalide.' });
        // Empêcher l'auto-validation
        if (tx.createdById && adminId && tx.createdById === adminId) {
            return res.status(403).json({ error: "Vous ne pouvez pas valider une transaction que vous avez vous-meme initiee." });
        }
        if (!tx.createdById && tx.createdBy && adminName && tx.createdBy === adminName) {
            return res.status(403).json({ error: "Vous ne pouvez pas valider une transaction que vous avez vous-meme initiee." });
        }
        if ((adminId && tx.validatedBy.includes(adminId)) || (adminName && tx.validatedBy.includes(adminName))) {
            return res.status(400).json({ error: "Vous avez déjà validé cette transaction." });
        }
        const newValidators = Array.from(new Set([...tx.validatedBy, adminId || adminName].filter(Boolean)));
        // Vérifier s'il s'agit d'un transfert lié
        const isTransfer = (_d = tx.transactionRef) === null || _d === void 0 ? void 0 : _d.startsWith('TR_REF_');
        if (isTransfer) {
            const transferRef = tx.transactionRef.substring(0, tx.transactionRef.lastIndexOf('_'));
            const linkedTransactions = yield prisma_1.default.transaction.findMany({
                where: {
                    transactionRef: {
                        in: [`${transferRef}_OUT`, `${transferRef}_IN`]
                    }
                }
            });
            if (linkedTransactions.length !== 2) {
                return res.status(400).json({ error: "Impossible de localiser la transaction de contrepartie liée à ce transfert." });
            }
            const senderTx = linkedTransactions.find((t) => t.transactionRef.endsWith('_OUT'));
            const recipientTx = linkedTransactions.find((t) => t.transactionRef.endsWith('_IN'));
            if (!senderTx || !recipientTx) {
                return res.status(400).json({ error: "Les composants débit/crédit du transfert sont invalides." });
            }
            const mergedValidators = Array.from(new Set([...senderTx.validatedBy, ...recipientTx.validatedBy, adminId || adminName].filter(Boolean)));
            if (mergedValidators.length < 2) {
                // Première validation sur 2
                const [, updatedRecipientTx] = yield prisma_1.default.$transaction([
                    prisma_1.default.transaction.update({
                        where: { id: senderTx.id },
                        data: { validatedBy: { push: validatorKey } },
                    }),
                    prisma_1.default.transaction.update({
                        where: { id: recipientTx.id },
                        data: { validatedBy: { push: validatorKey } },
                    }),
                ]);
                return res.json({
                    message: `Validé (1/2) - Transfert en attente de la seconde signature.`,
                    transaction: updatedRecipientTx
                });
            }
            else {
                // Deuxième validation : Exécuter les soldes de compte de manière atomique
                const result = yield prisma_1.default.$transaction((dbTx) => __awaiter(void 0, void 0, void 0, function* () {
                    const claimedSender = yield dbTx.transaction.updateMany({
                        where: { id: senderTx.id, status: 'PENDING' },
                        data: { status: 'PROCESSING', validatedBy: mergedValidators },
                    });
                    const claimedRecipient = yield dbTx.transaction.updateMany({
                        where: { id: recipientTx.id, status: 'PENDING' },
                        data: { status: 'PROCESSING', validatedBy: mergedValidators },
                    });
                    if (claimedSender.count !== 1 || claimedRecipient.count !== 1) {
                        const conflict = new Error('Ce transfert est deja en cours de traitement.');
                        conflict.status = 409;
                        throw conflict;
                    }
                    const senderUser = yield dbTx.user.findUnique({ where: { id: senderTx.userId } });
                    const recipientUser = yield dbTx.user.findUnique({ where: { id: recipientTx.userId } });
                    if (!senderUser || !recipientUser) {
                        throw new Error("L'expéditeur ou le destinataire du transfert est introuvable.");
                    }
                    const senderAccounts = yield dbTx.account.findMany({ where: { id: { in: senderUser.accountIds } } });
                    const recipientAccounts = yield dbTx.account.findMany({ where: { id: { in: recipientUser.accountIds } } });
                    const sourceAccount = senderAccounts.find(a => a.type === senderTx.sourceAccountType);
                    const destAccount = recipientAccounts.find(a => a.type === recipientTx.targetAccountType);
                    if (!sourceAccount || !destAccount) {
                        throw new Error("Le compte source ou le compte cible du transfert est introuvable.");
                    }
                    const sourceAmount = Math.abs(senderTx.amount || 0);
                    const debited = yield dbTx.account.updateMany({
                        where: {
                            id: sourceAccount.id,
                            currentBalance: { gte: sourceAmount },
                            availableBalance: { gte: sourceAmount },
                        },
                        data: {
                            currentBalance: { decrement: sourceAmount },
                            availableBalance: { decrement: sourceAmount }
                        }
                    });
                    if (debited.count !== 1)
                        throw new Error('Solde insuffisant sur le compte source.');
                    // Ajouter chez le destinataire
                    const convertedAmount = recipientTx.amount || 0;
                    yield dbTx.account.update({
                        where: { id: destAccount.id },
                        data: {
                            currentBalance: { increment: convertedAmount },
                            availableBalance: { increment: convertedAmount }
                        }
                    });
                    // Mettre à jour les deux transactions à SUCCESS
                    yield dbTx.transaction.update({
                        where: { id: senderTx.id },
                        data: { status: 'SUCCESS', validatedBy: mergedValidators }
                    });
                    const updatedRecipient = yield dbTx.transaction.update({
                        where: { id: recipientTx.id },
                        data: { status: 'SUCCESS', validatedBy: mergedValidators }
                    });
                    return updatedRecipient;
                }));
                return res.json({
                    message: "Validé (2/2) - Transfert exécuté avec succès.",
                    transaction: result
                });
            }
        }
        else {
            // Cas standard (Dépôt / Crédit direct)
            if (newValidators.length < 2) {
                const updatedTx = yield prisma_1.default.transaction.update({
                    where: { id: tx.id },
                    data: { validatedBy: { push: validatorKey } }
                });
                return res.json({ message: "Validé (1/2) - En attente de la seconde signature.", transaction: updatedTx });
            }
            else {
                const user = yield prisma_1.default.user.findUnique({ where: { id: tx.userId } });
                if (!user)
                    return res.status(404).json({ error: 'Utilisateur introuvable.' });
                const accounts = yield prisma_1.default.account.findMany({ where: { id: { in: user.accountIds } } });
                let sourceAccount = tx.sourceAccountType ? accounts.find(a => a.type === tx.sourceAccountType) : null;
                let targetAccount = accounts.find(a => a.type === tx.targetAccountType);
                const executionAmount = Number(tx.amount);
                if (!Number.isSafeInteger(executionAmount) || executionAmount <= 0 || !targetAccount) {
                    return res.status(409).json({ error: 'Donnees de transaction invalides.' });
                }
                yield prisma_1.default.$transaction((dbTx) => __awaiter(void 0, void 0, void 0, function* () {
                    const claimed = yield dbTx.transaction.updateMany({
                        where: { id: tx.id, status: 'PENDING' },
                        data: { status: 'PROCESSING', validatedBy: newValidators },
                    });
                    if (claimed.count !== 1)
                        throw new Error('Transaction deja en cours de traitement.');
                    if (sourceAccount) {
                        const debited = yield dbTx.account.updateMany({
                            where: {
                                id: sourceAccount.id,
                                currentBalance: { gte: executionAmount },
                                availableBalance: { gte: executionAmount },
                            },
                            data: {
                                currentBalance: { decrement: executionAmount },
                                availableBalance: { decrement: executionAmount }
                            }
                        });
                        if (debited.count !== 1)
                            throw new Error('Solde insuffisant sur le compte source.');
                    }
                    yield dbTx.account.update({
                        where: { id: targetAccount.id },
                        data: {
                            currentBalance: { increment: executionAmount },
                            availableBalance: { increment: executionAmount }
                        }
                    });
                    yield dbTx.transaction.update({
                        where: { id: tx.id },
                        data: { status: 'SUCCESS', validatedBy: newValidators }
                    });
                }));
                const updatedTx = yield prisma_1.default.transaction.findUnique({ where: { id: tx.id } });
                return res.json({ message: "Validé (2/2) - Transaction exécutée avec succès.", transaction: updatedTx });
            }
        }
    }
    catch (error) {
        console.error('validateTransaction error:', error);
        return (0, errorResponse_1.sendErrorResponse)(res, error, 'Validation de la transaction impossible.');
    }
});
exports.validateTransaction = validateTransaction;
const rejectTransaction = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { txId } = req.params;
        const tx = yield prisma_1.default.transaction.findUnique({ where: { id: txId } });
        if (!tx)
            return res.status(404).json({ error: "Transaction introuvable" });
        // Si c'est un transfert, rejeter les deux côtés
        if ((_a = tx.transactionRef) === null || _a === void 0 ? void 0 : _a.startsWith('TR_REF_')) {
            const transferRef = tx.transactionRef.substring(0, tx.transactionRef.lastIndexOf('_'));
            yield prisma_1.default.transaction.updateMany({
                where: { transactionRef: { in: [`${transferRef}_OUT`, `${transferRef}_IN`] } },
                data: { status: 'REJECTED' }
            });
            const updatedTx = yield prisma_1.default.transaction.findUnique({ where: { id: txId } });
            return res.json(updatedTx);
        }
        const updatedTx = yield prisma_1.default.transaction.update({
            where: { id: txId },
            data: { status: 'REJECTED' }
        });
        res.json(updatedTx);
    }
    catch (error) {
        console.error('rejectTransaction error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.rejectTransaction = rejectTransaction;
const getDashboardStats = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        const [userCount, transactionCount, pendingLoans, activeCotisations, accountGroups, approvedLoans] = yield Promise.all([
            prisma_1.default.user.count(),
            prisma_1.default.transaction.count(),
            prisma_1.default.loan.count({ where: { status: 'PENDING' } }),
            prisma_1.default.cotisationGroup.count({ where: { status: 'ACTIF' } }),
            prisma_1.default.account.groupBy({
                by: ['type'],
                _sum: {
                    currentBalance: true,
                    availableBalance: true
                }
            }),
            prisma_1.default.loan.findMany({
                where: { status: 'APPROVED' },
                include: { user: true }
            })
        ]);
        const maturingLoans = approvedLoans.filter(l => {
            if (!l.dueDate)
                return false;
            return l.dueDate.getMonth() === currentMonth && l.dueDate.getFullYear() === currentYear;
        });
        // Calcul de la capacitÃ© d'avalise totale rÃ©elle (somme des capacitÃ©s individuelles >= 0)
        const users = yield prisma_1.default.user.findMany({ select: { accountIds: true } });
        const allAccountIds = users.flatMap(u => u.accountIds || []);
        const accounts = yield prisma_1.default.account.findMany({
            where: { id: { in: allAccountIds } }
        });
        let volumePrincipal = 0;
        let volumeEpargne = 0;
        let volumeCaution = 0;
        let volumeCotisation = 0;
        let totalAvaliseCapacity = 0;
        // Calcul basÃ© uniquement sur les comptes rattachÃ©s Ã  des utilisateurs (exclut les comptes SystÃ¨me/Provider)
        for (const user of users) {
            const userAccounts = accounts.filter(a => (user.accountIds || []).includes(a.id));
            const getBal = (type) => { var _a; return ((_a = userAccounts.find(a => a.type === type)) === null || _a === void 0 ? void 0 : _a.currentBalance) || 0; };
            // Volume par type
            volumePrincipal += getBal('PRINCIPAL');
            volumeEpargne += getBal('EPARGNE');
            volumeCaution += getBal('CAUTION');
            volumeCotisation += (getBal('DJANGUI_NON_PERCU') || getBal('DJANGUI_PERCU') || getBal('DJANGUI_NONPERCU'));
            // CapacitÃ© d'avalise (clampÃ©e Ã  0)
            const epargne = getBal('EPARGNE');
            const djanguiNonPercu = getBal('DJANGUI_NON_PERCU') || getBal('DJANGUI_NONPERCU');
            const credit = getBal('CREDIT');
            const pret = getBal('PRET');
            const creditAvalise = getBal('CREDIT_AVALISE');
            const parrainage = getBal('PARRAINAGE');
            const capacity = (epargne + djanguiNonPercu) - (credit + pret + creditAvalise + parrainage);
            totalAvaliseCapacity += Math.max(0, capacity);
        }
        const totalAssets = volumePrincipal + volumeEpargne + volumeCaution + volumeCotisation;
        res.json({
            userCount,
            volumePrincipal,
            volumeEpargne,
            volumeCaution,
            volumeCotisation,
            totalAssets,
            transactionCount,
            pendingLoans,
            totalAvaliseCapacity,
            activeCotisations,
            maturingLoans
        });
    }
    catch (error) {
        console.error('getDashboardStats error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.getDashboardStats = getDashboardStats;
const createCotisationGroup = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const data = req.body;
        const group = yield prisma_1.default.cotisationGroup.create({ data: Object.assign(Object.assign({}, data), { status: 'ACTIF' }) });
        res.status(201).json(group);
    }
    catch (error) {
        console.error('createCotisationGroup error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.createCotisationGroup = createCotisationGroup;
const updateCotisationGroup = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const data = req.body;
        const group = yield prisma_1.default.cotisationGroup.update({
            where: { id: id },
            data
        });
        res.json(group);
    }
    catch (error) {
        console.error('updateCotisationGroup error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.updateCotisationGroup = updateCotisationGroup;
const cotisationMemberSelect = {
    id: true,
    firstName: true,
    lastName: true,
    phone: true
};
const cotisationDetailSelect = {
    id: true,
    name: true,
    code: true,
    amount: true,
    maxParticipants: true,
    nb_participant: true,
    frequency: true,
    currency: true,
    status: true,
    createdAt: true,
    approvedAt: true,
    dueDate: true,
    penaltyAmount: true,
    memberIds: true,
    members: {
        select: cotisationMemberSelect
    }
};
const getCotisations = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const groups = yield prisma_1.default.cotisationGroup.findMany({
            select: {
                id: true,
                name: true,
                code: true,
                amount: true,
                maxParticipants: true,
                nb_participant: true,
                frequency: true,
                currency: true,
                status: true,
                createdAt: true,
                approvedAt: true,
                dueDate: true,
                penaltyAmount: true,
                memberIds: true
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(groups.map(group => {
            var _a;
            return (Object.assign(Object.assign({}, group), { membersCount: ((_a = group.memberIds) === null || _a === void 0 ? void 0 : _a.length) || group.nb_participant || 0, members: [] }));
        }));
    }
    catch (error) {
        console.error('getCotisations error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.getCotisations = getCotisations;
const getCotisation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { id } = req.params;
        const group = yield prisma_1.default.cotisationGroup.findUnique({
            where: { id: id },
            select: cotisationDetailSelect
        });
        if (!group) {
            return res.status(404).json({ error: 'Groupe de cotisation introuvable' });
        }
        res.json(Object.assign(Object.assign({}, group), { membersCount: ((_a = group.memberIds) === null || _a === void 0 ? void 0 : _a.length) || ((_b = group.members) === null || _b === void 0 ? void 0 : _b.length) || group.nb_participant || 0 }));
    }
    catch (error) {
        console.error('getCotisation error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.getCotisation = getCotisation;
const addParticipantToCotisation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { groupId, userId } = req.body;
        const updated = yield prisma_1.default.cotisationGroup.update({
            where: { id: groupId },
            data: { members: { connect: { id: userId } } },
            select: cotisationDetailSelect
        });
        res.json(Object.assign(Object.assign({}, updated), { membersCount: ((_a = updated.memberIds) === null || _a === void 0 ? void 0 : _a.length) || ((_b = updated.members) === null || _b === void 0 ? void 0 : _b.length) || updated.nb_participant || 0 }));
    }
    catch (error) {
        console.error('addParticipantToCotisation error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.addParticipantToCotisation = addParticipantToCotisation;
const removeParticipantFromCotisation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { groupId, userId } = req.body;
        const updated = yield prisma_1.default.cotisationGroup.update({
            where: { id: groupId },
            data: { members: { disconnect: { id: userId } } },
            select: cotisationDetailSelect
        });
        res.json(Object.assign(Object.assign({}, updated), { membersCount: ((_a = updated.memberIds) === null || _a === void 0 ? void 0 : _a.length) || ((_b = updated.members) === null || _b === void 0 ? void 0 : _b.length) || updated.nb_participant || 0 }));
    }
    catch (error) {
        console.error('removeParticipantFromCotisation error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.removeParticipantFromCotisation = removeParticipantFromCotisation;
const payCotisationFromCaution = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { groupId, userId } = req.body;
        res.json({ message: "PayÃ© via Caution" });
    }
    catch (error) {
        console.error('payCotisationFromCaution error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.payCotisationFromCaution = payCotisationFromCaution;
const payCotisationInCash = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { groupId, userId } = req.body;
        res.json({ message: "PayÃ© en espÃ¨ces" });
    }
    catch (error) {
        console.error('payCotisationInCash error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.payCotisationInCash = payCotisationInCash;
const asArray = (value) => {
    if (Array.isArray(value))
        return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        }
        catch (_a) {
            return [];
        }
    }
    return [];
};
const slimAvaliste = (aval, userMap) => {
    const userId = typeof (aval === null || aval === void 0 ? void 0 : aval.userId) === 'string' ? aval.userId : undefined;
    const amount = Number((aval === null || aval === void 0 ? void 0 : aval.amount) || 0);
    return {
        userId,
        name: typeof (aval === null || aval === void 0 ? void 0 : aval.name) === 'string' && aval.name.trim()
            ? aval.name.trim()
            : userId
                ? userMap.get(userId) || 'Inconnu'
                : 'Inconnu',
        amount: Number.isFinite(amount) ? amount : 0,
        status: typeof (aval === null || aval === void 0 ? void 0 : aval.status) === 'string' ? aval.status : undefined
    };
};
const resolveLoanAvalistes = (loan) => __awaiter(void 0, void 0, void 0, function* () {
    let avalList = asArray(loan.avalistes);
    if (avalList.length === 0) {
        const tx = yield prisma_1.default.transaction.findFirst({
            where: {
                userId: loan.userId,
                amount: loan.amount,
                purpose: { contains: "CREDIT" }
            },
            select: { operation: true },
            orderBy: { createdAt: 'desc' }
        });
        const op = tx === null || tx === void 0 ? void 0 : tx.operation;
        avalList = asArray((op === null || op === void 0 ? void 0 : op.avalistes) || (op === null || op === void 0 ? void 0 : op.avaliste));
        if (avalList.length === 0 && (op === null || op === void 0 ? void 0 : op.beneficiary)) {
            avalList = Array.isArray(op.beneficiary) ? op.beneficiary : [op.beneficiary];
        }
    }
    const avalisteUserIds = [
        ...new Set(avalList
            .map((aval) => typeof (aval === null || aval === void 0 ? void 0 : aval.userId) === 'string' ? aval.userId : undefined)
            .filter(Boolean))
    ];
    const avalisteUsers = avalisteUserIds.length > 0
        ? yield prisma_1.default.user.findMany({
            where: { id: { in: avalisteUserIds } },
            select: { id: true, firstName: true, lastName: true }
        })
        : [];
    const userMap = new Map();
    avalisteUsers.forEach(user => {
        userMap.set(user.id, `${user.firstName || ''} ${user.lastName || ''}`.trim());
    });
    return avalList.map((aval) => slimAvaliste(aval, userMap));
});
const getLoans = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const requestedLimit = parseInt(req.query.limit) || 10;
        const limit = Math.min(Math.max(requestedLimit, 1), 50);
        const status = req.query.status;
        const search = req.query.search;
        const where = {};
        if (status && status !== 'ALL') {
            where.status = status;
        }
        if (search) {
            where.user = {
                OR: [
                    { firstName: { contains: search, mode: 'insensitive' } },
                    { lastName: { contains: search, mode: 'insensitive' } },
                    { phone: { contains: search, mode: 'insensitive' } }
                ]
            };
        }
        const [total, loans] = yield Promise.all([
            prisma_1.default.loan.count({ where }),
            prisma_1.default.loan.findMany({
                where,
                select: {
                    id: true,
                    userId: true,
                    amount: true,
                    interestRate: true,
                    totalInterest: true,
                    duration: true,
                    purpose: true,
                    status: true,
                    createdBy: true,
                    createdById: true,
                    validatedBy: true,
                    createdAt: true,
                    approvedAt: true,
                    dueDate: true,
                    penaltyAmount: true,
                    updatedAt: true,
                    user: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            phone: true
                        }
                    }
                },
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit
            })
        ]);
        const mapped = loans.map((l) => {
            return Object.assign(Object.assign({}, l), { avaliste: [], avalistes: [], avalistesDeferred: true });
        });
        res.json({
            data: mapped,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        });
    }
    catch (error) {
        console.error('getLoans error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.getLoans = getLoans;
const getLoan = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const loan = yield prisma_1.default.loan.findUnique({
            where: { id: id },
            select: {
                id: true,
                userId: true,
                amount: true,
                interestRate: true,
                totalInterest: true,
                duration: true,
                purpose: true,
                status: true,
                avalistes: true,
                createdBy: true,
                createdById: true,
                validatedBy: true,
                createdAt: true,
                approvedAt: true,
                dueDate: true,
                penaltyAmount: true,
                updatedAt: true,
                user: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        phone: true
                    }
                }
            }
        });
        if (!loan) {
            return res.status(404).json({ error: "Prêt non trouvé" });
        }
        const avalistes = yield resolveLoanAvalistes(loan);
        res.json(Object.assign(Object.assign({}, loan), { avaliste: avalistes, avalistes }));
    }
    catch (error) {
        console.error('getLoan error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.getLoan = getLoan;
const updateLoanStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const { id } = req.params;
        const { status } = req.body;
        const normalizedStatus = String(status || '').toUpperCase();
        if (!['APPROVED', 'REJECTED'].includes(normalizedStatus)) {
            return res.status(400).json({ error: 'Statut de credit invalide.' });
        }
        const adminId = ((_a = req.user) === null || _a === void 0 ? void 0 : _a.userId) || ((_b = req.user) === null || _b === void 0 ? void 0 : _b.sub) || ((_c = req.user) === null || _c === void 0 ? void 0 : _c.id);
        const adminUser = adminId ? yield prisma_1.default.user.findUnique({ where: { id: adminId } }) : null;
        if (!adminUser)
            return res.status(401).json({ error: "Non authentifié" });
        const isAuthorized = adminUser.roles.includes('COMEX') || adminUser.roles.includes('ADMIN');
        if (!isAuthorized) {
            return res.status(403).json({ error: "Seul un membre du COMEX peut valider un crédit." });
        }
        const loan = yield prisma_1.default.loan.findUnique({ where: { id: id } });
        if (!loan)
            return res.status(404).json({ error: "Prêt non trouvé" });
        if (loan.status !== 'PENDING')
            return res.status(409).json({ error: 'Ce credit a deja ete traite.' });
        const adminName = `${adminUser.firstName} ${adminUser.lastName}`;
        if (normalizedStatus === 'APPROVED' && loan.createdById && adminId && loan.createdById === adminId) {
            return res.status(403).json({ error: "Vous ne pouvez pas valider un credit que vous avez vous-meme saisi." });
        }
        if (normalizedStatus === 'APPROVED' && !loan.createdById && loan.createdBy && loan.createdBy === adminName) {
            return res.status(403).json({ error: "Vous ne pouvez pas valider un credit que vous avez vous-meme saisi." });
        }
        const claimedLoan = yield prisma_1.default.loan.updateMany({
            where: { id: id, status: 'PENDING' },
            data: {
                status: normalizedStatus,
                validatedBy: normalizedStatus === 'APPROVED' ? [adminId || adminName] : undefined,
                approvedAt: normalizedStatus === 'APPROVED' ? new Date() : undefined,
                dueDate: normalizedStatus === 'APPROVED' ? new Date(new Date().getTime() + (loan.duration || 30) * 24 * 60 * 60 * 1000) : undefined
            }
        });
        if (claimedLoan.count !== 1)
            return res.status(409).json({ error: 'Ce credit est deja en cours de traitement.' });
        const updatedLoan = yield prisma_1.default.loan.findUnique({ where: { id: id }, include: { user: true } });
        try {
            yield prisma_1.default.$transaction((dbTx) => __awaiter(void 0, void 0, void 0, function* () {
                if (normalizedStatus === 'APPROVED' && loan.amount) {
                    // 1. Créditer le compte PRINCIPAL de l'emprunteur
                    const borrower = yield dbTx.user.findUnique({ where: { id: loan.userId }, select: { accountIds: true } });
                    if (!borrower)
                        throw new Error('Emprunteur introuvable.');
                    if (borrower.accountIds) {
                        const principalAcc = yield dbTx.account.findFirst({
                            where: { id: { in: borrower.accountIds }, type: 'PRINCIPAL' }
                        });
                        if (!principalAcc)
                            throw new Error('Compte principal de l emprunteur introuvable.');
                        yield dbTx.account.update({
                            where: { id: principalAcc.id },
                            data: {
                                currentBalance: { increment: loan.amount },
                                availableBalance: { increment: loan.amount }
                            }
                        });
                    }
                    // 2. Mettre à jour la transaction PENDING associée
                    const updatedTransactions = yield dbTx.transaction.updateMany({
                        where: loan.transactionId
                            ? { id: loan.transactionId, status: 'PENDING' }
                            : { userId: loan.userId, purpose: loan.purpose, status: 'PENDING' },
                        data: { status: 'SUCCESS', validatedBy: [adminId || adminName] }
                    });
                    if (loan.transactionId && updatedTransactions.count !== 1)
                        throw new Error('Transaction de credit associee introuvable.');
                    // 3. Débiter la liquidité globale NFS du montant du crédit accordé au bénéficiaire
                    yield dbTx.systemBalance.upsert({
                        where: { code: 'NFS_GLOBAL' },
                        create: { code: 'NFS_GLOBAL', totalLoans: loan.amount, availableLiquidity: -loan.amount },
                        update: { totalLoans: { increment: loan.amount }, availableLiquidity: { decrement: loan.amount }, lastUpdated: new Date() },
                    });
                }
                if (normalizedStatus === 'APPROVED' && loan.avalistes && Array.isArray(loan.avalistes)) {
                    for (const avaliste of loan.avalistes) {
                        if (!avaliste.userId || !avaliste.amount)
                            continue;
                        const endorsedAmount = Number(avaliste.amount);
                        if (!Number.isSafeInteger(endorsedAmount) || endorsedAmount <= 0)
                            throw new Error('Montant avaliste invalide.');
                        const userAccounts = yield dbTx.user.findUnique({ where: { id: avaliste.userId }, select: { accountIds: true } });
                        if (userAccounts && userAccounts.accountIds) {
                            const creditAvaliseAcc = yield dbTx.account.findFirst({
                                where: { id: { in: userAccounts.accountIds }, type: 'CREDIT_AVALISE' }
                            });
                            if (creditAvaliseAcc) {
                                yield dbTx.account.update({
                                    where: { id: creditAvaliseAcc.id },
                                    data: {
                                        currentBalance: { increment: endorsedAmount },
                                        availableBalance: { increment: endorsedAmount }
                                    }
                                });
                            }
                            else {
                                const newAcc = yield dbTx.account.create({
                                    data: { type: 'CREDIT_AVALISE', currency: 'XAF', currentBalance: endorsedAmount, availableBalance: endorsedAmount }
                                });
                                yield dbTx.user.update({
                                    where: { id: avaliste.userId },
                                    data: { accountIds: { push: newAcc.id } }
                                });
                            }
                        }
                    }
                }
            }));
        }
        catch (sideEffectError) {
            yield prisma_1.default.loan.updateMany({
                where: { id: loan.id, status: normalizedStatus },
                data: { status: 'PENDING', validatedBy: [], approvedAt: null, dueDate: null },
            });
            throw sideEffectError;
        }
        res.json(updatedLoan);
    }
    catch (error) {
        console.error('updateLoanStatus error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.updateLoanStatus = updateLoanStatus;
const createLoan = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const { userId, amount, duration, purpose, avalistes, interestRate } = req.body;
        // ─── VÉRIFICATION 1 : Champs obligatoires ───────────────────────────────
        if (!userId || !amount || !duration || !interestRate) {
            return res.status(400).json({ error: "Les champs userId, amount, duration et interestRate sont obligatoires." });
        }
        const loanAmount = parseFloat(amount);
        const loanDuration = parseInt(duration);
        const loanRate = parseFloat(interestRate);
        if (isNaN(loanAmount) || loanAmount <= 0) {
            return res.status(400).json({ error: "Le montant du crédit doit être un nombre positif." });
        }
        if (isNaN(loanDuration) || loanDuration <= 0) {
            return res.status(400).json({ error: "La durée du crédit doit être un entier positif (en jours)." });
        }
        if (isNaN(loanRate) || loanRate < 0) {
            return res.status(400).json({ error: "Le taux d'intérêt doit être un nombre positif ou nul." });
        }
        // ─── VÉRIFICATION 2 : Existence et statut de l'emprunteur ───────────────
        const borrower = yield prisma_1.default.user.findUnique({
            where: { id: userId }
        });
        if (!borrower) {
            return res.status(404).json({ error: "Client introuvable. Veuillez vérifier l'identifiant." });
        }
        if (!borrower.activated) {
            return res.status(400).json({ error: `Le compte de ${borrower.firstName} ${borrower.lastName} est désactivé. Impossible de créer un crédit.` });
        }
        if (!borrower.verified) {
            return res.status(400).json({ error: `Le KYC de ${borrower.firstName} ${borrower.lastName} n'est pas vérifié. Le crédit ne peut être accordé qu'à un client vérifié.` });
        }
        // ─── VÉRIFICATION 2b : Capacité d'avalise de l'emprunteur ≥ 1/3 du montant ─
        const borrowerAccounts = yield prisma_1.default.account.findMany({
            where: { id: { in: borrower.accountIds || [] } }
        });
        const getBorrowerBal = (type) => { var _a; return ((_a = borrowerAccounts.find(a => a.type === type)) === null || _a === void 0 ? void 0 : _a.currentBalance) || 0; };
        const borrowerEpargne = getBorrowerBal('EPARGNE');
        const borrowerDjangui = getBorrowerBal('DJANGUI_NON_PERCU') || getBorrowerBal('DJANGUI_NONPERCU');
        const borrowerCredit = getBorrowerBal('CREDIT');
        const borrowerPret = getBorrowerBal('PRET');
        const borrowerCreditAvalise = getBorrowerBal('CREDIT_AVALISE');
        const borrowerParrainage = getBorrowerBal('PARRAINAGE');
        const borrowerAvaliseCapacity = Math.max(0, (borrowerEpargne + borrowerDjangui) - (borrowerCredit + borrowerPret + borrowerCreditAvalise + borrowerParrainage));
        const minRequiredCapacity = loanAmount / 3;
        if (borrowerAvaliseCapacity < minRequiredCapacity) {
            return res.status(400).json({
                error: `Capacité d'avalise insuffisante pour ${borrower.firstName} ${borrower.lastName}. ` +
                    `Pour un crédit de ${loanAmount.toLocaleString('fr-FR')} XAF, une capacité d'avalise d'au moins ` +
                    `${Math.ceil(minRequiredCapacity).toLocaleString('fr-FR')} XAF (1/3 du montant) est requise. ` +
                    `Capacité actuelle : ${borrowerAvaliseCapacity.toLocaleString('fr-FR')} XAF.`
            });
        }
        // ─── VÉRIFICATION 3 : Pas de crédit en cours (PENDING ou APPROVED) ───────
        const existingLoan = yield prisma_1.default.loan.findFirst({
            where: {
                userId: userId,
                status: { in: ['PENDING', 'APPROVED'] }
            }
        });
        if (existingLoan) {
            const statusLabel = existingLoan.status === 'PENDING' ? 'en attente de validation' : 'déjà actif';
            return res.status(400).json({
                error: `${borrower.firstName} ${borrower.lastName} possède déjà un crédit ${statusLabel} (montant : ${existingLoan.amount.toLocaleString('fr-FR')} XAF). Un nouveau crédit ne peut être créé qu'après le remboursement ou le rejet du précédent.`
            });
        }
        // ─── VÉRIFICATION 4 : Avalistes obligatoires et valides ──────────────────
        const avalisteList = Array.isArray(avalistes) ? avalistes : [];
        if (avalisteList.length === 0) {
            return res.status(400).json({ error: "Au moins un avaliste est requis pour accorder un crédit." });
        }
        // Validation de chaque avaliste
        const errors = [];
        const validatedAvalistes = [];
        for (const aval of avalisteList) {
            if (!aval.userId || !aval.amount) {
                errors.push("Chaque avaliste doit avoir un userId et un montant d'avalise.");
                continue;
            }
            const avalAmount = parseFloat(aval.amount);
            if (isNaN(avalAmount) || avalAmount <= 0) {
                errors.push(`Le montant d'avalise pour l'avaliste ${aval.userId} doit être positif.`);
                continue;
            }
            // Vérifier que l'avaliste existe
            const avalUser = yield prisma_1.default.user.findUnique({
                where: { id: aval.userId }
            });
            if (!avalUser) {
                errors.push(`Avaliste avec l'ID ${aval.userId} introuvable.`);
                continue;
            }
            if (!avalUser.activated) {
                errors.push(`Le compte de l'avaliste ${avalUser.firstName} ${avalUser.lastName} est désactivé.`);
                continue;
            }
            // L'avaliste ne peut pas être le même que l'emprunteur
            if (aval.userId === userId) {
                errors.push(`${avalUser.firstName} ${avalUser.lastName} ne peut pas être à la fois emprunteur et avaliste.`);
                continue;
            }
            // Calculer la capacité d'avalise de l'avaliste
            const avalAccounts = yield prisma_1.default.account.findMany({
                where: { id: { in: avalUser.accountIds || [] } }
            });
            const getBalance = (type) => { var _a; return ((_a = avalAccounts.find(a => a.type === type)) === null || _a === void 0 ? void 0 : _a.currentBalance) || 0; };
            const epargne = getBalance('EPARGNE');
            const djanguiNonPercu = getBalance('DJANGUI_NON_PERCU') || getBalance('DJANGUI_NONPERCU');
            const credit = getBalance('CREDIT');
            const pret = getBalance('PRET');
            const creditAvalise = getBalance('CREDIT_AVALISE');
            const parrainage = getBalance('PARRAINAGE');
            const avaliseCapacity = Math.max(0, (epargne + djanguiNonPercu) - (credit + pret + creditAvalise + parrainage));
            if (avaliseCapacity < avalAmount) {
                errors.push(`Capacité d'avalise insuffisante pour ${avalUser.firstName} ${avalUser.lastName} : ` +
                    `disponible ${avaliseCapacity.toLocaleString('fr-FR')} XAF, requis ${avalAmount.toLocaleString('fr-FR')} XAF.`);
                continue;
            }
            validatedAvalistes.push(Object.assign(Object.assign({}, aval), { name: `${avalUser.firstName} ${avalUser.lastName}`, amount: avalAmount }));
        }
        if (errors.length > 0) {
            return res.status(400).json({ error: errors.join(' | ') });
        }
        // ─── VÉRIFICATION 5 : Couverture totale par les avalistes ────────────────
        const totalAvalCoverage = validatedAvalistes.reduce((sum, a) => sum + parseFloat(a.amount), 0);
        if (totalAvalCoverage < loanAmount) {
            return res.status(400).json({
                error: `La couverture totale des avalistes (${totalAvalCoverage.toLocaleString('fr-FR')} XAF) est insuffisante pour couvrir le montant du crédit (${loanAmount.toLocaleString('fr-FR')} XAF).`
            });
        }
        // ─── Création du crédit après toutes les vérifications ───────────────────
        const adminId = ((_a = req.user) === null || _a === void 0 ? void 0 : _a.userId) || ((_b = req.user) === null || _b === void 0 ? void 0 : _b.sub) || ((_c = req.user) === null || _c === void 0 ? void 0 : _c.id);
        const adminUser = adminId ? yield prisma_1.default.user.findUnique({ where: { id: adminId } }) : null;
        const adminName = adminUser ? `${adminUser.firstName} ${adminUser.lastName}` : 'Admin Système';
        const loan = yield prisma_1.default.loan.create({
            data: {
                userId,
                amount: loanAmount,
                duration: loanDuration,
                interestRate: loanRate,
                totalInterest: Math.round(loanAmount * (loanRate / 100) * Math.max(1, Math.ceil(loanDuration / 30))),
                purpose,
                status: 'PENDING',
                avalistes: validatedAvalistes,
                createdBy: adminName,
                createdById: adminId || null
            },
            include: { user: true }
        });
        res.status(201).json(loan);
    }
    catch (error) {
        console.error('createLoan error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.createLoan = createLoan;
const transactionUserSelect = {
    id: true,
    firstName: true,
    lastName: true,
    phone: true,
    email: true
};
const slimOperation = (operation) => {
    if (!operation || typeof operation !== 'object')
        return operation;
    const avalistes = operation.avalistes || operation.avaliste;
    const slimAvalistes = Array.isArray(avalistes)
        ? avalistes.map((avaliste) => ({
            userId: avaliste === null || avaliste === void 0 ? void 0 : avaliste.userId,
            firstName: avaliste === null || avaliste === void 0 ? void 0 : avaliste.firstName,
            lastName: avaliste === null || avaliste === void 0 ? void 0 : avaliste.lastName,
            phone: avaliste === null || avaliste === void 0 ? void 0 : avaliste.phone,
            amount: avaliste === null || avaliste === void 0 ? void 0 : avaliste.amount,
            interestShare: avaliste === null || avaliste === void 0 ? void 0 : avaliste.interestShare,
        }))
        : avalistes;
    return {
        code: operation.code,
        name: operation.name,
        description: operation.description,
        avalistes: slimAvalistes,
        avaliste: slimAvalistes,
    };
};
const mapTransactionForList = (t) => {
    const operation = slimOperation(t.operation);
    const avalList = (operation === null || operation === void 0 ? void 0 : operation.avalistes) || (operation === null || operation === void 0 ? void 0 : operation.avaliste) || t.avalistes || t.avaliste || [];
    return {
        id: t.id,
        userId: t.userId,
        user: t.user,
        purpose: t.purpose,
        description: (operation === null || operation === void 0 ? void 0 : operation.description) || t.purpose,
        amount: t.amount,
        status: t.status,
        transactionRef: t.transactionRef,
        reference: t.transactionRef,
        createdBy: t.createdBy,
        validatedBy: t.validatedBy || [],
        targetAccountType: t.targetAccountType,
        sourceAccountType: t.sourceAccountType,
        currency: t.currency,
        operation,
        avaliste: avalList,
        avalistes: avalList,
        createdAt: t.createdAt,
        approvedAt: t.approvedAt,
        dueDate: t.dueDate,
        penaltyAmount: t.penaltyAmount,
    };
};
const getTransactions = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 0;
        const scope = req.query.scope;
        const where = scope === 'admin'
            ? { AND: [{ createdBy: { not: null } }, { createdBy: { not: 'System' } }] }
            : scope === 'mobile'
                ? { OR: [{ createdBy: null }, { createdBy: 'System' }] }
                : {};
        if (limit > 0) {
            const skip = (page - 1) * limit;
            const [transactions, total] = yield Promise.all([
                prisma_1.default.transaction.findMany({
                    where,
                    skip,
                    take: limit,
                    orderBy: { createdAt: 'desc' },
                    include: { user: { select: transactionUserSelect } }
                }),
                prisma_1.default.transaction.count({ where })
            ]);
            const mapped = transactions.map(mapTransactionForList);
            return res.json({ data: mapped, total, page, totalPages: Math.ceil(total / limit) });
        }
        const transactions = yield prisma_1.default.transaction.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: { user: { select: transactionUserSelect } }
        });
        const mapped = transactions.map(mapTransactionForList);
        res.json(mapped);
    }
    catch (error) {
        console.error('getTransactions error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.getTransactions = getTransactions;
const getReferralStats = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const [totalUsers, referredUsers, parrainageAccounts] = yield Promise.all([
            prisma_1.default.user.count(),
            prisma_1.default.user.count({ where: { referredById: { not: null } } }),
            prisma_1.default.account.aggregate({
                where: { type: 'PARRAINAGE' },
                _sum: { currentBalance: true }
            })
        ]);
        const totalCommissions = parrainageAccounts._sum.currentBalance || 0;
        const conversionRate = totalUsers > 0 ? (referredUsers / totalUsers) * 100 : 0;
        // Get top referrers
        const topReferrersRaw = yield prisma_1.default.user.groupBy({
            by: ['referredById'],
            _count: { id: true },
            where: { referredById: { not: null } },
            orderBy: { _count: { id: 'desc' } },
            take: 10
        });
        const topReferrers = yield Promise.all(topReferrersRaw.map((ref) => __awaiter(void 0, void 0, void 0, function* () {
            const user = yield prisma_1.default.user.findUnique({
                where: { id: ref.referredById }
            });
            const parrainageAcc = yield prisma_1.default.account.findFirst({
                where: {
                    id: { in: (user === null || user === void 0 ? void 0 : user.accountIds) || [] },
                    type: 'PARRAINAGE'
                }
            });
            return {
                id: user === null || user === void 0 ? void 0 : user.id,
                name: `${user === null || user === void 0 ? void 0 : user.firstName} ${user === null || user === void 0 ? void 0 : user.lastName}`,
                code: user === null || user === void 0 ? void 0 : user.referralCode,
                referralsCount: ref._count.id,
                commissions: (parrainageAcc === null || parrainageAcc === void 0 ? void 0 : parrainageAcc.currentBalance) || 0
            };
        })));
        res.json({
            totalReferrals: referredUsers,
            totalCommissions,
            conversionRate: Math.round(conversionRate),
            topReferrers
        });
    }
    catch (error) {
        console.error('getReferralStats error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.getReferralStats = getReferralStats;
const getGroups = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const groups = yield prisma_1.default.userGroup.findMany({ include: { users: true } });
        res.json(groups);
    }
    catch (e) {
        console.error('getGroups error:', e);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : e.message });
    }
});
exports.getGroups = getGroups;
const getPermissionCatalog = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    res.json({ data: permissions_1.permissionCatalog });
});
exports.getPermissionCatalog = getPermissionCatalog;
const getMyPermissions = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { permissions, allAccess } = (0, permissionMiddleware_1.getEffectivePermissions)(req);
    res.json({ data: { permissions, allAccess } });
});
exports.getMyPermissions = getMyPermissions;
const createGroup = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, description, permissions } = req.body;
        const group = yield prisma_1.default.userGroup.create({
            data: { name, description, permissions: (0, permissions_1.normalizePermissions)(permissions) }
        });
        res.json(group);
    }
    catch (e) {
        console.error('createGroup error:', e);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : e.message });
    }
});
exports.createGroup = createGroup;
const updateGroup = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const data = Object.assign({}, req.body);
        if ('permissions' in data) {
            data.permissions = (0, permissions_1.normalizePermissions)(data.permissions);
        }
        const group = yield prisma_1.default.userGroup.update({ where: { id: id }, data });
        res.json(group);
    }
    catch (e) {
        console.error('updateGroup error:', e);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : e.message });
    }
});
exports.updateGroup = updateGroup;
const assignUserGroups = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { groupIds } = req.body;
        const parsedRoles = parseRoles(req.body);
        let finalRoles = parsedRoles;
        if (!finalRoles) {
            const existingUser = yield prisma_1.default.user.findUnique({ where: { id: id } });
            finalRoles = (existingUser === null || existingUser === void 0 ? void 0 : existingUser.roles) || [];
        }
        if (groupIds && Array.isArray(groupIds)) {
            const groups = yield prisma_1.default.userGroup.findMany({
                where: { id: { in: groupIds } }
            });
            const hasComexGroup = groups.some(g => g.name.toUpperCase() === 'COMEX' || g.name.toUpperCase() === 'COMMEX');
            if (hasComexGroup) {
                if (!finalRoles.includes('COMEX'))
                    finalRoles = [...finalRoles, 'COMEX'];
                if (!finalRoles.includes('ADMIN'))
                    finalRoles = [...finalRoles, 'ADMIN'];
            }
            else {
                finalRoles = finalRoles.filter(r => r !== 'COMEX');
            }
        }
        const updateData = {};
        if (groupIds && Array.isArray(groupIds)) {
            updateData.userGroups = { set: groupIds.map((gid) => ({ id: gid })) };
        }
        updateData.roles = finalRoles;
        const user = yield prisma_1.default.user.update({
            where: { id: id },
            data: updateData,
            include: { userGroups: true }
        });
        res.json(user);
    }
    catch (e) {
        console.error('assignUserGroups error:', e);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : e.message });
    }
});
exports.assignUserGroups = assignUserGroups;
const getCurrencies = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const currencies = yield prisma_1.default.currency.findMany({ where: { isActive: true } });
        res.json(currencies);
    }
    catch (e) {
        console.error('getCurrencies error:', e);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : e.message });
    }
});
exports.getCurrencies = getCurrencies;
const syncCurrencies = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield (0, currencyService_1.updateExchangeRates)();
        res.json({ message: "OK" });
    }
    catch (e) {
        console.error('syncCurrencies error:', e);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : e.message });
    }
});
exports.syncCurrencies = syncCurrencies;
const getLoanConfigs = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const configs = yield prisma_1.default.loanConfig.findMany({ orderBy: { code: 'asc' } });
        res.json(configs);
    }
    catch (error) {
        console.error('getLoanConfigs error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.getLoanConfigs = getLoanConfigs;
const createLoanConfig = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { code, rate, duration } = req.body;
        // VÃ©rifier si le code existe dÃ©jÃ 
        const existing = yield prisma_1.default.loanConfig.findUnique({ where: { code } });
        if (existing) {
            return res.status(400).json({ error: `Le code crÃ©dit "${code}" existe dÃ©jÃ .` });
        }
        const config = yield prisma_1.default.loanConfig.create({
            data: { code, rate: parseFloat(rate), duration: parseInt(duration) }
        });
        res.status(201).json(config);
    }
    catch (error) {
        console.error('createLoanConfig error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.createLoanConfig = createLoanConfig;
const updateLoanConfig = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { code, rate, duration } = req.body;
        const config = yield prisma_1.default.loanConfig.update({
            where: { id: id },
            data: { code, rate: parseFloat(rate), duration: parseInt(duration) }
        });
        res.json(config);
    }
    catch (error) {
        console.error('updateLoanConfig error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.updateLoanConfig = updateLoanConfig;
const deleteLoanConfig = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        yield prisma_1.default.loanConfig.delete({ where: { id: id } });
        res.json({ message: 'Configuration supprimÃ©e' });
    }
    catch (error) {
        console.error('deleteLoanConfig error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.deleteLoanConfig = deleteLoanConfig;
const updateUserKYC = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const body = req.body || {};
        const allowedFields = [
            'documentType', 'documentNumber', 'documentUrl', 'address', 'addressImageUrl',
            'ribUrl', 'swiftCode', 'beneficiaries', 'emergencyContacts', 'profession',
            'country', 'joiningYear', 'kycStatus'
        ];
        const data = {};
        for (const field of allowedFields) {
            if (hasOwn(body, field))
                data[field] = body[field];
        }
        if (hasOwn(body, 'averageIncome')) {
            const averageIncome = Number(body.averageIncome);
            if (!Number.isFinite(averageIncome) || averageIncome < 0) {
                return res.status(400).json({ error: 'Revenu moyen invalide.' });
            }
            data.averageIncome = averageIncome;
        }
        if (hasOwn(data, 'joiningYear')) {
            const joiningYear = Number(data.joiningYear);
            if (!Number.isInteger(joiningYear) || joiningYear < 1900 || joiningYear > new Date().getFullYear() + 1) {
                return res.status(400).json({ error: 'Annee d adhesion invalide.' });
            }
            data.joiningYear = joiningYear;
        }
        if (hasOwn(data, 'kycStatus')) {
            data.kycStatus = String(data.kycStatus || '').toUpperCase();
            if (!['IDLE', 'PENDING', 'APPROVED', 'REJECTED'].includes(data.kycStatus)) {
                return res.status(400).json({ error: 'Statut KYC invalide.' });
            }
        }
        if (Object.keys(data).length === 0)
            return res.status(400).json({ error: 'Aucune donnee KYC valide.' });
        const user = yield prisma_1.default.user.update({
            where: { id: id },
            data: Object.assign(Object.assign({}, data), (hasOwn(data, 'kycStatus') ? { verified: data.kycStatus === 'APPROVED' } : {}))
        });
        res.json(user);
    }
    catch (e) {
        console.error('updateUserKYC error:', e);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : e.message });
    }
});
exports.updateUserKYC = updateUserKYC;
const adminTransfer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const { sourceUserId, sourceAccountType, destUserId, destAccountType, amount, purpose } = req.body;
        const adminId = ((_a = req.user) === null || _a === void 0 ? void 0 : _a.userId) || ((_b = req.user) === null || _b === void 0 ? void 0 : _b.sub) || ((_c = req.user) === null || _c === void 0 ? void 0 : _c.id);
        const adminUser = adminId ? yield prisma_1.default.user.findUnique({ where: { id: adminId } }) : null;
        const adminName = adminUser ? `${adminUser.firstName} ${adminUser.lastName}` : 'Admin Système';
        if (!sourceUserId || !sourceAccountType || !destUserId || !destAccountType || !amount) {
            return res.status(400).json({ error: "Tous les champs (expéditeur, compte source, destinataire, compte cible, montant) sont requis." });
        }
        const transferAmount = Number(amount);
        if (isNaN(transferAmount) || transferAmount <= 0) {
            return res.status(400).json({ error: "Le montant du transfert doit être un nombre positif." });
        }
        // 1. Rechercher l'expéditeur et le destinataire
        const sourceUser = yield prisma_1.default.user.findUnique({ where: { id: sourceUserId } });
        if (!sourceUser)
            return res.status(404).json({ error: "Client expéditeur introuvable." });
        const destUser = yield prisma_1.default.user.findUnique({ where: { id: destUserId } });
        if (!destUser)
            return res.status(404).json({ error: "Client destinataire introuvable." });
        // 2. Récupérer les comptes associés
        const sourceAccounts = yield prisma_1.default.account.findMany({
            where: { id: { in: sourceUser.accountIds || [] } }
        });
        const destAccounts = yield prisma_1.default.account.findMany({
            where: { id: { in: destUser.accountIds || [] } }
        });
        const sourceAccount = sourceAccounts.find(a => a.type === sourceAccountType);
        const destAccount = destAccounts.find(a => a.type === destAccountType);
        if (!sourceAccount) {
            return res.status(400).json({ error: `Compte source de type ${sourceAccountType} introuvable.` });
        }
        if (!destAccount) {
            return res.status(400).json({ error: `Compte destinataire de type ${destAccountType} introuvable.` });
        }
        // 3. Calculer les frais de transfert
        const sourceCurrencyCode = sourceAccount.currency || 'XAF';
        const feeDetails = yield (0, exports.calculateTransferFee)(transferAmount, sourceCurrencyCode);
        const fee = feeDetails.fee;
        // Vérifier le solde disponible (montant + frais)
        const totalRequired = transferAmount + fee;
        if (sourceAccount.availableBalance < totalRequired) {
            return res.status(400).json({
                error: `Solde insuffisant pour couvrir le transfert et les frais. Requis : ${totalRequired} ${sourceCurrencyCode}, Disponible : ${sourceAccount.availableBalance} ${sourceCurrencyCode}`
            });
        }
        // 4. Calculer le taux de change
        const destCurrencyCode = destAccount.currency || 'XAF';
        let conversionRate = 1.0;
        let convertedAmount = transferAmount;
        if (sourceCurrencyCode !== destCurrencyCode) {
            const sourceCurrency = yield prisma_1.default.currency.findUnique({ where: { code: sourceCurrencyCode } });
            const destCurrency = yield prisma_1.default.currency.findUnique({ where: { code: destCurrencyCode } });
            const sourceRateToBase = sourceCurrency ? sourceCurrency.rateToBase : (sourceCurrencyCode === 'XAF' ? 1.0 : null);
            const destRateToBase = destCurrency ? destCurrency.rateToBase : (destCurrencyCode === 'XAF' ? 1.0 : null);
            if (sourceRateToBase === null || destRateToBase === null) {
                return res.status(400).json({ error: "Impossible de calculer le taux de change pour l'une des devises." });
            }
            // Convertir via la devise de base (XAF)
            conversionRate = sourceRateToBase / destRateToBase;
            convertedAmount = transferAmount * conversionRate;
        }
        // 5. Générer la référence commune pour lier les deux transactions
        const transferRef = `TR_REF_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
        const dateStr = new Date().toLocaleDateString('fr-FR').replace(/\//g, '-');
        // 6. Créer les deux transactions liées à l'état PENDING
        const result = yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            // Créer la transaction de sortie chez l'expéditeur
            const senderTx = yield tx.transaction.create({
                data: {
                    userId: sourceUser.id,
                    amount: -totalRequired,
                    currency: sourceCurrencyCode,
                    status: 'PENDING',
                    purpose: purpose || `Transfert vers ${destUser.firstName} ${destUser.lastName}`,
                    transactionRef: `${transferRef}_OUT`,
                    sourceAccountType,
                    targetAccountType: destAccountType,
                    createdBy: adminName,
                    createdById: adminId || null,
                    operation: {
                        type: "transfer_out",
                        code: `${transferRef}_OUT`,
                        reference: `${dateStr}.TR-OUT.${sourceUser.id}`,
                        amount: -transferAmount,
                        fee: fee,
                        feeRate: feeDetails.rate,
                        flatFee: feeDetails.flatFee,
                        totalAmount: -totalRequired,
                        date: new Date().toISOString(),
                        recipient: {
                            id: destUser.id,
                            firstName: destUser.firstName,
                            lastName: destUser.lastName,
                            accountNumber: destUser.accountNumber
                        },
                        exchangeRate: conversionRate,
                        convertedAmount: -convertedAmount,
                        destCurrency: destCurrencyCode,
                        transferRef: transferRef
                    }
                }
            });
            // Créer la transaction d'entrée chez le destinataire
            const recipientTx = yield tx.transaction.create({
                data: {
                    userId: destUser.id,
                    amount: convertedAmount,
                    currency: destCurrencyCode,
                    status: 'PENDING',
                    purpose: purpose || `Transfert reçu de ${sourceUser.firstName} ${sourceUser.lastName}`,
                    transactionRef: `${transferRef}_IN`,
                    sourceAccountType,
                    targetAccountType: destAccountType,
                    createdBy: adminName,
                    createdById: adminId || null,
                    operation: {
                        type: "transfer_in",
                        code: `${transferRef}_IN`,
                        reference: `${dateStr}.TR-IN.${destUser.id}`,
                        amount: convertedAmount,
                        date: new Date().toISOString(),
                        sender: {
                            id: sourceUser.id,
                            firstName: sourceUser.firstName,
                            lastName: sourceUser.lastName,
                            accountNumber: sourceUser.accountNumber
                        },
                        exchangeRate: conversionRate,
                        sourceAmount: transferAmount,
                        sourceCurrency: sourceCurrencyCode,
                        transferRef: transferRef
                    }
                }
            });
            return { senderTx, recipientTx };
        }));
        return res.status(200).json({
            message: "Opération soumise au COMEX avec succès.",
            data: result
        });
    }
    catch (error) {
        console.error('adminTransfer error:', error);
        return res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.adminTransfer = adminTransfer;
// Helper de calcul des frais de transfert
const calculateTransferFee = (amount, currency) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        let config = yield prisma_1.default.transferFeeConfig.findFirst({
            where: {
                currency: currency,
                isActive: true,
                minAmount: { lte: amount },
                maxAmount: { gte: amount }
            }
        });
        if (!config && currency !== 'XAF') {
            const srcCurrency = yield prisma_1.default.currency.findUnique({ where: { code: currency } });
            const srcRateToBase = srcCurrency ? srcCurrency.rateToBase : null;
            if (srcRateToBase !== null && srcRateToBase > 0) {
                const amountInBase = amount * srcRateToBase;
                const baseConfig = yield prisma_1.default.transferFeeConfig.findFirst({
                    where: {
                        currency: 'XAF',
                        isActive: true,
                        minAmount: { lte: amountInBase },
                        maxAmount: { gte: amountInBase }
                    }
                });
                if (baseConfig) {
                    const feeInBase = (amountInBase * baseConfig.rate / 100) + baseConfig.flatFee;
                    const feeInSource = feeInBase / srcRateToBase;
                    const flatFeeInSource = baseConfig.flatFee / srcRateToBase;
                    return {
                        fee: parseFloat(feeInSource.toFixed(4)),
                        rate: baseConfig.rate,
                        flatFee: parseFloat(flatFeeInSource.toFixed(4))
                    };
                }
            }
        }
        if (config) {
            const calculatedFee = (amount * config.rate / 100) + config.flatFee;
            return {
                fee: parseFloat(calculatedFee.toFixed(4)),
                rate: config.rate,
                flatFee: config.flatFee
            };
        }
        return { fee: 0, rate: 0, flatFee: 0 };
    }
    catch (error) {
        console.error('calculateTransferFee error:', error);
        return { fee: 0, rate: 0, flatFee: 0 };
    }
});
exports.calculateTransferFee = calculateTransferFee;
// CRUD TransferFeeConfig
const getTransferFees = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const fees = yield prisma_1.default.transferFeeConfig.findMany({
            orderBy: { minAmount: 'asc' }
        });
        res.json(fees);
    }
    catch (error) {
        console.error('getTransferFees error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.getTransferFees = getTransferFees;
const createTransferFee = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { minAmount, maxAmount, rate, flatFee, isActive } = req.body;
        const config = yield prisma_1.default.transferFeeConfig.create({
            data: {
                minAmount: parseFloat(minAmount),
                maxAmount: parseFloat(maxAmount),
                rate: parseFloat(rate),
                flatFee: flatFee ? parseFloat(flatFee) : 0,
                currency: 'XAF',
                isActive: isActive !== undefined ? Boolean(isActive) : true
            }
        });
        res.status(201).json(config);
    }
    catch (error) {
        console.error('createTransferFee error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.createTransferFee = createTransferFee;
const updateTransferFee = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { minAmount, maxAmount, rate, flatFee, isActive } = req.body;
        const config = yield prisma_1.default.transferFeeConfig.update({
            where: { id: id },
            data: {
                minAmount: minAmount !== undefined ? parseFloat(minAmount) : undefined,
                maxAmount: maxAmount !== undefined ? parseFloat(maxAmount) : undefined,
                rate: rate !== undefined ? parseFloat(rate) : undefined,
                flatFee: flatFee !== undefined ? parseFloat(flatFee) : undefined,
                currency: 'XAF',
                isActive: isActive !== undefined ? Boolean(isActive) : undefined
            }
        });
        res.json(config);
    }
    catch (error) {
        console.error('updateTransferFee error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.updateTransferFee = updateTransferFee;
const deleteTransferFee = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        yield prisma_1.default.transferFeeConfig.delete({
            where: { id: id }
        });
        res.json({ message: 'Configuration de frais supprimée' });
    }
    catch (error) {
        console.error('deleteTransferFee error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.deleteTransferFee = deleteTransferFee;

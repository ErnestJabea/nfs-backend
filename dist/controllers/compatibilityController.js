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
exports.assignCotisation = exports.getCotisationUsers = exports.getPrincipalNfs = exports.getProviderByCode = exports.getCotisations = void 0;
const prisma_1 = __importDefault(require("../utils/prisma"));
const requestAccess_1 = require("../utils/requestAccess");
const getCotisations = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const cotisations = yield prisma_1.default.cotisationGroup.findMany();
        const mapped = cotisations.map(c => {
            const rawMemberIds = Array.isArray(c.memberIds) ? c.memberIds : [];
            const memberIds = Array.from(new Set(rawMemberIds.map(id => String(id))));
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
            return Object.assign(Object.assign({}, c), { _id: c.id, status: isGroupActive ? 'ACTIF' : 'EN_ATTENTE', limit_participant: max, max_members: max, members_count: memberIds.length, nb_participant: memberIds.length, memberIds, next_payment_due: nextPaymentDue });
        });
        res.json({ data: mapped });
    }
    catch (error) {
        console.error('getCotisations error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.getCotisations = getCotisations;
const balanceService_1 = require("../services/balanceService");
const getProviderByCode = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { code } = req.params;
        const globalBalance = yield balanceService_1.BalanceService.getGlobalBalance();
        const accounts = [
            { id: "1", type: "PRINCIPAL", currentBalance: globalBalance.totalPrincipal || 0, availableBalance: globalBalance.totalPrincipal || 0, currency: "XAF" },
            { id: "2", type: "EPARGNE", currentBalance: globalBalance.totalSavings || 0, availableBalance: globalBalance.totalSavings || 0, currency: "XAF" }
        ];
        res.json({
            data: {
                id: "nfs-provider-id",
                name: "NFS",
                code: code,
                description: "National Financial System",
                isActive: true,
                accountList: accounts,
                accounts: accounts
            }
        });
    }
    catch (error) {
        console.error('getProviderByCode error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.getProviderByCode = getProviderByCode;
const getPrincipalNfs = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    res.json({ data: "0" });
});
exports.getPrincipalNfs = getPrincipalNfs;
const getCotisationUsers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const idCotisation = req.params.idCotisation;
        if (!idCotisation || !/^[0-9a-fA-F]{24}$/.test(idCotisation)) {
            return res.status(400).json({ error: "Invalid cotisation ID format" });
        }
        const group = yield prisma_1.default.cotisationGroup.findUnique({
            where: { id: idCotisation },
            include: {
                members: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                    }
                }
            }
        });
        if (!group) {
            return res.status(404).json({ error: "Cotisation group not found" });
        }
        const requesterId = (0, requestAccess_1.getRequestUserId)(req);
        if (!requesterId || (!(0, requestAccess_1.requestIsAdmin)(req) && !group.memberIds.includes(requesterId))) {
            return res.status(403).json({ error: 'Acces refuse aux membres de cette cotisation.' });
        }
        res.json({ data: group.members });
    }
    catch (error) {
        console.error('getCotisationUsers error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.getCotisationUsers = getCotisationUsers;
const assignCotisation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.params.userId;
        const idCotisation = req.query.idCotisation;
        if (!userId || !/^[0-9a-fA-F]{24}$/.test(userId)) {
            return res.status(400).json({ error: "Invalid user ID format" });
        }
        if (!idCotisation || !/^[0-9a-fA-F]{24}$/.test(idCotisation)) {
            return res.status(400).json({ error: "Invalid cotisation ID format" });
        }
        if (!(0, requestAccess_1.canAccessUser)(req, userId)) {
            return res.status(403).json({ error: "Acces refuse a cet utilisateur." });
        }
        const currentGroup = yield prisma_1.default.cotisationGroup.findUnique({ where: { id: idCotisation } });
        if (!currentGroup) {
            return res.status(404).json({ error: "Groupe de cotisation introuvable." });
        }
        const rawMemberIds = Array.isArray(currentGroup.memberIds) ? currentGroup.memberIds : [];
        const memberIds = Array.from(new Set(rawMemberIds.map(id => String(id))));
        const max = currentGroup.maxParticipants || currentGroup.limit_participant || 10;
        if (memberIds.includes(userId)) {
            return res.status(409).json({ error: "L'utilisateur fait deja partie de cette cotisation." });
        }
        if (memberIds.length >= max) {
            return res.status(409).json({ error: "Ce groupe de cotisation est deja complet." });
        }
        const updatedMemberIds = [...memberIds, userId];
        const newStatus = updatedMemberIds.length >= max ? 'ACTIF' : 'EN_ATTENTE';
        const group = yield prisma_1.default.cotisationGroup.update({
            where: { id: idCotisation },
            data: {
                memberIds: updatedMemberIds,
                nb_participant: updatedMemberIds.length,
                status: newStatus,
            }
        });
        res.json({ message: "Successfully assigned to cotisation", data: group });
    }
    catch (error) {
        console.error('assignCotisation error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.assignCotisation = assignCotisation;

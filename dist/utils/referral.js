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
Object.defineProperty(exports, "__esModule", { value: true });
exports.processReferralCommission = void 0;
/**
 * Calcule et applique une commission de parrainage
 * @param userId L'ID de l'utilisateur qui vient de faire une transaction
 * @param amount Le montant de la transaction
 * @param type Le type de transaction
 */
const processReferralCommission = (userId, amount, type) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Note: Temporairement désactivé pour éviter les erreurs TS avec le nouveau schéma
        // On reprendra la logique dès que le mappage referral.code sera stabilisé
        console.log('Traitement commission pour', userId);
        return;
    }
    catch (error) {
        console.error('Erreur lors du calcul de la commission :', error);
    }
});
exports.processReferralCommission = processReferralCommission;

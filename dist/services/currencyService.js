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
exports.initCurrencyJob = exports.updateExchangeRates = void 0;
const axios_1 = __importDefault(require("axios"));
const client_1 = require("@prisma/client");
const node_cron_1 = __importDefault(require("node-cron"));
const prisma = new client_1.PrismaClient();
const EXCHANGE_API_URL = 'https://open.er-api.com/v6/latest/XAF';
const updateExchangeRates = () => __awaiter(void 0, void 0, void 0, function* () {
    console.log('[CurrencyService] Mise à jour des taux de change...');
    try {
        const response = yield axios_1.default.get(EXCHANGE_API_URL);
        if (!response.data || response.data.result === 'error') {
            throw new Error('Erreur API Taux de change');
        }
        const rates = response.data.rates; // Rates relative to XAF (1 XAF = X Currency)
        // Actually the API returns: 1 XAF = rates[CURRENCY]
        // So if we want to know how many XAF is 1 USD: 1 / rates['USD']
        const activeCurrencies = yield prisma.currency.findMany({
            where: { isActive: true }
        });
        for (const currency of activeCurrencies) {
            if (currency.code === 'XAF') {
                yield prisma.currency.update({
                    where: { code: 'XAF' },
                    data: { rateToBase: 1.0, lastUpdated: new Date() }
                });
                continue;
            }
            const rateToXaf = rates[currency.code];
            if (rateToXaf) {
                // We store the rate: 1 unit of currency = X units of XAF
                // If 1 XAF = 0.0016 USD, then 1 USD = 1 / 0.0016 XAF = 625 XAF
                const valueInBase = 1 / rateToXaf;
                yield prisma.currency.update({
                    where: { code: currency.code },
                    data: {
                        rateToBase: valueInBase,
                        lastUpdated: new Date()
                    }
                });
                console.log(`[CurrencyService] Taux mis à jour : 1 ${currency.code} = ${valueInBase.toFixed(2)} XAF`);
            }
        }
        console.log('[CurrencyService] Synchronisation terminée.');
    }
    catch (error) {
        console.error('[CurrencyService] Erreur lors de la mise à jour des taux:', error);
    }
});
exports.updateExchangeRates = updateExchangeRates;
// Planifier la mise à jour tous les jours à minuit
const initCurrencyJob = () => {
    // Puis tous les jours à minuit
    node_cron_1.default.schedule('0 0 * * *', () => {
        (0, exports.updateExchangeRates)();
    });
};
exports.initCurrencyJob = initCurrencyJob;

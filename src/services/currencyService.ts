import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import cron from 'node-cron';

const prisma = new PrismaClient();

const EXCHANGE_API_URL = 'https://open.er-api.com/v6/latest/XAF';

export const updateExchangeRates = async () => {
  console.log('[CurrencyService] Mise à jour des taux de change...');
  try {
    const response = await axios.get(EXCHANGE_API_URL);
    if (!response.data || response.data.result === 'error') {
      throw new Error('Erreur API Taux de change');
    }

    const rates = response.data.rates; // Rates relative to XAF (1 XAF = X Currency)
    // Actually the API returns: 1 XAF = rates[CURRENCY]
    // So if we want to know how many XAF is 1 USD: 1 / rates['USD']

    const activeCurrencies = await prisma.currency.findMany({
      where: { isActive: true }
    });

    for (const currency of activeCurrencies) {
      if (currency.code === 'XAF') {
        await prisma.currency.update({
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
        
        await prisma.currency.update({
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
  } catch (error) {
    console.error('[CurrencyService] Erreur lors de la mise à jour des taux:', error);
  }
};

// Planifier la mise à jour tous les jours à minuit
export const initCurrencyJob = () => {
  // Puis tous les jours à minuit
  cron.schedule('0 0 * * *', () => {
    updateExchangeRates();
  });
};


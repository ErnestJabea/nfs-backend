import { updateExchangeRates } from './src/services/currencyService';

async function run() {
  await updateExchangeRates();
  process.exit(0);
}

run();

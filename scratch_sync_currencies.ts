import { updateExchangeRates } from './src/services/currencyService';

async function main() {
  try {
    await updateExchangeRates();
    console.log('Manual sync successful.');
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}

main();

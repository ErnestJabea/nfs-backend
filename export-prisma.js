const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();
const outputPath = path.join(__dirname, 'prod-export.json');

async function main() {
  console.log('Export Prisma démarré...');

  const data = {
    users: await prisma.user.findMany(),
    transactions: await prisma.transaction.findMany(),
    loans: await prisma.loan.findMany(),
    accounts: await prisma.account.findMany(),
    cotisationGroups: await prisma.cotisationGroup.findMany(),
    currencies: await prisma.currency.findMany(),
    userGroups: await prisma.userGroup.findMany(),
    loanConfigs: await prisma.loanConfig.findMany(),
    passwordResets: await prisma.passwordReset.findMany(),
    systemBalances: await prisma.systemBalance.findMany(),
  };

  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`Export terminé : ${outputPath}`);
}

main()
  .catch((error) => {
    console.error('Erreur pendant l\'export Prisma :', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

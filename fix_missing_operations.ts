import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Migration des transactions sans opération ---');
  
  // prisma does not easily support checking for undefined/null json fields via typical queries on older Prisma versions,
  // but we can retrieve all transactions and filter them in JavaScript, or fetch using raw query if needed.
  // Since we have a small dataset (around a few hundreds of transactions), fetching them is fast and extremely safe.
  const transactions = await prisma.transaction.findMany();
  
  let count = 0;
  for (const t of transactions) {
    // Check if operation is null, undefined, or an empty object
    const op = t.operation as any;
    if (!op || Object.keys(op).length === 0) {
      const accountType = t.targetAccountType || 'PRINCIPAL';
      const upperType = accountType.toUpperCase();
      let opType = 'deposit';
      
      const txTime = t.createdAt ? t.createdAt.getTime() : Date.now();
      let opCode = `DEPOT_${accountType}_${txTime}`;
      let opName = `Dépôt ${accountType}`;
      
      if (upperType === 'EPARGNE') {
        opType = 'epargne';
        opCode = `EPARGNE_${txTime}`;
        opName = 'Dépôt Épargne';
      } else if (upperType === 'CAUTION') {
        opType = 'caution';
        opCode = `CAUTION_${txTime}`;
        opName = 'Dépôt Caution';
      } else if (upperType === 'CREDIT' || upperType === 'PRET') {
        opType = 'credit';
        opCode = `EMPRUNT_${txTime}`;
        opName = 'Déblocage Crédit';
      } else if (upperType === 'PRINCIPAL') {
        opType = 'principal';
        opCode = `DEPOT_WALLET_${txTime}`;
        opName = 'Dépôt Wallet';
      } else if (upperType === 'PARRAINAGE') {
        opType = 'parrainage';
        opCode = `PARRAINAGE_${txTime}`;
        opName = 'Dépôt Parrainage';
      } else if (upperType.includes('DJANGUI')) {
        opType = 'djangui';
        opCode = `DJANGUI_${txTime}`;
        opName = 'Dépôt Djangui';
      }
      
      const reference = `MIG-${t.id.substring(18)}`;
      
      console.log(`Mise à jour transaction ${t.id} - Montant: ${t.amount} - Type: ${accountType}`);
      
      await prisma.transaction.update({
        where: { id: t.id },
        data: {
          purpose: t.purpose || opName,
          operation: {
            type: opType,
            code: opCode,
            reference,
            amount: t.amount || 0,
            date: t.createdAt ? t.createdAt.toISOString() : new Date().toISOString()
          }
        }
      });
      count++;
    }
  }
  
  console.log(`Migration terminée. ${count} transactions ont été mises à jour.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
});

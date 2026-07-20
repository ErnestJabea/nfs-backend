require('dotenv/config');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const entries = (value) => Array.isArray(value) ? value : [];
const coveredAmount = (avalistes) => entries(avalistes)
  .reduce((total, avaliste) => total + Math.max(0, Number(avaliste?.amount || 0)), 0);

async function run() {
  const loans = await prisma.loan.findMany({
    where: {
      OR: [
        { transactionId: null },
        { transactionId: { isSet: false } },
      ],
      status: { in: ['PENDING', 'VALIDATED', 'CONFIRMED'] },
    },
    orderBy: { createdAt: 'asc' },
  });

  const results = [];
  for (const loan of loans) {
    const avalistes = entries(loan.avalistes);
    const amountEndorsed = coveredAmount(avalistes);
    const transactionStatus = loan.status === 'CONFIRMED'
      ? 'CONFIRMED'
      : amountEndorsed >= Number(loan.amount || 0)
        ? 'VALIDATED'
        : 'PENDING';
    const transactionRef = `LOAN-MIG-${loan.id}`;

    const transaction = await prisma.$transaction(async (db) => {
      const linkedTransaction = await db.transaction.upsert({
        where: { transactionRef },
        create: {
          userId: loan.userId,
          purpose: `CREDIT - ${loan.purpose || 'Credit NFS'}`,
          amount: loan.amount,
          status: transactionStatus,
          transactionRef,
          targetAccountType: 'CREDIT',
          currency: 'XAF',
          createdBy: loan.createdBy || 'Migration credits historiques',
          createdById: loan.createdById || null,
          validatedBy: loan.validatedBy || [],
          operation: {
            type: 'loan_request_migrated',
            legacyLoanId: loan.id,
            durationMonths: loan.duration,
            avalistes,
            amountEndorsed,
            migratedAt: new Date().toISOString(),
          },
          createdAt: loan.createdAt || new Date(),
        },
        update: {},
      });
      await db.loan.update({ where: { id: loan.id }, data: { transactionId: linkedTransaction.id } });
      return linkedTransaction;
    });

    results.push({ loanId: loan.id, transactionId: transaction.id, status: transaction.status });
  }

  console.log('Loan transaction backfill completed.', {
    matched: loans.length,
    linked: results.length,
    pendingForGuarantee: results.filter(result => result.status === 'PENDING').length,
  });
}

run()
  .catch((error) => {
    console.error('Loan transaction backfill failed:', error instanceof Error ? error.message : 'unknown error');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

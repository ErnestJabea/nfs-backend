import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  try {
    const defaultPassword = 'password';
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);
    
    const usersToImport = [
      { firstName: 'ATEMENGUE', lastName: 'PIERRE', matricule: '588356-J', profession: 'AGENT', service: 'DAF', phone: '+237600000016' },
      { firstName: 'ATIM', lastName: 'MARIE', matricule: '588359-K', profession: 'AGENT', service: 'DAF', phone: '+237600000017' },
      { firstName: 'AVOMO', lastName: 'JEANNE', matricule: '588362-L', profession: 'AGENT', service: 'DAF', phone: '+237600000018' },
      { firstName: 'AWONO', lastName: 'SIMON', matricule: '588365-M', profession: 'AGENT', service: 'DAF', phone: '+237600000019' },
      { firstName: 'AZIZ', lastName: 'HAMADOU', matricule: '588368-N', profession: 'AGENT', service: 'DAF', phone: '+237600000020' },
      { firstName: 'BADANG', lastName: 'THERESE', matricule: '588371-O', profession: 'AGENT', service: 'DAF', phone: '+237600000021' },
      { firstName: 'BAH', lastName: 'ALIOU', matricule: '588374-P', profession: 'AGENT', service: 'DAF', phone: '+237600000022' },
      { firstName: 'BALLA', lastName: 'JOSEPH', matricule: '588377-Q', profession: 'AGENT', service: 'DAF', phone: '+237600000023' },
      { firstName: 'BANA', lastName: 'CELESTIN', matricule: '588380-R', profession: 'AGENT', service: 'DAF', phone: '+237600000024' },
      { firstName: 'BEKOLO', lastName: 'MARTIN', matricule: '588383-S', profession: 'AGENT', service: 'DAF', phone: '+237600000025' },
      { firstName: 'BELINGA', lastName: 'JEAN', matricule: '588386-T', profession: 'AGENT', service: 'DAF', phone: '+237600000026' },
      { firstName: 'BELLO', lastName: 'HAMAN', matricule: '588389-U', profession: 'AGENT', service: 'DAF', phone: '+237600000027' },
      { firstName: 'BENGONO', lastName: 'PAUL', matricule: '588392-V', profession: 'AGENT', service: 'DAF', phone: '+237600000028' },
      { firstName: 'BESSALA', lastName: 'MARC', matricule: '588395-W', profession: 'AGENT', service: 'DAF', phone: '+237600000029' },
      { firstName: 'BEYALA', lastName: 'ANNE', matricule: '588398-X', profession: 'AGENT', service: 'DAF', phone: '+237600000030' },
      { firstName: 'BILOA', lastName: 'MARIE', matricule: '588401-Y', profession: 'AGENT', service: 'DAF', phone: '+237600000031' },
      { firstName: 'BIYONG', lastName: 'JOSEPH', matricule: '588404-Z', profession: 'AGENT', service: 'DAF', phone: '+237600000032' },
      { firstName: 'BONA', lastName: 'SAMUEL', matricule: '588407-A', profession: 'AGENT', service: 'DAF', phone: '+237600000033' },
      { firstName: 'BONG', lastName: 'JEAN', matricule: '588410-B', profession: 'AGENT', service: 'DAF', phone: '+237600000034' },
      { firstName: 'BOUBA', lastName: 'HAMAN', matricule: '588413-C', profession: 'AGENT', service: 'DAF', phone: '+237600000035' },
      { firstName: 'BOUM', lastName: 'PAUL', matricule: '588416-D', profession: 'AGENT', service: 'DAF', phone: '+237600000036' },
      { firstName: 'BOUPDA', lastName: 'CHARLES', matricule: '588419-E', profession: 'AGENT', service: 'DAF', phone: '+237600000037' },
      { firstName: 'CHEDOM', lastName: 'MARCEL', matricule: '588422-F', profession: 'AGENT', service: 'DAF', phone: '+237600000038' },
      { firstName: 'CHEGUE', lastName: 'JEAN', matricule: '588425-G', profession: 'AGENT', service: 'DAF', phone: '+237600000039' },
      { firstName: 'CHETCHOU', lastName: 'PAUL', matricule: '588428-H', profession: 'AGENT', service: 'DAF', phone: '+237600000040' },
      { firstName: 'CHIMI', lastName: 'RENE', matricule: '588431-I', profession: 'AGENT', service: 'DAF', phone: '+237600000041' },
      { firstName: 'CHOUAIBOU', lastName: 'HAMAN', matricule: '588434-J', profession: 'AGENT', service: 'DAF', phone: '+237600000042' },
      { firstName: 'DAGUE', lastName: 'JEAN', matricule: '588437-K', profession: 'AGENT', service: 'DAF', phone: '+237600000043' },
      { firstName: 'DAMBA', lastName: 'PAUL', matricule: '588440-L', profession: 'AGENT', service: 'DAF', phone: '+237600000044' },
      { firstName: 'DANG', lastName: 'MARC', matricule: '588443-M', profession: 'AGENT', service: 'DAF', phone: '+237600000045' }
    ];

    const defaultAccountTypes = [
      'PRINCIPAL', 'CAUTION', 'EPARGNE', 'CREDIT', 'PRET', 
      'CREDIT_AVALISE', 'PARRAINAGE', 'AVALISE', 'DJANGUI_NON_PERCU', 'DJANGUI_PERCU'
    ];

    console.log(`Starting second batch import of ${usersToImport.length} users...`);

    for (const userData of usersToImport) {
      try {
        const existing = await prisma.user.findFirst({
          where: {
            OR: [
              { phone: userData.phone },
              { matricule: userData.matricule }
            ]
          }
        });

        if (existing) {
          console.log(`User ${userData.firstName} ${userData.lastName} already exists, skipping.`);
          continue;
        }

        const createdAccounts = await Promise.all(defaultAccountTypes.map(type => 
          prisma.account.create({
            data: {
              type,
              currentBalance: 0,
              availableBalance: 0,
              currency: 'XAF'
            }
          })
        ));

        const accountIds = createdAccounts.map(a => a.id);

        const user = await prisma.user.create({
          data: {
            firstName: userData.firstName,
            lastName: userData.lastName,
            phone: userData.phone,
            email: `${userData.matricule.toLowerCase()}@nfs.cm`,
            matricule: userData.matricule,
            service: userData.service,
            profession: userData.profession,
            password: hashedPassword,
            roles: ['CLIENT'],
            activated: true,
            verified: true,
            accountIds: accountIds
          }
        });

        console.log(`Successfully imported: ${user.firstName} ${user.lastName} (Matricule: ${user.matricule})`);
      } catch (error) {
        console.error(`Failed to import ${userData.firstName} ${userData.lastName}:`, error);
      }
    }

    console.log('Import finished.');
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

main();

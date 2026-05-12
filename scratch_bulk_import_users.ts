import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  try {
    const defaultPassword = 'password';
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);
    
    const usersToImport = [
      { firstName: 'JACQUES', lastName: 'ABA EBONGUE', matricule: '585504-H', profession: 'TECHNICIEN', service: 'DAF', phone: '+237600000001' },
      { firstName: 'JACQUES', lastName: 'ABANDA', matricule: '543477-M', profession: 'CADRE', service: 'CABINET PCA', phone: '+237600000002' },
      { firstName: 'CATHERINE', lastName: 'ABBE', matricule: '588320-P', profession: 'SECRETAIRE', service: 'DAF', phone: '+237600000003' },
      { firstName: "EVE'E", lastName: 'ABESSOLO', matricule: '585507-X', profession: 'CHAUFFEUR', service: 'DAF', phone: '+237600000004' },
      { firstName: 'JEAN PIERRE', lastName: 'ABOH', matricule: '588323-Y', profession: 'PLOMBIER', service: 'DAF', phone: '+237600000005' },
      { firstName: 'ADEDJOUMA', lastName: 'AURELIE', matricule: '588326-Z', profession: 'AGENT', service: 'DAF', phone: '+237600000006' },
      { firstName: 'AGHANG', lastName: 'BERNARD', matricule: '588329-A', profession: 'AGENT', service: 'DAF', phone: '+237600000007' },
      { firstName: 'AKAME', lastName: 'SAMUEL', matricule: '588332-B', profession: 'AGENT', service: 'DAF', phone: '+237600000008' },
      { firstName: 'AKOA', lastName: 'ROGER', matricule: '588335-C', profession: 'AGENT', service: 'DAF', phone: '+237600000009' },
      { firstName: 'AKONO', lastName: 'MARIE', matricule: '588338-D', profession: 'AGENT', service: 'DAF', phone: '+237600000010' },
      { firstName: 'AMOUGOU', lastName: 'JOSEPH', matricule: '588341-E', profession: 'AGENT', service: 'DAF', phone: '+237600000011' },
      { firstName: 'ANGUE', lastName: 'ELISE', matricule: '588344-F', profession: 'AGENT', service: 'DAF', phone: '+237600000012' },
      { firstName: 'ASSAM', lastName: 'JEAN', matricule: '588347-G', profession: 'AGENT', service: 'DAF', phone: '+237600000013' },
      { firstName: 'ASSAN', lastName: 'PAUL', matricule: '588350-H', profession: 'AGENT', service: 'DAF', phone: '+237600000014' },
      { firstName: 'ASSOUMOU', lastName: 'RENE', matricule: '588353-I', profession: 'AGENT', service: 'DAF', phone: '+237600000015' }
    ];

    const defaultAccountTypes = [
      'PRINCIPAL', 'CAUTION', 'EPARGNE', 'CREDIT', 'PRET', 
      'CREDIT_AVALISE', 'PARRAINAGE', 'AVALISE', 'DJANGUI_NON_PERCU', 'DJANGUI_PERCU'
    ];

    console.log(`Starting import of ${usersToImport.length} users...`);

    for (const userData of usersToImport) {
      try {
        // Check if user already exists
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
            email: `${userData.matricule.toLowerCase()}@nfs.cm`, // Unique email to avoid index issues
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

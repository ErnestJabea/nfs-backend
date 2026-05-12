export const computeAvalise = (accounts: any[]) => {
  const getBalance = (type: string) => accounts.find(a => a.type === type)?.currentBalance || 0;
  
  const epargne = getBalance('EPARGNE');
  // Le Njangui non perçu est la totalité des cagnottes attendues
  const djanguiNonPercu = getBalance('DJANGUI_NON_PERCU');
  
  const credit = getBalance('CREDIT');
  const pret = getBalance('PRET');
  const creditAvalise = getBalance('CREDIT_AVALISE');
  const parrainage = getBalance('PARRAINAGE');
  
  const avaliseValue = (epargne + djanguiNonPercu) - (credit + pret + creditAvalise + parrainage);
  
  const avaliseAcc = accounts.find(a => a.type === 'AVALISE');
  if (avaliseAcc) {
    avaliseAcc.currentBalance = avaliseValue;
    avaliseAcc.availableBalance = avaliseValue;
  } else {
    accounts.push({
      type: 'AVALISE',
      currentBalance: avaliseValue,
      availableBalance: avaliseValue,
      currency: 'XAF',
      isVirtual: true
    });
  }
  return accounts;
};

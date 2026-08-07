"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeAvalise = void 0;
const computeAvalise = (accounts) => {
    const getBalance = (type) => { var _a; return ((_a = accounts.find(a => a.type === type)) === null || _a === void 0 ? void 0 : _a.currentBalance) || 0; };
    const epargne = getBalance('EPARGNE');
    // Le Njangui non perçu est la totalité des cagnottes attendues
    const djanguiNonPercu = getBalance('DJANGUI_NON_PERCU') || getBalance('DJANGUI_NONPERCU');
    const credit = getBalance('CREDIT');
    const pret = getBalance('PRET');
    const creditAvalise = getBalance('CREDIT_AVALISE');
    const parrainage = getBalance('PARRAINAGE');
    // La capacité ne peut pas être négative (règle métier)
    const avaliseValue = Math.max(0, (epargne + djanguiNonPercu) - (credit + pret + creditAvalise + parrainage));
    const avaliseAcc = accounts.find(a => a.type === 'AVALISE');
    if (avaliseAcc) {
        avaliseAcc.currentBalance = avaliseValue;
        avaliseAcc.availableBalance = avaliseValue;
    }
    else {
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
exports.computeAvalise = computeAvalise;

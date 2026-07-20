export const guaranteeEntries = (...candidates: unknown[]): any[] => {
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
};

export const guaranteeAmountEndorsed = (operation: any, loanAvalistes?: unknown): number => {
  const explicitAmount = Number(operation?.amountEndorsed);
  if (Number.isFinite(explicitAmount) && explicitAmount >= 0) return explicitAmount;
  return guaranteeEntries(operation?.avalistes, operation?.avaliste, loanAvalistes)
    .reduce((total, entry) => total + Math.max(0, Number(entry?.amount || 0)), 0);
};

export const isGuaranteeActorAuthorized = (input: {
  guarantorId: string;
  borrowerId: string;
  borrowerReferrerId?: string | null;
  avalistes: unknown;
}) => {
  if (!input.guarantorId || input.guarantorId === input.borrowerId) return false;
  if (input.borrowerReferrerId === input.guarantorId) return true;
  return guaranteeEntries(input.avalistes)
    .some(entry => String(entry?.userId || '') === input.guarantorId);
};

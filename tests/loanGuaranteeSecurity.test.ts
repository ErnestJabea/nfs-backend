/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  guaranteeAmountEndorsed,
  guaranteeEntries,
  isGuaranteeActorAuthorized,
} from '../src/services/loanGuaranteeService';

test('authorizes only a direct referrer or an explicitly assigned guarantor', () => {
  const avalistes = [{ userId: 'assigned-user', amount: 20_000 }];
  assert.equal(isGuaranteeActorAuthorized({ guarantorId: 'referrer', borrowerId: 'borrower', borrowerReferrerId: 'referrer', avalistes }), true);
  assert.equal(isGuaranteeActorAuthorized({ guarantorId: 'assigned-user', borrowerId: 'borrower', borrowerReferrerId: null, avalistes }), true);
  assert.equal(isGuaranteeActorAuthorized({ guarantorId: 'stranger', borrowerId: 'borrower', borrowerReferrerId: 'referrer', avalistes }), false);
  assert.equal(isGuaranteeActorAuthorized({ guarantorId: 'borrower', borrowerId: 'borrower', borrowerReferrerId: 'borrower', avalistes }), false);
});

test('uses the explicit endorsed amount and safely falls back to guarantor entries', () => {
  const avalistes = [{ userId: 'a', amount: 46_955 }, { userId: 'b', amount: -50 }];
  assert.equal(guaranteeAmountEndorsed({ amountEndorsed: 12_345 }, avalistes), 12_345);
  assert.equal(guaranteeAmountEndorsed({}, avalistes), 46_955);
  assert.deepEqual(guaranteeEntries(undefined, avalistes), avalistes);
});

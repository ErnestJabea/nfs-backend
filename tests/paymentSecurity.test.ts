import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  assertProviderAvailable,
  getPaymentProviderAvailability,
  isValidFlutterwaveSignature,
} from '../src/services/paymentProviderService';

const paymentEnvironmentKeys = [
  'FLW_PAYMENTS_ENABLED',
  'FLW_SECRET_KEY',
  'FLW_SECRET_HASH',
  'STRIPE_PAYMENTS_ENABLED',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
] as const;

const withCleanPaymentEnvironment = (callback: () => void) => {
  const previous = Object.fromEntries(paymentEnvironmentKeys.map((key) => [key, process.env[key]]));
  paymentEnvironmentKeys.forEach((key) => delete process.env[key]);
  try {
    callback();
  } finally {
    paymentEnvironmentKeys.forEach((key) => {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    });
  }
};

test('payment providers remain disabled until every required server secret is configured', () => {
  withCleanPaymentEnvironment(() => {
    let availability = getPaymentProviderAvailability();
    assert.equal(availability.providers.FLUTTERWAVE.enabled, false);
    assert.equal(availability.providers.STRIPE.enabled, false);

    process.env.FLW_PAYMENTS_ENABLED = 'true';
    process.env.FLW_SECRET_KEY = 'FLWSECK_TEST-example';
    assert.equal(getPaymentProviderAvailability().providers.FLUTTERWAVE.enabled, false);

    process.env.FLW_SECRET_HASH = 'a-strong-webhook-secret';
    availability = getPaymentProviderAvailability();
    assert.equal(availability.providers.FLUTTERWAVE.enabled, true);
    assert.deepEqual(assertProviderAvailable('flutterwave', 'orange_money'), {
      provider: 'FLUTTERWAVE',
      method: 'ORANGE_MONEY',
    });
  });
});

test('Flutterwave HMAC and legacy webhook signatures reject altered values', () => {
  withCleanPaymentEnvironment(() => {
    process.env.FLW_SECRET_HASH = 'test-webhook-secret-with-sufficient-entropy';
    const body = Buffer.from('{"event":"charge.completed","data":{"id":42}}');
    const signature = crypto
      .createHmac('sha256', process.env.FLW_SECRET_HASH)
      .update(body)
      .digest('base64');

    assert.equal(isValidFlutterwaveSignature(body, signature, undefined), true);
    assert.equal(isValidFlutterwaveSignature(Buffer.concat([body, Buffer.from(' ')]), signature, undefined), false);
    assert.equal(isValidFlutterwaveSignature(body, undefined, process.env.FLW_SECRET_HASH), true);
    assert.equal(isValidFlutterwaveSignature(body, undefined, 'incorrect-secret'), false);
  });
});

test('Stripe only exposes card payments when its server configuration is complete', () => {
  withCleanPaymentEnvironment(() => {
    process.env.STRIPE_PAYMENTS_ENABLED = 'true';
    process.env.STRIPE_SECRET_KEY = 'sk_test_example';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_example';

    assert.deepEqual(assertProviderAvailable('stripe', 'card'), {
      provider: 'STRIPE',
      method: 'CARD',
    });
    assert.throws(
      () => assertProviderAvailable('stripe', 'mtn_momo'),
      (error: any) => error?.code === 'PAYMENT_METHOD_UNAVAILABLE',
    );
  });
});

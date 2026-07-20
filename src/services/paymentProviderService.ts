import crypto from 'crypto';
import axios from 'axios';
import Stripe from 'stripe';

export type PaymentProvider = 'FLUTTERWAVE' | 'STRIPE';
export type PaymentMethod = 'CARD' | 'ORANGE_MONEY' | 'MTN_MOMO';

type PaymentRecord = {
  reference: string;
  provider: string;
  method: string;
  amount: number;
  currency: string;
  targetAccountType: string;
};

type PaymentCustomer = {
  id: string;
  email: string | null;
  phone: string;
  firstName: string | null;
  lastName: string | null;
};

export type ProviderCheckout = {
  checkoutUrl?: string;
  providerSessionId?: string;
  providerPaymentId?: string;
  providerStatus: string;
  instructions?: string;
};

export type VerifiedProviderPayment = {
  reference: string;
  amount: number;
  currency: string;
  status: string;
  providerSessionId?: string;
  providerPaymentId?: string;
};

export class PaymentProviderError extends Error {
  status: number;
  code: string;

  constructor(message: string, code = 'PAYMENT_PROVIDER_ERROR', status = 502) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const enabled = (value: unknown) => String(value || '').toLowerCase() === 'true';

export const getPaymentProviderAvailability = () => ({
  environment: String(process.env.PAYMENTS_ENVIRONMENT || 'sandbox').toLowerCase(),
  providers: {
    FLUTTERWAVE: {
      enabled: enabled(process.env.FLW_PAYMENTS_ENABLED)
        && Boolean(process.env.FLW_SECRET_KEY)
        && Boolean(process.env.FLW_SECRET_HASH),
      methods: ['CARD', 'ORANGE_MONEY', 'MTN_MOMO'],
    },
    STRIPE: {
      enabled: enabled(process.env.STRIPE_PAYMENTS_ENABLED)
        && Boolean(process.env.STRIPE_SECRET_KEY)
        && Boolean(process.env.STRIPE_WEBHOOK_SECRET),
      methods: ['CARD'],
    },
  },
});

export const assertProviderAvailable = (providerValue: unknown, methodValue: unknown) => {
  const provider = String(providerValue || '').toUpperCase() as PaymentProvider;
  const method = String(methodValue || '').toUpperCase() as PaymentMethod;
  const availability = getPaymentProviderAvailability();
  const configuration = availability.providers[provider];

  if (!configuration || !configuration.enabled) {
    throw new PaymentProviderError('Ce prestataire de paiement n’est pas configure.', 'PAYMENT_PROVIDER_UNAVAILABLE', 503);
  }
  if (!(configuration.methods as string[]).includes(method)) {
    throw new PaymentProviderError('Ce moyen de paiement n’est pas disponible avec ce prestataire.', 'PAYMENT_METHOD_UNAVAILABLE', 400);
  }
  return { provider, method };
};

const safeEqual = (leftValue: unknown, rightValue: unknown) => {
  const left = Buffer.from(String(leftValue || ''), 'utf8');
  const right = Buffer.from(String(rightValue || ''), 'utf8');
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
};

export const isValidFlutterwaveSignature = (
  rawBody: Buffer,
  signature: unknown,
  legacyHash: unknown,
) => {
  const secretHash = process.env.FLW_SECRET_HASH || '';
  if (!secretHash) return false;
  if (signature) {
    const expected = crypto.createHmac('sha256', secretHash).update(rawBody).digest('base64');
    return safeEqual(signature, expected);
  }
  return safeEqual(legacyHash, secretHash);
};

const stripeClient = () => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new PaymentProviderError('Stripe n’est pas configure.', 'PAYMENT_PROVIDER_UNAVAILABLE', 503);
  return new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 15_000 });
};

export const constructStripeEvent = (rawBody: Buffer, signature: string) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) throw new PaymentProviderError('Webhook Stripe non configure.', 'PAYMENT_WEBHOOK_UNAVAILABLE', 503);
  return stripeClient().webhooks.constructEvent(rawBody, signature, webhookSecret);
};

const paymentReturnUrl = (provider: PaymentProvider, reference: string, state: 'return' | 'cancel') => {
  const configured = process.env.PAYMENT_RETURN_URL || 'http://localhost:5173/funding';
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new PaymentProviderError('URL de retour de paiement invalide.', 'PAYMENT_CONFIGURATION_ERROR', 500);
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new PaymentProviderError('L’URL de retour doit utiliser HTTPS.', 'PAYMENT_CONFIGURATION_ERROR', 500);
  }
  url.searchParams.set('provider', provider.toLowerCase());
  url.searchParams.set('reference', reference);
  url.searchParams.set('payment_state', state);
  return url.toString();
};

const checkedCheckoutUrl = (value: unknown, provider: PaymentProvider) => {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    throw new PaymentProviderError('Le prestataire a retourne une URL invalide.', 'INVALID_PROVIDER_RESPONSE');
  }
  const host = url.hostname.toLowerCase();
  const allowed = provider === 'STRIPE'
    ? host === 'checkout.stripe.com' || host.endsWith('.stripe.com')
    : host === 'checkout.flutterwave.com' || host.endsWith('.flutterwave.com') || host.endsWith('.flutterwave.cloud');
  if (url.protocol !== 'https:' || !allowed) {
    throw new PaymentProviderError('Le prestataire a retourne une destination non autorisee.', 'INVALID_PROVIDER_RESPONSE');
  }
  return url.toString();
};

const flutterwaveHeaders = () => ({
  Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
  'Content-Type': 'application/json',
});

const createFlutterwaveCheckout = async (payment: PaymentRecord, customer: PaymentCustomer): Promise<ProviderCheckout> => {
  if (!customer.email) {
    throw new PaymentProviderError('Une adresse email verifiee est requise pour ce paiement.', 'PAYMENT_EMAIL_REQUIRED', 400);
  }

  try {
    if (payment.method === 'CARD') {
      const response = await axios.post('https://api.flutterwave.com/v3/payments', {
        tx_ref: payment.reference,
        amount: payment.amount,
        currency: payment.currency,
        redirect_url: paymentReturnUrl('FLUTTERWAVE', payment.reference, 'return'),
        payment_options: 'card',
        customer: {
          email: customer.email,
          phonenumber: customer.phone,
          name: `${customer.firstName || ''} ${customer.lastName || ''}`.trim(),
        },
        meta: { nfs_payment_reference: payment.reference },
        customizations: {
          title: 'New Financial Services',
          description: `Approvisionnement ${payment.targetAccountType}`,
        },
        configurations: { session_duration: 30, max_retry_attempt: 3 },
      }, {
        headers: { ...flutterwaveHeaders(), 'X-Idempotency-Key': payment.reference },
        timeout: 15_000,
      });
      const checkoutUrl = checkedCheckoutUrl(response.data?.data?.link, 'FLUTTERWAVE');
      if (!checkoutUrl) throw new PaymentProviderError('Flutterwave n’a pas retourne de page de paiement.', 'INVALID_PROVIDER_RESPONSE');
      return { checkoutUrl, providerStatus: 'AWAITING_CUSTOMER' };
    }

    const network = payment.method === 'ORANGE_MONEY' ? 'ORANGEMONEY' : 'MTN';
    const response = await axios.post('https://api.flutterwave.com/v3/charges?type=mobile_money_franco', {
      tx_ref: payment.reference,
      amount: payment.amount,
      currency: payment.currency,
      country: 'CM',
      network,
      phone_number: customer.phone,
      email: customer.email,
      fullname: `${customer.firstName || ''} ${customer.lastName || ''}`.trim(),
      redirect_url: paymentReturnUrl('FLUTTERWAVE', payment.reference, 'return'),
      meta: { nfs_payment_reference: payment.reference },
    }, {
      headers: { ...flutterwaveHeaders(), 'X-Idempotency-Key': payment.reference },
      timeout: 15_000,
    });
    const data = response.data?.data || response.data;
    const checkoutUrl = checkedCheckoutUrl(
      data?.meta?.authorization?.redirect
        || data?.authorization?.redirect
        || data?.next_action?.redirect_url?.url
        || data?.redirect_url,
      'FLUTTERWAVE',
    );
    return {
      checkoutUrl,
      providerPaymentId: data?.id ? String(data.id) : undefined,
      providerStatus: String(data?.status || 'pending').toUpperCase(),
      instructions: checkoutUrl
        ? 'Finalisez l’autorisation sur la page securisee Flutterwave.'
        : 'Validez la demande recue sur votre telephone Mobile Money.',
    };
  } catch (error: any) {
    if (error instanceof PaymentProviderError) throw error;
    const providerCode = error?.response?.data?.data?.code || error?.response?.data?.error?.code;
    throw new PaymentProviderError(
      providerCode ? `Paiement refuse par Flutterwave (${String(providerCode).slice(0, 24)}).` : 'Flutterwave est temporairement indisponible.',
      'FLUTTERWAVE_REQUEST_FAILED',
      502,
    );
  }
};

const createStripeCheckout = async (payment: PaymentRecord, customer: PaymentCustomer): Promise<ProviderCheckout> => {
  try {
    const session = await stripeClient().checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      client_reference_id: payment.reference,
      customer_email: customer.email || undefined,
      success_url: `${paymentReturnUrl('STRIPE', payment.reference, 'return')}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: paymentReturnUrl('STRIPE', payment.reference, 'cancel'),
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: payment.currency.toLowerCase(),
          unit_amount: payment.amount,
          product_data: { name: `Approvisionnement NFS - ${payment.targetAccountType}` },
        },
      }],
      metadata: { nfs_payment_reference: payment.reference },
      payment_intent_data: { metadata: { nfs_payment_reference: payment.reference } },
    }, { idempotencyKey: payment.reference });
    const checkoutUrl = checkedCheckoutUrl(session.url, 'STRIPE');
    if (!checkoutUrl) throw new PaymentProviderError('Stripe n’a pas retourne de page de paiement.', 'INVALID_PROVIDER_RESPONSE');
    return {
      checkoutUrl,
      providerSessionId: session.id,
      providerStatus: String(session.status || 'open').toUpperCase(),
    };
  } catch (error: any) {
    if (error instanceof PaymentProviderError) throw error;
    throw new PaymentProviderError('Stripe est temporairement indisponible.', 'STRIPE_REQUEST_FAILED', 502);
  }
};

export const createProviderCheckout = async (payment: PaymentRecord, customer: PaymentCustomer) => {
  const { provider } = assertProviderAvailable(payment.provider, payment.method);
  return provider === 'FLUTTERWAVE'
    ? createFlutterwaveCheckout(payment, customer)
    : createStripeCheckout(payment, customer);
};

export const verifyFlutterwavePayment = async (transactionId: string): Promise<VerifiedProviderPayment> => {
  try {
    const response = await axios.get(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transactionId)}/verify`, {
      headers: flutterwaveHeaders(),
      timeout: 15_000,
    });
    const data = response.data?.data;
    if (!data) throw new PaymentProviderError('Reponse de verification Flutterwave invalide.', 'INVALID_PROVIDER_RESPONSE');
    return {
      reference: String(data.tx_ref || data.reference || ''),
      amount: Number(data.amount),
      currency: String(data.currency || '').toUpperCase(),
      status: String(data.status || '').toUpperCase(),
      providerPaymentId: String(data.id || transactionId),
    };
  } catch (error) {
    if (error instanceof PaymentProviderError) throw error;
    throw new PaymentProviderError('Verification Flutterwave indisponible.', 'PAYMENT_VERIFICATION_FAILED', 503);
  }
};

export const verifyFlutterwavePaymentByReference = async (reference: string): Promise<VerifiedProviderPayment> => {
  try {
    const response = await axios.get('https://api.flutterwave.com/v3/transactions/verify_by_reference', {
      headers: flutterwaveHeaders(),
      params: { tx_ref: reference },
      timeout: 15_000,
    });
    const data = response.data?.data;
    if (!data) throw new PaymentProviderError('Reponse de verification Flutterwave invalide.', 'INVALID_PROVIDER_RESPONSE');
    return {
      reference: String(data.tx_ref || data.reference || ''),
      amount: Number(data.amount),
      currency: String(data.currency || '').toUpperCase(),
      status: String(data.status || '').toUpperCase(),
      providerPaymentId: data.id ? String(data.id) : undefined,
    };
  } catch (error) {
    if (error instanceof PaymentProviderError) throw error;
    throw new PaymentProviderError('Verification Flutterwave indisponible.', 'PAYMENT_VERIFICATION_FAILED', 503);
  }
};

export const verifyStripeCheckoutSession = async (sessionId: string): Promise<VerifiedProviderPayment> => {
  try {
    const session = await stripeClient().checkout.sessions.retrieve(sessionId);
    return {
      reference: String(session.client_reference_id || session.metadata?.nfs_payment_reference || ''),
      amount: Number(session.amount_total),
      currency: String(session.currency || '').toUpperCase(),
      status: session.payment_status === 'paid' ? 'SUCCESSFUL' : String(session.payment_status || '').toUpperCase(),
      providerSessionId: session.id,
      providerPaymentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id,
    };
  } catch (error) {
    if (error instanceof PaymentProviderError) throw error;
    throw new PaymentProviderError('Verification Stripe indisponible.', 'PAYMENT_VERIFICATION_FAILED', 503);
  }
};

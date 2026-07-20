export type ReceiptEventPayload = {
  transactionId?: string;
  type: string;
  title: string;
  amount: number;
  currency: string;
  direction?: 'DEBIT' | 'CREDIT' | 'NEUTRAL';
  reference: string;
  occurredAt: string;
  paymentMethod: string;
  purpose: string;
  source?: string;
  destination?: string;
  fees?: number;
  total?: number;
  status?: string;
  providerReference?: string;
  metadata?: Record<string, unknown>;
};

export type UserNotificationEvent = {
  eventKey: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  mandatoryEmail?: boolean;
  receipt?: ReceiptEventPayload;
};

export const enqueueUserNotification = (db: any, event: UserNotificationEvent) => db.outboxEvent.upsert({
  where: { eventKey: event.eventKey },
  create: {
    eventKey: event.eventKey,
    type: event.type,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    payload: {
      userId: event.userId,
      title: event.title,
      body: event.body,
      data: event.data || {},
      mandatoryEmail: Boolean(event.mandatoryEmail),
      receipt: event.receipt || null,
    },
  },
  update: {},
});

export const maskAccountNumber = (value: unknown) => {
  const normalized = String(value || '').replace(/\s/g, '');
  if (!normalized) return 'Compte NFS';
  return normalized.length <= 4 ? `****${normalized}` : `****${normalized.slice(-4)}`;
};

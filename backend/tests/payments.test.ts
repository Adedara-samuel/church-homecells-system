import crypto from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { LedgerTransaction } from '../src/modules/finance/ledger.model';
import { homecellBalance } from '../src/modules/finance/ledger.service';
import { Payment, WebhookEvent } from '../src/modules/payments/payment.model';
import { toMinor } from '../src/utils/money';
import { API, authed, getApp, login, resetDatabase, seedFixture, type Fixture } from './helpers';

/** Signs a webhook body the way the mock provider does (HMAC-SHA512, Paystack style). */
function signWebhook(body: string): string {
  return crypto
    .createHmac('sha512', process.env.JWT_ACCESS_SECRET!)
    .update(body)
    .digest('hex');
}

async function deliverWebhook(payload: unknown, signature?: string) {
  const body = JSON.stringify(payload);
  return request(getApp())
    .post(`${API}/payments/webhooks/mock`)
    .set('Content-Type', 'application/json')
    .set('x-mock-signature', signature ?? signWebhook(body))
    .send(body);
}

describe('Payments', () => {
  let fixture: Fixture;
  let coordinator: string;
  let sysadmin: string;

  const balanceOf = async () => (await homecellBalance(fixture.homecellA1a)).availableMinor;

  beforeAll(async () => {
    await resetDatabase();
    fixture = await seedFixture();
    coordinator = await login('hc.a1a@test.org');
    sysadmin = await login('sysadmin@test.org');
  });

  async function initiatePayment(amount = 15_000) {
    const response = await authed(coordinator).post('/payments/initiate').send({
      homecellId: fixture.homecellA1a,
      purpose: 'OFFERING',
      amount,
      email: 'payer@test.org',
      name: 'Test Payer',
    });
    expect(response.status).toBe(201);
    return response.body.data as { reference: string; amount: number };
  }

  it('creates a pending payment without touching the ledger', async () => {
    const before = await balanceOf();
    const payment = await initiatePayment();

    const stored = await Payment.findOne({ reference: payment.reference });
    expect(stored).not.toBeNull();
    expect(stored!.ledgerTransaction).toBeNull();
    // Creating a checkout must never move money.
    expect(await balanceOf()).toBe(before);
  });

  it('rejects a webhook with an invalid signature', async () => {
    const payment = await initiatePayment();

    const response = await deliverWebhook(
      {
        event: 'charge.success',
        data: { reference: payment.reference, status: 'success', amount: toMinor(15_000) },
      },
      'clearly-not-a-valid-signature',
    );

    expect(response.status).toBe(422);
    const stored = await Payment.findOne({ reference: payment.reference });
    expect(stored!.status).not.toBe('SUCCESSFUL');
  });

  it('settles the payment and credits the purse on a valid webhook', async () => {
    const before = await balanceOf();
    const payment = await initiatePayment(20_000);

    const response = await deliverWebhook({
      event: 'charge.success',
      data: { reference: payment.reference, status: 'success', amount: toMinor(20_000) },
    });

    expect(response.status).toBe(200);
    expect(response.body.processed).toBe(true);

    const stored = await Payment.findOne({ reference: payment.reference });
    expect(stored!.status).toBe('SUCCESSFUL');
    expect(stored!.ledgerTransaction).not.toBeNull();
    expect(await balanceOf()).toBe(before + toMinor(20_000));
  });

  it('ignores repeated deliveries of the same webhook (idempotency)', async () => {
    const before = await balanceOf();
    const payment = await initiatePayment(30_000);

    const payload = {
      event: 'charge.success',
      data: { reference: payment.reference, status: 'success', amount: toMinor(30_000) },
    };

    const first = await deliverWebhook(payload);
    const second = await deliverWebhook(payload);
    const third = await deliverWebhook(payload);

    expect(first.body.processed).toBe(true);
    expect(second.body.duplicate).toBe(true);
    expect(third.body.duplicate).toBe(true);
    // Every delivery answers 200 so the provider stops retrying.
    expect([first.status, second.status, third.status]).toEqual([200, 200, 200]);

    // Exactly one credit, no matter how many times the event arrived.
    expect(await balanceOf()).toBe(before + toMinor(30_000));

    const entries = await LedgerTransaction.countDocuments({
      idempotencyKey: `payment:${payment.reference}`,
    });
    expect(entries).toBe(1);

    const events = await WebhookEvent.find({ paymentReference: payment.reference });
    expect(events.length).toBe(1);
    expect(events[0].deliveryCount).toBe(3);
  });

  it('accepts a webhook for an unknown reference without processing it', async () => {
    const response = await deliverWebhook({
      event: 'charge.success',
      data: { reference: 'PAY-000000-UNKNOWN', status: 'success', amount: 1000 },
    });

    expect(response.status).toBe(200);
    expect(response.body.processed).toBe(false);
    expect(response.body.reason).toBe('Unknown reference');
  });

  it('marks a payment failed without moving money', async () => {
    const before = await balanceOf();
    const payment = await initiatePayment(12_000);

    const response = await deliverWebhook({
      event: 'charge.failed',
      data: { reference: payment.reference, status: 'failed', amount: toMinor(12_000) },
    });

    expect(response.status).toBe(200);
    const stored = await Payment.findOne({ reference: payment.reference });
    expect(stored!.status).toBe('FAILED');
    expect(stored!.ledgerTransaction).toBeNull();
    expect(await balanceOf()).toBe(before);
  });

  it('ignores a late webhook for an already-settled payment', async () => {
    const payment = await initiatePayment(9_000);

    await deliverWebhook({
      event: 'charge.success',
      data: { reference: payment.reference, status: 'success', amount: toMinor(9_000) },
    });
    const afterFirst = await balanceOf();

    // A different event id for the same payment: not a duplicate delivery, but the
    // payment is already terminal so it must be ignored.
    const late = await deliverWebhook({
      event: 'charge.success.retry',
      data: { reference: payment.reference, status: 'success', amount: toMinor(9_000) },
    });

    expect(late.status).toBe(200);
    expect(late.body.processed).toBe(false);
    expect(await balanceOf()).toBe(afterFirst);
  });

  it('runs reconciliation and reports a summary', async () => {
    const response = await authed(sysadmin).post('/payments/reconciliation/run').send({});

    expect(response.status).toBe(201);
    expect(response.body.data.provider).toBe('MOCK');
    expect(typeof response.body.data.totalChecked).toBe('number');

    const summary = await authed(sysadmin).get('/payments/reconciliation/summary');
    expect(summary.status).toBe(200);
    expect(summary.body.data.counts).toBeDefined();
  });

  it('refuses to settle a payment twice manually', async () => {
    const payment = await initiatePayment(7_000);
    await deliverWebhook({
      event: 'charge.success',
      data: { reference: payment.reference, status: 'success', amount: toMinor(7_000) },
    });

    const stored = await Payment.findOne({ reference: payment.reference });
    const response = await authed(sysadmin)
      .post(`/payments/${stored!._id}/settle`)
      .send({ note: 'Attempting a second settlement' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ALREADY_PROCESSED');
  });
});

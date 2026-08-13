import crypto from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { homecellBalance, postTransaction } from '../src/modules/finance/ledger.service';
import { Payment } from '../src/modules/payments/payment.model';
import { Remittance } from '../src/modules/remittances/remittance.model';
import { RemittanceStatus, TransactionType } from '../src/types/enums';
import { dayjs } from '../src/utils/dates';
import { toMinor } from '../src/utils/money';
import {
  API,
  authed,
  getApp,
  login,
  resetDatabase,
  seedFixture,
  type Fixture,
} from './helpers';

async function deliverWebhook(payload: unknown) {
  const body = JSON.stringify(payload);
  return request(getApp())
    .post(`${API}/payments/webhooks/mock`)
    .set('Content-Type', 'application/json')
    .set(
      'x-mock-signature',
      crypto.createHmac('sha512', env.JWT_ACCESS_SECRET).update(body).digest('hex'),
    )
    .send(body);
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * A date and time that has definitely already happened. Both parts come from the same
 * instant, so this stays valid at any hour — including just after midnight, where a
 * fixed clock time would be in the future and correctly refused.
 */
function justNow() {
  const moment = dayjs().subtract(5, 'minute');
  return { date: moment.format('YYYY-MM-DD'), time: moment.format('HH:mm') };
}

/**
 * The threshold rule (SRS 8.2) and the online remittance path.
 *
 * The fixture threshold is ₦100,000, so a purse holding ₦400,000 must remit at least
 * ₦300,000 — the excess, not an arbitrary amount.
 */
describe('Remittance minimum and online checkout', () => {
  let fixture: Fixture;
  let coordinator: string;

  const balanceOf = async () => (await homecellBalance(fixture.homecellA1a)).availableMinor;

  const fundPurse = async (major: number) => {
    await postTransaction({
      idempotencyKey: `test-funding:${Math.random()}`,
      homecell: fixture.homecellA1a,
      area: fixture.areaA1,
      zone: fixture.zoneA,
      type: TransactionType.OFFERING,
      amountMinor: toMinor(major),
      currency: 'NGN',
      valueDate: new Date(),
      description: 'Test funding',
    });
  };

  beforeAll(async () => {
    await resetDatabase();
    fixture = await seedFixture();
    coordinator = await login('hc.a1a@test.org');
    await fundPurse(400_000);
  });

  describe('the minimum', () => {
    it('reports the excess over the threshold as the minimum', async () => {
      const response = await authed(coordinator).get(`/remittances/minimum/${fixture.homecellA1a}`);

      expect(response.status).toBe(200);
      expect(response.body.data.availableMinor).toBe(toMinor(400_000));
      expect(response.body.data.thresholdMinor).toBe(toMinor(100_000));
      expect(response.body.data.aboveThreshold).toBe(true);
      expect(response.body.data.minimumMinor).toBe(toMinor(300_000));
    });

    it('refuses a remittance below the minimum while the purse is over its threshold', async () => {
      const response = await authed(coordinator).post('/remittances').send({
        homecellId: fixture.homecellA1a,
        amount: 250_000,
        ...justNow(),
      });

      expect(response.status).toBe(422);
      expect(response.body.error.message).toContain('300,000');
      expect(await Remittance.countDocuments({ amountMinor: toMinor(250_000) })).toBe(0);
    });

    it('accepts a remittance at exactly the minimum', async () => {
      const response = await authed(coordinator).post('/remittances').send({
        homecellId: fixture.homecellA1a,
        amount: 300_000,
        ...justNow(),
      });

      expect(response.status).toBe(201);
      expect(response.body.data.amountMinor).toBe(toMinor(300_000));
    });

    it('records the date and the time the money was sent', async () => {
      const remittance = await Remittance.findOne({ amountMinor: toMinor(300_000) }).lean();

      expect(remittance!.remittedAt).toBeTruthy();
      // Stored as a real instant, not just a calendar day.
      expect(new Date(remittance!.remittedAt).getTime()).toBeGreaterThan(
        new Date(remittance!.date).getTime(),
      );
    });

    it('refuses a remittance dated in the future', async () => {
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      const response = await authed(coordinator).post('/remittances').send({
        homecellId: fixture.homecellA1a,
        // At the minimum, so a rejection can only be about the date.
        amount: 300_000,
        date: tomorrow,
      });

      expect(response.status).toBe(422);
      expect(response.body.error.message).toContain('future');
    });

    /**
     * A coordinator in Lagos (UTC+1) submitting "09:41" to a server running in UTC
     * used to be rejected as an hour into the future. A wall clock carries no
     * timezone, so it is clamped rather than refused.
     */
    it('accepts a wall-clock time that only looks like the future to the server', async () => {
      const ahead = new Date(Date.now() + 3 * 60 * 60 * 1000);
      const response = await authed(coordinator).post('/remittances').send({
        homecellId: fixture.homecellA1a,
        amount: 300_000,
        date: today(),
        time: `${String(ahead.getHours()).padStart(2, '0')}:${String(ahead.getMinutes()).padStart(2, '0')}`,
      });

      expect(response.status).toBe(201);
      // Clamped to now — never stored ahead of the clock.
      expect(new Date(response.body.data.remittedAt).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('honours an explicit instant sent with a UTC offset', async () => {
      const sentAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const response = await authed(coordinator).post('/remittances').send({
        homecellId: fixture.homecellA1a,
        amount: 300_000,
        date: today(),
        remittedAt: sentAt.toISOString(),
      });

      expect(response.status).toBe(201);
      expect(new Date(response.body.data.remittedAt).toISOString()).toBe(sentAt.toISOString());
    });

    it('still refuses a genuinely future instant', async () => {
      const response = await authed(coordinator).post('/remittances').send({
        homecellId: fixture.homecellA1a,
        amount: 300_000,
        date: today(),
        remittedAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
      });

      expect(response.status).toBe(422);
      expect(response.body.error.message).toContain('future');
    });

    it('imposes no minimum once the purse is under its threshold', async () => {
      await resetDatabase();
      fixture = await seedFixture();
      coordinator = await login('hc.a1a@test.org');
      await fundPurse(50_000);

      const floor = await authed(coordinator).get(`/remittances/minimum/${fixture.homecellA1a}`);
      expect(floor.body.data.aboveThreshold).toBe(false);
      expect(floor.body.data.minimumMinor).toBe(0);

      const response = await authed(coordinator).post('/remittances').send({
        homecellId: fixture.homecellA1a,
        amount: 5_000,
        date: today(),
      });
      expect(response.status).toBe(201);
    });
  });

  describe('paying online', () => {
    beforeAll(async () => {
      await resetDatabase();
      fixture = await seedFixture();
      coordinator = await login('hc.a1a@test.org');
      await fundPurse(400_000);
    });

    /** An online payment carries no client-supplied date: the server stamps it. */
    it('opens a checkout without moving any money, stamped by the server clock', async () => {
      const before = await balanceOf();
      const openedAt = Date.now();

      const response = await authed(coordinator).post('/remittances').send({
        homecellId: fixture.homecellA1a,
        amount: 300_000,
        channel: 'PROVIDER_CHECKOUT',
      });

      const stamped = new Date(response.body.data.remittedAt).getTime();
      expect(stamped).toBeGreaterThanOrEqual(openedAt - 2000);
      expect(stamped).toBeLessThanOrEqual(Date.now() + 1000);

      expect(response.status).toBe(201);
      expect(response.body.data.checkout.authorizationUrl).toContain('/payments/mock/');
      expect(response.body.data.status).toBe(RemittanceStatus.PROCESSING);
      // Opening a checkout is not a payment.
      expect(await balanceOf()).toBe(before);
    });

    it('debits the purse only when the provider confirms, and only once', async () => {
      const before = await balanceOf();
      const remittance = await Remittance.findOne({ status: RemittanceStatus.PROCESSING }).lean();
      const payment = remittance!.payment;
      expect(payment).toBeTruthy();

      const paymentDoc = await Payment.findById(payment).lean();

      const first = await deliverWebhook({
        event: 'charge.success',
        data: {
          reference: paymentDoc!.reference,
          status: 'success',
          amount: toMinor(300_000),
        },
      });
      expect(first.status).toBe(200);
      expect(await balanceOf()).toBe(before - toMinor(300_000));

      // A replayed delivery must be recognised and ignored.
      const replay = await deliverWebhook({
        event: 'charge.success',
        data: {
          reference: paymentDoc!.reference,
          status: 'success',
          amount: toMinor(300_000),
        },
      });
      expect(replay.status).toBe(200);
      expect(await balanceOf()).toBe(before - toMinor(300_000));

      const settled = await Remittance.findById(remittance!._id).lean();
      expect(settled!.status).toBe(RemittanceStatus.SUCCESSFUL);
      expect(settled!.ledgerTransaction).toBeTruthy();
    });

    it('issues a receipt for the settled remittance', async () => {
      const remittance = await Remittance.findOne({
        status: RemittanceStatus.SUCCESSFUL,
      }).lean();

      const response = await authed(coordinator).get(`/remittances/${remittance!._id}/receipt`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('application/pdf');
      expect(response.headers['content-disposition']).toContain('.pdf');
      // A real PDF, not an error page rendered as one.
      expect(response.body.slice(0, 4).toString()).toBe('%PDF');
    });

    it('refuses a receipt for a remittance that has not settled', async () => {
      const opened = await authed(coordinator).post('/remittances').send({
        homecellId: fixture.homecellA1a,
        amount: 1_000,
        date: today(),
        channel: 'PROVIDER_CHECKOUT',
      });

      const response = await authed(coordinator).get(`/remittances/${opened.body.data._id}/receipt`);
      expect(response.status).toBe(409);
    });
  });
});

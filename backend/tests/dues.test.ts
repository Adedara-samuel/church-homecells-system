import crypto from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { DuesDefinition, DuesInvoice } from '../src/modules/dues/dues.model';
import { ensureInvoicesForHomecell } from '../src/modules/dues/dues.service';
import { homecellBalance, postTransaction } from '../src/modules/finance/ledger.service';
import { Homecell } from '../src/modules/homecells/homecell.model';
import { Payment } from '../src/modules/payments/payment.model';
import { verifyPayment } from '../src/modules/payments/payment.service';
import { DuesInvoiceStatus, TransactionType } from '../src/types/enums';
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

/** Delivers a webhook signed the way the mock provider signs one. */
async function deliverWebhook(payload: unknown) {
  const body = JSON.stringify(payload);
  return request(getApp())
    .post(`${API}/payments/webhooks/mock`)
    .set('Content-Type', 'application/json')
    .set('x-mock-signature', crypto.createHmac('sha512', env.JWT_ACCESS_SECRET).update(body).digest('hex'))
    .send(body);
}

/**
 * Dues move real money out of a Homecell purse, so these tests assert the balance and
 * the invoice states after each operation — not just the HTTP status. The rules that
 * matter most are the ones that must hold under repetition and concurrency: a month
 * must never be billed twice, and must never be paid twice.
 */
describe('Dues and levies', () => {
  let fixture: Fixture;
  let coordinator: string;
  let zonal: string;
  let sysadmin: string;

  const balanceOf = async () => (await homecellBalance(fixture.homecellA1a)).availableMinor;

  /** Puts money in the purse so dues have something to be paid from. */
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

  const createMonthlyDue = async (amount: number, startMonthsAgo = 3) =>
    authed(zonal)
      .post('/dues/definitions')
      .send({
        zoneId: fixture.zoneA,
        name: 'Monthly Due',
        frequency: 'MONTHLY',
        amount,
        startDate: dayjs().subtract(startMonthsAgo, 'month').startOf('month').format('YYYY-MM-DD'),
        dueDayOfMonth: 10,
        isPrimaryMonthlyDue: true,
      });

  beforeAll(async () => {
    await resetDatabase();
    fixture = await seedFixture();
    coordinator = await login('hc.a1a@test.org');
    zonal = await login('zonal.a@test.org');
    sysadmin = await login('sysadmin@test.org');
  });

  beforeEach(async () => {
    await DuesInvoice.deleteMany({});
    await DuesDefinition.deleteMany({});
    // The fixture creates its Homecells "now", which would correctly accrue only the
    // current month. Ageing this one lets the back-billing rules actually be tested.
    // The native driver is required: Mongoose treats `createdAt` as immutable and
    // silently drops it from an update.
    await Homecell.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(fixture.homecellA1a) },
      { $set: { createdAt: dayjs().subtract(6, 'month').toDate() } },
    );
  });

  describe('definitions', () => {
    it('lets a Zonal Coordinator create the standing monthly due', async () => {
      const response = await createMonthlyDue(5_000);

      expect(response.status).toBe(201);
      expect(response.body.data.amountMinor).toBe(toMinor(5_000));
      expect(response.body.data.frequency).toBe('MONTHLY');
    });

    it('refuses a second standing monthly due for the same Zone', async () => {
      await createMonthlyDue(5_000);
      const response = await createMonthlyDue(7_000);

      expect(response.status).toBe(409);
    });

    it('refuses a one-off levy with no due date', async () => {
      const response = await authed(zonal).post('/dues/definitions').send({
        zoneId: fixture.zoneA,
        name: 'Anniversary Levy',
        frequency: 'ONE_OFF',
        amount: 2_000,
        startDate: dayjs().format('YYYY-MM-DD'),
      });

      expect(response.status).toBe(422);
    });

    it('does not let a coordinator configure dues for another Zone', async () => {
      const response = await authed(zonal).post('/dues/definitions').send({
        zoneId: fixture.zoneB,
        name: 'Monthly Due',
        frequency: 'MONTHLY',
        amount: 5_000,
        startDate: dayjs().format('YYYY-MM-DD'),
      });

      expect(response.status).toBe(403);
    });

    it('refuses a Homecell Coordinator creating a charge at all', async () => {
      const response = await authed(coordinator).post('/dues/definitions').send({
        zoneId: fixture.zoneA,
        name: 'Self-serve Levy',
        frequency: 'MONTHLY',
        amount: 1,
        startDate: dayjs().format('YYYY-MM-DD'),
      });

      expect(response.status).toBe(403);
    });
  });

  describe('accrual', () => {
    it('raises one invoice per month from the start month to the current one', async () => {
      await createMonthlyDue(5_000, 3);
      await ensureInvoicesForHomecell(fixture.homecellA1a);

      const invoices = await DuesInvoice.find({ homecell: fixture.homecellA1a }).lean();
      // Three months back, inclusive of the current month, is four invoices.
      expect(invoices).toHaveLength(4);
      expect(invoices.every((i) => i.amountMinor === toMinor(5_000))).toBe(true);
    });

    it('never bills the same month twice, however often generation runs', async () => {
      await createMonthlyDue(5_000, 3);

      await ensureInvoicesForHomecell(fixture.homecellA1a);
      await ensureInvoicesForHomecell(fixture.homecellA1a);
      const created = await ensureInvoicesForHomecell(fixture.homecellA1a);

      expect(created).toBe(0);
      expect(await DuesInvoice.countDocuments({ homecell: fixture.homecellA1a })).toBe(4);
    });

    it('never bills a Homecell for months before it existed', async () => {
      // The charge starts two years back; the Homecell is far younger than that.
      await createMonthlyDue(5_000, 24);
      await ensureInvoicesForHomecell(fixture.homecellA1a);

      const homecell = await Homecell.findById(fixture.homecellA1a).lean();
      const earliest = await DuesInvoice.find({ homecell: fixture.homecellA1a })
        .sort({ periodStart: 1 })
        .limit(1)
        .lean();

      expect(
        dayjs(earliest[0].periodStart).isBefore(dayjs(homecell!.createdAt).startOf('month')),
      ).toBe(false);
    });

    it('stops billing a one-off levy once its due date has passed', async () => {
      await DuesDefinition.create({
        zone: fixture.zoneA,
        name: 'Expired Levy',
        frequency: 'ONE_OFF',
        amountMinor: toMinor(2_000),
        currency: 'NGN',
        startDate: dayjs().subtract(2, 'month').toDate(),
        dueDate: dayjs().subtract(1, 'day').toDate(),
        status: 'ACTIVE',
        createdBy: fixture.users.zonalA,
      });

      await ensureInvoicesForHomecell(fixture.homecellA1a);

      expect(await DuesInvoice.countDocuments({ name: 'Expired Levy' })).toBe(0);
      const definition = await DuesDefinition.findOne({ name: 'Expired Levy' }).lean();
      expect(definition!.status).toBe('INACTIVE');
      expect(definition!.autoClosedAt).toBeTruthy();
    });

    it('re-opening an expired levy requires a future due date', async () => {
      const definition = await DuesDefinition.create({
        zone: fixture.zoneA,
        name: 'Anniversary Levy',
        frequency: 'ONE_OFF',
        amountMinor: toMinor(2_000),
        currency: 'NGN',
        startDate: dayjs().subtract(1, 'year').toDate(),
        dueDate: dayjs().subtract(1, 'month').toDate(),
        status: 'INACTIVE',
        autoClosedAt: new Date(),
        createdBy: fixture.users.zonalA,
      });

      const refused = await authed(zonal)
        .post(`/dues/definitions/${definition._id}/status`)
        .send({ status: 'ACTIVE' });
      expect(refused.status).toBe(422);

      const accepted = await authed(zonal)
        .post(`/dues/definitions/${definition._id}/status`)
        .send({ status: 'ACTIVE', dueDate: dayjs().add(1, 'year').format('YYYY-MM-DD') });
      expect(accepted.status).toBe(200);
      expect(accepted.body.data.status).toBe('ACTIVE');
      expect(accepted.body.data.autoClosedAt).toBeNull();
    });
  });

  describe('statement', () => {
    it('reports what is outstanding, and what is overdue', async () => {
      await createMonthlyDue(5_000, 3);

      const response = await authed(coordinator).get(`/dues/statement/${fixture.homecellA1a}`);

      expect(response.status).toBe(200);
      expect(response.body.data.outstanding).toHaveLength(4);
      expect(response.body.data.totalOutstandingMinor).toBe(toMinor(20_000));
      // Everything before the current month is past its due date.
      expect(response.body.data.overdueCount).toBeGreaterThanOrEqual(3);
    });

    it('refuses a statement for a Homecell outside the caller’s scope', async () => {
      const response = await authed(coordinator).get(`/dues/statement/${fixture.homecellB1a}`);
      expect(response.status).toBe(403);
    });
  });

  describe('payment', () => {
    it('refuses to open a checkout the purse cannot cover', async () => {
      await createMonthlyDue(50_000, 3);

      const response = await authed(coordinator)
        .post('/dues/pay')
        .send({ homecellId: fixture.homecellA1a });

      // 200,000 owed against an empty purse.
      expect(response.status).toBe(422);
      expect(await DuesInvoice.countDocuments({ status: DuesInvoiceStatus.PROCESSING })).toBe(0);
    });

    it('claims the selected invoices so the same month cannot be paid twice', async () => {
      await fundPurse(100_000);
      await createMonthlyDue(5_000, 3);
      await ensureInvoicesForHomecell(fixture.homecellA1a);

      const invoices = await DuesInvoice.find({ homecell: fixture.homecellA1a })
        .sort({ dueDate: 1 })
        .lean();
      const first = String(invoices[0]._id);

      const opened = await authed(coordinator)
        .post('/dues/pay')
        .send({ homecellId: fixture.homecellA1a, invoiceIds: [first] });
      expect(opened.status).toBe(201);
      expect(opened.body.data.amountMinor).toBe(toMinor(5_000));

      // The same invoice is now claimed, so a second attempt finds nothing to take.
      const again = await authed(coordinator)
        .post('/dues/pay')
        .send({ homecellId: fixture.homecellA1a, invoiceIds: [first] });
      expect(again.status).toBe(409);
    });

    it('debits the purse exactly once when the payment settles', async () => {
      await fundPurse(100_000);
      await createMonthlyDue(5_000, 3);
      await ensureInvoicesForHomecell(fixture.homecellA1a);

      const before = await balanceOf();
      const opened = await authed(coordinator)
        .post('/dues/pay')
        .send({ homecellId: fixture.homecellA1a });

      expect(opened.status).toBe(201);
      expect(opened.body.data.amountMinor).toBe(toMinor(20_000));
      // Nothing has moved yet: opening a checkout is not a payment.
      expect(await balanceOf()).toBe(before);

      const reference = opened.body.data.reference as string;
      await verifyPayment(reference);

      expect(await balanceOf()).toBe(before - toMinor(20_000));

      // A replayed confirmation must not debit a second time.
      await verifyPayment(reference);
      expect(await balanceOf()).toBe(before - toMinor(20_000));

      const invoices = await DuesInvoice.find({ homecell: fixture.homecellA1a }).lean();
      expect(invoices.every((i) => i.status === DuesInvoiceStatus.PAID)).toBe(true);
      expect(invoices.every((i) => i.ledgerTransaction)).toBe(true);
    });

    it('posts one ledger entry for a multi-month payment, not one per month', async () => {
      await fundPurse(100_000);
      await createMonthlyDue(5_000, 3);
      await ensureInvoicesForHomecell(fixture.homecellA1a);

      const opened = await authed(coordinator)
        .post('/dues/pay')
        .send({ homecellId: fixture.homecellA1a });
      await verifyPayment(opened.body.data.reference as string);

      const payment = await Payment.findOne({ reference: opened.body.data.reference }).lean();
      const invoices = await DuesInvoice.find({ payment: payment!._id }).lean();
      const ledgerIds = new Set(invoices.map((i) => String(i.ledgerTransaction)));

      expect(invoices).toHaveLength(4);
      expect(ledgerIds.size).toBe(1);
    });

    it('releases claimed invoices when the payment fails', async () => {
      await fundPurse(100_000);
      await createMonthlyDue(5_000, 3);
      await ensureInvoicesForHomecell(fixture.homecellA1a);

      const before = await balanceOf();
      const opened = await authed(coordinator)
        .post('/dues/pay')
        .send({ homecellId: fixture.homecellA1a });
      const reference = opened.body.data.reference as string;

      expect(await DuesInvoice.countDocuments({ status: DuesInvoiceStatus.PROCESSING })).toBe(4);

      // Failure arrives the way it does in production: a signed provider webhook.
      const failure = await deliverWebhook({
        event: 'charge.failed',
        data: { reference, status: 'failed', amount: toMinor(20_000) },
      });
      expect(failure.status).toBe(200);

      const invoices = await DuesInvoice.find({ homecell: fixture.homecellA1a }).lean();
      expect(invoices.every((i) => i.status === DuesInvoiceStatus.OUTSTANDING)).toBe(true);
      expect(invoices.every((i) => i.payment === null)).toBe(true);
      // A failed payment must never have moved money.
      expect(await balanceOf()).toBe(before);
    });
  });

  describe('receipts', () => {
    it('issues a receipt for a settled dues payment, itemised by month', async () => {
      await fundPurse(100_000);
      await createMonthlyDue(5_000, 3);
      await ensureInvoicesForHomecell(fixture.homecellA1a);

      const opened = await authed(coordinator)
        .post('/dues/pay')
        .send({ homecellId: fixture.homecellA1a });
      const reference = opened.body.data.reference as string;
      await verifyPayment(reference);

      // Both routes resolve to the same document.
      for (const path of [`/dues/payments/${reference}/receipt`, `/payments/${reference}/receipt`]) {
        const response = await authed(coordinator).get(path);
        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toBe('application/pdf');
        expect(response.body.slice(0, 4).toString()).toBe('%PDF');
        expect(response.body.length).toBeGreaterThan(1000);
      }
    });

    it('refuses a receipt while the payment is still unconfirmed', async () => {
      await fundPurse(100_000);
      await createMonthlyDue(5_000, 1);
      await ensureInvoicesForHomecell(fixture.homecellA1a);

      const opened = await authed(coordinator)
        .post('/dues/pay')
        .send({ homecellId: fixture.homecellA1a });

      const response = await authed(coordinator).get(
        `/payments/${opened.body.data.reference}/receipt`,
      );
      // A document that looks like proof of an unmade payment must not be issued.
      expect(response.status).toBe(409);
    });

    it('does not issue a receipt for another homecell’s payment', async () => {
      await fundPurse(100_000);
      await createMonthlyDue(5_000, 1);
      await ensureInvoicesForHomecell(fixture.homecellA1a);

      const opened = await authed(coordinator)
        .post('/dues/pay')
        .send({ homecellId: fixture.homecellA1a });
      await verifyPayment(opened.body.data.reference as string);

      const other = await login('hc.a1b@test.org');
      const response = await authed(other).get(
        `/payments/${opened.body.data.reference}/receipt`,
      );
      expect(response.status).toBe(403);
    });
  });

  describe('waivers', () => {
    it('lets a Zonal Coordinator waive an invoice, and a Homecell Coordinator not', async () => {
      await createMonthlyDue(5_000, 1);
      await ensureInvoicesForHomecell(fixture.homecellA1a);
      const invoice = await DuesInvoice.findOne({ homecell: fixture.homecellA1a }).lean();

      const refused = await authed(coordinator)
        .post(`/dues/invoices/${invoice!._id}/waive`)
        .send({ reason: 'Cannot afford it' });
      expect(refused.status).toBe(403);

      const allowed = await authed(zonal)
        .post(`/dues/invoices/${invoice!._id}/waive`)
        .send({ reason: 'New homecell grace period' });
      expect(allowed.status).toBe(200);
      expect(allowed.body.data.status).toBe(DuesInvoiceStatus.WAIVED);
    });

    it('does not include a waived invoice in what is owed', async () => {
      await createMonthlyDue(5_000, 1);
      await ensureInvoicesForHomecell(fixture.homecellA1a);
      const invoice = await DuesInvoice.findOne({ homecell: fixture.homecellA1a }).lean();
      await authed(sysadmin)
        .post(`/dues/invoices/${invoice!._id}/waive`)
        .send({ reason: 'Waived for testing' });

      const statement = await authed(coordinator).get(`/dues/statement/${fixture.homecellA1a}`);
      expect(statement.body.data.totalOutstandingMinor).toBe(toMinor(5_000));
    });
  });
});

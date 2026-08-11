import { beforeAll, describe, expect, it } from 'vitest';
import { LedgerTransaction } from '../src/modules/finance/ledger.model';
import { homecellBalance, postTransaction } from '../src/modules/finance/ledger.service';
import { toMinor } from '../src/utils/money';
import { authed, lastWeekday, login, resetDatabase, seedFixture, type Fixture } from './helpers';

/**
 * The financial rules are the ones a church cannot afford to have wrong, so these
 * tests assert the *balance* after each operation rather than just the HTTP status.
 */
describe('Finance', () => {
  let fixture: Fixture;
  let coordinator: string;
  let areaCoordinator: string;
  let sysadmin: string;

  const balanceOf = async () => (await homecellBalance(fixture.homecellA1a)).availableMinor;

  beforeAll(async () => {
    await resetDatabase();
    fixture = await seedFixture();
    coordinator = await login('hc.a1a@test.org');
    areaCoordinator = await login('area.a1@test.org');
    sysadmin = await login('sysadmin@test.org');
  });

  describe('offerings', () => {
    it('rejects an offering that is not on a Sunday (BR-008)', async () => {
      const response = await authed(coordinator).post('/finance/offerings').send({
        homecellId: fixture.homecellA1a,
        amount: 10_000,
        date: lastWeekday(1),
      });

      expect(response.status).toBe(422);
      expect(response.body.error.details.rule).toBe('BR-008');
    });

    it('credits the purse when an offering is recorded', async () => {
      const before = await balanceOf();

      const response = await authed(coordinator).post('/finance/offerings').send({
        homecellId: fixture.homecellA1a,
        amount: 50_000,
        date: lastWeekday(0),
        channel: 'CASH',
      });

      expect(response.status).toBe(201);
      expect(await balanceOf()).toBe(before + toMinor(50_000));
    });

    it('refuses a second offering for the same Homecell and Sunday', async () => {
      const response = await authed(coordinator).post('/finance/offerings').send({
        homecellId: fixture.homecellA1a,
        amount: 25_000,
        date: lastWeekday(0),
      });

      expect(response.status).toBe(409);
    });

    it('restores the balance when an offering is reversed', async () => {
      const date = lastWeekday(0, 1);
      const created = await authed(coordinator).post('/finance/offerings').send({
        homecellId: fixture.homecellA1a,
        amount: 20_000,
        date,
      });
      expect(created.status).toBe(201);

      const afterOffering = await balanceOf();

      const reversed = await authed(sysadmin)
        .post(`/finance/offerings/${created.body.data._id}/reverse`)
        .send({ reason: 'Recorded against the wrong Homecell' });

      expect(reversed.status).toBe(200);
      expect(await balanceOf()).toBe(afterOffering - toMinor(20_000));

      // The original posting is preserved, not deleted (BR-016).
      const original = await LedgerTransaction.findById(created.body.data.ledgerTransaction);
      expect(original).not.toBeNull();
      expect(original!.status).toBe('REVERSED');
      expect(original!.reversalReason).toContain('wrong Homecell');
    });
  });

  describe('expenses', () => {
    it('does not change the balance while an expense awaits approval (BR-015)', async () => {
      const before = await balanceOf();

      const response = await authed(coordinator).post('/finance/expenses').send({
        homecellId: fixture.homecellA1a,
        categoryId: fixture.categoryId,
        amount: 5_000,
        date: new Date().toISOString().slice(0, 10),
        description: 'Refreshments for the meeting',
      });

      expect(response.status).toBe(201);
      expect(response.body.data.status).toBe('PENDING_APPROVAL');
      expect(await balanceOf()).toBe(before);
    });

    it('debits the purse when the expense is approved (BR-010)', async () => {
      const created = await authed(coordinator).post('/finance/expenses').send({
        homecellId: fixture.homecellA1a,
        categoryId: fixture.categoryId,
        amount: 8_000,
        date: new Date().toISOString().slice(0, 10),
        description: 'Booklets for new members',
      });

      const before = await balanceOf();

      const approved = await authed(areaCoordinator).post(
        `/finance/expenses/${created.body.data._id}/approve`,
      );

      expect(approved.status).toBe(200);
      expect(approved.body.data.status).toBe('APPROVED');
      expect(await balanceOf()).toBe(before - toMinor(8_000));
    });

    it('leaves the balance untouched when an expense is rejected', async () => {
      const created = await authed(coordinator).post('/finance/expenses').send({
        homecellId: fixture.homecellA1a,
        categoryId: fixture.categoryId,
        amount: 3_000,
        date: new Date().toISOString().slice(0, 10),
        description: 'Unbudgeted purchase',
      });

      const before = await balanceOf();

      const rejected = await authed(areaCoordinator)
        .post(`/finance/expenses/${created.body.data._id}/reject`)
        .send({ reason: 'Not covered by the approved expense policy' });

      expect(rejected.status).toBe(200);
      expect(await balanceOf()).toBe(before);
    });

    it('refuses to approve an expense the purse cannot cover', async () => {
      const available = await balanceOf();

      const created = await authed(coordinator).post('/finance/expenses').send({
        homecellId: fixture.homecellA1a,
        categoryId: fixture.categoryId,
        amount: available / 100 + 100_000,
        date: new Date().toISOString().slice(0, 10),
        description: 'Deliberately larger than the available balance',
      });

      const approved = await authed(areaCoordinator).post(
        `/finance/expenses/${created.body.data._id}/approve`,
      );

      expect(approved.status).toBe(422);
      expect(approved.body.error.code).toBe('INSUFFICIENT_BALANCE');
      // The failed approval must not leave the expense marked approved.
      const reloaded = await authed(coordinator).get(`/finance/expenses/${created.body.data._id}`);
      expect(reloaded.body.data.status).toBe('PENDING_APPROVAL');
      expect(await balanceOf()).toBe(available);
    });
  });

  describe('remittances', () => {
    it('does not debit the purse until the remittance is verified (BR-011)', async () => {
      const before = await balanceOf();

      const created = await authed(coordinator).post('/remittances').send({
        homecellId: fixture.homecellA1a,
        amount: 10_000,
        date: new Date().toISOString().slice(0, 10),
      });

      expect(created.status).toBe(201);
      expect(created.body.data.status).toBe('PENDING_APPROVAL');
      expect(await balanceOf()).toBe(before);

      const approved = await authed(areaCoordinator).post(
        `/remittances/${created.body.data._id}/approve`,
      );
      expect(approved.status).toBe(200);
      // Approval alone still does not move money.
      expect(await balanceOf()).toBe(before);

      const verified = await authed(sysadmin).post(`/remittances/${created.body.data._id}/verify`);
      expect(verified.status).toBe(200);
      expect(verified.body.data.status).toBe('SUCCESSFUL');
      expect(await balanceOf()).toBe(before - toMinor(10_000));
    });

    it('refuses a remittance larger than the available balance', async () => {
      const available = await balanceOf();

      const response = await authed(coordinator).post('/remittances').send({
        homecellId: fixture.homecellA1a,
        amount: available / 100 + 50_000,
        date: new Date().toISOString().slice(0, 10),
      });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('INSUFFICIENT_BALANCE');
    });
  });

  describe('ledger integrity', () => {
    it('refuses a duplicate idempotency key and returns the original entry', async () => {
      const key = `test-idempotency-${Date.now()}`;
      const input = {
        idempotencyKey: key,
        homecell: fixture.homecellA1a,
        area: fixture.areaA1,
        zone: fixture.zoneA,
        type: 'OTHER_INCOME' as const,
        amountMinor: toMinor(1_000),
        currency: 'NGN',
        valueDate: new Date(),
        description: 'Idempotency check',
      };

      const first = await postTransaction(input);
      const second = await postTransaction(input);

      expect(first.duplicate).toBe(false);
      expect(second.duplicate).toBe(true);
      expect(String(second.transaction._id)).toBe(String(first.transaction._id));

      const count = await LedgerTransaction.countDocuments({ idempotencyKey: key });
      expect(count).toBe(1);
    });

    it('rejects an attempt to edit a posted transaction (BR-016)', async () => {
      const { transaction } = await postTransaction({
        idempotencyKey: `immutability-${Date.now()}`,
        homecell: fixture.homecellA1a,
        area: fixture.areaA1,
        zone: fixture.zoneA,
        type: 'OTHER_INCOME',
        amountMinor: toMinor(2_000),
        currency: 'NGN',
        valueDate: new Date(),
        description: 'Immutability check',
      });

      transaction.amountMinor = toMinor(999_999);
      await expect(transaction.save()).rejects.toThrow(/immutable/i);
    });

    it('rejects a non-positive amount', async () => {
      await expect(
        postTransaction({
          idempotencyKey: `negative-${Date.now()}`,
          homecell: fixture.homecellA1a,
          area: fixture.areaA1,
          zone: fixture.zoneA,
          type: 'OTHER_INCOME',
          amountMinor: 0,
          currency: 'NGN',
          valueDate: new Date(),
          description: 'Zero amount',
        }),
      ).rejects.toThrow(/greater than zero/i);
    });

    it('derives the balance purely from the ledger', async () => {
      const summary = await homecellBalance(fixture.homecellA1a);
      // A reversed original stays in the fold; its REVERSAL entry cancels it.
      const rows = await LedgerTransaction.find({
        homecell: fixture.homecellA1a,
        status: { $in: ['POSTED', 'REVERSED'] },
      }).lean();

      const expected = rows.reduce(
        (total, row) => total + (row.direction === 'CREDIT' ? row.amountMinor : -row.amountMinor),
        0,
      );
      expect(summary.availableMinor).toBe(expected);
    });
  });

  describe('purse threshold', () => {
    it('flags a Homecell once its balance reaches the configured maximum', async () => {
      // Push the balance above the ₦100,000 threshold set in the fixture.
      await postTransaction({
        idempotencyKey: `threshold-top-up-${Date.now()}`,
        homecell: fixture.homecellA1a,
        area: fixture.areaA1,
        zone: fixture.zoneA,
        type: 'OTHER_INCOME',
        amountMinor: toMinor(200_000),
        currency: 'NGN',
        valueDate: new Date(),
        description: 'Top-up to breach the threshold',
      });

      const response = await authed(coordinator).get(`/finance/purses/${fixture.homecellA1a}`);

      expect(response.status).toBe(200);
      expect(response.body.data.requiresRemittance).toBe(true);
      expect(response.body.data.suggestedRemittanceMinor).toBeGreaterThan(0);
    });
  });
});

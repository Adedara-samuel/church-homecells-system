import { beforeAll, describe, expect, it } from 'vitest';
import { postTransaction, reverseTransaction } from '../src/modules/finance/ledger.service';
import { TransactionType } from '../src/types/enums';
import { toMinor } from '../src/utils/money';
import { authed, login, resetDatabase, seedFixture, type Fixture } from './helpers';

/**
 * The purse hierarchy.
 *
 *   Homecell — the only unit that holds money.
 *   Area     — holds nothing; shows the purses beneath it.
 *   Zone     — holds what its homecells have remitted.
 *
 * The distinction that matters most is between money a zone has *received* and money
 * its homecells are still *holding*. Adding the two together would double-count every
 * naira the church has, so both are asserted separately here.
 */
describe('Purse hierarchy', () => {
  let fixture: Fixture;
  let sysadmin: string;
  let zonal: string;
  let areaCoordinator: string;
  let coordinator: string;

  const credit = (homecell: string, area: string, zone: string, major: number) =>
    postTransaction({
      idempotencyKey: `test-credit:${Math.random()}`,
      homecell,
      area,
      zone,
      type: TransactionType.OFFERING,
      amountMinor: toMinor(major),
      currency: 'NGN',
      valueDate: new Date(),
      description: 'Test offering',
    });

  const remit = (homecell: string, area: string, zone: string, major: number, dues = false) =>
    postTransaction({
      idempotencyKey: `test-remit:${Math.random()}`,
      homecell,
      area,
      zone,
      type: TransactionType.REMITTANCE,
      amountMinor: toMinor(major),
      currency: 'NGN',
      valueDate: new Date(),
      description: dues ? 'Test dues' : 'Test remittance',
      sourceModel: dues ? 'DuesInvoice' : 'Remittance',
    });

  beforeAll(async () => {
    await resetDatabase();
    fixture = await seedFixture();
    sysadmin = await login('sysadmin@test.org');
    zonal = await login('zonal.a@test.org');
    areaCoordinator = await login('area.a1@test.org');
    coordinator = await login('hc.a1a@test.org');

    // Zone A → Area A1 (Homecells A1a, A1b) and Area A2 (Homecell A2a).
    await credit(fixture.homecellA1a, fixture.areaA1, fixture.zoneA, 100_000);
    await credit(fixture.homecellA1b, fixture.areaA1, fixture.zoneA, 60_000);
    await credit(fixture.homecellA2a, fixture.areaA2, fixture.zoneA, 40_000);
    await credit(fixture.homecellB1a, fixture.areaB1, fixture.zoneB, 25_000);

    // Money that has reached Zone A: one remittance and one dues payment.
    await remit(fixture.homecellA1a, fixture.areaA1, fixture.zoneA, 30_000);
    await remit(fixture.homecellA1b, fixture.areaA1, fixture.zoneA, 5_000, true);
  });

  describe('zone level', () => {
    it('separates what the zone has received from what its homecells still hold', async () => {
      const response = await authed(zonal).get(`/finance/purses/zones/${fixture.zoneA}`);

      expect(response.status).toBe(200);
      const { zone } = response.body.data;

      // Received: 30,000 remitted + 5,000 dues.
      expect(zone.zonePurseMinor).toBe(toMinor(35_000));
      expect(zone.remittanceInflowMinor).toBe(toMinor(30_000));
      expect(zone.duesInflowMinor).toBe(toMinor(5_000));

      // Still held: 200,000 credited less the 35,000 that left the purses.
      expect(zone.homecellHoldingsMinor).toBe(toMinor(165_000));
      expect(zone.areaCount).toBe(2);
      expect(zone.homecellCount).toBe(3);
    });

    it('rolls each area up to the sum of its homecell purses', async () => {
      const response = await authed(zonal).get(`/finance/purses/zones/${fixture.zoneA}`);
      const areas = response.body.data.areas as {
        areaId: string;
        homecellHoldingsMinor: number;
        homecellCount: number;
      }[];

      const a1 = areas.find((area) => area.areaId === fixture.areaA1)!;
      const a2 = areas.find((area) => area.areaId === fixture.areaA2)!;

      // A1a: 100,000 − 30,000 remitted. A1b: 60,000 − 5,000 dues.
      expect(a1.homecellHoldingsMinor).toBe(toMinor(125_000));
      expect(a1.homecellCount).toBe(2);
      expect(a2.homecellHoldingsMinor).toBe(toMinor(40_000));
    });

    it('excludes a reversed remittance from the zone purse', async () => {
      const before = await authed(zonal).get(`/finance/purses/zones/${fixture.zoneA}`);
      const { transaction } = await remit(
        fixture.homecellA2a,
        fixture.areaA2,
        fixture.zoneA,
        10_000,
      );

      const after = await authed(zonal).get(`/finance/purses/zones/${fixture.zoneA}`);
      expect(after.body.data.zone.zonePurseMinor).toBe(
        before.body.data.zone.zonePurseMinor + toMinor(10_000),
      );

      await reverseTransaction(String(transaction._id), 'Sent in error', fixture.users.systemAdmin);

      const reversed = await authed(zonal).get(`/finance/purses/zones/${fixture.zoneA}`);
      expect(reversed.body.data.zone.zonePurseMinor).toBe(before.body.data.zone.zonePurseMinor);
    });

    it('does not let a zonal coordinator open another zone', async () => {
      const response = await authed(zonal).get(`/finance/purses/zones/${fixture.zoneB}`);
      expect(response.status).toBe(403);
    });

    it('lists every zone for a church-wide role, and only one for a zonal coordinator', async () => {
      const all = await authed(sysadmin).get('/finance/purses/zones');
      expect(all.status).toBe(200);
      expect(all.body.data).toHaveLength(2);

      const scoped = await authed(zonal).get('/finance/purses/zones');
      expect(scoped.body.data).toHaveLength(1);
      expect(scoped.body.data[0].zoneId).toBe(fixture.zoneA);
    });
  });

  describe('area level', () => {
    it('returns every homecell purse beneath the area, and their total', async () => {
      const response = await authed(areaCoordinator).get(`/finance/purses/areas/${fixture.areaA1}`);

      expect(response.status).toBe(200);
      expect(response.body.data.purses).toHaveLength(2);
      expect(response.body.data.area.homecellHoldingsMinor).toBe(toMinor(125_000));
      // An area never reports a purse of its own — only what its homecells hold.
      expect(response.body.data.area).not.toHaveProperty('zonePurseMinor');
    });

    it('does not let an area coordinator open an area outside their scope', async () => {
      const response = await authed(areaCoordinator).get(`/finance/purses/areas/${fixture.areaA2}`);
      expect(response.status).toBe(403);
    });

    /**
     * A Homecell Coordinator sees their own purse and nothing else. Their `zoneId` and
     * `areaId` match their own units, which is enough to satisfy the scope checks —
     * those answer "is this your zone?", not "should you see every purse in it?" — so
     * the rollup endpoints refuse them outright.
     */
    it('refuses a homecell coordinator every rollup view', async () => {
      for (const path of [
        '/finance/purses/zones',
        `/finance/purses/zones/${fixture.zoneA}`,
        `/finance/purses/areas/${fixture.areaA1}`,
      ]) {
        const response = await authed(coordinator).get(path);
        expect(response.status).toBe(403);
      }
    });

    it('still lets a homecell coordinator read their own purse', async () => {
      const own = await authed(coordinator).get(`/finance/purses/${fixture.homecellA1a}`);
      expect(own.status).toBe(200);
      expect(own.body.data.homecellId).toBe(fixture.homecellA1a);

      // And not a neighbour's, even by direct reference.
      const other = await authed(coordinator).get(`/finance/purses/${fixture.homecellA1b}`);
      expect(other.status).toBe(403);
    });
  });
});

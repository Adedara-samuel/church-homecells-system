import { beforeAll, describe, expect, it } from 'vitest';
import { authed, login, resetDatabase, seedFixture, type Fixture } from './helpers';

/**
 * Organisational scope is the security property most likely to be broken by a future
 * change, so these tests attack it directly: each one is a coordinator deliberately
 * asking for data belonging to a sibling unit.
 */
describe('Role and organisational scope enforcement', () => {
  let fixture: Fixture;
  let sysadmin: string;
  let churchAdmin: string;
  let zonalA: string;
  let areaA1: string;
  let homecellA1a: string;

  beforeAll(async () => {
    await resetDatabase();
    fixture = await seedFixture();
    sysadmin = await login('sysadmin@test.org');
    churchAdmin = await login('churchadmin@test.org');
    zonalA = await login('zonal.a@test.org');
    areaA1 = await login('area.a1@test.org');
    homecellA1a = await login('hc.a1a@test.org');
  });

  describe('Homecell Coordinator', () => {
    it('sees only members of their own Homecell', async () => {
      const response = await authed(homecellA1a).get('/members?limit=100');
      expect(response.status).toBe(200);
      expect(response.body.data.length).toBe(fixture.members.a1a.length);
      for (const member of response.body.data) {
        expect(member.homecell._id ?? member.homecell).toBe(fixture.homecellA1a);
      }
    });

    it('cannot read a member belonging to a sibling Homecell', async () => {
      const response = await authed(homecellA1a).get(`/members/${fixture.members.a1b[0]}`);
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('OUT_OF_SCOPE');
    });

    it('cannot widen its own list by passing another Homecell id', async () => {
      const response = await authed(homecellA1a).get(`/members?homecellId=${fixture.homecellA1b}`);
      expect(response.status).toBe(403);
    });

    it('cannot escape scope by requesting a whole Zone', async () => {
      const response = await authed(homecellA1a).get(`/members?zoneId=${fixture.zoneA}`);
      // Scoped to a Homecell, the Zone filter can only ever intersect with it.
      if (response.status === 200) {
        for (const member of response.body.data) {
          expect(member.homecell._id ?? member.homecell).toBe(fixture.homecellA1a);
        }
      } else {
        expect(response.status).toBe(403);
      }
    });

    it('cannot create a user', async () => {
      const response = await authed(homecellA1a).post('/users').send({
        firstName: 'Should',
        lastName: 'Fail',
        email: 'should.fail@test.org',
        phone: '+2348090000001',
        role: 'HOMECELL_COORDINATOR',
        homecellId: fixture.homecellA1a,
      });
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('cannot approve an expense', async () => {
      const created = await authed(homecellA1a).post('/finance/expenses').send({
        homecellId: fixture.homecellA1a,
        categoryId: fixture.categoryId,
        amount: 1000,
        date: new Date().toISOString().slice(0, 10),
        description: 'Test expense awaiting approval',
      });
      expect(created.status).toBe(201);

      const approval = await authed(homecellA1a).post(
        `/finance/expenses/${created.body.data._id}/approve`,
      );
      expect(approval.status).toBe(403);
    });
  });

  describe('Area Coordinator', () => {
    it('sees members across every Homecell in their Area', async () => {
      const response = await authed(areaA1).get('/members?limit=100');
      expect(response.status).toBe(200);
      expect(response.body.data.length).toBe(
        fixture.members.a1a.length + fixture.members.a1b.length,
      );
    });

    it('cannot reach a Homecell in another Area', async () => {
      const response = await authed(areaA1).get(`/finance/purses/${fixture.homecellA2a}`);
      expect(response.status).toBe(403);
    });

    it('cannot reach an Area in another Zone', async () => {
      const response = await authed(areaA1).get(`/areas/${fixture.areaB1}`);
      expect(response.status).toBe(403);
    });
  });

  describe('Zonal Coordinator', () => {
    it('sees every Area in their own Zone only', async () => {
      const response = await authed(zonalA).get('/areas?limit=100');
      expect(response.status).toBe(200);
      const ids = response.body.data.map((area: { _id: string }) => area._id);
      expect(ids).toContain(fixture.areaA1);
      expect(ids).toContain(fixture.areaA2);
      expect(ids).not.toContain(fixture.areaB1);
    });

    it('cannot read a Homecell in another Zone', async () => {
      const response = await authed(zonalA).get(`/homecells/${fixture.homecellB1a}`);
      expect(response.status).toBe(403);
    });

    it('cannot create a Zone', async () => {
      const response = await authed(zonalA)
        .post('/zones')
        .send({ code: 'ZC', name: 'Zone C' });
      expect(response.status).toBe(403);
    });
  });

  describe('Church Administrator', () => {
    it('sees members church-wide', async () => {
      const response = await authed(churchAdmin).get('/members?limit=100');
      expect(response.status).toBe(200);
      expect(response.body.data.length).toBe(
        fixture.members.a1a.length + fixture.members.a1b.length,
      );
    });

    it('cannot change system settings', async () => {
      const response = await authed(churchAdmin).patch('/settings').send({ churchName: 'Changed' });
      expect(response.status).toBe(403);
    });

    it('cannot create a System Administrator account', async () => {
      const response = await authed(churchAdmin).post('/users').send({
        firstName: 'New',
        lastName: 'Admin',
        email: 'new.admin@test.org',
        phone: '+2348090000002',
        role: 'SYSTEM_ADMIN',
      });
      expect(response.status).toBe(403);
    });
  });

  describe('System Administrator', () => {
    it('reads across every zone', async () => {
      const response = await authed(sysadmin).get('/zones?limit=100');
      expect(response.status).toBe(200);
      expect(response.body.data.length).toBe(2);
    });

    it('can change system settings', async () => {
      const response = await authed(sysadmin).patch('/settings').send({ churchName: 'Renamed Assembly' });
      expect(response.status).toBe(200);
      expect(response.body.data.churchName).toBe('Renamed Assembly');
    });
  });
});

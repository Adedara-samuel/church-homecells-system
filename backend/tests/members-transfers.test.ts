import { beforeAll, describe, expect, it } from 'vitest';
import { Member } from '../src/modules/members/member.model';
import { MemberTransfer } from '../src/modules/transfers/transfer.model';
import { authed, login, resetDatabase, seedFixture, type Fixture } from './helpers';

describe('Members and transfers', () => {
  let fixture: Fixture;
  let coordinator: string;
  let areaCoordinator: string;
  let zonalCoordinator: string;
  let churchAdmin: string;

  beforeAll(async () => {
    await resetDatabase();
    fixture = await seedFixture();
    coordinator = await login('hc.a1a@test.org');
    areaCoordinator = await login('area.a1@test.org');
    zonalCoordinator = await login('zonal.a@test.org');
    churchAdmin = await login('churchadmin@test.org');
  });

  describe('registration', () => {
    it('derives Area and Zone from the chosen Homecell', async () => {
      const response = await authed(coordinator).post('/members').send({
        firstName: 'Chidera',
        lastName: 'Okafor',
        sex: 'FEMALE',
        phone: '+2348051234567',
        maritalStatus: 'SINGLE',
        membershipCategory: 'MEMBER',
        homecellId: fixture.homecellA1a,
      });

      expect(response.status).toBe(201);
      expect(response.body.data.area._id ?? response.body.data.area).toBe(fixture.areaA1);
      expect(response.body.data.zone._id ?? response.body.data.zone).toBe(fixture.zoneA);
      expect(response.body.data.memberId).toMatch(/^MBR-\d{6}$/);
    });

    it('refuses to register into a Homecell outside the caller’s scope', async () => {
      const response = await authed(coordinator).post('/members').send({
        firstName: 'Should',
        lastName: 'Fail',
        sex: 'MALE',
        phone: '+2348051234568',
        maritalStatus: 'SINGLE',
        membershipCategory: 'MEMBER',
        homecellId: fixture.homecellA1b,
      });

      expect(response.status).toBe(403);
    });

    it('rejects an invalid payload with field-level detail', async () => {
      const response = await authed(coordinator).post('/members').send({
        firstName: 'A',
        lastName: 'B',
        sex: 'INVALID',
        phone: 'not-a-phone',
        maritalStatus: 'SINGLE',
        membershipCategory: 'MEMBER',
        homecellId: fixture.homecellA1a,
      });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(response.body.error.details)).toBe(true);
    });

    it('finds members by search term', async () => {
      const response = await authed(coordinator).get('/members?search=Chidera');
      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data[0].firstName).toBe('Chidera');
    });

    it('paginates results', async () => {
      const response = await authed(coordinator).get('/members?page=1&limit=2');
      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeLessThanOrEqual(2);
      expect(response.body.meta.pagination.limit).toBe(2);
    });
  });

  describe('transfers', () => {
    it('classifies a move within the same Area and applies it after one approval', async () => {
      const memberId = fixture.members.a1a[0];

      const requested = await authed(coordinator).post('/transfers').send({
        memberId,
        destinationHomecellId: fixture.homecellA1b,
        reason: 'Relocated closer to the destination Homecell',
      });

      expect(requested.status).toBe(201);
      expect(requested.body.data.scope).toBe('SAME_AREA');
      expect(requested.body.data.status).toBe('PENDING');

      // The member has not moved while the request is pending.
      const during = await Member.findById(memberId);
      expect(String(during!.homecell)).toBe(fixture.homecellA1a);

      const approved = await authed(areaCoordinator).post(
        `/transfers/${requested.body.data._id}/approve`,
      );

      expect(approved.status).toBe(200);
      expect(approved.body.data.status).toBe('APPROVED');

      const after = await Member.findById(memberId);
      expect(String(after!.homecell)).toBe(fixture.homecellA1b);
      // BR-017: the previous assignment is retained.
      expect(String(after!.previousHomecell)).toBe(fixture.homecellA1a);
    });

    it('requires two approvals for a cross-area transfer', async () => {
      const memberId = fixture.members.a1a[1];

      const requested = await authed(coordinator).post('/transfers').send({
        memberId,
        destinationHomecellId: fixture.homecellA2a,
        reason: 'Family joined the destination Homecell',
      });

      expect(requested.body.data.scope).toBe('CROSS_AREA');
      expect(requested.body.data.approvalChain.length).toBe(2);

      const firstApproval = await authed(areaCoordinator).post(
        `/transfers/${requested.body.data._id}/approve`,
      );
      expect(firstApproval.status).toBe(200);
      // Still pending: one stage remains.
      expect(firstApproval.body.data.status).toBe('PENDING');
      expect(firstApproval.body.data.currentStageIndex).toBe(1);

      const stillThere = await Member.findById(memberId);
      expect(String(stillThere!.homecell)).toBe(fixture.homecellA1a);

      const secondApproval = await authed(zonalCoordinator).post(
        `/transfers/${requested.body.data._id}/approve`,
      );
      expect(secondApproval.body.data.status).toBe('APPROVED');

      const moved = await Member.findById(memberId);
      expect(String(moved!.homecell)).toBe(fixture.homecellA2a);
      expect(String(moved!.area)).toBe(fixture.areaA2);
    });

    it('requires three approvals for a cross-zone transfer', async () => {
      const memberId = fixture.members.a1a[2];

      const requested = await authed(coordinator).post('/transfers').send({
        memberId,
        destinationHomecellId: fixture.homecellB1a,
        reason: 'Work relocation to another part of the city',
      });

      expect(requested.body.data.scope).toBe('CROSS_ZONE');
      expect(requested.body.data.approvalChain.length).toBe(3);

      await authed(areaCoordinator).post(`/transfers/${requested.body.data._id}/approve`);
      await authed(zonalCoordinator).post(`/transfers/${requested.body.data._id}/approve`);
      const final = await authed(churchAdmin).post(`/transfers/${requested.body.data._id}/approve`);

      expect(final.body.data.status).toBe('APPROVED');

      const moved = await Member.findById(memberId);
      expect(String(moved!.zone)).toBe(fixture.zoneB);
    });

    it('leaves the member in place when a transfer is rejected', async () => {
      const memberId = fixture.members.a1b[0];
      const homecellB = await login('hc.a1b@test.org');

      const requested = await authed(homecellB).post('/transfers').send({
        memberId,
        destinationHomecellId: fixture.homecellA2a,
        reason: 'Requested a Homecell nearer to residence',
      });

      const rejected = await authed(areaCoordinator)
        .post(`/transfers/${requested.body.data._id}/reject`)
        .send({ reason: 'Outstanding responsibilities in the current Homecell' });

      expect(rejected.status).toBe(200);
      expect(rejected.body.data.status).toBe('REJECTED');

      const unchanged = await Member.findById(memberId);
      expect(String(unchanged!.homecell)).toBe(fixture.homecellA1b);
    });

    it('refuses a second pending transfer for the same member', async () => {
      const memberId = fixture.members.a1b[1];
      const homecellB = await login('hc.a1b@test.org');

      const first = await authed(homecellB).post('/transfers').send({
        memberId,
        destinationHomecellId: fixture.homecellA1a,
        reason: 'Moved after marriage',
      });
      expect(first.status).toBe(201);

      const second = await authed(homecellB).post('/transfers').send({
        memberId,
        destinationHomecellId: fixture.homecellA2a,
        reason: 'A second, conflicting request',
      });
      expect(second.status).toBe(409);
    });

    it('rejects a transfer to the member’s current Homecell', async () => {
      const response = await authed(coordinator).post('/transfers').send({
        memberId: fixture.members.a1a[3],
        destinationHomecellId: fixture.homecellA1a,
        reason: 'A transfer that goes nowhere',
      });

      expect(response.status).toBe(422);
    });

    it('keeps a permanent transfer history for the member', async () => {
      const memberId = fixture.members.a1a[0];
      const response = await authed(churchAdmin).get(`/transfers/member/${memberId}`);

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data[0].previousHomecell).toBeTruthy();

      const stored = await MemberTransfer.countDocuments({ member: memberId });
      expect(stored).toBeGreaterThan(0);
    });
  });
});

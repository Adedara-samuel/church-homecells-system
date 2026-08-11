import { beforeAll, describe, expect, it } from 'vitest';
import { Attendance } from '../src/modules/attendance/attendance.model';
import { authed, lastWeekday, login, resetDatabase, seedFixture, type Fixture } from './helpers';

describe('Attendance', () => {
  let fixture: Fixture;
  let coordinator: string;

  beforeAll(async () => {
    await resetDatabase();
    fixture = await seedFixture();
    coordinator = await login('hc.a1a@test.org');
  });

  const sunday = () => lastWeekday(0);
  const monday = () => lastWeekday(1);
  const tuesday = () => lastWeekday(2);
  const thursday = () => lastWeekday(4);

  const entries = (status: 'PRESENT' | 'ABSENT' = 'PRESENT') =>
    fixture.members.a1a.map((memberId) => ({ memberId, status }));

  describe('day-of-week validation (BR-005 – BR-007)', () => {
    it('accepts Sunday Homecell attendance on a Sunday', async () => {
      const response = await authed(coordinator).post('/attendance').send({
        homecellId: fixture.homecellA1a,
        type: 'SUNDAY_HOMECELL',
        date: sunday(),
        entries: entries(),
      });

      expect(response.status).toBe(201);
      expect(response.body.data.present).toBe(fixture.members.a1a.length);
    });

    it('rejects Sunday Homecell attendance on a Monday', async () => {
      const response = await authed(coordinator).post('/attendance').send({
        homecellId: fixture.homecellA1a,
        type: 'SUNDAY_HOMECELL',
        date: monday(),
        entries: entries(),
      });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('BUSINESS_RULE_VIOLATION');
      expect(response.body.error.details.rule).toBe('BR-005');
      expect(response.body.error.message).toMatch(/Sunday/);
    });

    it('rejects Tuesday Miracle Service attendance on a Thursday', async () => {
      const response = await authed(coordinator).post('/attendance').send({
        homecellId: fixture.homecellA1a,
        type: 'TUESDAY_MIRACLE_SERVICE',
        date: thursday(),
        entries: entries(),
      });

      expect(response.status).toBe(422);
      expect(response.body.error.details.rule).toBe('BR-006');
    });

    it('rejects Thursday Hour of Emphasis attendance on a Tuesday', async () => {
      const response = await authed(coordinator).post('/attendance').send({
        homecellId: fixture.homecellA1a,
        type: 'THURSDAY_HOUR_OF_EMPHASIS',
        date: tuesday(),
        entries: entries(),
      });

      expect(response.status).toBe(422);
      expect(response.body.error.details.rule).toBe('BR-007');
    });

    it('accepts each service on its own day', async () => {
      const tuesdayResponse = await authed(coordinator).post('/attendance').send({
        homecellId: fixture.homecellA1a,
        type: 'TUESDAY_MIRACLE_SERVICE',
        date: tuesday(),
        entries: entries(),
      });
      const thursdayResponse = await authed(coordinator).post('/attendance').send({
        homecellId: fixture.homecellA1a,
        type: 'THURSDAY_HOUR_OF_EMPHASIS',
        date: thursday(),
        entries: entries(),
      });

      expect(tuesdayResponse.status).toBe(201);
      expect(thursdayResponse.status).toBe(201);
    });
  });

  describe('duplicate prevention (BR-009)', () => {
    it('updates rather than duplicating when the same register is submitted twice', async () => {
      const date = lastWeekday(0, 1);

      const first = await authed(coordinator).post('/attendance').send({
        homecellId: fixture.homecellA1a,
        type: 'SUNDAY_HOMECELL',
        date,
        entries: entries('PRESENT'),
      });
      expect(first.status).toBe(201);
      expect(first.body.data.created).toBe(fixture.members.a1a.length);

      const second = await authed(coordinator).post('/attendance').send({
        homecellId: fixture.homecellA1a,
        type: 'SUNDAY_HOMECELL',
        date,
        entries: entries('ABSENT'),
      });
      expect(second.status).toBe(201);
      expect(second.body.data.created).toBe(0);
      expect(second.body.data.updated).toBe(fixture.members.a1a.length);

      // One row per member/event/date, whatever the submission count.
      const count = await Attendance.countDocuments({
        homecell: fixture.homecellA1a,
        type: 'SUNDAY_HOMECELL',
        date: new Date(`${date}T00:00:00.000Z`),
      });
      expect(count).toBe(fixture.members.a1a.length);
    });

    it('enforces uniqueness at the database level', async () => {
      const date = new Date(`${lastWeekday(0, 2)}T00:00:00.000Z`);
      const base = {
        member: fixture.members.a1a[0],
        homecell: fixture.homecellA1a,
        area: fixture.areaA1,
        zone: fixture.zoneA,
        type: 'SUNDAY_HOMECELL' as const,
        date,
        status: 'PRESENT' as const,
        recordedBy: fixture.users.homecellA1a,
      };

      await Attendance.create(base);
      // Even a direct model write cannot bypass BR-009.
      await expect(Attendance.create(base)).rejects.toThrow();
    });
  });

  describe('register and scope', () => {
    it('reports an invalid date without refusing to build the register', async () => {
      const response = await authed(coordinator).get(
        `/attendance/register?homecellId=${fixture.homecellA1a}&type=SUNDAY_HOMECELL&date=${monday()}`,
      );

      expect(response.status).toBe(200);
      expect(response.body.data.isValidDate).toBe(false);
      expect(response.body.data.requiredDayName).toBe('Sunday');
      expect(response.body.data.entries.length).toBe(fixture.members.a1a.length);
    });

    it('refuses to record attendance for another Homecell', async () => {
      const response = await authed(coordinator).post('/attendance').send({
        homecellId: fixture.homecellA1b,
        type: 'SUNDAY_HOMECELL',
        date: sunday(),
        entries: fixture.members.a1b.map((memberId) => ({ memberId, status: 'PRESENT' })),
      });

      expect(response.status).toBe(403);
    });

    it('ignores members who do not belong to the Homecell', async () => {
      const response = await authed(coordinator).post('/attendance').send({
        homecellId: fixture.homecellA1a,
        type: 'SUNDAY_HOMECELL',
        date: lastWeekday(0, 3),
        entries: [
          { memberId: fixture.members.a1a[0], status: 'PRESENT' },
          // Belongs to a different Homecell and must be silently skipped.
          { memberId: fixture.members.a1b[0], status: 'PRESENT' },
        ],
      });

      expect(response.status).toBe(201);
      expect(response.body.data.total).toBe(1);
      expect(response.body.data.skipped).toBe(1);
    });
  });

  it('computes attendance percentages', async () => {
    const response = await authed(coordinator).get('/attendance/summary');
    expect(response.status).toBe(200);
    expect(response.body.data.overall.total).toBeGreaterThan(0);
    expect(response.body.data.byType.length).toBe(3);
  });
});

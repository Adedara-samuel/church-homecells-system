import type { Application } from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { hashPassword } from '../src/modules/auth/password';
import { Area } from '../src/modules/areas/area.model';
import { ExpenseCategory } from '../src/modules/finance/expense.model';
import { Homecell } from '../src/modules/homecells/homecell.model';
import { Member } from '../src/modules/members/member.model';
import { SystemSettings } from '../src/modules/settings/settings.model';
import { invalidateSettingsCache } from '../src/modules/settings/settings.service';
import { User } from '../src/modules/users/user.model';
import { Zone } from '../src/modules/zones/zone.model';
import { Role, Sex, UserStatus } from '../src/types/enums';
import { toMinor } from '../src/utils/money';

export const TEST_PASSWORD = 'TestPass#2026';
export const API = env.API_PREFIX;

let app: Application | undefined;

export function getApp(): Application {
  if (!app) app = createApp();
  return app;
}

/** Empties every collection between suites so tests never depend on each other. */
export async function resetDatabase(): Promise<void> {
  const collections = await mongoose.connection.db!.collections();
  for (const collection of collections) {
    await collection.deleteMany({});
  }
  invalidateSettingsCache();
}

export interface Fixture {
  zoneA: string;
  zoneB: string;
  areaA1: string;
  areaA2: string;
  areaB1: string;
  homecellA1a: string;
  homecellA1b: string;
  homecellA2a: string;
  homecellB1a: string;
  categoryId: string;
  users: {
    systemAdmin: string;
    churchAdmin: string;
    zonalA: string;
    areaA1: string;
    homecellA1a: string;
    homecellA1b: string;
    inactive: string;
  };
  members: { a1a: string[]; a1b: string[] };
}

/**
 * Builds a small but complete organisation:
 *   Zone A → Area A1 → Homecells A1a, A1b
 *          → Area A2 → Homecell A2a
 *   Zone B → Area B1 → Homecell B1a
 *
 * Two zones and two areas are essential: they make cross-scope access attempts
 * testable, which a single-branch fixture cannot do.
 */
export async function seedFixture(): Promise<Fixture> {
  const passwordHash = await hashPassword(TEST_PASSWORD);

  await SystemSettings.create({
    key: 'SYSTEM',
    churchName: 'Test Assembly',
    currency: 'NGN',
    maxPurseThresholdMinor: toMinor(100_000),
    expenseApprovalRequired: true,
    expenseApprovalThresholdMinor: 0,
    remittanceRequiresApproval: true,
    remittanceRequiresReceipt: false,
  });
  invalidateSettingsCache();

  const zoneA = await Zone.create({ code: 'ZA', name: 'Zone A' });
  const zoneB = await Zone.create({ code: 'ZB', name: 'Zone B' });

  const areaA1 = await Area.create({ code: 'AA1', name: 'Area A1', zone: zoneA._id });
  const areaA2 = await Area.create({ code: 'AA2', name: 'Area A2', zone: zoneA._id });
  const areaB1 = await Area.create({ code: 'AB1', name: 'Area B1', zone: zoneB._id });

  const homecellA1a = await Homecell.create({
    code: 'HA1A', name: 'Homecell A1a', area: areaA1._id, zone: zoneA._id,
  });
  const homecellA1b = await Homecell.create({
    code: 'HA1B', name: 'Homecell A1b', area: areaA1._id, zone: zoneA._id,
  });
  const homecellA2a = await Homecell.create({
    code: 'HA2A', name: 'Homecell A2a', area: areaA2._id, zone: zoneA._id,
  });
  const homecellB1a = await Homecell.create({
    code: 'HB1A', name: 'Homecell B1a', area: areaB1._id, zone: zoneB._id,
  });

  const category = await ExpenseCategory.create({
    code: 'GENERAL',
    name: 'General',
    approvalThresholdMinor: 0,
    requiresReceipt: false,
    isActive: true,
  });

  const makeUser = async (
    email: string,
    role: Role,
    scope: { zone?: unknown; area?: unknown; homecell?: unknown } = {},
    status: UserStatus = UserStatus.ACTIVE,
  ) => {
    const user = await User.create({
      firstName: role.split('_')[0],
      lastName: 'Tester',
      email,
      phone: `+234800${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
      passwordHash,
      role,
      status,
      zone: scope.zone ?? null,
      area: scope.area ?? null,
      homecell: scope.homecell ?? null,
    });
    return String(user._id);
  };

  const users = {
    systemAdmin: await makeUser('sysadmin@test.org', Role.SYSTEM_ADMIN),
    churchAdmin: await makeUser('churchadmin@test.org', Role.CHURCH_ADMIN),
    zonalA: await makeUser('zonal.a@test.org', Role.ZONAL_COORDINATOR, { zone: zoneA._id }),
    areaA1: await makeUser('area.a1@test.org', Role.AREA_COORDINATOR, {
      zone: zoneA._id,
      area: areaA1._id,
    }),
    homecellA1a: await makeUser('hc.a1a@test.org', Role.HOMECELL_COORDINATOR, {
      zone: zoneA._id,
      area: areaA1._id,
      homecell: homecellA1a._id,
    }),
    homecellA1b: await makeUser('hc.a1b@test.org', Role.HOMECELL_COORDINATOR, {
      zone: zoneA._id,
      area: areaA1._id,
      homecell: homecellA1b._id,
    }),
    inactive: await makeUser(
      'inactive@test.org',
      Role.HOMECELL_COORDINATOR,
      { zone: zoneA._id, area: areaA1._id, homecell: homecellA1a._id },
      UserStatus.INACTIVE,
    ),
  };

  const makeMembers = async (homecell: typeof homecellA1a, count: number, prefix: string) => {
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const member = await Member.create({
        memberId: `MBR-${prefix}${String(i).padStart(4, '0')}`,
        firstName: `${prefix}Member`,
        lastName: `Number${i}`,
        sex: i % 2 === 0 ? Sex.MALE : Sex.FEMALE,
        phone: `+234801${String(1_000_000 + i).slice(0, 7)}`,
        dateOfBirth: new Date(Date.UTC(1990, i % 12, (i % 27) + 1)),
        zone: homecell.zone,
        area: homecell.area,
        homecell: homecell._id,
      });
      ids.push(String(member._id));
    }
    return ids;
  };

  return {
    zoneA: String(zoneA._id),
    zoneB: String(zoneB._id),
    areaA1: String(areaA1._id),
    areaA2: String(areaA2._id),
    areaB1: String(areaB1._id),
    homecellA1a: String(homecellA1a._id),
    homecellA1b: String(homecellA1b._id),
    homecellA2a: String(homecellA2a._id),
    homecellB1a: String(homecellB1a._id),
    categoryId: String(category._id),
    users,
    members: {
      a1a: await makeMembers(homecellA1a, 4, 'A'),
      a1b: await makeMembers(homecellA1b, 3, 'B'),
    },
  };
}

/** Signs in and returns the access token for use as a bearer credential. */
export async function login(email: string, password = TEST_PASSWORD): Promise<string> {
  const response = await request(getApp())
    .post(`${API}/auth/login`)
    .send({ identifier: email, password });

  if (response.status !== 200) {
    throw new Error(`Login failed for ${email}: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body.data.accessToken as string;
}

export function authed(token: string) {
  const agent = request(getApp());
  return {
    get: (path: string) => agent.get(`${API}${path}`).set('Authorization', `Bearer ${token}`),
    post: (path: string) => agent.post(`${API}${path}`).set('Authorization', `Bearer ${token}`),
    patch: (path: string) => agent.patch(`${API}${path}`).set('Authorization', `Bearer ${token}`),
    delete: (path: string) => agent.delete(`${API}${path}`).set('Authorization', `Bearer ${token}`),
  };
}

/** Most recent past (or current) date falling on `weekday`, as `YYYY-MM-DD`. */
export function lastWeekday(weekday: number, weeksAgo = 0): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  while (date.getUTCDay() !== weekday) date.setUTCDate(date.getUTCDate() - 1);
  date.setUTCDate(date.getUTCDate() - weeksAgo * 7);
  return date.toISOString().slice(0, 10);
}

/* eslint-disable no-console */
import mongoose, { Types } from 'mongoose';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { connectDatabase, disconnectDatabase } from '../db/connection';
import { Counter, nextSequence } from '../db/counter.model';
import {
  ATTENDANCE_TYPE_WEEKDAY,
  AttendanceStatus,
  AttendanceType,
  AuditAction,
  AuditModule,
  BaptismStatus,
  ExpenseStatus,
  MaritalStatus,
  MembershipCategory,
  MembershipStatus,
  NotificationSeverity,
  NotificationType,
  OrgStatus,
  PaymentDirection,
  PaymentProviderName,
  PaymentPurpose,
  PaymentStatus,
  ReconciliationStatus,
  RemittanceChannel,
  RemittanceStatus,
  Role,
  Sex,
  TransactionStatus,
  TransactionType,
  TransferApprovalStage,
  TransferScope,
  TransferStatus,
  UserStatus,
} from '../types/enums';
import { dayjs, toCalendarDate } from '../utils/dates';
import { idString, references } from '../utils/ids';
import { toMinor } from '../utils/money';
import { hashPassword } from '../modules/auth/password';
import { RefreshToken } from '../modules/auth/refreshToken.model';
import { Area } from '../modules/areas/area.model';
import { Attendance } from '../modules/attendance/attendance.model';
import { AuditLog } from '../modules/audit/audit.model';
import { Expense, ExpenseCategory } from '../modules/finance/expense.model';
import { LedgerTransaction } from '../modules/finance/ledger.model';
import { Offering, OfferingChannel } from '../modules/finance/offering.model';
import { Homecell } from '../modules/homecells/homecell.model';
import { Member } from '../modules/members/member.model';
import { Notification } from '../modules/notifications/notification.model';
import { Payment, WebhookEvent } from '../modules/payments/payment.model';
import { ReconciliationRun } from '../modules/payments/reconciliation.model';
import { Remittance } from '../modules/remittances/remittance.model';
import { SystemSettings } from '../modules/settings/settings.model';
import { SmsLog } from '../modules/sms/sms.model';
import { MemberTransfer } from '../modules/transfers/transfer.model';
import { User } from '../modules/users/user.model';
import { Zone } from '../modules/zones/zone.model';
import {
  DEPARTMENTS,
  EXPENSE_CATEGORIES,
  EXPENSE_DESCRIPTIONS,
  FEMALE_NAMES,
  LOCATIONS,
  MALE_NAMES,
  MIDDLE_NAMES,
  OCCUPATIONS,
  OFFERING_DESCRIPTIONS,
  STREET_NAMES,
  STRUCTURE,
  SURNAMES,
  TRANSFER_REASONS,
} from './data';

// ---------------------------------------------------------------------------
// Deterministic pseudo-randomness
// ---------------------------------------------------------------------------

/**
 * A fixed seed means every developer, CI run and demo gets the *same* data.
 * Reproducible demo figures matter: a screenshot of the dashboard stays valid.
 */
let rngState = 0x2f6e2b1;
function random(): number {
  rngState ^= rngState << 13;
  rngState ^= rngState >>> 17;
  rngState ^= rngState << 5;
  return Math.abs(rngState % 100_000) / 100_000;
}
const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];
const between = (min: number, max: number): number => Math.floor(random() * (max - min + 1)) + min;
const chance = (probability: number): boolean => random() < probability;

const DEFAULT_PASSWORD = env.SEED_DEFAULT_PASSWORD;

interface SeedContext {
  passwordHash: string;
  zones: { id: Types.ObjectId; code: string; name: string }[];
  areas: { id: Types.ObjectId; code: string; name: string; zone: Types.ObjectId }[];
  homecells: {
    id: Types.ObjectId;
    code: string;
    name: string;
    area: Types.ObjectId;
    zone: Types.ObjectId;
  }[];
  users: Record<string, Types.ObjectId>;
  categories: Record<string, Types.ObjectId>;
  members: {
    id: Types.ObjectId;
    homecell: Types.ObjectId;
    area: Types.ObjectId;
    zone: Types.ObjectId;
  }[];
  systemAdminId: Types.ObjectId;
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

const ALL_MODELS = [
  User, Zone, Area, Homecell, Member, MemberTransfer, Attendance,
  LedgerTransaction, Offering, Expense, ExpenseCategory, Remittance,
  Payment, WebhookEvent, ReconciliationRun, Notification, SmsLog,
  SystemSettings, RefreshToken, Counter, AuditLog,
];

/**
 * Drops collections outright rather than deleting their documents.
 *
 * Clearing documents leaves the *indexes* behind, so a schema change that removes or
 * alters an index would keep failing against a stale one. Dropping and resyncing gives
 * a genuinely clean database.
 */
async function wipe(): Promise<void> {
  console.log('  Clearing existing collections…');
  for (const model of ALL_MODELS) {
    const collection = (model as unknown as { collection: { drop: () => Promise<unknown> } })
      .collection;
    try {
      await collection.drop();
    } catch (err) {
      // 26 = NamespaceNotFound: the collection was never created. Nothing to do.
      if ((err as { code?: number }).code !== 26) throw err;
    }
  }
  await syncIndexes();
}

/** Rebuilds indexes from the schemas, removing any that no longer exist. */
async function syncIndexes(): Promise<void> {
  for (const model of ALL_MODELS) {
    await (model as unknown as { syncIndexes: () => Promise<unknown> }).syncIndexes();
  }
}

// ---------------------------------------------------------------------------
// Structure & users
// ---------------------------------------------------------------------------

async function seedSettings(): Promise<void> {
  await SystemSettings.create({
    key: 'SYSTEM',
    churchName: 'Grace Assembly International',
    currency: 'NGN',
    maxPurseThresholdMinor: toMinor(100_000),
    expenseApprovalRequired: true,
    expenseApprovalThresholdMinor: toMinor(5_000),
    remittanceRequiresApproval: true,
    remittanceRequiresReceipt: true,
    generalPurseAccountName: 'Grace Assembly — General Homecell Purse',
    generalPurseAccountNumber: '0123456789',
    generalPurseBankName: 'Zenith Bank',
    activePaymentProvider: PaymentProviderName.MOCK,
    activeSmsProvider: 'MOCK',
    smsSenderId: 'GraceHC',
    transferApprovalChainSameArea: [TransferApprovalStage.AREA_COORDINATOR],
    transferApprovalChainCrossArea: [
      TransferApprovalStage.AREA_COORDINATOR,
      TransferApprovalStage.ZONAL_COORDINATOR,
    ],
    transferApprovalChainCrossZone: [
      TransferApprovalStage.AREA_COORDINATOR,
      TransferApprovalStage.ZONAL_COORDINATOR,
      TransferApprovalStage.CHURCH_ADMIN,
    ],
  });
}

async function seedStructureAndUsers(passwordHash: string): Promise<SeedContext> {
  const context: SeedContext = {
    passwordHash,
    zones: [],
    areas: [],
    homecells: [],
    users: {},
    categories: {},
    members: [],
    systemAdminId: new Types.ObjectId(),
  };

  const systemAdmin = await User.create({
    firstName: 'Adebayo',
    lastName: 'Ogunleye',
    email: 'sysadmin@graceassembly.org',
    phone: '+2348030000001',
    passwordHash,
    role: Role.SYSTEM_ADMIN,
    status: UserStatus.ACTIVE,
    mustChangePassword: false,
  });
  context.systemAdminId = systemAdmin._id;
  context.users.sysadmin = systemAdmin._id;

  const churchAdmin = await User.create({
    firstName: 'Ngozi',
    lastName: 'Okonkwo',
    email: 'churchadmin@graceassembly.org',
    phone: '+2348030000002',
    passwordHash,
    role: Role.CHURCH_ADMIN,
    status: UserStatus.ACTIVE,
    mustChangePassword: false,
    createdBy: systemAdmin._id,
  });
  context.users.churchadmin = churchAdmin._id;

  // Zones, areas and homecells, each with a coordinator whose assignment is
  // denormalised down the hierarchy exactly as the application does at runtime.
  let zonalIndex = 0;
  let areaIndex = 0;
  let homecellIndex = 0;

  for (const zoneSpec of STRUCTURE) {
    const zone = await Zone.create({
      code: zoneSpec.code,
      name: zoneSpec.name,
      description: zoneSpec.description,
      status: OrgStatus.ACTIVE,
      createdBy: systemAdmin._id,
    });
    context.zones.push({ id: zone._id, code: zone.code, name: zone.name });

    zonalIndex += 1;
    const zonalCoordinator = await User.create({
      firstName: MALE_NAMES[zonalIndex % MALE_NAMES.length],
      lastName: SURNAMES[zonalIndex % SURNAMES.length],
      email: `zonal${zonalIndex}@graceassembly.org`,
      phone: `+23480310000${String(zonalIndex).padStart(2, '0')}`,
      passwordHash,
      role: Role.ZONAL_COORDINATOR,
      status: UserStatus.ACTIVE,
      mustChangePassword: false,
      zone: zone._id,
      createdBy: systemAdmin._id,
    });
    zone.coordinator = zonalCoordinator._id;
    await zone.save();
    if (zonalIndex === 1) context.users.zonal = zonalCoordinator._id;

    for (const areaSpec of zoneSpec.areas) {
      const area = await Area.create({
        code: areaSpec.code,
        name: areaSpec.name,
        zone: zone._id,
        status: OrgStatus.ACTIVE,
        createdBy: systemAdmin._id,
      });
      context.areas.push({ id: area._id, code: area.code, name: area.name, zone: zone._id });

      areaIndex += 1;
      const areaCoordinator = await User.create({
        firstName: FEMALE_NAMES[areaIndex % FEMALE_NAMES.length],
        lastName: SURNAMES[(areaIndex + 7) % SURNAMES.length],
        email: `area${areaIndex}@graceassembly.org`,
        phone: `+23480320000${String(areaIndex).padStart(2, '0')}`,
        passwordHash,
        role: Role.AREA_COORDINATOR,
        status: UserStatus.ACTIVE,
        mustChangePassword: false,
        zone: zone._id,
        area: area._id,
        createdBy: systemAdmin._id,
      });
      area.coordinator = areaCoordinator._id;
      await area.save();
      if (areaIndex === 1) context.users.area = areaCoordinator._id;

      for (const homecellSpec of areaSpec.homecells) {
        const homecell = await Homecell.create({
          code: homecellSpec.code,
          name: homecellSpec.name,
          area: area._id,
          zone: zone._id,
          meetingLocation: homecellSpec.location,
          meetingAddress: homecellSpec.address,
          status: OrgStatus.ACTIVE,
          createdBy: systemAdmin._id,
        });
        context.homecells.push({
          id: homecell._id,
          code: homecell.code,
          name: homecell.name,
          area: area._id,
          zone: zone._id,
        });

        homecellIndex += 1;
        const coordinator = await User.create({
          firstName: homecellIndex % 2 === 0 ? pick(MALE_NAMES) : pick(FEMALE_NAMES),
          lastName: SURNAMES[(homecellIndex + 13) % SURNAMES.length],
          email: `homecell${homecellIndex}@graceassembly.org`,
          phone: `+23480330000${String(homecellIndex).padStart(2, '0')}`,
          passwordHash,
          role: Role.HOMECELL_COORDINATOR,
          status: UserStatus.ACTIVE,
          mustChangePassword: false,
          zone: zone._id,
          area: area._id,
          homecell: homecell._id,
          createdBy: systemAdmin._id,
        });
        homecell.coordinator = coordinator._id;
        await homecell.save();
        if (homecellIndex === 1) context.users.homecell = coordinator._id;
      }
    }
  }

  // One deactivated account so the "inactive users cannot sign in" rule is
  // demonstrable straight from the seed data (SRS FR-AUTH-004).
  await User.create({
    firstName: 'Yetunde',
    lastName: 'Balogun',
    email: 'inactive.coordinator@graceassembly.org',
    phone: '+2348039999999',
    passwordHash,
    role: Role.HOMECELL_COORDINATOR,
    status: UserStatus.INACTIVE,
    mustChangePassword: false,
    zone: context.zones[0].id,
    area: context.areas[0].id,
    homecell: context.homecells[0].id,
    createdBy: systemAdmin._id,
  });

  return context;
}

async function seedExpenseCategories(context: SeedContext): Promise<void> {
  for (const category of EXPENSE_CATEGORIES) {
    const created = await ExpenseCategory.create({ ...category, isActive: true });
    context.categories[category.code] = created._id;
  }
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

async function seedMembers(context: SeedContext): Promise<void> {
  const today = dayjs.utc();

  for (const homecell of context.homecells) {
    const memberCount = between(14, 26);

    for (let i = 0; i < memberCount; i += 1) {
      const isFemale = chance(0.55);
      const sex = isFemale ? Sex.FEMALE : Sex.MALE;
      const firstName = isFemale ? pick(FEMALE_NAMES) : pick(MALE_NAMES);
      const lastName = pick(SURNAMES);
      const location = pick(LOCATIONS);

      const age = between(6, 78);
      const dateOfBirth = today
        .subtract(age, 'year')
        .subtract(between(0, 364), 'day')
        .startOf('day');

      const isAdult = age >= 24;
      const married = isAdult && chance(0.45);
      const weddingAnniversary = married
        ? today.subtract(between(1, 25), 'year').subtract(between(0, 364), 'day').startOf('day')
        : null;

      // A few celebrants land on today so the SMS jobs and dashboard have
      // something real to show the moment the demo starts.
      const forceBirthdayToday = i === 0 && chance(0.35);
      const forceAnniversaryToday = married && i === 1 && chance(0.35);

      const sequence = await nextSequence('member');

      // ~92% active; the rest exercise the inactive / relocated paths.
      const statusRoll = random();
      const membershipStatus =
        statusRoll > 0.96
          ? MembershipStatus.RELOCATED
          : statusRoll > 0.92
            ? MembershipStatus.INACTIVE
            : MembershipStatus.ACTIVE;

      const member = await Member.create({
        memberId: references.member(sequence),
        firstName,
        middleName: chance(0.4) ? pick(MIDDLE_NAMES) : undefined,
        lastName,
        preferredName: chance(0.2) ? firstName : undefined,
        sex,
        dateOfBirth: forceBirthdayToday
          ? today.subtract(age, 'year').startOf('day').toDate()
          : dateOfBirth.toDate(),
        phone: `+23480${between(10000000, 99999999)}`,
        alternatePhone: chance(0.25) ? `+23490${between(10000000, 99999999)}` : undefined,
        email: chance(0.55)
          ? `${firstName.toLowerCase()}.${lastName.toLowerCase()}${between(1, 99)}@example.com`
          : undefined,
        maritalStatus: married
          ? MaritalStatus.MARRIED
          : isAdult && chance(0.06)
            ? MaritalStatus.WIDOWED
            : MaritalStatus.SINGLE,
        weddingAnniversary: forceAnniversaryToday
          ? today.subtract(between(1, 20), 'year').startOf('day').toDate()
          : (weddingAnniversary?.toDate() ?? null),
        residentialAddress: `${between(1, 120)} ${pick(STREET_NAMES)}`,
        location: {
          state: location.state,
          lga: location.lga,
          city: location.city,
          community: pick(location.communities),
          street: pick(STREET_NAMES),
        },
        occupation: age >= 18 ? pick(OCCUPATIONS) : 'Student',
        emergencyContact: {
          name: `${pick(isFemale ? MALE_NAMES : FEMALE_NAMES)} ${lastName}`,
          relationship: pick(['Spouse', 'Parent', 'Sibling', 'Guardian', 'Friend']),
          phone: `+23480${between(10000000, 99999999)}`,
        },
        dateJoinedChurch: today.subtract(between(30, 2200), 'day').startOf('day').toDate(),
        membershipStatus,
        membershipCategory: chance(0.12)
          ? MembershipCategory.LEADER
          : chance(0.3)
            ? MembershipCategory.WORKER
            : chance(0.15)
              ? MembershipCategory.NEW_CONVERT
              : MembershipCategory.MEMBER,
        zone: homecell.zone,
        area: homecell.area,
        homecell: homecell.id,
        baptismStatus: chance(0.6)
          ? BaptismStatus.BOTH
          : chance(0.5)
            ? BaptismStatus.WATER_BAPTISED
            : BaptismStatus.NOT_BAPTISED,
        department: chance(0.5) ? pick(DEPARTMENTS) : undefined,
        membershipClassCompleted: chance(0.65),
        createdBy: context.systemAdminId,
      });

      if (membershipStatus === MembershipStatus.ACTIVE) {
        context.members.push({
          id: member._id,
          homecell: homecell.id,
          area: homecell.area,
          zone: homecell.zone,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

/** Every occurrence of `weekday` within the last `weeks` weeks, oldest first. */
function recentWeekdays(weekday: number, weeks: number): Date[] {
  const dates: Date[] = [];
  let cursor = dayjs.utc().startOf('day');
  while (cursor.day() !== weekday) cursor = cursor.subtract(1, 'day');
  for (let i = 0; i < weeks; i += 1) {
    dates.push(cursor.subtract(i, 'week').toDate());
  }
  return dates.reverse();
}

async function seedAttendance(context: SeedContext): Promise<number> {
  const WEEKS = 10;
  const membersByHomecell = new Map<string, SeedContext['members']>();
  for (const member of context.members) {
    const key = idString(member.homecell);
    if (!membersByHomecell.has(key)) membersByHomecell.set(key, []);
    membersByHomecell.get(key)!.push(member);
  }

  const operations: Record<string, unknown>[] = [];

  for (const type of Object.values(AttendanceType)) {
    const dates = recentWeekdays(ATTENDANCE_TYPE_WEEKDAY[type], WEEKS);

    for (const homecell of context.homecells) {
      const members = membersByHomecell.get(idString(homecell.id)) ?? [];
      if (members.length === 0) continue;

      const coordinatorId = context.users.homecell;

      for (const date of dates) {
        // Sunday Homecell draws the strongest turnout; midweek services are lower.
        const baseRate =
          type === AttendanceType.SUNDAY_HOMECELL
            ? 0.82
            : type === AttendanceType.TUESDAY_MIRACLE_SERVICE
              ? 0.64
              : 0.58;
        const rate = Math.min(0.97, Math.max(0.35, baseRate + (random() - 0.5) * 0.2));

        for (const member of members) {
          operations.push({
            member: member.id,
            homecell: homecell.id,
            area: homecell.area,
            zone: homecell.zone,
            type,
            date,
            status: random() < rate ? AttendanceStatus.PRESENT : AttendanceStatus.ABSENT,
            recordedBy: coordinatorId,
          });
        }
      }
    }
  }

  // Chunked so a large church does not build one enormous insert.
  for (let i = 0; i < operations.length; i += 2000) {
    await Attendance.insertMany(operations.slice(i, i + 2000), { ordered: false });
  }
  return operations.length;
}

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

interface LedgerSeedEntry {
  homecell: Types.ObjectId;
  area: Types.ObjectId;
  zone: Types.ObjectId;
  type: TransactionType;
  direction: 'CREDIT' | 'DEBIT';
  amountMinor: number;
  valueDate: Date;
  description: string;
  reference: string;
  idempotencyKey: string;
  sourceModel?: 'Offering' | 'Expense' | 'Remittance' | 'Payment';
  sourceId?: Types.ObjectId;
  createdBy: Types.ObjectId;
  approvedBy?: Types.ObjectId;
}

async function seedFinance(context: SeedContext) {
  const sundays = recentWeekdays(0, 10);
  const ledgerEntries: LedgerSeedEntry[] = [];
  const stats = { offerings: 0, expenses: 0, remittances: 0, payments: 0 };

  for (const homecell of context.homecells) {
    const coordinator = context.users.homecell;

    // --- opening balance ---------------------------------------------------
    const openingMinor = toMinor(between(5, 40) * 1000);
    const openingRef = references.transaction();
    ledgerEntries.push({
      homecell: homecell.id,
      area: homecell.area,
      zone: homecell.zone,
      type: TransactionType.OPENING_BALANCE,
      direction: 'CREDIT',
      amountMinor: openingMinor,
      valueDate: dayjs.utc().subtract(11, 'week').toDate(),
      description: 'Opening balance carried forward',
      reference: openingRef,
      idempotencyKey: `opening:${idString(homecell.id)}`,
      createdBy: context.systemAdminId,
      approvedBy: context.systemAdminId,
    });

    // --- weekly offerings --------------------------------------------------
    for (const sunday of sundays) {
      const amountMinor = toMinor(between(18, 85) * 1000);
      const reference = references.offering();
      const offering = await Offering.create({
        reference,
        homecell: homecell.id,
        area: homecell.area,
        zone: homecell.zone,
        date: toCalendarDate(sunday),
        amountMinor,
        currency: 'NGN',
        channel: chance(0.85) ? OfferingChannel.CASH : OfferingChannel.BANK_TRANSFER,
        description: pick(OFFERING_DESCRIPTIONS),
        status: TransactionStatus.POSTED,
        recordedBy: coordinator,
      });
      stats.offerings += 1;

      ledgerEntries.push({
        homecell: homecell.id,
        area: homecell.area,
        zone: homecell.zone,
        type: TransactionType.OFFERING,
        direction: 'CREDIT',
        amountMinor,
        valueDate: toCalendarDate(sunday),
        description: offering.description ?? 'Sunday Homecell offering',
        reference,
        idempotencyKey: `offering:${idString(offering._id)}`,
        sourceModel: 'Offering',
        sourceId: offering._id,
        createdBy: coordinator,
      });
    }

    // --- expenses ----------------------------------------------------------
    const expenseCount = between(2, 5);
    for (let i = 0; i < expenseCount; i += 1) {
      const categoryCode = pick(Object.keys(EXPENSE_DESCRIPTIONS));
      const categoryId = context.categories[categoryCode];
      const amountMinor = toMinor(between(2, 22) * 1000);
      const date = dayjs.utc().subtract(between(1, 60), 'day').startOf('day').toDate();
      const reference = references.expense();

      // A realistic mix: mostly approved, some awaiting a decision, one rejected.
      const roll = random();
      const status =
        roll > 0.85
          ? ExpenseStatus.PENDING_APPROVAL
          : roll > 0.8
            ? ExpenseStatus.REJECTED
            : ExpenseStatus.APPROVED;

      const expense = await Expense.create({
        reference,
        homecell: homecell.id,
        area: homecell.area,
        zone: homecell.zone,
        date,
        category: categoryId,
        description: pick(EXPENSE_DESCRIPTIONS[categoryCode]),
        amountMinor,
        currency: 'NGN',
        status,
        submittedBy: coordinator,
        submittedAt: date,
        approvedBy: status === ExpenseStatus.PENDING_APPROVAL ? null : context.users.area,
        approvedAt: status === ExpenseStatus.PENDING_APPROVAL ? null : date,
        rejectionReason:
          status === ExpenseStatus.REJECTED ? 'Not covered by the approved expense policy.' : null,
      });
      stats.expenses += 1;

      // BR-015: only an approved expense reaches the ledger.
      if (status === ExpenseStatus.APPROVED) {
        ledgerEntries.push({
          homecell: homecell.id,
          area: homecell.area,
          zone: homecell.zone,
          type: TransactionType.EXPENSE,
          direction: 'DEBIT',
          amountMinor,
          valueDate: date,
          description: expense.description,
          reference,
          idempotencyKey: `expense:${idString(expense._id)}`,
          sourceModel: 'Expense',
          sourceId: expense._id,
          createdBy: coordinator,
          approvedBy: context.users.area,
        });
      }
    }

    // --- remittances -------------------------------------------------------
    const remittanceCount = between(1, 3);
    for (let i = 0; i < remittanceCount; i += 1) {
      const amountMinor = toMinor(between(20, 60) * 1000);
      const date = dayjs.utc().subtract(between(3, 55), 'day').startOf('day').toDate();
      const reference = references.remittance();

      const roll = random();
      const status =
        roll > 0.82
          ? RemittanceStatus.PENDING_APPROVAL
          : roll > 0.74
            ? RemittanceStatus.APPROVED
            : RemittanceStatus.SUCCESSFUL;

      const remittance = await Remittance.create({
        reference,
        homecell: homecell.id,
        area: homecell.area,
        zone: homecell.zone,
        date,
        amountMinor,
        currency: 'NGN',
        channel: RemittanceChannel.MANUAL,
        status,
        paymentReference: `TRF${between(100000, 999999)}`,
        receivingAccount: 'Grace Assembly — General Homecell Purse',
        description: 'Remittance to the General Homecell Purse',
        receiptUrl:
          status === RemittanceStatus.PENDING_APPROVAL
            ? null
            : 'https://res.cloudinary.com/demo/image/upload/sample_receipt.jpg',
        recordedBy: coordinator,
        approvedBy: status === RemittanceStatus.PENDING_APPROVAL ? null : context.users.area,
        approvedAt: status === RemittanceStatus.PENDING_APPROVAL ? null : date,
        verifiedBy: status === RemittanceStatus.SUCCESSFUL ? context.users.churchadmin : null,
        verifiedAt: status === RemittanceStatus.SUCCESSFUL ? date : null,
      });
      stats.remittances += 1;

      // BR-011: only a completed remittance reduces the purse.
      if (status === RemittanceStatus.SUCCESSFUL) {
        ledgerEntries.push({
          homecell: homecell.id,
          area: homecell.area,
          zone: homecell.zone,
          type: TransactionType.REMITTANCE,
          direction: 'DEBIT',
          amountMinor,
          valueDate: date,
          description: 'Remittance to the General Homecell Purse',
          reference,
          idempotencyKey: `remittance:${idString(remittance._id)}`,
          sourceModel: 'Remittance',
          sourceId: remittance._id,
          createdBy: coordinator,
          approvedBy: context.users.area,
        });
      }
    }
  }

  // --- ledger ---------------------------------------------------------------
  const created = await LedgerTransaction.insertMany(
    ledgerEntries.map((entry) => ({
      transactionRef: entry.reference.startsWith('TXN')
        ? entry.reference
        : references.transaction(),
      idempotencyKey: entry.idempotencyKey,
      homecell: entry.homecell,
      area: entry.area,
      zone: entry.zone,
      type: entry.type,
      direction: entry.direction,
      amountMinor: entry.amountMinor,
      currency: 'NGN',
      status: TransactionStatus.POSTED,
      valueDate: entry.valueDate,
      description: entry.description,
      reference: entry.reference,
      sourceModel: entry.sourceModel ?? null,
      sourceId: entry.sourceId ?? null,
      createdBy: entry.createdBy,
      approvedBy: entry.approvedBy ?? null,
      approvedAt: entry.approvedBy ? entry.valueDate : null,
      postedAt: entry.valueDate,
    })),
    { ordered: false },
  );

  // Link each source document back to its posting so the UI can drill through.
  for (const transaction of created) {
    if (!transaction.sourceModel || !transaction.sourceId) continue;
    const model = (
      transaction.sourceModel === 'Offering'
        ? Offering
        : transaction.sourceModel === 'Expense'
          ? Expense
          : Remittance
    ) as unknown as {
      updateOne: (filter: object, update: object) => Promise<unknown>;
    };
    await model.updateOne(
      { _id: transaction.sourceId },
      { $set: { ledgerTransaction: transaction._id } },
    );
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Payments — successful, failed and pending, plus a reconciliation run
// ---------------------------------------------------------------------------

async function seedPayments(context: SeedContext): Promise<number> {
  let count = 0;

  for (const homecell of context.homecells.slice(0, 6)) {
    const scenarios: { status: PaymentStatus; settle: boolean }[] = [
      { status: PaymentStatus.SUCCESSFUL, settle: true },
      { status: PaymentStatus.FAILED, settle: false },
      { status: PaymentStatus.PENDING, settle: false },
    ];

    for (const scenario of scenarios) {
      const amountMinor = toMinor(between(5, 30) * 1000);
      const reference = references.payment();
      const createdAt = dayjs.utc().subtract(between(1, 25), 'day').toDate();

      const payment = await Payment.create({
        reference,
        idempotencyKey: `payment-in:${reference}`,
        direction: PaymentDirection.INBOUND,
        purpose: PaymentPurpose.OFFERING,
        provider: PaymentProviderName.MOCK,
        homecell: homecell.id,
        area: homecell.area,
        zone: homecell.zone,
        amountMinor,
        currency: 'NGN',
        status: scenario.status,
        customerEmail: 'member@example.com',
        customerName: `${pick(MALE_NAMES)} ${pick(SURNAMES)}`,
        description: 'Online Homecell offering',
        providerReference: `MOCK-${between(100000, 999999)}`,
        providerAmountMinor: scenario.settle ? amountMinor : null,
        providerStatusRaw: scenario.status.toLowerCase(),
        failureReason:
          scenario.status === PaymentStatus.FAILED ? 'Insufficient funds on the card' : null,
        reconciliationStatus: scenario.settle
          ? ReconciliationStatus.MATCHED
          : ReconciliationStatus.UNRECONCILED,
        reconciledAt: scenario.settle ? createdAt : null,
        initiatedBy: context.users.homecell,
        completedAt: scenario.status === PaymentStatus.PENDING ? null : createdAt,
        createdAt,
        statusHistory: [
          { status: PaymentStatus.PENDING, at: createdAt, source: 'SYSTEM' },
          ...(scenario.status === PaymentStatus.PENDING
            ? []
            : [{ status: scenario.status, at: createdAt, source: 'WEBHOOK' as const }]),
        ],
      });
      count += 1;

      // A successful online payment produces both an Offering record and a
      // ledger credit — the same pair the live webhook handler creates.
      if (scenario.settle) {
        const offering = await Offering.create({
          reference: references.offering(),
          homecell: homecell.id,
          area: homecell.area,
          zone: homecell.zone,
          date: toCalendarDate(createdAt),
          amountMinor,
          currency: 'NGN',
          channel: OfferingChannel.ONLINE_PAYMENT,
          description: 'Online Homecell offering',
          status: TransactionStatus.POSTED,
          payment: payment._id,
          paymentProvider: PaymentProviderName.MOCK,
          recordedBy: context.users.homecell,
        });

        const [transaction] = await LedgerTransaction.create([
          {
            transactionRef: references.transaction(),
            idempotencyKey: `payment:${reference}`,
            homecell: homecell.id,
            area: homecell.area,
            zone: homecell.zone,
            type: TransactionType.OFFERING,
            direction: 'CREDIT',
            amountMinor,
            currency: 'NGN',
            status: TransactionStatus.POSTED,
            valueDate: toCalendarDate(createdAt),
            description: 'Online Homecell offering',
            reference,
            sourceModel: 'Offering',
            sourceId: offering._id,
            paymentProvider: PaymentProviderName.MOCK,
            providerReference: payment.providerReference,
            createdBy: context.users.homecell,
            postedAt: createdAt,
          },
        ]);

        offering.ledgerTransaction = transaction._id;
        await offering.save();
        payment.ledgerTransaction = transaction._id;
        payment.relatedModel = 'Offering';
        payment.relatedId = offering._id;
        await payment.save();
      }
    }
  }

  // A completed reconciliation run with one outstanding exception, so the
  // reconciliation console has something meaningful on first load.
  const orphanReference = references.payment();
  await ReconciliationRun.create({
    provider: PaymentProviderName.MOCK,
    from: dayjs.utc().subtract(7, 'day').toDate(),
    to: new Date(),
    trigger: 'SCHEDULED',
    startedAt: dayjs.utc().subtract(1, 'day').toDate(),
    completedAt: dayjs.utc().subtract(1, 'day').add(4, 'second').toDate(),
    totalChecked: count,
    matched: Math.max(count - 1, 0),
    mismatched: 0,
    orphaned: 1,
    unresolved: 1,
    exceptions: [
      {
        reference: orphanReference,
        providerReference: `MOCK-${between(100000, 999999)}`,
        status: ReconciliationStatus.ORPHANED,
        reason: 'Provider transaction has no matching internal record',
        providerAmountMinor: toMinor(7_500),
        providerStatus: PaymentStatus.SUCCESSFUL,
        resolved: false,
      },
    ],
  });

  return count;
}

// ---------------------------------------------------------------------------
// Transfers, notifications, SMS and audit history
// ---------------------------------------------------------------------------

async function seedTransfers(context: SeedContext): Promise<number> {
  let count = 0;

  // A spread across same-area, cross-area and cross-zone moves, in each state.
  const candidates = context.members.filter((_, index) => index % 37 === 0).slice(0, 12);

  for (const [index, member] of candidates.entries()) {
    const sameArea = context.homecells.filter(
      (h) => idString(h.area) === idString(member.area) && idString(h.id) !== idString(member.homecell),
    );
    const crossArea = context.homecells.filter(
      (h) => idString(h.zone) === idString(member.zone) && idString(h.area) !== idString(member.area),
    );
    const crossZone = context.homecells.filter(
      (h) => idString(h.zone) !== idString(member.zone),
    );

    const bucket = index % 3 === 0 ? sameArea : index % 3 === 1 ? crossArea : crossZone;
    if (bucket.length === 0) continue;
    const destination = pick(bucket);

    const scope =
      idString(destination.zone) !== idString(member.zone)
        ? TransferScope.CROSS_ZONE
        : idString(destination.area) !== idString(member.area)
          ? TransferScope.CROSS_AREA
          : TransferScope.SAME_AREA;

    const stages =
      scope === TransferScope.CROSS_ZONE
        ? [
            TransferApprovalStage.AREA_COORDINATOR,
            TransferApprovalStage.ZONAL_COORDINATOR,
            TransferApprovalStage.CHURCH_ADMIN,
          ]
        : scope === TransferScope.CROSS_AREA
          ? [TransferApprovalStage.AREA_COORDINATOR, TransferApprovalStage.ZONAL_COORDINATOR]
          : [TransferApprovalStage.AREA_COORDINATOR];

    const roll = index % 5;
    const status =
      roll === 0
        ? TransferStatus.PENDING
        : roll === 1
          ? TransferStatus.REJECTED
          : TransferStatus.APPROVED;

    const requestedAt = dayjs.utc().subtract(between(2, 70), 'day').toDate();

    await MemberTransfer.create({
      reference: references.transfer(),
      member: member.id,
      previousZone: member.zone,
      previousArea: member.area,
      previousHomecell: member.homecell,
      newZone: destination.zone,
      newArea: destination.area,
      newHomecell: destination.id,
      scope,
      reason: pick(TRANSFER_REASONS),
      status,
      approvalChain: stages.map((stage, stageIndex) => ({
        stage,
        approver:
          status === TransferStatus.PENDING && stageIndex > 0 ? null : context.users.area,
        decidedAt: status === TransferStatus.PENDING && stageIndex > 0 ? null : requestedAt,
        decision:
          status === TransferStatus.PENDING && stageIndex > 0
            ? null
            : status === TransferStatus.REJECTED
              ? 'REJECTED'
              : 'APPROVED',
      })),
      currentStageIndex: status === TransferStatus.PENDING ? 0 : stages.length,
      requestedBy: context.users.homecell,
      requestedAt,
      completedBy: status === TransferStatus.PENDING ? null : context.users.churchadmin,
      completedAt: status === TransferStatus.PENDING ? null : requestedAt,
      rejectionReason:
        status === TransferStatus.REJECTED
          ? 'The member has outstanding responsibilities in the current Homecell.'
          : undefined,
    });
    count += 1;

    // An approved transfer must be reflected on the member record (BR-017).
    if (status === TransferStatus.APPROVED) {
      await Member.updateOne(
        { _id: member.id },
        {
          $set: {
            previousHomecell: member.homecell,
            homecell: destination.id,
            area: destination.area,
            zone: destination.zone,
          },
        },
      );
    }
  }

  return count;
}

async function seedNotifications(context: SeedContext): Promise<number> {
  const notifications = [
    {
      recipient: context.users.homecell,
      type: NotificationType.PURSE_THRESHOLD_REACHED,
      severity: NotificationSeverity.WARNING,
      title: 'Homecell purse has reached its maximum threshold',
      message:
        'Grace Homecell purse balance is at or above the configured maximum of ₦100,000.00. ' +
        'Please remit the required amount to the General Homecell Purse.',
      actionUrl: '/finance/remittances',
      isRead: false,
    },
    {
      recipient: context.users.area,
      type: NotificationType.EXPENSE_PENDING_APPROVAL,
      severity: NotificationSeverity.INFO,
      title: 'Expense awaiting approval',
      message: 'Zion Homecell submitted a ₦12,000.00 expense (Meeting Materials) for approval.',
      actionUrl: '/finance/expenses',
      isRead: false,
    },
    {
      recipient: context.users.zonal,
      type: NotificationType.TRANSFER_INITIATED,
      severity: NotificationSeverity.INFO,
      title: 'Member transfer awaiting your approval',
      message: 'A cross-area transfer request needs your decision.',
      actionUrl: '/transfers',
      isRead: false,
    },
    {
      recipient: context.users.churchadmin,
      type: NotificationType.RECONCILIATION_EXCEPTION,
      severity: NotificationSeverity.CRITICAL,
      title: 'Payment reconciliation exceptions detected',
      message: '1 exception found while reconciling MOCK payments. Review it in the finance console.',
      actionUrl: '/finance/reconciliation',
      isRead: false,
    },
    {
      recipient: context.users.sysadmin,
      type: NotificationType.PAYMENT_SUCCESSFUL,
      severity: NotificationSeverity.SUCCESS,
      title: 'Payment received',
      message: 'An online offering payment was successful and applied to the Homecell purse.',
      actionUrl: '/finance/payments',
      isRead: true,
      readAt: new Date(),
    },
  ];

  await Notification.insertMany(notifications, { ordered: false });
  return notifications.length;
}

async function seedSmsLogs(context: SeedContext): Promise<number> {
  const celebrants = await Member.find({ membershipStatus: MembershipStatus.ACTIVE })
    .select('firstName lastName phone')
    .limit(24)
    .lean();

  const logs = celebrants.map((member, index) => {
    const sentAt = dayjs.utc().subtract(index, 'day').toDate();
    const isBirthday = index % 3 !== 0;
    return {
      member: member._id,
      recipientName: `${member.firstName} ${member.lastName}`,
      phone: member.phone,
      type: isBirthday ? 'BIRTHDAY' : 'WEDDING_ANNIVERSARY',
      message: isBirthday
        ? `Happy Birthday ${member.firstName}! We celebrate you and pray that this new year of your life will be filled with God's blessings, joy and fulfilment. Happy Birthday from your church family at Grace Assembly International.`
        : `Happy Wedding Anniversary ${member.firstName}! We rejoice with you and pray for continued love, peace and grace in your home. With love from your church family at Grace Assembly International.`,
      provider: 'MOCK',
      status: index % 11 === 0 ? 'FAILED' : 'DELIVERED',
      providerReference: `MOCK-SMS-${index}${Date.now().toString(36).toUpperCase()}`,
      error: index % 11 === 0 ? 'Recipient number is unreachable' : null,
      segments: 2,
      dedupeKey: `${isBirthday ? 'BIRTHDAY' : 'ANNIVERSARY'}:${idString(member._id)}:${dayjs
        .utc(sentAt)
        .format('YYYY-MM-DD')}`,
      sentAt,
      deliveredAt: index % 11 === 0 ? null : sentAt,
    };
  });

  await SmsLog.insertMany(logs, { ordered: false });
  void context;
  return logs.length;
}

async function seedAuditLogs(context: SeedContext): Promise<number> {
  const entries = [
    {
      user: context.users.sysadmin,
      userName: 'Adebayo Ogunleye',
      userRole: Role.SYSTEM_ADMIN,
      action: AuditAction.CREATE,
      module: AuditModule.ZONES,
      description: 'Created Zone Ikeja Zone (ZN-01)',
      entityModel: 'Zone',
      entityLabel: 'Ikeja Zone',
    },
    {
      user: context.users.sysadmin,
      userName: 'Adebayo Ogunleye',
      userRole: Role.SYSTEM_ADMIN,
      action: AuditAction.CREATE,
      module: AuditModule.USERS,
      description: 'Created CHURCH_ADMIN account for Ngozi Okonkwo',
      entityModel: 'User',
      entityLabel: 'churchadmin@graceassembly.org',
    },
    {
      user: context.users.homecell,
      userName: 'Homecell Coordinator',
      userRole: Role.HOMECELL_COORDINATOR,
      action: AuditAction.CREATE,
      module: AuditModule.ATTENDANCE,
      description: 'Recorded Sunday Homecell attendance for Grace Homecell',
      entityModel: 'Attendance',
    },
    {
      user: context.users.area,
      userName: 'Area Coordinator',
      userRole: Role.AREA_COORDINATOR,
      action: AuditAction.APPROVE,
      module: AuditModule.FINANCE,
      description: 'Approved an expense of ₦12,000.00',
      entityModel: 'Expense',
    },
    {
      user: context.users.churchadmin,
      userName: 'Ngozi Okonkwo',
      userRole: Role.CHURCH_ADMIN,
      action: AuditAction.APPROVE,
      module: AuditModule.REMITTANCES,
      description: 'Verified a remittance to the General Homecell Purse',
      entityModel: 'Remittance',
    },
    {
      user: null,
      userName: 'Payment provider',
      userRole: 'SYSTEM',
      action: AuditAction.PAYMENT_WEBHOOK,
      module: AuditModule.PAYMENTS,
      description: 'Payment settled successfully via webhook',
      entityModel: 'Payment',
    },
  ];

  // insertMany bypasses the append-only guard on the model, which is what the
  // seed needs and nothing else in the application does.
  await AuditLog.collection.insertMany(
    entries.map((entry, index) => ({
      ...entry,
      success: true,
      createdAt: dayjs.utc().subtract(index * 3, 'hour').toDate(),
    })) as never[],
  );

  return entries.length;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  const fresh = process.argv.includes('--fresh');
  const started = Date.now();

  console.log('\n  Church Homecell Management System — database seed');
  console.log(`  Target: ${env.MONGODB_URI}\n`);

  await connectDatabase();

  const existingUsers = await User.estimatedDocumentCount();
  if (existingUsers > 0 && !fresh) {
    console.log(
      '  The database already contains data.\n' +
        '  Re-run with `npm run seed:fresh` to wipe it and seed from scratch.\n',
    );
    await disconnectDatabase();
    return;
  }

  if (fresh) await wipe();
  else await syncIndexes();

  console.log('  Seeding system settings…');
  await seedSettings();

  console.log('  Seeding users and church structure…');
  const passwordHash = await hashPassword(DEFAULT_PASSWORD);
  const context = await seedStructureAndUsers(passwordHash);

  console.log('  Seeding expense categories…');
  await seedExpenseCategories(context);

  console.log('  Seeding members…');
  await seedMembers(context);

  console.log('  Seeding attendance history…');
  const attendanceCount = await seedAttendance(context);

  console.log('  Seeding finance (offerings, expenses, remittances, ledger)…');
  const finance = await seedFinance(context);

  console.log('  Seeding payments and reconciliation…');
  const paymentCount = await seedPayments(context);

  console.log('  Seeding member transfers…');
  const transferCount = await seedTransfers(context);

  console.log('  Seeding notifications, SMS logs and audit trail…');
  const notificationCount = await seedNotifications(context);
  const smsCount = await seedSmsLogs(context);
  const auditCount = await seedAuditLogs(context);

  const memberTotal = await Member.countDocuments();

  console.log('\n  Seed complete in ' + ((Date.now() - started) / 1000).toFixed(1) + 's\n');
  console.log('  ─── Data ─────────────────────────────────────────');
  console.log(`   Zones                 ${context.zones.length}`);
  console.log(`   Areas                 ${context.areas.length}`);
  console.log(`   Homecells             ${context.homecells.length}`);
  console.log(`   Members               ${memberTotal}`);
  console.log(`   Attendance records    ${attendanceCount}`);
  console.log(`   Offerings             ${finance.offerings}`);
  console.log(`   Expenses              ${finance.expenses}`);
  console.log(`   Remittances           ${finance.remittances}`);
  console.log(`   Payments              ${paymentCount}`);
  console.log(`   Transfers             ${transferCount}`);
  console.log(`   Notifications         ${notificationCount}`);
  console.log(`   SMS logs              ${smsCount}`);
  console.log(`   Audit entries         ${auditCount}`);

  console.log('\n  ─── Demo credentials ─────────────────────────────');
  console.log('   All accounts share the password below.\n');
  console.log(`   System Administrator   sysadmin@graceassembly.org`);
  console.log(`   Church Administrator   churchadmin@graceassembly.org`);
  console.log(`   Zonal Coordinator      zonal1@graceassembly.org`);
  console.log(`   Area Coordinator       area1@graceassembly.org`);
  console.log(`   Homecell Coordinator   homecell1@graceassembly.org`);
  console.log(`   Inactive account       inactive.coordinator@graceassembly.org`);
  console.log(`\n   Password               ${DEFAULT_PASSWORD}`);
  console.log('\n   Change these before deploying anywhere real.\n');

  await disconnectDatabase();
}

run()
  .then(() => process.exit(0))
  .catch(async (err) => {
    logger.error({ err }, 'Seed failed');
    console.error('\n  Seed failed:', (err as Error).message, '\n');
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  });

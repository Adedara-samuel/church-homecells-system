import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MailLog } from '../src/modules/mail/mail.model';
import {
  celebrationHtml,
  celebrationSubject,
  celebrationText,
} from '../src/modules/mail/templates/celebration';
import { Member } from '../src/modules/members/member.model';
import { SmsLog } from '../src/modules/sms/sms.model';
import {
  dispatchAnniversaryMessages,
  dispatchBirthdayMessages,
} from '../src/modules/sms/sms.service';
import { MembershipStatus, Sex } from '../src/types/enums';
import { resetDatabase, seedFixture, type Fixture } from './helpers';

/**
 * Celebration greetings.
 *
 * Email is the primary channel and SMS the fallback, so the tests that matter are the
 * routing rules and the guarantee nobody is greeted twice — a duplicate birthday email
 * is the kind of mistake a whole congregation notices.
 */
describe('Celebration greetings', () => {
  let fixture: Fixture;

  const today = new Date();
  const monthDay = `${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(
    today.getUTCDate(),
  ).padStart(2, '0')}`;

  const makeMember = async (overrides: Record<string, unknown>) =>
    Member.create({
      memberId: `MBR-${Math.random().toString().slice(2, 8)}`,
      firstName: 'Grace',
      lastName: 'Tester',
      sex: Sex.FEMALE,
      phone: `+2348${Math.floor(100_000_000 + Math.random() * 800_000_000)}`,
      dateOfBirth: new Date(Date.UTC(1990, today.getUTCMonth(), today.getUTCDate())),
      birthMonthDay: monthDay,
      membershipStatus: MembershipStatus.ACTIVE,
      zone: fixture.zoneA,
      area: fixture.areaA1,
      homecell: fixture.homecellA1a,
      ...overrides,
    });

  beforeAll(async () => {
    await resetDatabase();
    fixture = await seedFixture();
  });

  beforeEach(async () => {
    await Promise.all([
      Member.deleteMany({ birthMonthDay: monthDay }),
      Member.deleteMany({ anniversaryMonthDay: monthDay }),
      MailLog.deleteMany({}),
      SmsLog.deleteMany({}),
    ]);
  });

  describe('the template', () => {
    const input = {
      kind: 'BIRTHDAY' as const,
      name: 'Chiamaka',
      churchName: 'Grace Assembly',
      message: 'Happy birthday from all of us.',
      homecellName: 'Overcomers Homecell',
    };

    it('produces a subject, an HTML body and a plain-text alternative', () => {
      expect(celebrationSubject(input)).toContain('Chiamaka');
      expect(celebrationText(input)).toContain('Happy birthday from all of us.');
      // A message with no text part is scored as spam by most filters.
      expect(celebrationText(input).length).toBeGreaterThan(20);
    });

    it('escapes a name that would otherwise break the markup', () => {
      const html = celebrationHtml({ ...input, name: 'Tunde & <script>alert(1)</script>' });

      expect(html).not.toContain('<script>');
      expect(html).toContain('&amp;');
      expect(html).toContain('&lt;script&gt;');
    });

    it('lays out with tables and no remote images, so it survives every client', () => {
      const html = celebrationHtml(input);

      expect(html).not.toMatch(/display:\s*(flex|grid)/i);
      expect(html).not.toMatch(/<img/i);
      // Gmail clips a message over ~102KB, hiding whatever follows.
      expect(html.length).toBeLessThan(102_400);
    });

    it('omits the portal button entirely when there is no URL to point at', () => {
      expect(celebrationHtml(input)).not.toContain('Visit the church portal');
      expect(celebrationHtml({ ...input, portalUrl: 'https://example.org' })).toContain(
        'Visit the church portal',
      );
    });
  });

  describe('routing', () => {
    it('greets a member with an email by email, not SMS', async () => {
      await makeMember({ email: 'celebrant@example.org' });

      const result = await dispatchBirthdayMessages(today);

      expect(result.attempted).toBe(1);
      expect(await MailLog.countDocuments({ type: 'BIRTHDAY' })).toBe(1);
      expect(await SmsLog.countDocuments({})).toBe(0);
    });

    it('falls back to SMS for a member with no email', async () => {
      await makeMember({ email: undefined });

      await dispatchBirthdayMessages(today);

      expect(await MailLog.countDocuments({})).toBe(0);
      expect(await SmsLog.countDocuments({ type: 'BIRTHDAY' })).toBe(1);
    });

    it('greets each member exactly once, however often the job runs', async () => {
      await makeMember({ email: 'twice@example.org' });

      await dispatchBirthdayMessages(today);
      const second = await dispatchBirthdayMessages(today);

      expect(second.skipped).toBe(1);
      expect(await MailLog.countDocuments({ type: 'BIRTHDAY' })).toBe(1);
    });

    it('records the greeting against the member it was sent to', async () => {
      const member = await makeMember({ email: 'linked@example.org', firstName: 'Ada' });

      await dispatchBirthdayMessages(today);
      const log = await MailLog.findOne({ type: 'BIRTHDAY' }).lean();

      expect(String(log!.member)).toBe(String(member._id));
      expect(log!.recipientName).toContain('Ada');
      expect(log!.subject).toContain('Ada');
    });

    it('does the same for anniversaries', async () => {
      // The month-day keys are derived from the dates by a pre-save hook, so the
      // dates are what must be set — assigning the keys directly is overwritten.
      await makeMember({
        email: 'married@example.org',
        dateOfBirth: new Date(Date.UTC(1990, 0, 1)),
        weddingAnniversary: new Date(Date.UTC(2015, today.getUTCMonth(), today.getUTCDate())),
      });

      const result = await dispatchAnniversaryMessages(today);

      expect(result.attempted).toBe(1);
      expect(await MailLog.countDocuments({ type: 'ANNIVERSARY' })).toBe(1);
    });

    it('leaves inactive members alone', async () => {
      await makeMember({
        email: 'inactive@example.org',
        membershipStatus: MembershipStatus.INACTIVE,
      });

      const result = await dispatchBirthdayMessages(today);

      expect(result.attempted).toBe(0);
      expect(await MailLog.countDocuments({})).toBe(0);
    });
  });

  describe('without SMTP credentials', () => {
    it('records the greeting as skipped rather than sent', async () => {
      await makeMember({ email: 'nosmtp@example.org' });

      const result = await dispatchBirthdayMessages(today);
      const log = await MailLog.findOne({ type: 'BIRTHDAY' }).lean();

      // Reporting a send that never happened would hide a broken production setup.
      expect(log!.status).toBe('SKIPPED');
      expect(log!.error).toContain('No SMTP credentials');
      expect(result.sent).toBe(0);
      expect(result.skipped).toBe(1);
    });
  });
});

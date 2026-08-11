import { z } from 'zod';
import {
  objectIdSchema,
  paginationSchema,
  phoneSchema,
} from '../../middleware/validate';
import {
  BaptismStatus,
  MARITAL_STATUSES,
  MEMBERSHIP_CATEGORIES,
  MEMBERSHIP_STATUSES,
  SEXES,
} from '../../types/enums';

const pastDate = z
  .string()
  .date('Enter a valid date')
  .refine((v) => new Date(v) <= new Date(), { message: 'The date cannot be in the future' });

export const memberBaseSchema = z.object({
  firstName: z.string().trim().min(2, 'First name is required').max(80),
  middleName: z.string().trim().max(80).optional().or(z.literal('')),
  lastName: z.string().trim().min(2, 'Last name is required').max(80),
  preferredName: z.string().trim().max(80).optional().or(z.literal('')),
  sex: z.enum(SEXES as [string, ...string[]]),
  dateOfBirth: pastDate.optional().nullable(),

  phone: phoneSchema,
  alternatePhone: phoneSchema.optional().or(z.literal('')),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(160).optional().or(z.literal('')),

  maritalStatus: z.enum(MARITAL_STATUSES as [string, ...string[]]),
  weddingAnniversary: pastDate.optional().nullable(),

  photoUrl: z.string().url().max(500).optional().nullable(),
  photoPublicId: z.string().max(200).optional().nullable(),

  residentialAddress: z.string().trim().max(300).optional().or(z.literal('')),
  location: z
    .object({
      state: z.string().trim().max(80).optional().or(z.literal('')),
      lga: z.string().trim().max(80).optional().or(z.literal('')),
      city: z.string().trim().max(80).optional().or(z.literal('')),
      community: z.string().trim().max(80).optional().or(z.literal('')),
      street: z.string().trim().max(160).optional().or(z.literal('')),
    })
    .optional(),
  occupation: z.string().trim().max(120).optional().or(z.literal('')),
  emergencyContact: z
    .object({
      name: z.string().trim().max(120).optional().or(z.literal('')),
      relationship: z.string().trim().max(60).optional().or(z.literal('')),
      phone: phoneSchema.optional().or(z.literal('')),
    })
    .optional(),

  dateJoinedChurch: pastDate.optional().nullable(),
  membershipStatus: z.enum(MEMBERSHIP_STATUSES as [string, ...string[]]).optional(),
  membershipCategory: z.enum(MEMBERSHIP_CATEGORIES as [string, ...string[]]).optional(),

  /** Zone and Area are derived from the Homecell — SRS §25 acceptance criterion. */
  homecellId: objectIdSchema,

  baptismStatus: z.enum(Object.values(BaptismStatus) as [string, ...string[]]).optional(),
  department: z.string().trim().max(120).optional().or(z.literal('')),
  membershipClassCompleted: z.boolean().optional(),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
});

/** A married member is expected to have an anniversary for the SMS module to work. */
export const createMemberSchema = memberBaseSchema;
export const updateMemberSchema = memberBaseSchema.partial().omit({ homecellId: true });

export const listMembersSchema = paginationSchema.extend({
  zoneId: objectIdSchema.optional(),
  areaId: objectIdSchema.optional(),
  homecellId: objectIdSchema.optional(),
  sex: z.enum(SEXES as [string, ...string[]]).optional(),
  membershipStatus: z.enum(MEMBERSHIP_STATUSES as [string, ...string[]]).optional(),
  membershipCategory: z.enum(MEMBERSHIP_CATEGORIES as [string, ...string[]]).optional(),
  minAge: z.coerce.number().int().min(0).max(120).optional(),
  maxAge: z.coerce.number().int().min(0).max(120).optional(),
  state: z.string().trim().max(80).optional(),
  lga: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  joinedFrom: z.string().date().optional(),
  joinedTo: z.string().date().optional(),
});

export type CreateMemberInput = z.infer<typeof createMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type ListMembersQuery = z.infer<typeof listMembersSchema>;

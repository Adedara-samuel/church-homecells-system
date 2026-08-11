import { z } from 'zod';
import {
  objectIdSchema,
  paginationSchema,
  passwordSchema,
  phoneSchema,
} from '../../middleware/validate';
import { ALL_PERMISSIONS } from '../../config/permissions';
import { ROLES, Role, USER_STATUSES } from '../../types/enums';

const permissionSchema = z.enum(ALL_PERMISSIONS as [string, ...string[]]);

const baseUser = z.object({
  firstName: z.string().trim().min(2, 'First name is required').max(80),
  lastName: z.string().trim().min(2, 'Last name is required').max(80),
  email: z.string().trim().toLowerCase().email('A valid email address is required').max(160),
  phone: phoneSchema,
  role: z.enum(ROLES as [Role, ...Role[]]),
  zoneId: objectIdSchema.nullish(),
  areaId: objectIdSchema.nullish(),
  homecellId: objectIdSchema.nullish(),
  extraPermissions: z.array(permissionSchema).max(60).optional(),
  revokedPermissions: z.array(permissionSchema).max(60).optional(),
});

/**
 * A scoped role is meaningless without its assignment, so the API rejects the
 * combination rather than silently creating a user who can see nothing.
 */
function requireScopeAssignment<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((value, ctx) => {
    const data = value as z.infer<typeof baseUser>;
    if (!data.role) return;
    const requirement: Partial<Record<Role, keyof typeof data>> = {
      [Role.ZONAL_COORDINATOR]: 'zoneId',
      [Role.AREA_COORDINATOR]: 'areaId',
      [Role.HOMECELL_COORDINATOR]: 'homecellId',
    };
    const field = requirement[data.role];
    if (field && !data[field]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field as string],
        message: `A ${field.replace('Id', '')} must be assigned for this role`,
      });
    }
  });
}

export const createUserSchema = requireScopeAssignment(
  baseUser.extend({
    password: passwordSchema.optional(),
    mustChangePassword: z.boolean().default(true),
  }),
);

export const updateUserSchema = requireScopeAssignment(
  baseUser.partial().extend({
    status: z.enum(USER_STATUSES as [string, ...string[]]).optional(),
  }),
);

export const updateUserStatusSchema = z.object({
  status: z.enum(USER_STATUSES as [string, ...string[]]),
  reason: z.string().trim().max(300).optional(),
});

export const updatePermissionsSchema = z.object({
  extraPermissions: z.array(permissionSchema).max(60).default([]),
  revokedPermissions: z.array(permissionSchema).max(60).default([]),
});

export const resetUserPasswordSchema = z.object({
  newPassword: passwordSchema,
  mustChangePassword: z.boolean().default(true),
});

export const listUsersSchema = paginationSchema.extend({
  role: z.enum(ROLES as [Role, ...Role[]]).optional(),
  status: z.enum(USER_STATUSES as [string, ...string[]]).optional(),
  zoneId: objectIdSchema.optional(),
  areaId: objectIdSchema.optional(),
  homecellId: objectIdSchema.optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ListUsersQuery = z.infer<typeof listUsersSchema>;

import { z } from 'zod';
import { passwordSchema } from '../../middleware/validate';

export const loginSchema = z.object({
  /** SRS FR-AUTH-001: username / email / phone number. */
  identifier: z.string().trim().min(3, 'Enter your email address or phone number').max(160),
  password: z.string().min(1, 'Enter your password').max(128),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10).optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'The passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    message: 'Your new password must be different from the current one',
    path: ['newPassword'],
  });

export const forgotPasswordSchema = z.object({
  identifier: z.string().trim().min(3).max(160),
});

export const resetPasswordSchema = z
  .object({
    token: z.string().min(10, 'The reset link is invalid'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'The passwords do not match',
    path: ['confirmPassword'],
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

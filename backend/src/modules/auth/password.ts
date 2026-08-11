import argon2 from 'argon2';

/**
 * Argon2id with deliberately conservative parameters — OWASP's 2024 baseline for a
 * server-side password hash (19 MiB memory, 2 iterations, 1 degree of parallelism).
 */
const OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

export interface PasswordStrength {
  valid: boolean;
  problems: string[];
}

/** Mirrors the Zod rule used at the API boundary; kept here for seed/CLI reuse. */
export function checkPasswordStrength(password: string): PasswordStrength {
  const problems: string[] = [];
  if (password.length < 10) problems.push('be at least 10 characters long');
  if (!/[a-z]/.test(password)) problems.push('contain a lowercase letter');
  if (!/[A-Z]/.test(password)) problems.push('contain an uppercase letter');
  if (!/\d/.test(password)) problems.push('contain a digit');
  if (!/[^A-Za-z0-9]/.test(password)) problems.push('contain a symbol');
  return { valid: problems.length === 0, problems };
}

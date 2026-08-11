import type { Permission } from '../config/permissions';
import type { Role, ScopeLevel } from './enums';

/** The authenticated principal attached to every protected request. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  scopeLevel: ScopeLevel;
  zoneId: string | null;
  areaId: string | null;
  homecellId: string | null;
  permissions: Set<Permission>;
  can(permission: Permission): boolean;
  /** True for SYSTEM_ADMIN / CHURCH_ADMIN — no organisational restriction. */
  isChurchWide: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      requestId?: string;
      /** Raw body buffer, captured only on webhook routes for signature verification. */
      rawBody?: Buffer;
    }
  }
}

export {};

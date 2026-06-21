import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { getConfig } from '../config.js';

/** Passwort-Hash im Format salt:hash (scrypt) – keine native Dependency nötig. */
export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const calc = scryptSync(pw, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return calc.length === expected.length && timingSafeEqual(calc, expected);
}

export interface SessionUser {
  id: string;
  email: string;
  role: string;
  tenantId: string | null;
}

export async function findUserByEmail(email: string) {
  const [u] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  return u ?? null;
}

export async function findUserById(id: string): Promise<SessionUser | null> {
  const [u] = await db.select().from(users).where(eq(users.id, id));
  return u ? { id: u.id, email: u.email, role: u.role, tenantId: u.tenantId } : null;
}

/**
 * Legt beim Start einen Admin aus ADMIN_EMAIL/ADMIN_PASSWORD an, falls es ihn noch
 * nicht gibt. So kommt man ohne manuelles Seeding ins frische Dashboard.
 */
export async function ensureAdminFromEnv(): Promise<void> {
  const cfg = getConfig();
  if (!cfg.ADMIN_EMAIL || !cfg.ADMIN_PASSWORD) return;
  const existing = await findUserByEmail(cfg.ADMIN_EMAIL);
  if (existing) return;
  await db.insert(users).values({
    email: cfg.ADMIN_EMAIL.toLowerCase(),
    passwordHash: hashPassword(cfg.ADMIN_PASSWORD),
    role: 'owner',
  });
}

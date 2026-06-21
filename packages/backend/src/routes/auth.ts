import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getConfig } from '../config.js';
import { findUserByEmail, findUserById, verifyPassword, type SessionUser } from '../services/auth.js';

export const SESSION_COOKIE = 'wg_session';

function cookieOptions() {
  return {
    signed: true,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: getConfig().NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 Tage
  };
}

/** Liest die Session aus dem signierten Cookie (für Admin-Routen + WS wiederverwendet). */
export async function getSessionUser(req: FastifyRequest): Promise<SessionUser | null> {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (!raw) return null;
  const un = req.unsignCookie(raw);
  if (!un.valid || !un.value) return null;
  return findUserById(un.value);
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

  app.post('/api/auth/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_body', message: 'E-Mail und Passwort erforderlich.' };
    }
    const user = await findUserByEmail(parsed.data.email);
    if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
      reply.code(401);
      return { error: 'invalid_credentials', message: 'E-Mail oder Passwort falsch.' };
    }
    reply.setCookie(SESSION_COOKIE, user.id, cookieOptions());
    return { ok: true, user: { email: user.email, role: user.role } };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req, reply) => {
    const user = await getSessionUser(req);
    if (!user) {
      reply.code(401);
      return { error: 'unauthorized' };
    }
    return { user: { email: user.email, role: user.role } };
  });
}

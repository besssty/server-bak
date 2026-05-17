/** Application-сервіс: authService. */

import { generateTokens, verifyRefreshToken } from '../../../shared/utils/jwt';
import { sanitizeUsername } from '../domain/authDomain';
import { authRepository } from '../infrastructure/authRepository';

interface GoogleProfile {
  email: string;
  name?: string;
  googleId: string;
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

type RefreshSessionResult =
  | ({ ok: true; user: AuthUser } & AuthTokens)
  | { ok: false; reason: 'missing' | 'invalid' | 'ended' };

interface AuthUser {
  id: string;
  email: string;
  username: string;
  createdAt: Date;
}

export async function signInWithGoogle(profile: GoogleProfile): Promise<AuthTokens> {
  // Google email є стабільним ключем для пошуку або створення користувача.
  const user = await authRepository.upsertGoogleUser({
    email: profile.email,
    googleId: profile.googleId,
    username: await generateUniqueUsername(profile.name ?? profile.email.split('@')[0]),
  });

  return generateTokens(user);
}

export async function refreshSession(refreshToken?: string): Promise<RefreshSessionResult> {
  if (!refreshToken) {
    return { ok: false, reason: 'missing' };
  }

  const payload = verifyRefreshToken(refreshToken);
  if (!payload) {
    return { ok: false, reason: 'invalid' };
  }

  const user = await authRepository.findUserById(payload.userId);

  // sessionVersion дозволяє завершити старі refresh tokens після logout.
  if (!user || user.sessionVersion !== payload.sessionVersion) {
    return { ok: false, reason: 'ended' };
  }

  return {
    ok: true,
    ...generateTokens(user),
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      createdAt: user.createdAt,
    },
  };
}

export async function logoutSession(refreshToken?: string): Promise<void> {
  const payload = refreshToken ? verifyRefreshToken(refreshToken) : null;

  if (!payload) return;

  // Інкремент версії робить поточний refresh token недійсним.
  await authRepository.incrementSessionVersion(payload.userId, payload.sessionVersion);
}

async function generateUniqueUsername(base: string): Promise<string> {
  const sanitized = sanitizeUsername(base);

  const existing = await authRepository.findUserByUsername(sanitized);
  if (!existing) return sanitized;

  // Якщо базове ім'я зайняте, пробуємо короткий префікс з випадковим суфіксом.
  const prefix = sanitized.slice(0, 12) || 'user';
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = Math.floor(Math.random() * 9000) + 1000;
    const candidate = `${prefix}${suffix}`;
    const conflict = await authRepository.findUserByUsername(candidate);
    if (!conflict) return candidate;
  }

  return `${prefix}${Date.now().toString(36).slice(-6)}`;
}

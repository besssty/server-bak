/** Utility-файл: jwt. */

import jwt from 'jsonwebtoken';

const JWT_SECRET         = process.env.JWT_SECRET!;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!;
const accessExpiresIn = (process.env.JWT_EXPIRES_IN ?? '15m') as `${number}${'s'|'m'|'h'|'d'}`;
const refreshExpiresIn = (process.env.JWT_REFRESH_EXPIRES_IN ?? '7d') as `${number}${'s'|'m'|'h'|'d'}`;

/**
 * Розширений payload — містить базові дані юзера.
 */
interface TokenPayload {
  userId:    string;
  email:     string;     
  username:  string;     
  createdAt: number;     // Unix timestamp (number) для JSON serialization
}

/**
 * generateTokens — генерує пару токенів для юзера після логіну або refresh.
 *
 * @param user  Об'єкт юзера з БД (id, email, username, createdAt)
 * @returns     { accessToken, refreshToken }
 */
export function generateTokens(user: {
  id:        string;
  email:     string;
  username:  string;
  createdAt: Date;
  sessionVersion: number;
}) {
  // Включаємо email, username, createdAt в payload щоб requireAuth міг наповнити req.user без звернення до БД.
  const payload: TokenPayload = {
    userId:    user.id,
    email:     user.email,
    username:  user.username,
    createdAt: user.createdAt.getTime(), // Date → number для JWT serialization
  };

  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: accessExpiresIn });

  // Refresh token: мінімальний payload — лише userId достатньо для ротації
  const refreshToken = jwt.sign(
    { userId: user.id, sessionVersion: user.sessionVersion },
    JWT_REFRESH_SECRET,
    {
    expiresIn: refreshExpiresIn,
    }
  );

  return { accessToken, refreshToken };
}

/**
 * verifyAccessToken — верифікує підпис та TTL access token.
 *
 * @param token  JWT рядок з Authorization: Bearer заголовку
 * @returns      TokenPayload якщо токен валідний, null якщо ні
 */
export function verifyAccessToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

/**
 * verifyRefreshToken — верифікує підпис та TTL refresh token. Використовується в POST /api/auth/refresh.
 */
export function verifyRefreshToken(token: string): { userId: string; sessionVersion: number } | null {
  try {
    return jwt.verify(token, JWT_REFRESH_SECRET) as { userId: string; sessionVersion: number };
  } catch {
    return null;
  }
}

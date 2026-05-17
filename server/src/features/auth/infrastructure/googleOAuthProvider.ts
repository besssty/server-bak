/** Google OAuth infrastructure provider. */

import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';

interface GoogleOAuthProfile {
  email: string;
  name?: string;
  googleId: string;
}

const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_CALLBACK_URL ?? `${process.env.SERVER_URL}/api/auth/google/callback`,
);

export function createOAuthState(): string {
  // state — це випадковий одноразовий рядок, який ми передаємо в Google разом із запитом на авторизацію.
  //
  // Навіщо він потрібен:
  //  користувач натискає "увійти через Google";
  //  сервер створює state і відправляє користувача на сторінку Google;
  //  після входу Google повертає користувача назад разом із тим самим state;
  //  сервер може перевірити, що відповідь справді належить до запиту, який він сам починав.
  //
  // randomBytes(16) створює 16 випадкових байтів. toString('hex') перетворює їх у звичайний текст із символів 0-9 та a-f. У результаті виходить довгий непередбачуваний рядок, який важко підробити.
  return crypto.randomBytes(16).toString('hex');
}

export function getGoogleAuthUrl(state: string): string {
  // generateAuthUrl створює посилання, на яке треба перенаправити користувача. Саме на цій сторінці Google попросить його увійти в акаунт і дозволити нашому застосунку отримати базові дані профілю.
  return oauth2Client.generateAuthUrl({
    // access_type: 'offline' просить Google видати refresh token.
    access_type: 'offline',

    // prompt: 'consent' змушує Google показати екран згоди. 
    prompt: 'consent',

    // scope описує, які саме дані ми просимо у Google.
    scope: ['email', 'profile'],

    // state повернеться назад у callback після авторизації. Його треба порівняти з тим state, який сервер створив перед переходом на Google.Це захищає OAuth-процес від підміни запиту.
    state,
  });
}

export async function getGoogleProfileFromCode(code: string): Promise<GoogleOAuthProfile> {
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.id_token) {
    throw new Error('No id_token in Google OAuth response');
  }

  const ticket = await oauth2Client.verifyIdToken({
    idToken: tokens.id_token,
    audience: process.env.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();
  if (!payload?.email || !payload.sub) {
    throw new Error('Google profile is missing required fields');
  }

  return {
    email: payload.email,
    name: payload.name,
    googleId: payload.sub,
  };
}

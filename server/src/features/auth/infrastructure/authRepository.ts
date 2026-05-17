/** Infrastructure-файл: authRepository. */

import { prisma } from '../../../shared/utils/prisma';

interface GoogleUserData {
  email: string;
  googleId: string;
  username: string;
}

export const authRepository = {
  // Створює користувача після Google OAuth або оновлює його googleId.
  upsertGoogleUser(data: GoogleUserData) {
    return prisma.user.upsert({
      where: { email: data.email },
      update: { googleId: data.googleId },
      create: data,
      select: { id: true, email: true, username: true, createdAt: true, sessionVersion: true },
    });
  },

  // Використовується у refresh-сценарії: треба перевірити sessionVersion у БД.
  findUserById(userId: string) {
    return prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, username: true, createdAt: true, sessionVersion: true },
    });
  },

  // Допомагає згенерувати унікальний username.
  findUserByUsername(username: string) {
    return prisma.user.findUnique({ where: { username } });
  },

  // Logout робить старі refresh tokens недійсними.
  incrementSessionVersion(userId: string, sessionVersion: number) {
    return prisma.user.updateMany({
      where: { id: userId, sessionVersion },
      data: { sessionVersion: { increment: 1 } },
    });
  },
};

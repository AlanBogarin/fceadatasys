import type { User } from '@prisma/client';

export function userDto(user: User) {
  return { id: user.id, name: user.name, ci: user.ci, email: user.email, username: user.username, role: user.role, active: user.active, createdAt: user.createdAt.toISOString() };
}

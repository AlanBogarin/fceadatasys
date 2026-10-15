import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { z } from 'zod';

export const passwordSchema = z.string().min(8).max(128).refine(
  value => /[A-Za-z]/.test(value) && /\d/.test(value),
  'La contraseña debe contener letras y números.',
);
export const normalizeIdentity = (value: string): string => value.normalize('NFKC').trim().toLowerCase();
export const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');
export const randomToken = (bytes: number): string => randomBytes(bytes).toString('hex');
export const hashPassword = (password: string): Promise<string> => argon2.hash(password, {
  type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1,
});
export const verifyPassword = async (hash: string, password: string): Promise<boolean> => {
  try { return await argon2.verify(hash, password); } catch { return false; }
};

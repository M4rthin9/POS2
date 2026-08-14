// ── JWT access/refresh tokens (jose, HS256) ──

import { SignJWT, jwtVerify } from 'jose';
import type { AuthUser } from '../env';

const enc = new TextEncoder();

function secretKey(secret: string): Uint8Array {
  return enc.encode(secret);
}

export async function signAccessToken(user: AuthUser, secret: string, ttlSeconds: number): Promise<string> {
  return new SignJWT({ role: user.role, name: user.display_name, uid: user.id })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secretKey(secret));
}

export async function signRefreshToken(user: AuthUser, secret: string, ttlSeconds: number, jti: string): Promise<string> {
  return new SignJWT({ role: user.role, name: user.display_name, uid: user.id })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.id))
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secretKey(secret));
}

export interface VerifiedToken {
  userId: number;
  role: 'superadmin' | 'admin' | 'cashier';
  jti?: string;
}

export async function verifyToken(token: string, secret: string): Promise<VerifiedToken> {
  const { payload } = await jwtVerify(token, secretKey(secret));
  const userId = Number(payload.sub);
  if (!Number.isInteger(userId)) throw new Error('invalid subject');
  const role = payload.role === 'superadmin' || payload.role === 'admin' ? payload.role : 'cashier';
  return { userId, role, jti: payload.jti };
}

export async function sha256hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  JWT_SECRET: string;
  APP_ORIGIN_POS: string;
  APP_ORIGIN_ADMIN: string;
}

export interface AuthUser {
  id: number;
  username: string;
  display_name: string;
  role: 'superadmin' | 'admin' | 'cashier';
}

export type Variables = {
  user: AuthUser;
};

export const ACCESS_TTL = 12 * 60 * 60; // 12h
export const REFRESH_TTL = 30 * 24 * 60 * 60; // 30d
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCK_MINUTES = 15;

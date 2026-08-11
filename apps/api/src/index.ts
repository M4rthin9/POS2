import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import authRoutes from './routes/auth';
import posRoutes from './routes/pos';
import adminRoutes from './routes/admin';
import { ok } from './lib/http';
import type { Env } from './env';

const app = new Hono<{ Bindings: Env }>();

app.use('*', logger());
app.use(
  '*',
  cors({
    origin: (origin, c) => {
      // Allow configured frontend origins, any *.pages.dev origin, and localhost dev.
      const configured = [c.env?.APP_ORIGIN_POS, c.env?.APP_ORIGIN_ADMIN].filter(Boolean) as string[];
      if (!origin) return origin;
      if (configured.includes(origin)) return origin;
      if (origin.endsWith('.pages.dev')) return origin;
      if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return origin;
      return origin; // permissive fallback
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  }),
);

app.get('/health', (c) => ok(c, { status: 'ok', time: new Date().toISOString() }));

app.route('/api/auth', authRoutes);
app.route('/api', posRoutes);
app.route('/api/admin', adminRoutes);

app.notFound((c) => c.json({ ok: false, error: 'Not found' }, 404));

export default app;

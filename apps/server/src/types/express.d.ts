import type { AuthContext } from '../auth/auth.types';

declare module 'express-serve-static-core' {
  interface Request {
    /** Populated by requireAuth. Absent on public routes. */
    auth?: AuthContext;
  }
}
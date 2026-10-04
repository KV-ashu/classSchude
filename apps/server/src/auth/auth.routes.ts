import { Router } from 'express';
import { loginBodySchema, registerBodySchema } from './auth.schemas';
import { loginUser, registerUser, getProfile } from './auth.service';
import { requireAuth, requireAuthContext } from './auth.middleware';

export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  const body = registerBodySchema.parse(req.body);
  const result = await registerUser(body);
  res.status(201).json({ ok: true, data: result });
});

authRouter.post('/login', async (req, res) => {
  const body = loginBodySchema.parse(req.body);
  const result = await loginUser(body);
  res.json({ ok: true, data: result });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const auth = requireAuthContext(req);
  const user = await getProfile(auth.userId);
  res.json({ ok: true, data: user });
});
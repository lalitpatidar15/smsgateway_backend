import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../db';
import { config } from '../config';
import { asyncHandler, httpError, requireAdmin, audit, AuthedRequest } from '../middleware';

export const authRouter = Router();

function signToken(user: { id: string; email: string; role: string }) {
  return jwt.sign({ email: user.email, role: user.role }, config.jwtSecret, {
    subject: user.id,
    expiresIn: config.jwtExpiresIn,
  } as any);
}

function publicUser(u: any) {
  return { id: u.id, email: u.email, name: u.name ?? null, role: u.role, isActive: u.isActive, createdAt: u.createdAt, updatedAt: u.updatedAt };
}

authRouter.post(
  '/register',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { email, password, name } = req.body ?? {};
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw httpError(400, 'VALIDATION_ERROR', 'Valid email required');
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      throw httpError(400, 'VALIDATION_ERROR', 'Password must be at least 8 characters');
    }
    const existing = await prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) throw httpError(409, 'CONFLICT', 'Email already registered');

    const count = await prisma.adminUser.count();
    // First user becomes SUPER_ADMIN; subsequent open registrations become VIEWER to limit privilege escalation.
    // Admins can promote via DB or future endpoint.
    const role = count === 0 ? 'SUPER_ADMIN' : 'VIEWER';
    const hash = await (bcrypt as any).hash(password, 10);
    const user = await prisma.adminUser.create({
      data: { email: email.toLowerCase(), password: hash, name: name ?? null, role: role as any },
    });
    audit('auth.register', req, 'admin_user', user.id, { email: user.email, role });
    res.status(201).json({ accessToken: signToken(user), user: publicUser(user) });
  })
);

authRouter.post(
  '/login',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) throw httpError(400, 'VALIDATION_ERROR', 'Email and password required');
    const user = await prisma.adminUser.findUnique({ where: { email: String(email).toLowerCase() } });
    if (!user) throw httpError(401, 'UNAUTHORIZED', 'Invalid credentials');
    if (!user.isActive) throw httpError(403, 'FORBIDDEN', 'Account disabled');
    const ok = await (bcrypt as any).compare(String(password), user.password);
    if (!ok) throw httpError(401, 'UNAUTHORIZED', 'Invalid credentials');
    audit('auth.login', req, 'admin_user', user.id, { email: user.email });
    res.json({ accessToken: signToken(user), user: publicUser(user) });
  })
);

authRouter.get(
  '/me',
  requireAdmin(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await prisma.adminUser.findUnique({ where: { id: req.admin!.id } });
    if (!user) throw httpError(404, 'NOT_FOUND', 'User not found');
    res.json(publicUser(user));
  })
);

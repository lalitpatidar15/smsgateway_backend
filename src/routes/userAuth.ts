import { Router, Response, NextFunction, Request } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../db';
import { config } from '../config';
import { asyncHandler, httpError, audit, AuthedRequest } from '../middleware';

export const userAuthRouter = Router();

function signUserToken(user: { id: string; email: string; role: string; organizationId: string }) {
  return jwt.sign(
    { email: user.email, role: user.role, organizationId: user.organizationId },
    config.jwtSecret,
    { subject: user.id, expiresIn: config.jwtExpiresIn } as any
  );
}

function publicUser(u: any) {
  return {
    id: u.id,
    email: u.email,
    name: u.name ?? null,
    role: u.role,
    isActive: u.isActive,
    organizationId: u.organizationId,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

userAuthRouter.post(
  '/register',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { email, password, name, organizationName } = req.body ?? {};
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw httpError(400, 'VALIDATION_ERROR', 'Valid email required');
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      throw httpError(400, 'VALIDATION_ERROR', 'Password must be at least 8 characters');
    }
    if (!organizationName || typeof organizationName !== 'string' || organizationName.trim().length < 2) {
      throw httpError(400, 'VALIDATION_ERROR', 'Organization name required (min 2 chars)');
    }

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) throw httpError(409, 'CONFLICT', 'Email already registered');

    const slugBase = organizationName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    let slug = slugBase;
    let suffix = 1;
    while (await prisma.organization.findUnique({ where: { slug } })) {
      slug = `${slugBase}-${suffix++}`;
    }

    const hash = await (bcrypt as any).hash(password, 10);
    const result = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name: organizationName.trim(), slug },
      });
      const user = await tx.user.create({
        data: {
          email: email.toLowerCase(),
          password: hash,
          name: name ?? null,
          role: 'ADMIN',
          organizationId: org.id,
        },
      });
      return { org, user };
    });

    audit('user.register', req, 'user', result.user.id, { email: result.user.email, organizationId: result.org.id });
    res.status(201).json({ accessToken: signUserToken(result.user), user: publicUser(result.user) });
  })
);

userAuthRouter.post(
  '/login',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) throw httpError(400, 'VALIDATION_ERROR', 'Email and password required');
    const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } });
    if (!user) throw httpError(401, 'UNAUTHORIZED', 'Invalid credentials');
    if (!user.isActive) throw httpError(403, 'FORBIDDEN', 'Account disabled');
    const ok = await (bcrypt as any).compare(String(password), user.password);
    if (!ok) throw httpError(401, 'UNAUTHORIZED', 'Invalid credentials');
    audit('user.login', req, 'user', user.id, { email: user.email });
    res.json({ accessToken: signUserToken(user), user: publicUser(user) });
  })
);

userAuthRouter.get(
  '/me',
  asyncHandler(async (req: AuthedRequest, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw httpError(401, 'UNAUTHORIZED', 'Missing bearer token');
    }
    const token = authHeader.slice(7).trim();
    let payload: any;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      throw httpError(401, 'UNAUTHORIZED', 'Invalid or expired token');
    }
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) throw httpError(401, 'UNAUTHORIZED', 'Account disabled');
    res.json(publicUser(user));
  })
);


import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler, httpError, requireAdmin, audit, AuthedRequest } from '../middleware';

export const complianceRouter = Router();

complianceRouter.post(
  '/suppressions',
  requireAdmin(['SUPER_ADMIN', 'ADMIN']),
  asyncHandler(async (req: AuthedRequest, res) => {
    const b = req.body ?? {};
    const phone = String(b.phone ?? '').trim();
    if (!phone) throw httpError(400, 'VALIDATION_ERROR', 'phone required');
    const existing = await prisma.suppressionList.findFirst({ where: { phone } });
    const suppression = await prisma.suppressionList.create({
      data: {
        phone,
        sender: b.sender ? String(b.sender) : null,
        purpose: b.purpose ? String(b.purpose) : null,
        reason: b.reason ? String(b.reason) : null,
        expiresAt: b.expiresAt ? new Date(String(b.expiresAt)) : null,
      },
    });
    audit('compliance.suppression.create', req, 'suppression', suppression.id, { phone });
    res.status(201).json(suppression);
  })
);

complianceRouter.get(
  '/suppressions',
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const list = await prisma.suppressionList.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
    res.json(list);
  })
);

complianceRouter.delete(
  '/suppressions/:id',
  requireAdmin(['SUPER_ADMIN', 'ADMIN']),
  asyncHandler(async (req: AuthedRequest, res) => {
    const sup = await prisma.suppressionList.findUnique({ where: { id: req.params.id } });
    if (!sup) throw httpError(404, 'NOT_FOUND', 'Suppression not found');
    await prisma.suppressionList.delete({ where: { id: sup.id } });
    audit('compliance.suppression.delete', req, 'suppression', sup.id, { phone: sup.phone });
    res.json({ ok: true });
  })
);

complianceRouter.post(
  '/sender-identities',
  requireAdmin(['SUPER_ADMIN', 'ADMIN']),
  asyncHandler(async (req: AuthedRequest, res) => {
    const b = req.body ?? {};
    const phone = String(b.phone ?? '').trim();
    if (!phone) throw httpError(400, 'VALIDATION_ERROR', 'phone required');
    const existing = await prisma.senderIdentity.findUnique({ where: { phone } });
    const identity = existing
      ? await prisma.senderIdentity.update({ where: { id: existing.id }, data: { name: b.name ? String(b.name) : null, status: b.status ? String(b.status) : 'ACTIVE' } })
      : await prisma.senderIdentity.create({ data: { phone, name: b.name ? String(b.name) : null, status: b.status ? String(b.status) : 'ACTIVE' } });
    audit('compliance.sender_identity.save', req, 'sender_identity', identity.id, { phone });
    res.status(existing ? 200 : 201).json(identity);
  })
);

complianceRouter.get(
  '/sender-identities',
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const list = await prisma.senderIdentity.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
    res.json(list);
  })
);

complianceRouter.post(
  '/templates',
  requireAdmin(['SUPER_ADMIN', 'ADMIN']),
  asyncHandler(async (req: AuthedRequest, res) => {
    const b = req.body ?? {};
    const name = String(b.name ?? '').trim();
    const content = String(b.content ?? '').trim();
    if (!name || !content) throw httpError(400, 'VALIDATION_ERROR', 'name and content required');
    const existing = await prisma.template.findUnique({ where: { name } });
    const template = existing
      ? await prisma.template.update({ where: { id: existing.id }, data: { content } })
      : await prisma.template.create({ data: { name, content } });
    res.status(existing ? 200 : 201).json(template);
  })
);

complianceRouter.get(
  '/templates',
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const list = await prisma.template.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
    res.json(list);
  })
);

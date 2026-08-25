import 'dotenv/config';

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';

const app = express();
const prisma = new PrismaClient();

app.use(helmet());
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', async (req, res) => {
  const postgres = await prisma.$queryRaw`SELECT 1`.then(() => 'ok').catch(() => 'error');
  res.json({ status: postgres === 'ok' ? 'ok' : 'degraded', timestamp: new Date().toISOString() });
});

// SMS routes
app.post('/sms', async (req, res) => {
  const { to, message } = req.body;
  if (!to || !message) {
    return res.status(400).json({ error: 'phone number and message required' });
  }

  const job = await prisma.smsJob.create({
    data: {
      phoneNumber: to,
      message,
      status: 'QUEUED',
    },
  });

  res.json({ id: job.id, status: job.status, recipient: job.phoneNumber });
});

// List SMS jobs
app.get('/sms', async (req, res) => {
  const limit = Number(process.env.LIMIT || 50);
  const jobs = await prisma.smsJob.findMany({
    take: limit,
    orderBy: { createdAt: 'desc' },
  });
  res.json(jobs);
});

// Get single SMS job
app.get('/sms/:id', async (req, res) => {
  const job = await prisma.smsJob.findUnique({
    where: { id: req.params.id },
  });
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// Cancel SMS
app.post('/sms/:id/cancel', async (req, res) => {
  const job = await prisma.smsJob.update({
    where: { id: req.params.id },
    data: { status: 'CANCELLED' },
  });
  res.json(job);
});

// Start server
const PORT = process.env.PORT || process.env.APP_PORT || 3000;
app.listen(PORT, async () => {
  console.log(`SMS Gateway Backend running on port ${PORT}`);
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('Database connected');
  } catch (e: unknown) {
    console.error('Database connection failed:', (e as Error).message);
  }
});

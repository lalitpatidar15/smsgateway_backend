import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import redis from 'ioredis';
import { PrismaClient } from '@prisma/client';

const app = express();
const prisma = new PrismaClient();
const redisClient = new redis(process.env.REDIS_URL || 'redis://localhost:6379');

app.use(helmet());
app.use(express.json());

// Health check
app.get('/health', async (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// SMS routes
app.post('/sms', async (req, res) => {
  const { to, message } = req.body;
  if (!to || !message) {
    return res.status(400).json({ error: 'phone number and message required' });
  }
  
  const job = await prisma.smsJob.create({
    data: {
      recipient: to,
      message,
      status: 'QUEUED',
    },
  });
  
  res.json({ id: job.id, status: job.status });
});

// List SMS jobs
app.get('/sms', async (req, res) => {
  const jobs = await prisma.smsJob.findMany({
    take: 50,
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
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`SMS Gateway running on port ${PORT}`);
  // Prisma migrate would be run separately
});

export { app };
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private connection: Redis;
  private queues: Map<string, Queue> = new Map();
  private workers: Map<string, Worker> = new Map();

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const host = this.configService.get('REDIS_HOST', 'localhost');
    const port = this.configService.get('REDIS_PORT', 6379);
    const password = this.configService.get('REDIS_PASSWORD');

    this.connection = new Redis({ host, port, password: password || undefined, maxRetriesPerRequest: null });

    this.createQueue('sms-dispatch');
    this.createQueue('sms-retry');
    this.createQueue('scheduled-sms');
    this.createQueue('gateway-health');
    this.createQueue('webhooks');
  }

  async onModuleDestroy() {
    for (const worker of this.workers.values()) {
      await worker.close();
    }
    for (const queue of this.queues.values()) {
      await queue.close();
    }
    await this.connection?.quit();
  }

  private createQueue(name: string): Queue {
    const queue = new Queue(name, { connection: this.connection });
    this.queues.set(name, queue);
    return queue;
  }

  getQueue(name: string): Queue {
    const queue = this.queues.get(name);
    if (!queue) throw new Error(`Queue ${name} not found`);
    return queue;
  }

  async addJob(queueName: string, data: any, opts?: any) {
    const queue = this.queues.get(queueName);
    if (!queue) throw new Error(`Queue ${queueName} not found`);
    return queue.add(queueName, data, opts);
  }

  registerWorker(queueName: string, processor: (job: Job) => Promise<any>) {
    const worker = new Worker(queueName, processor, { connection: this.connection });
    worker.on('failed', (job, err) => {
      this.logger.error(`Job ${job?.id} in ${queueName} failed: ${err.message}`);
    });
    worker.on('completed', (job) => {
      this.logger.log(`Job ${job.id} in ${queueName} completed`);
    });
    this.workers.set(queueName, worker);
    return worker;
  }
}

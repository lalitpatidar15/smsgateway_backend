import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { config, isProd } from './config';

const transports: winston.transport[] = [new winston.transports.Console()];

if (isProd) {
  transports.push(
    new DailyRotateFile({
      filename: 'logs/app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
      level: 'info',
    }) as unknown as winston.transport,
    new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d',
      level: 'error',
    }) as unknown as winston.transport
  );
}

export const logger = winston.createLogger({
  level: isProd ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'sms-gateway', env: config.env },
  transports,
});

export function logRequest(req: any, res: any, ms: number) {
  logger.info('http', {
    method: req.method,
    path: req.originalUrl || req.url,
    status: res.statusCode,
    ms,
    requestId: (req as any).requestId,
    ip: req.ip,
  });
}

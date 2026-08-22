import * as crypto from 'crypto';

export function generateApiKey(prefix: string = 'sg_live_'): { key: string; hash: string; short: string } {
  const raw = crypto.randomBytes(32).toString('hex');
  const key = `${prefix}${raw}`;
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const short = key.substring(0, prefix.length + 8);
  return { key, hash, short };
}

export function generateGatewayToken(prefix: string = 'gw_'): { token: string; hash: string } {
  const raw = crypto.randomBytes(32).toString('hex');
  const token = `${prefix}${raw}`;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateSignature(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

import crypto from 'crypto';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

export function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export function newId(): string {
  return crypto.randomUUID();
}

export function randomSecret(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function maskToken(prefix: string, secret: string): string {
  return `${prefix}${secret}`;
}

// Stored as sha256 hex; lookup by hash.
export function hashToken(plain: string): string {
  return sha256(plain);
}

export function getClientIp(req: any): string | null {
  const fwd = req.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.ip || null;
}

export interface PhoneCheck {
  ok: boolean;
  normalized: string;
  error?: string;
}

export function validatePhone(raw: unknown): PhoneCheck {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, normalized: '', error: 'phone number required' };
  }
  const input = raw.trim().replace(/[\s\-().]/g, '');
  try {
    const parsed = parsePhoneNumberFromString(input);
    if (parsed && parsed.isValid()) {
      return { ok: true, normalized: parsed.number as string };
    }
  } catch {
    // fall through to regex check
  }
  // Permissive E.164 fallback: optional +, 7-15 digits
  const digits = input.startsWith('+') ? input.slice(1) : input;
  if (/^\d{7,15}$/.test(digits)) {
    return { ok: true, normalized: input.startsWith('+') ? input : `+${digits}` };
  }
  return { ok: false, normalized: '', error: 'invalid phone number (expected E.164)' };
}

// GSM-7 basic detection (approx). Returns encoding + segment count.
export function smsSegments(message: string): { encoding: string; segmentCount: number } {
  // GSM 03.38 basic set approx: if all chars in basic latin + common symbols, treat as GSM-7
  // Anything outside -> UCS-2
  const gsm = /^[@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\[~\]|€]*$/;
  const isGsm = gsm.test(message);
  const len = Array.from(message).length;
  if (isGsm) {
    const encoding = 'GSM-7';
    const segmentCount = len <= 160 ? 1 : Math.ceil(len / 153);
    return { encoding, segmentCount };
  }
  const encoding = 'UCS-2';
  const segmentCount = len <= 70 ? 1 : Math.ceil(len / 67);
  return { encoding, segmentCount };
}

export function validateMessage(raw: unknown): { ok: boolean; error?: string } {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, error: 'message required' };
  if (raw.length > 1600) return { ok: false, error: 'message too long (max 1600 chars)' };
  return { ok: true };
}

export function paginate(pageRaw: unknown, limitRaw: unknown, maxLimit = 100) {
  let page = Number(pageRaw ?? 1);
  let limit = Number(limitRaw ?? 20);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(limit) || limit < 1) limit = 20;
  if (limit > maxLimit) limit = maxLimit;
  return { page, limit, skip: (page - 1) * limit, take: limit };
}

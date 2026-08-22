import { parsePhoneNumber, isValidPhoneNumber } from 'libphonenumber-js';

export function normalizePhoneNumber(phone: string): string {
  try {
    const parsed = parsePhoneNumber(phone);
    if (!parsed || !parsed.isValid()) {
      throw new Error('Invalid phone number');
    }
    return parsed.format('E.164');
  } catch {
    throw new Error('Invalid phone number format. Use E.164 format (e.g., +919876543210)');
  }
}

export function isValidPhone(phone: string): boolean {
  return isValidPhoneNumber(phone);
}

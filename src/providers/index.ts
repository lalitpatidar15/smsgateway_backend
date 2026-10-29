import { TwilioSmsProvider } from './twilio';
import type { SmsProvider } from './types';

const registry = new Map<string, SmsProvider>();

export function registerSmsProvider(provider: SmsProvider): void {
  registry.set(provider.id, provider);
}

export function getSmsProvider(id: string): SmsProvider | null {
  return registry.get(id) ?? null;
}

export function getDefaultSmsProvider(): SmsProvider {
  const existing = registry.get('twilio');
  if (existing) return existing;
  const provider = new TwilioSmsProvider();
  registry.set('twilio', provider);
  return provider;
}

import type { SmsProvider, SmsProviderSendInput, SmsProviderSendResult } from './types';
import { config } from '../config';

export class TwilioSmsProvider implements SmsProvider {
  readonly id = 'twilio';

  async send({ to, message, from }: SmsProviderSendInput): Promise<SmsProviderSendResult> {
    const accountSid = config.twilioAccountSid;
    const authToken = config.twilioAuthToken;
    const sender = from ?? config.twilioFromNumber;
    if (!accountSid || !authToken || !from) {
      throw new Error('Twilio SMS provider is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER)');
    }
    const body = new URLSearchParams({ To: to, From: sender, Body: message });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    const text = await res.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      // non-JSON body
    }
    const status = String((data?.status ?? '').toLowerCase());
    if (!res.ok || status === 'failed') {
      throw new Error(`Twilio send failed: ${data?.error_message ?? data?.message ?? text?.slice(0, 200) ?? `HTTP ${res.status}`}`);
    }
    return { providerMessageId: String(data?.sid ?? ''), status: 'SENT' };
  }
}

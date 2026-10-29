export type SmsDeliveryStatus = 'QUEUED' | 'SENT' | 'FAILED';

export interface SmsProviderSendInput {
  to: string;
  message: string;
  idempotencyKey?: string;
  from?: string;
}

export interface SmsProviderSendResult {
  providerMessageId: string;
  status: 'SENT';
}

export interface SmsProvider {
  readonly id: string;
  send(input: SmsProviderSendInput): Promise<SmsProviderSendResult>;
}

import { logger } from './logger';

export interface Alert {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  source: string;
  message: string;
  createdAt: string;
}

const alerts: Alert[] = [];
const MAX_ALERTS = 500;

export function createAlert(severity: Alert['severity'], source: string, message: string): Alert {
  const alert: Alert = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, severity, source, message, createdAt: new Date().toISOString() };
  alerts.push(alert);
  if (alerts.length > MAX_ALERTS) alerts.shift();
  logger.error('alert_fired', { severity, source, message });
  return alert;
}

export function getAlerts(source?: string, limit = 100): Alert[] {
  const filtered = source ? alerts.filter((a) => a.source === source) : alerts;
  return filtered.slice(-limit).reverse();
}

export function clearAlerts(): void {
  alerts.length = 0;
}

import nodemailer, { type Transporter } from 'nodemailer';
import { getConfig } from '../config.js';
import type { ResolvedTenant } from './tenant.js';

/** Minimaler Lead-Datensatz (DB-Row), den die Benachrichtigungen brauchen. */
export interface LeadRecord {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  conversationId: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export interface LeadPayload {
  type: 'chat_lead';
  tenant: { id: string; name: string; siteKey: string };
  lead: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    message: unknown;
    pageUrl: unknown;
    conversationId: string | null;
    createdAt: string;
  };
}

/** Reines Payload-Format für den CRM/FormBuilder/N8N-Webhook (unit-testbar). */
export function buildLeadPayload(tenant: ResolvedTenant, lead: LeadRecord): LeadPayload {
  return {
    type: 'chat_lead',
    tenant: { id: tenant.id, name: tenant.name, siteKey: tenant.siteKey },
    lead: {
      id: lead.id,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      message: lead.payload?.message ?? null,
      pageUrl: lead.payload?.pageUrl ?? null,
      conversationId: lead.conversationId,
      createdAt: lead.createdAt instanceof Date ? lead.createdAt.toISOString() : String(lead.createdAt),
    },
  };
}

/** Webhook an CRM/FormBuilder/N8N. true bei 2xx. */
export async function sendLeadWebhook(tenant: ResolvedTenant, lead: LeadRecord): Promise<boolean> {
  const url = tenant.settings.leadWebhookUrl;
  if (!url) return false;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildLeadPayload(tenant, lead)),
    signal: AbortSignal.timeout(8000),
  });
  return res.ok;
}

let transporter: Transporter | null = null;
function getTransport(): Transporter | null {
  const cfg = getConfig();
  if (!cfg.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: cfg.SMTP_HOST,
      port: cfg.SMTP_PORT,
      secure: cfg.SMTP_SECURE,
      auth: cfg.SMTP_USER ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

/** E-Mail-Benachrichtigung an den Seitenbetreiber. true bei Versand. */
export async function sendLeadEmail(tenant: ResolvedTenant, lead: LeadRecord): Promise<boolean> {
  const to = tenant.settings.notifyEmail;
  const t = getTransport();
  if (!to || !t) return false;

  const lines = [
    `Neuer Lead über den Chatbot von ${tenant.name}:`,
    '',
    `Name:    ${lead.name ?? '–'}`,
    `E-Mail:  ${lead.email ?? '–'}`,
    `Telefon: ${lead.phone ?? '–'}`,
    `Anliegen: ${(lead.payload?.message as string) ?? '–'}`,
    `Seite:   ${(lead.payload?.pageUrl as string) ?? '–'}`,
    `Zeit:    ${lead.createdAt instanceof Date ? lead.createdAt.toISOString() : String(lead.createdAt)}`,
  ];
  await t.sendMail({
    from: getConfig().SMTP_FROM,
    to,
    subject: `Neuer Chat-Lead – ${tenant.name}`,
    text: lines.join('\n'),
  });
  return true;
}

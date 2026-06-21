import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { conversations, leads } from '../db/schema.js';
import type { ResolvedTenant } from './tenant.js';
import { sendLeadEmail, sendLeadWebhook, type LeadRecord } from './notify.js';

export interface NewLead {
  conversationId?: string;
  name?: string;
  email?: string;
  phone?: string;
  message?: string;
  pageUrl?: string;
}

/** Lead persistieren und – falls vorhanden – die Konversation als „Lead erfasst" markieren. */
export async function createLead(tenant: ResolvedTenant, input: NewLead): Promise<LeadRecord> {
  const [lead] = await db
    .insert(leads)
    .values({
      tenantId: tenant.id,
      conversationId: input.conversationId ?? null,
      name: input.name ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      payload: { message: input.message ?? null, pageUrl: input.pageUrl ?? null },
    })
    .returning();

  if (input.conversationId) {
    await db
      .update(conversations)
      .set({ leadCaptured: true })
      .where(and(eq(conversations.id, input.conversationId), eq(conversations.tenantId, tenant.id)));
  }
  return lead as LeadRecord;
}

/**
 * Benachrichtigungen auslösen: Webhook (CRM/FormBuilder/N8N) + E-Mail. Non-blocking
 * gedacht – Fehler einzelner Kanäle dürfen den Lead nicht scheitern lassen.
 * Setzt pushed_to_crm, wenn der Webhook erfolgreich war.
 */
export async function dispatchLeadNotifications(
  tenant: ResolvedTenant,
  lead: LeadRecord,
  log: (msg: string) => void = () => {},
): Promise<void> {
  const [webhook, email] = await Promise.allSettled([
    sendLeadWebhook(tenant, lead),
    sendLeadEmail(tenant, lead),
  ]);

  if (webhook.status === 'fulfilled' && webhook.value) {
    await db.update(leads).set({ pushedToCrm: true }).where(eq(leads.id, lead.id));
    log('lead webhook ok');
  } else if (webhook.status === 'rejected') {
    log(`lead webhook failed: ${String(webhook.reason)}`);
  }
  if (email.status === 'fulfilled' && email.value) log('lead email sent');
  else if (email.status === 'rejected') log(`lead email failed: ${String(email.reason)}`);
}

export async function listLeads(tenantId: string) {
  return db
    .select()
    .from(leads)
    .where(eq(leads.tenantId, tenantId))
    .orderBy(desc(leads.createdAt))
    .limit(200);
}

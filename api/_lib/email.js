import { env, flags, siteUrl } from './env.js';
import { serviceClient } from './supabase.js';
import {
  orderReceivedEmail,
  paymentConfirmedEmail,
  orderDispatchedEmail,
  orderCancelledEmail,
  contactNotificationEmail
} from './email-templates.js';

/**
 * Email delivery.
 *
 * Providers:
 *  * "log"    — default. Records the intended message and writes to the server
 *               log. Nothing is sent. This is deliberate: without a verified
 *               sending domain and API key we must not claim delivery.
 *  * "resend" — real delivery via Resend once RESEND_API_KEY and EMAIL_FROM are
 *               configured and the domain is verified.
 *
 * Every attempt is recorded in email_log. Failures never roll back an order.
 */

function fromAddress() {
  const raw = env('EMAIL_FROM');
  if (!raw) return null;
  return raw.includes('<') ? raw : `Hasswell London <${raw}>`;
}

async function record({ orderId = null, to, template, subject, status, provider, error = null }) {
  try {
    await serviceClient().from('email_log').insert({
      order_id: orderId,
      to_email: to,
      template,
      subject,
      status,
      provider,
      error: error ? String(error).slice(0, 500) : null
    });
  } catch (loggingError) {
    console.error('[email] could not write email_log:', loggingError?.message || loggingError);
  }
}

async function sendWithResend({ to, subject, html, text, replyTo }) {
  const apiKey = env('RESEND_API_KEY');
  const from = fromAddress();
  if (!apiKey || !from) {
    throw Object.assign(new Error('Email provider is not configured.'), {
      code: 'EMAIL_NOT_CONFIGURED'
    });
  }

  const payload = {
    from,
    to: [to],
    subject,
    html,
    text,
    ...(replyTo ? { reply_to: replyTo } : env('EMAIL_REPLY_TO') ? { reply_to: env('EMAIL_REPLY_TO') } : {})
  };

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.message || body?.error || '';
    } catch {
      detail = '';
    }
    throw Object.assign(new Error(detail || `Email provider responded ${response.status}.`), {
      code: 'EMAIL_SEND_FAILED',
      status: response.status
    });
  }

  return response.json().catch(() => ({}));
}

/**
 * Sends one transactional email. Throws on provider failure so callers can
 * decide whether the failure matters; order flows wrap it in sendSafely().
 */
export async function sendEmail({ to, template, subject, html, text, orderId = null, replyTo = null }) {
  const provider = flags.emailProvider;

  if (!to || !subject || !html) {
    throw Object.assign(new Error('Email message is incomplete.'), { code: 'EMAIL_INVALID' });
  }

  if (provider === 'log') {
    await record({ orderId, to, template, subject, status: 'logged', provider: 'log' });
    console.info(`[email:log] ${template} → ${to} — ${subject}`);
    return { provider: 'log', delivered: false, logged: true };
  }

  if (provider === 'resend') {
    try {
      const result = await sendWithResend({ to, subject, html, text, replyTo });
      await record({ orderId, to, template, subject, status: 'sent', provider: 'resend' });
      return { provider: 'resend', delivered: true, id: result?.id ?? null };
    } catch (error) {
      await record({
        orderId,
        to,
        template,
        subject,
        status: 'failed',
        provider: 'resend',
        error: error?.message
      });
      throw error;
    }
  }

  await record({
    orderId,
    to,
    template,
    subject,
    status: 'failed',
    provider,
    error: `Unknown EMAIL_PROVIDER: ${provider}`
  });
  throw Object.assign(new Error(`Unknown email provider: ${provider}`), {
    code: 'EMAIL_PROVIDER_UNKNOWN'
  });
}

/** Never throws — used inside order and payment flows. */
export async function sendSafely(message) {
  try {
    return await sendEmail(message);
  } catch (error) {
    console.error('[email] send failed:', error?.message || error);
    return { provider: flags.emailProvider, delivered: false, error: true };
  }
}

const TEMPLATES = {
  order_received: orderReceivedEmail,
  payment_confirmed: paymentConfirmedEmail,
  order_dispatched: orderDispatchedEmail,
  order_cancelled: orderCancelledEmail
};

/**
 * Builds and sends an order lifecycle email.
 * @param {'order_received'|'payment_confirmed'|'order_dispatched'|'order_cancelled'} type
 */
export async function sendOrderEmail(type, { order, items = [], payment = null, reason = null }) {
  const builder = TEMPLATES[type];
  if (!builder) throw Object.assign(new Error(`Unknown order email: ${type}`), { code: 'EMAIL_INVALID' });

  const message = builder({ order, items, payment, reason, siteUrl: siteUrl() });
  return sendSafely({
    to: order.email,
    template: type,
    subject: message.subject,
    html: message.html,
    text: message.text,
    orderId: order.id
  });
}

export async function sendContactNotification({ message, to }) {
  if (!to) return { delivered: false, skipped: true };
  const built = contactNotificationEmail({ message, siteUrl: siteUrl() });
  return sendSafely({
    to,
    template: 'contact_notification',
    subject: built.subject,
    html: built.html,
    text: built.text,
    replyTo: built.replyTo
  });
}

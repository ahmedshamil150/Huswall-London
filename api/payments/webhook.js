import { env } from '../_lib/env.js';
import { markOrderPaid } from '../_lib/orders.js';
import { verifyStripeSignature } from '../../integrations/payments/stripe.js';

/**
 * Stripe webhook.
 *
 * This endpoint deliberately uses Vercel's web-standard handler instead of the
 * Node `(req, res)` helper: Vercel parses `request.body` for JSON before a Node
 * handler sees it, which would destroy the exact bytes Stripe signed. Here
 * `request.text()` returns the raw payload, which is verified before parsing.
 */

const MAX_BYTES = 512 * 1024;

function errorResponse(error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const body = {
    ok: false,
    error: {
      code: error?.code || (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED'),
      message:
        status >= 500 && !error?.expose
          ? 'Something went wrong on our side. Please try again shortly.'
          : error?.message || 'Request failed.'
    }
  };

  if (status >= 500) console.error('[stripe] webhook failed:', error?.code || error?.message);
  return Response.json(body, { status });
}

export async function POST(request) {
  try {
    const secret = env('STRIPE_WEBHOOK_SECRET');
    if (!secret) {
      return Response.json(
        {
          ok: false,
          error: { code: 'WEBHOOK_NOT_CONFIGURED', message: 'Webhook is not configured.' }
        },
        { status: 503 }
      );
    }

    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > MAX_BYTES) {
      return Response.json(
        {
          ok: false,
          error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' }
        },
        { status: 413 }
      );
    }

    const payload = await request.text();
    if (payload.length > MAX_BYTES) {
      return Response.json(
        {
          ok: false,
          error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' }
        },
        { status: 413 }
      );
    }

    verifyStripeSignature({
      payload,
      header: request.headers.get('stripe-signature'),
      secret
    });

    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      return Response.json(
        {
          ok: false,
          error: { code: 'INVALID_JSON', message: 'Webhook body must be valid JSON.' }
        },
        { status: 400 }
      );
    }

    const type = String(event?.type || '');
    const session = event?.data?.object ?? {};

    if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
      const orderId = session?.metadata?.order_id;
      const amountMinor = session?.amount_total;
      const currency = String(session?.currency || 'gbp').toUpperCase();

      if (!orderId) {
        console.warn('[stripe] received session without order metadata:', session?.id);
        return Response.json({ ok: true, received: true, ignored: 'missing_order_reference' });
      }

      if (type === 'checkout.session.completed' && session.payment_status !== 'paid') {
        return Response.json({ ok: true, received: true, ignored: 'payment_not_captured' });
      }

      if (!Number.isInteger(amountMinor) || amountMinor < 0) {
        return Response.json(
          {
            ok: false,
            error: { code: 'INVALID_WEBHOOK', message: 'Webhook is missing a valid amount.' }
          },
          { status: 400 }
        );
      }

      await markOrderPaid({
        orderId,
        provider: 'stripe',
        reference: String(session.id),
        amountMinor,
        currency,
        raw: {
          event_id: event.id,
          event_type: type,
          payment_intent: session.payment_intent ?? null,
          livemode: Boolean(event.livemode)
        }
      });
    }

    return Response.json({ ok: true, received: true });
  } catch (error) {
    // A non-2xx response makes Stripe retry the event safely.
    return errorResponse(error);
  }
}

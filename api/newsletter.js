import { handler, ok, assertMethod, requireJson, readJson } from './_lib/http.js';
import { serviceClient } from './_lib/supabase.js';
import { validateNewsletterInput } from './_lib/validate.js';
import { enforceRateLimit } from './_lib/rate-limit.js';

/**
 * Newsletter sign-up. Single opt-in only: we do not claim a confirmation email
 * has been sent. Subscribers are stored with confirmed = false until a future
 * double opt-in flow is configured.
 */
export default handler(async (req, res) => {
  assertMethod(req, ['POST']);
  requireJson(req);

  await enforceRateLimit(req, {
    bucket: 'newsletter',
    limit: 5,
    windowSeconds: 3600,
    failClosed: true
  });

  const body = await readJson(req, { maxBytes: 8 * 1024 });
  const { email, source } = validateNewsletterInput(body);

  const db = serviceClient();
  const { data: existing, error: readError } = await db
    .from('newsletter_subscribers')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (readError) throw readError;

  if (!existing) {
    const { error } = await db.from('newsletter_subscribers').insert({
      email,
      source,
      confirmed: false
    });
    // A concurrent duplicate is success from the customer's point of view.
    if (error && error.code !== '23505') throw error;
  }

  return ok(res, {
    message: 'Thank you — you are on the list.',
    confirmation_email_sent: false
  });
});

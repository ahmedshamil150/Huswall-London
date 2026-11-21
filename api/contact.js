import { handler, ok, assertMethod, requireJson, readJson } from './_lib/http.js';
import { serviceClient } from './_lib/supabase.js';
import { validateContactInput } from './_lib/validate.js';
import { enforceRateLimit } from './_lib/rate-limit.js';
import { sendContactNotification } from './_lib/email.js';

export default handler(async (req, res) => {
  assertMethod(req, ['POST']);
  requireJson(req);

  await enforceRateLimit(req, {
    bucket: 'contact',
    limit: 5,
    windowSeconds: 3600,
    failClosed: true
  });

  const body = await readJson(req, { maxBytes: 32 * 1024 });
  const message = validateContactInput(body);

  const db = serviceClient();
  const { error } = await db.from('contact_messages').insert({
    name: message.name,
    email: message.email,
    subject: message.subject,
    message: message.message
  });
  if (error) throw error;

  let storeEmail = null;
  try {
    const { data } = await db
      .from('store_settings')
      .select('value')
      .eq('key', 'store.email')
      .maybeSingle();
    storeEmail = typeof data?.value === 'string' ? data.value : null;
  } catch {
    storeEmail = null;
  }

  await sendContactNotification({ message, to: storeEmail });

  return ok(res, {
    message: 'Thank you. Your message has been received and our team will reply by email.'
  });
});

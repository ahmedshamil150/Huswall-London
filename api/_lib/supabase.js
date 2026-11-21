import { createClient } from '@supabase/supabase-js';
import { requireEnv } from './env.js';
import { AppError } from './http.js';

let cached;

/**
 * Service-role client. Bypasses RLS and must never be returned to a browser.
 * Used only inside serverless functions.
 */
export function serviceClient() {
  if (cached) return cached;
  cached = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-client-info': 'hasswell-server' } }
  });
  return cached;
}

function bearerToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

export async function getAuthenticatedUser(req) {
  const token = bearerToken(req);
  if (!token) return null;
  const { data, error } = await serviceClient().auth.getUser(token);
  if (error) return null;
  return data?.user ?? null;
}

export async function requireUser(req) {
  const user = await getAuthenticatedUser(req);
  if (!user) throw new AppError('UNAUTHORISED', 'Sign in to continue.', 401);
  return user;
}

export async function requireAdmin(req) {
  const user = await requireUser(req);
  const { data, error } = await serviceClient()
    .from('profiles')
    .select('id, email, role, is_active')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    throw new AppError('ADMIN_CHECK_FAILED', 'Could not verify administrator access.', 500);
  }
  if (!data || data.role !== 'admin' || !data.is_active) {
    throw new AppError('FORBIDDEN', 'Administrator access is required.', 403);
  }
  return { user, profile: data };
}

/**
 * Database RPC errors carry useful codes but Postgres messages can reveal
 * internals. Translate expected domain errors and hide the rest.
 */
export function translateDbError(error) {
  const message = error?.message || 'Database operation failed.';
  const raw = message.replace(/^.*?:\s*/, '');

  if (message.includes('CART_EMPTY')) return new AppError('CART_EMPTY', 'Your bag is empty.', 400);
  if (message.includes('INSUFFICIENT_STOCK')) {
    const sku = message.split('INSUFFICIENT_STOCK:')[1]?.trim().split(/\s/)[0];
    return new AppError(
      'INSUFFICIENT_STOCK',
      'One of the pieces in your bag is no longer available in that quantity.',
      409,
      sku ? { sku } : undefined
    );
  }
  if (message.includes('PRODUCT_UNAVAILABLE')) {
    return new AppError(
      'PRODUCT_UNAVAILABLE',
      'One of the pieces in your bag is no longer available.',
      409
    );
  }
  if (message.includes('VARIANT_UNAVAILABLE')) {
    return new AppError('PRODUCT_UNAVAILABLE', 'That size is no longer available.', 409);
  }
  if (message.includes('INVALID_EMAIL')) return new AppError('INVALID_EMAIL', 'Enter a valid email address.', 400);
  if (message.includes('INVALID_NAME')) return new AppError('INVALID_ADDRESS', 'Enter the recipient name.', 400);
  if (message.includes('INVALID_ADDRESS')) return new AppError('INVALID_ADDRESS', 'Enter a complete delivery address.', 400);
  if (message.includes('INVALID_QUANTITY')) return new AppError('INVALID_QUANTITY', 'Check the quantities in your bag.', 400);
  if (message.includes('PAYMENT_AMOUNT_MISMATCH')) {
    return new AppError('PAYMENT_AMOUNT_MISMATCH', 'The payment amount did not match the order total.', 409);
  }
  if (message.includes('ORDER_NOT_PAYABLE')) {
    return new AppError('ORDER_NOT_PAYABLE', 'This order can no longer be paid.', 409);
  }
  if (message.includes('ORDER_ALREADY_DISPATCHED')) {
    return new AppError('ORDER_ALREADY_DISPATCHED', 'This order has already been dispatched.', 409);
  }
  if (message.includes('ORDER_NOT_SHIPPABLE')) {
    return new AppError('ORDER_NOT_SHIPPABLE', 'This order can no longer be shipped.', 409);
  }
  if (message.includes('TRACKING_REQUIRED')) {
    return new AppError('TRACKING_REQUIRED', 'A carrier and tracking number are required.', 400);
  }
  if (message.includes('PAYMENT_NOT_CONFIRMED')) {
    return new AppError('PAYMENT_NOT_CONFIRMED', 'Payment has not been confirmed for this order.', 409);
  }
  if (message.includes('PAYMENT_REFERENCE_REUSED')) {
    return new AppError('PAYMENT_REFERENCE_REUSED', 'That payment reference is already linked to another order.', 409);
  }
  if (message.includes('INVALID_STATUS_TRANSITION')) {
    return new AppError('INVALID_STATUS_TRANSITION', 'That status change is not allowed.', 409);
  }
  if (message.includes('CURRENCY_MISMATCH')) {
    return new AppError('CURRENCY_MISMATCH', 'The payment currency did not match the order.', 409);
  }
  if (message.includes('STOCK_BELOW_RESERVED')) {
    return new AppError('STOCK_BELOW_RESERVED', 'Stock cannot be reduced below the quantity already reserved.', 409);
  }
  if (message.includes('ORDER_NOT_FOUND')) {
    return new AppError('ORDER_NOT_FOUND', 'That order could not be found.', 404);
  }
  if (message.includes('duplicate key') && message.includes('order_number')) {
    return new AppError('DUPLICATE_ORDER', 'That order already exists.', 409);
  }

  // Log the database detail for operators, but never return it to the caller.
  console.error('[db]', raw.slice(0, 500));
  return new AppError('DATABASE_ERROR', 'A database operation failed.', 500);
}

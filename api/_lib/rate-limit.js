import { createHash } from 'node:crypto';
import { serviceClient } from './supabase.js';
import { env } from './env.js';
import { AppError, getClientIp } from './http.js';

/**
 * Database-backed rate limiting.
 *
 * Serverless functions do not share memory, so counters live in Postgres. The
 * identifier is hashed with a server-only salt before it leaves the function
 * (raw IP addresses are never stored).
 */

function salt() {
  return env('RATE_LIMIT_SALT', 'hasswell-local-development-salt');
}

export function hashIdentifier(value) {
  return createHash('sha256').update(`${salt()}:${String(value)}`).digest('hex').slice(0, 40);
}

/**
 * @param {object} req
 * @param {object} options
 * @param {string} options.bucket   Logical endpoint name, e.g. "checkout".
 * @param {number} options.limit    Allowed requests within the window.
 * @param {number} options.windowSeconds
 * @param {string} [options.identifier] Override the default client IP.
 * @param {boolean} [options.failClosed] Reject when the limiter itself fails.
 */
export async function enforceRateLimit(
  req,
  { bucket, limit, windowSeconds, identifier, failClosed = false }
) {
  const id = identifier || getClientIp(req);
  const key = `${bucket}:${hashIdentifier(id)}`;

  try {
    const { data, error } = await serviceClient().rpc('consume_rate_limit', {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds
    });

    if (error) throw error;

    if (data === false) {
      throw new AppError(
        'RATE_LIMITED',
        'Too many requests. Please wait a moment and try again.',
        429
      );
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('[rate-limit]', error?.message || error);
    if (failClosed) {
      throw new AppError(
        'RATE_LIMIT_UNAVAILABLE',
        'We could not process that request safely. Please try again shortly.',
        503
      );
    }
  }
}

/**
 * Consistent API responses and error handling.
 */

export class AppError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function ok(res, data = {}, status = 200) {
  return json(res, status, { ok: true, ...data });
}

export function fail(res, error) {
  const status = error?.status && Number.isInteger(error.status) ? error.status : 500;
  const body = {
    ok: false,
    error: {
      code: error?.code || (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED'),
      message:
        status >= 500 && !error?.expose
          ? 'Something went wrong on our side. Please try again shortly.'
          : error?.message || 'Request failed.',
      ...(error?.details ? { details: error.details } : {})
    }
  };
  if (status >= 500) console.error('[api]', error);
  return json(res, status, body);
}

export function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed.join(', '));
  return fail(res, new AppError('METHOD_NOT_ALLOWED', 'Method not allowed.', 405));
}

export function assertMethod(req, allowed) {
  if (!allowed.includes(req.method)) {
    const error = new AppError('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);
    error.allowed = allowed;
    throw error;
  }
}

export async function readJson(req, { maxBytes = 64 * 1024 } = {}) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new AppError('PAYLOAD_TOO_LARGE', 'Request body is too large.', 413);
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError('INVALID_JSON', 'Request body must be valid JSON.', 400);
  }
}

export async function readRawBody(req, { maxBytes = 1024 * 1024 } = {}) {
  // Some runtimes provide a pre-read body. Only accept bytes/strings: a parsed
  // object cannot be used for signature verification.
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (typeof req.body === 'string') return req.body;

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new AppError('PAYLOAD_TOO_LARGE', 'Request body is too large.', 413);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

export function requireJson(req) {
  const type = req.headers['content-type'] || '';
  if (!type.includes('application/json')) {
    throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.', 415);
  }
}

/**
 * Wraps a handler with uniform error handling so stack traces never leak.
 */
export function handler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error?.allowed) {
        res.setHeader('Allow', error.allowed.join(', '));
      }
      fail(res, error);
    }
  };
}

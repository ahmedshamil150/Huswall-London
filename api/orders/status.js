import { handler, ok, assertMethod } from '../_lib/http.js';
import { enforceRateLimit } from '../_lib/rate-limit.js';
import { getOrderByAccess, getOrderItems, publicOrder } from '../_lib/orders.js';

/**
 * Private order lookup. Requires both the order number and the unguessable
 * access token issued at checkout. Only customer-facing fields are returned.
 */
export default handler(async (req, res) => {
  assertMethod(req, ['GET']);

  await enforceRateLimit(req, { bucket: 'order-status', limit: 120, windowSeconds: 60 });

  const url = new URL(req.url, 'http://localhost');
  const orderNumber = url.searchParams.get('order');
  const token = url.searchParams.get('token');

  const order = await getOrderByAccess(orderNumber, token);
  const items = await getOrderItems(order.id);

  return ok(res, { order: publicOrder(order, items) });
});

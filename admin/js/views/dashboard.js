import { adminApi } from '../api.js';
import {
  escapeHtml,
  formatMoney,
  formatDateTime,
  orderBadge,
  paymentBadge,
  pageHead,
  notice
} from '../ui.js';

export async function renderDashboard(view) {
  const data = await adminApi('/dashboard');
  const stats = data.stats || {};
  const recent = stats.recent_orders || [];
  const best = stats.best_sellers || [];

  view.innerHTML = `
    ${pageHead({
      title: 'Dashboard',
      subtitle: `Signed in as ${data.admin?.email || 'administrator'}. Figures update live from the database.`,
      actions: `<a class="btn btn--ghost" href="#/orders">All orders</a><a class="btn" href="#/products/new">Add product</a>`
    })}

    <div class="stat-grid">
      <div class="stat">
        <div class="stat__label">Verified revenue</div>
        <div class="stat__value">${formatMoney(stats.revenue_minor || 0)}</div>
        <div class="stat__meta">Paid orders only</div>
      </div>
      <div class="stat">
        <div class="stat__label">Total orders</div>
        <div class="stat__value">${Number(stats.total_orders || 0)}</div>
        <div class="stat__meta">${Number(stats.completed_orders || 0)} dispatched or delivered</div>
      </div>
      <div class="stat ${Number(stats.pending_orders || 0) ? 'stat--warn' : ''}">
        <div class="stat__label">Pending payment</div>
        <div class="stat__value">${Number(stats.pending_orders || 0)}</div>
        <div class="stat__meta">Stock is reserved until payment or expiry</div>
      </div>
      <div class="stat">
        <div class="stat__label">Processing</div>
        <div class="stat__value">${Number(stats.processing_orders || 0)}</div>
        <div class="stat__meta">Paid, awaiting or with supplier</div>
      </div>
      <div class="stat ${Number(stats.low_stock_count || 0) ? 'stat--warn' : ''}">
        <div class="stat__label">Low stock</div>
        <div class="stat__value">${Number(stats.low_stock_count || 0)}</div>
        <div class="stat__meta">At or below threshold</div>
      </div>
      <div class="stat ${Number(stats.out_of_stock_count || 0) ? 'stat--danger' : ''}">
        <div class="stat__label">Out of stock</div>
        <div class="stat__value">${Number(stats.out_of_stock_count || 0)}</div>
        <div class="stat__meta">Available quantity is zero</div>
      </div>
    </div>

    <div class="dashboard-grid">
      <section class="card">
        <div class="card__head">
          <h3>Recent orders</h3>
          <a class="link small" href="#/orders">View all</a>
        </div>
        ${
          recent.length
            ? `<div class="table-wrap">
                 <table class="data-table">
                   <thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th>Placed</th></tr></thead>
                   <tbody>
                     ${recent
                       .map(
                         (order) => `<tr>
                           <td><a class="link" href="#/orders/${escapeHtml(order.id)}">${escapeHtml(order.order_number)}</a></td>
                           <td>${escapeHtml(order.shipping_name || order.email)}<span class="cell-sub">${escapeHtml(order.email)}</span></td>
                           <td class="nowrap">${formatMoney(order.total_minor, order.currency)}</td>
                           <td><div class="badge-row">${orderBadge(order.status)}${paymentBadge(order.payment_status)}</div></td>
                           <td class="nowrap small muted">${formatDateTime(order.placed_at)}</td>
                         </tr>`
                       )
                       .join('')}
                   </tbody>
                 </table>
               </div>`
            : `<div class="empty">No orders yet. Orders will appear here as soon as checkout is used.</div>`
        }
      </section>

      <div class="stack">
        <section class="card">
          <div class="card__head"><h3>Best sellers</h3><a class="link small" href="#/products">Products</a></div>
          <div class="card__body">
            ${
              best.length
                ? `<div class="detail-list">${best
                    .map(
                      (product) => `<div class="row">
                        <span>${escapeHtml(product.name)}<br><span class="small muted mono">${escapeHtml(
                          product.sku
                        )}</span></span>
                        <span>${Number(product.sales_count)} sold<br><span class="small muted">${formatMoney(
                          product.price_minor
                        )}</span></span>
                      </div>`
                    )
                    .join('')}</div>`
                : `<p class="muted small">Sales ranking appears after paid orders are recorded.</p>`
            }
          </div>
        </section>

        <section class="card">
          <div class="card__head"><h3>Operational notes</h3></div>
          <div class="card__body stack small">
            ${notice(
              'Payments are only marked paid after a server-side check: a signed Stripe webhook, or an administrator confirming a bank transfer.',
              'warn'
            )}
            ${notice(
              'Supplier orders are never sent automatically. AW Dropship submission stays manual until its request schema is verified.',
              ''
            )}
            <a class="link" href="#/supplier">Open supplier settings</a>
          </div>
        </section>
      </div>
    </div>`;
}

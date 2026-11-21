import { adminApi } from '../api.js';
import {
  escapeHtml,
  formatDateTime,
  pageHead,
  notice,
  stockBadge,
  toast,
  setBusy
} from '../ui.js';

/**
 * Inventory is the operational source of truth for stock. Available quantity is
 * always (on hand − reserved), calculated by the server. Adjustments are
 * recorded as movements so the history remains auditable.
 */
export async function renderInventory(view) {
  const state = { q: '', low: false, page: 1 };

  view.innerHTML = `
    ${pageHead({
      title: 'Inventory',
      subtitle: 'On-hand stock, reservations and supplier stock. Adjustments are recorded as movements.',
      actions: `<a class="btn btn--ghost" href="#/supplier">Supplier sync</a>`
    })}

    <section class="card">
      <form class="toolbar" id="inventory-filters">
        <div class="field">
          <label for="inventory-search">Search</label>
          <input id="inventory-search" name="q" type="search" placeholder="Product name or SKU">
        </div>
        <div class="field" style="min-width:auto">
          <label class="check" style="margin-top:.4rem">
            <input type="checkbox" name="low" ${state.low ? 'checked' : ''}>
            <span>Low stock only</span>
          </label>
        </div>
        <button class="btn btn--ghost" type="submit">Filter</button>
        <span class="spacer"></span>
      </form>
      <div id="inventory-results"></div>
    </section>

    <div class="notice notice--warn" style="margin-top:1.2rem">
      <strong>Stock rules.</strong>
      <p>Reserved stock belongs to unpaid orders. Cancelling an order releases its reservation; verifying payment commits it. You cannot reduce on-hand stock below the quantity currently reserved.</p>
    </div>`;

  const results = view.querySelector('#inventory-results');

  async function load() {
    results.innerHTML = '<div class="empty">Loading inventory…</div>';
    const params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.low) params.set('low', '1');
    params.set('page', String(state.page));
    params.set('pageSize', '50');

    try {
      const data = await adminApi(`/inventory?${params.toString()}`);
      results.innerHTML = `${
        data.items?.length
          ? `<div class="table-wrap">
               <table class="data-table">
                 <thead>
                   <tr>
                     <th>Product</th><th>Option</th><th>On hand</th><th>Reserved</th>
                     <th>Available</th><th>Supplier</th><th>Adjust</th>
                   </tr>
                 </thead>
                 <tbody>
                   ${data.items
                     .map(
                       (row) => `<tr data-row="${escapeHtml(row.id)}" data-product="${escapeHtml(
                         row.product_id
                       )}" data-variant="${escapeHtml(row.variant_id || '')}">
                         <td>
                           <span class="cell-main">${escapeHtml(row.product_name)}</span>
                           <span class="cell-sub mono">${escapeHtml(row.product_sku)}</span>
                         </td>
                         <td>${row.variant_name ? escapeHtml(row.variant_name) : '<span class="muted">Single SKU</span>'}${
                           row.variant_sku
                             ? `<span class="cell-sub mono">${escapeHtml(row.variant_sku)}</span>`
                             : ''
                         }</td>
                         <td><span data-on-hand>${Number(row.stock_on_hand)}</span></td>
                         <td><span data-reserved>${Number(row.stock_reserved)}</span></td>
                         <td>${stockBadge(Number(row.available), Number(row.low_stock_threshold))}</td>
                         <td class="small muted">${
                           row.supplier_stock === null || row.supplier_stock === undefined
                             ? '—'
                             : `${Number(row.supplier_stock)}<span class="cell-sub">${
                                 row.last_synced_at ? formatDateTime(row.last_synced_at) : ''
                               }</span>`
                         }</td>
                         <td>
                           <div class="cluster" style="flex-wrap:nowrap">
                             <input class="input" style="width:84px" type="number" step="1" data-delta
                               placeholder="± qty" aria-label="Adjustment for ${escapeHtml(row.product_name)}">
                             <button class="btn btn--ghost btn--sm" type="button" data-adjust>Apply</button>
                           </div>
                         </td>
                       </tr>`
                     )
                     .join('')}
                 </tbody>
               </table>
             </div>
             <div class="pagination">
               <span>Page ${data.page} · ${data.total} inventory row${data.total === 1 ? '' : 's'}</span>
               <span class="cluster">
                 <button class="btn btn--ghost btn--sm" type="button" data-page="${data.page - 1}" ${
                   data.page <= 1 ? 'disabled' : ''
                 }>Previous</button>
                 <button class="btn btn--ghost btn--sm" type="button" data-page="${data.page + 1}" ${
                   data.page * data.pageSize >= data.total ? 'disabled' : ''
                 }>Next</button>
               </span>
             </div>`
          : `<div class="empty">${
              state.low || state.q
                ? 'No inventory rows match those filters.'
                : 'No inventory yet. Add products and they will appear here.'
            }</div>`
      }`;

      results.querySelectorAll('[data-page]').forEach((button) => {
        button.addEventListener('click', () => {
          state.page = Number(button.dataset.page);
          load();
        });
      });

      results.querySelectorAll('[data-adjust]').forEach((button) => {
        button.addEventListener('click', async () => {
          const row = button.closest('tr');
          const input = row.querySelector('[data-delta]');
          const delta = Number(input.value);
          if (!Number.isInteger(delta) || delta === 0) {
            toast('Enter a non-zero whole number.', 'error');
            return;
          }

          setBusy(button, true, 'Saving…');
          try {
            const result = await adminApi('/inventory', {
              method: 'POST',
              body: {
                product_id: row.dataset.product,
                variant_id: row.dataset.variant || null,
                delta,
                note: 'Admin adjustment from inventory page'
              }
            });
            const inventory = result.inventory || {};
            row.querySelector('[data-on-hand]').textContent = Number(inventory.stock_on_hand);
            row.querySelector('[data-reserved]').textContent = Number(inventory.stock_reserved);
            const availableCell = row.children[4];
            availableCell.innerHTML = stockBadge(
              Math.max(0, Number(inventory.stock_on_hand) - Number(inventory.stock_reserved)),
              Number(inventory.low_stock_threshold ?? 3)
            );
            input.value = '';
            toast('Stock adjusted.', 'success');
          } catch (error) {
            toast(error.message, 'error');
          } finally {
            setBusy(button, false);
          }
        });
      });
    } catch (error) {
      results.innerHTML = notice(escapeHtml(error.message), 'error');
    }
  }

  view.querySelector('#inventory-filters').addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    state.q = String(data.get('q') || '').trim();
    state.low = data.get('low') === 'on';
    state.page = 1;
    load();
  });

  await load();
}

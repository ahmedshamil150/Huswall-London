import { adminApi } from '../api.js';
import { escapeHtml, formatDateTime, pageHead, notice, statusLabel, toast, setBusy } from '../ui.js';

/**
 * AW Dropship supplier control.
 *
 * Catalogue and stock sync use the documented data feed. Order submission is
 * intentionally manual: the public API documentation does not describe the
 * order request body, so automated submission stays disabled and clearly
 * labelled rather than pretending to work.
 */
export async function renderSupplier(view) {
  view.innerHTML = '<div class="empty">Loading supplier configuration…</div>';

  let data;
  try {
    data = await adminApi('/suppliers');
  } catch (error) {
    view.innerHTML = notice(escapeHtml(error.message), 'error');
    return;
  }

  const accounts = data.items ?? [];
  const logs = data.logs ?? [];

  view.innerHTML = `
    ${pageHead({
      title: 'Supplier',
      subtitle: 'AW Dropship catalogue and stock sync, plus manual fulfilment records.',
      actions: `<a class="btn btn--ghost" href="#/orders">Paid orders</a>`
    })}

    <div class="notice notice--warn">
      <strong>Order submission is manual.</strong>
      <p>AW Dropship publishes catalogue, stock and client endpoints, but does not publicly document the order-creation request body. Automated submission is disabled until it has been verified against your account. Place paid orders in the AW dashboard, then record the reference on the order. Unpaid orders are never sent.</p>
    </div>

    ${
      accounts.length
        ? accounts
            .map((account) => {
              const runtime = account.runtime ?? {};
              const counts = account.counts ?? { products: 0, linked: 0 };
              return `<section class="card" data-supplier="${escapeHtml(account.id)}">
                <div class="card__head">
                  <div>
                    <h3>${escapeHtml(account.name || 'AW Dropship')}</h3>
                    <span class="small muted">${escapeHtml(account.connector || 'aw-dropship')} · ${
                      account.is_active
                        ? '<span class="badge badge--green">Active</span>'
                        : '<span class="badge badge--grey">Inactive</span>'
                    }</span>
                  </div>
                  <div class="cluster">
                    <button class="btn btn--ghost btn--sm" type="button" data-test>Test connection</button>
                    <button class="btn btn--ghost btn--sm" type="button" data-toggle>${
                      account.is_active ? 'Deactivate' : 'Activate'
                    }</button>
                  </div>
                </div>
                <div class="card__body">
                  <div class="stat-grid" style="margin-bottom:1rem">
                    <div class="stat">
                      <div class="stat__label">Feed products</div>
                      <div class="stat__value">${Number(counts.products || 0)}</div>
                      <div class="stat__meta">${Number(counts.linked || 0)} linked to store products</div>
                    </div>
                    <div class="stat">
                      <div class="stat__label">API token</div>
                      <div class="stat__value" style="font-size:1.1rem">${
                        runtime.token_configured ? 'Configured' : 'Missing'
                      }</div>
                      <div class="stat__meta">Set AW_DROPSHIP_API_TOKEN in Vercel</div>
                    </div>
                    <div class="stat">
                      <div class="stat__label">Order submission</div>
                      <div class="stat__value" style="font-size:1.1rem">Manual</div>
                      <div class="stat__meta">Automated submission unverified</div>
                    </div>
                  </div>

                  <div class="detail-list" style="margin-bottom:1rem">
                    <div class="row"><span>API base URL</span><span class="mono small">${escapeHtml(
                      runtime.base_url || account.api_base_url || 'Not set'
                    )}</span></div>
                    <div class="row"><span>Credentials reference</span><span class="mono small">${escapeHtml(
                      account.credentials_ref || 'AW_DROPSHIP_API_TOKEN'
                    )}</span></div>
                    <div class="row"><span>Last updated</span><span>${formatDateTime(
                      account.updated_at || account.created_at
                    )}</span></div>
                  </div>

                  <form class="form-grid" data-settings-form>
                    <div class="field">
                      <label>Name</label>
                      <input class="input" name="name" type="text" value="${escapeHtml(account.name || '')}">
                    </div>
                    <div class="field">
                      <label>API base URL</label>
                      <input class="input" name="api_base_url" type="url"
                        value="${escapeHtml(account.api_base_url || '')}"
                        placeholder="https://api.aiku.io">
                    </div>
                    <div class="field">
                      <label>Credentials reference</label>
                      <input class="input" name="credentials_ref" type="text"
                        value="${escapeHtml(account.credentials_ref || '')}"
                        placeholder="AW_DROPSHIP_API_TOKEN">
                      <span class="field__hint">Environment variable name only. The token itself is never stored here.</span>
                    </div>
                    <div class="field">
                      <label>Notes</label>
                      <input class="input" name="notes" type="text" value="${escapeHtml(account.notes || '')}">
                    </div>
                    <div class="field field--full">
                      <div class="cluster">
                        <button class="btn btn--ghost btn--sm" type="submit" data-save>Save details</button>
                        <label class="check">
                          <input type="checkbox" data-create-missing>
                          <span>Create missing store products on sync</span>
                        </label>
                        <button class="btn btn--sm" type="button" data-sync>Sync catalogue &amp; stock</button>
                      </div>
                    </div>
                  </form>
                </div>
              </section>`;
            })
            .join('')
        : `<section class="card"><div class="empty">
             No supplier account is configured. Apply the database migrations to create the AW Dropship account row.
           </div></section>`
    }

    <section class="card">
      <div class="card__head"><h3>Sync history</h3><span class="small muted">Most recent 20 runs</span></div>
      ${
        logs.length
          ? `<div class="table-wrap">
               <table class="data-table">
                 <thead><tr><th>Started</th><th>Job</th><th>Status</th><th>Processed</th><th>Failed</th><th>Error</th></tr></thead>
                 <tbody>
                   ${logs
                     .map(
                       (log) => `<tr>
                         <td class="small nowrap">${formatDateTime(log.started_at)}</td>
                         <td class="small">${escapeHtml(statusLabel(log.job_type))}</td>
                         <td><span class="badge badge--${
                           log.status === 'success' ? 'green' : log.status === 'failed' ? 'red' : 'gold'
                         }">${escapeHtml(log.status)}</span></td>
                         <td>${Number(log.records_processed ?? 0)}</td>
                         <td>${Number(log.records_failed ?? 0)}</td>
                         <td class="small muted">${escapeHtml(log.error_message || '—')}</td>
                       </tr>`
                     )
                     .join('')}
                 </tbody>
               </table>
             </div>`
          : '<div class="empty">No sync has run yet. Use “Sync catalogue &amp; stock” after configuring the token.</div>'
      }
    </section>`;

  function flash(message, tone = 'success') {
    toast(message, tone);
  }

  view.querySelectorAll('[data-supplier]').forEach((card) => {
    const supplierId = card.dataset.supplier;

    card.querySelector('[data-test]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      setBusy(button, true, 'Testing…');
      try {
        const result = await adminApi('/suppliers', {
          method: 'POST',
          body: { action: 'test', supplier_id: supplierId }
        });
        flash(`Connection succeeded. ${result.products_found} feed products visible.`);
      } catch (error) {
        flash(error.message, 'error');
      } finally {
        setBusy(button, false);
      }
    });

    card.querySelector('[data-toggle]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const activate = button.textContent.trim() === 'Activate';
      setBusy(button, true, 'Saving…');
      try {
        await adminApi('/suppliers', {
          method: 'POST',
          body: { action: 'toggle', supplier_id: supplierId, is_active: activate }
        });
        flash(activate ? 'Supplier activated.' : 'Supplier deactivated.');
        await renderSupplier(view);
      } catch (error) {
        flash(error.message, 'error');
        setBusy(button, false);
      }
    });

    card.querySelector('[data-settings-form]')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('[data-save]');
      setBusy(button, true, 'Saving…');
      try {
        await adminApi('/suppliers', {
          method: 'POST',
          body: {
            action: 'update',
            supplier_id: supplierId,
            name: form.elements.name.value.trim(),
            api_base_url: form.elements.api_base_url.value.trim(),
            credentials_ref: form.elements.credentials_ref.value.trim(),
            notes: form.elements.notes.value.trim()
          }
        });
        flash('Supplier details saved.');
        await renderSupplier(view);
      } catch (error) {
        flash(error.message, 'error');
        setBusy(button, false);
      }
    });

    card.querySelector('[data-sync]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const createMissing = card.querySelector('[data-create-missing]')?.checked ?? false;
      setBusy(button, true, 'Syncing…');
      try {
        const result = await adminApi('/suppliers', {
          method: 'POST',
          body: {
            action: 'sync',
            supplier_id: supplierId,
            create_missing_products: createMissing
          }
        });
        const summary = result.result ?? {};
        flash(
          `Sync finished. ${Number(summary.productsSeen ?? summary.products_seen ?? 0)} products seen, ${
            Number(summary.productsUpdated ?? summary.products_updated ?? 0)
          } updated.`
        );
        await renderSupplier(view);
      } catch (error) {
        flash(error.message, 'error');
        setBusy(button, false);
      }
    });
  });
}

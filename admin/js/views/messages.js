import { adminApi } from '../api.js';
import {
  escapeHtml,
  formatDateTime,
  pageHead,
  notice,
  selectOptions,
  statusLabel,
  toast
} from '../ui.js';

const STATUSES = [
  { value: 'new', label: 'New' },
  { value: 'read', label: 'Read' },
  { value: 'replied', label: 'Replied' },
  { value: 'archived', label: 'Archived' }
];

export async function renderMessages(view) {
  const state = { status: '', page: 1 };

  view.innerHTML = `
    ${pageHead({
      title: 'Messages',
      subtitle: 'Enquiries submitted through the storefront contact form.'
    })}
    <section class="card">
      <form class="toolbar" id="message-filters">
        <div class="field">
          <label for="message-status">Status</label>
          <select id="message-status" name="status">
            <option value="">All</option>
            ${selectOptions(STATUSES)}
          </select>
        </div>
        <button class="btn btn--ghost" type="submit">Filter</button>
      </form>
      <div id="message-results"></div>
    </section>`;

  const results = view.querySelector('#message-results');

  async function load() {
    results.innerHTML = '<div class="empty">Loading messages…</div>';
    const params = new URLSearchParams();
    if (state.status) params.set('status', state.status);
    params.set('page', String(state.page));
    params.set('pageSize', '25');

    try {
      const data = await adminApi(`/messages?${params.toString()}`);
      results.innerHTML = `${
        data.items?.length
          ? `<div class="table-wrap">
               <table class="data-table">
                 <thead>
                   <tr><th>From</th><th>Subject</th><th>Received</th><th>Status</th><th>Update</th></tr>
                 </thead>
                 <tbody>
                   ${data.items
                     .map(
                       (message) => `<tr data-message="${escapeHtml(message.id)}">
                         <td>
                           <span class="cell-main">${escapeHtml(message.name)}</span>
                           <span class="cell-sub"><a class="link" href="mailto:${escapeHtml(
                             message.email
                           )}">${escapeHtml(message.email)}</a></span>
                         </td>
                         <td>
                           <details>
                             <summary class="link" style="cursor:pointer">${escapeHtml(message.subject)}</summary>
                             <p class="small" style="margin-top:.6rem;white-space:pre-wrap;max-width:60ch">${escapeHtml(
                               message.message
                             )}</p>
                           </details>
                         </td>
                         <td class="small muted nowrap">${formatDateTime(message.created_at)}</td>
                         <td><span class="badge badge--${
                           message.status === 'new'
                             ? 'gold'
                             : message.status === 'replied'
                               ? 'green'
                               : 'grey'
                         }">${escapeHtml(statusLabel(message.status))}</span></td>
                         <td>
                           <div class="cluster" style="flex-wrap:nowrap">
                             <select class="input" style="width:130px" data-status>
                               ${STATUSES.map(
                                 (option) =>
                                   `<option value="${option.value}" ${
                                     option.value === message.status ? 'selected' : ''
                                   }>${escapeHtml(option.label)}</option>`
                               ).join('')}
                             </select>
                             <button class="btn btn--ghost btn--sm" type="button" data-save>Save</button>
                           </div>
                         </td>
                       </tr>`
                     )
                     .join('')}
                 </tbody>
               </table>
             </div>
             <div class="pagination">
               <span>Page ${data.page} · ${data.total} message${data.total === 1 ? '' : 's'}</span>
               <span class="cluster">
                 <button class="btn btn--ghost btn--sm" type="button" data-page="${data.page - 1}" ${
                   data.page <= 1 ? 'disabled' : ''
                 }>Previous</button>
                 <button class="btn btn--ghost btn--sm" type="button" data-page="${data.page + 1}" ${
                   data.page * data.pageSize >= data.total ? 'disabled' : ''
                 }>Next</button>
               </span>
             </div>`
          : `<div class="empty">No messages${state.status ? ' with that status' : ''}. Contact form submissions will appear here.</div>`
      }`;

      results.querySelectorAll('[data-page]').forEach((button) => {
        button.addEventListener('click', () => {
          state.page = Number(button.dataset.page);
          load();
        });
      });

      results.querySelectorAll('[data-save]').forEach((button) => {
        button.addEventListener('click', async () => {
          const row = button.closest('tr');
          const status = row.querySelector('[data-status]').value;
          button.disabled = true;
          try {
            await adminApi('/messages', {
              method: 'PATCH',
              body: { id: row.dataset.message, status }
            });
            toast('Message status updated.', 'success');
            await load();
          } catch (error) {
            toast(error.message, 'error');
            button.disabled = false;
          }
        });
      });
    } catch (error) {
      results.innerHTML = notice(escapeHtml(error.message), 'error');
    }
  }

  view.querySelector('#message-filters').addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    state.status = String(data.get('status') || '');
    state.page = 1;
    load();
  });

  await load();
}

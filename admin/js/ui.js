import { escapeHtml, toast, setBusy } from '/shared/js/dom.js';
import { formatMoney, parsePriceToMinor, minorToInput } from '/shared/js/money.js';

export { escapeHtml, toast, setBusy, formatMoney, parsePriceToMinor, minorToInput };

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

const STATUS_LABELS = {
  pending_payment: 'Pending payment',
  paid: 'Paid',
  awaiting_supplier: 'Awaiting supplier',
  submitted_to_supplier: 'Submitted to supplier',
  supplier_processing: 'Supplier processing',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  failed: 'Failed',
  pending: 'Pending',
  authorised: 'Authorised',
  refunded: 'Refunded',
  partially_refunded: 'Part refunded',
  unfulfilled: 'Unfulfilled'
};

export function statusLabel(status) {
  return STATUS_LABELS[status] || String(status || '—').replaceAll('_', ' ');
}

export function orderBadge(status) {
  const tone =
    status === 'delivered'
      ? 'green'
      : status === 'dispatched'
        ? 'blue'
        : status === 'cancelled' || status === 'failed'
          ? 'red'
          : status === 'pending_payment'
            ? 'gold'
            : status === 'paid' || status === 'awaiting_supplier'
              ? 'gold'
              : 'grey';
  return `<span class="badge badge--${tone}">${escapeHtml(statusLabel(status))}</span>`;
}

export function paymentBadge(status) {
  const tone =
    status === 'paid' ? 'green' : status === 'pending' ? 'gold' : status === 'failed' ? 'red' : 'grey';
  return `<span class="badge badge--${tone}">${escapeHtml(statusLabel(status))}</span>`;
}

export function productStatusBadge(status) {
  const tone = status === 'active' ? 'green' : status === 'draft' ? 'gold' : 'grey';
  return `<span class="badge badge--${tone}">${escapeHtml(status)}</span>`;
}

export function stockBadge(available, threshold = 3) {
  if (available <= 0) return '<span class="badge badge--red">Out of stock</span>';
  if (available <= threshold) return `<span class="badge badge--gold">${available} left</span>`;
  return `<span class="badge badge--green">${available} available</span>`;
}

export function pageHead({ title, subtitle = '', actions = '' }) {
  return `<div class="page-head">
    <div>
      <h2>${escapeHtml(title)}</h2>
      ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
    </div>
    ${actions ? `<div class="actions">${actions}</div>` : ''}
  </div>`;
}

export function notice(message, tone = '') {
  return `<div class="notice ${tone ? `notice--${tone}` : ''}">${message}</div>`;
}

export function empty(message, action = '') {
  return `<div class="empty"><p>${escapeHtml(message)}</p>${action ? `<p style="margin-top:.8rem">${action}</p>` : ''}</div>`;
}

export function errorText(error) {
  return error?.message || 'Something went wrong. Please try again.';
}

export function truncate(value, length = 80) {
  const text = String(value || '');
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

export function checkbox(name, checked, label) {
  return `<label class="check"><input type="checkbox" name="${escapeHtml(name)}" ${
    checked ? 'checked' : ''
  }> <span>${escapeHtml(label)}</span></label>`;
}

export function selectOptions(options, selected) {
  return options
    .map((option) => {
      const value = typeof option === 'string' ? option : option.value;
      const label = typeof option === 'string' ? statusLabel(option) : option.label;
      return `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${escapeHtml(
        label
      )}</option>`;
    })
    .join('');
}

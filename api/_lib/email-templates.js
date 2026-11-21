/**
 * Transactional email templates.
 *
 * Plain HTML with inline styles so they render consistently. All dynamic
 * values are escaped. Copy never claims dispatch or delivery before the
 * supplier has confirmed it.
 */

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function formatMoney(minor, currency = 'GBP') {
  const amount = Number.isFinite(Number(minor)) ? Number(minor) / 100 : 0;
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

function lines(items = []) {
  return items
    .map(
      (item) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #ece7df;font-size:14px;color:#2b2b2b">
          ${escapeHtml(item.name)}${item.variant_name ? ` — ${escapeHtml(item.variant_name)}` : ''}
          <span style="color:#7a746b"> × ${Number(item.quantity) || 0}</span>
        </td>
        <td align="right" style="padding:10px 0;border-bottom:1px solid #ece7df;font-size:14px;color:#2b2b2b;white-space:nowrap">
          ${formatMoney(item.line_total_minor, item.currency || 'GBP')}
        </td>
      </tr>`
    )
    .join('');
}

function layout({ heading, intro, body, orderNumber, siteUrl }) {
  return `<!doctype html>
<html lang="en-GB">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:#f6f2ec;font-family:Georgia,'Times New Roman',serif;color:#1f1f1f">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f2ec;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffdf9;border:1px solid #e7e0d5">
        <tr><td style="padding:28px 32px 8px 32px">
          <div style="font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#8b8377">Hasswell London</div>
          <h1 style="margin:14px 0 0;font-size:26px;line-height:1.25;font-weight:400">${escapeHtml(heading)}</h1>
          ${intro ? `<p style="margin:14px 0 0;font-size:15px;line-height:1.7;color:#5f5a53">${intro}</p>` : ''}
        </td></tr>
        <tr><td style="padding:20px 32px 8px 32px">${body}</td></tr>
        <tr><td style="padding:8px 32px 28px 32px">
          <p style="margin:18px 0 0;font-size:12px;line-height:1.7;color:#8b8377">
            Order ${escapeHtml(orderNumber || '')} · <a href="${escapeHtml(siteUrl)}" style="color:#8b8377">${escapeHtml(
              siteUrl.replace(/^https?:\/\//, '')
            )}</a>
          </p>
          <p style="margin:8px 0 0;font-size:12px;line-height:1.7;color:#8b8377">
            This is an automated message. Reply to it and our team will see it.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function orderReceivedEmail({ order, items, payment, siteUrl }) {
  const currency = order.currency || 'GBP';
  const isManual = payment?.provider === 'manual';
  const instructionHtml = payment?.instructions
    ? `<div style="margin:18px 0 0;padding:16px;background:#faf6ef;border:1px solid #e7e0d5">
         <p style="margin:0 0 8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#8b8377">How to pay</p>
         ${payment.instructions
           .split('\n')
           .filter(Boolean)
           .map((line) => `<p style="margin:4px 0;font-size:14px;line-height:1.6;color:#2b2b2b">${escapeHtml(line)}</p>`)
           .join('')}
       </div>`
    : '';

  const body = `
    <p style="margin:0 0 12px;font-size:15px;line-height:1.7;color:#5f5a53">
      ${
        isManual
          ? 'We have reserved your order and are waiting for your bank transfer. We will only dispatch once payment has been verified.'
          : 'We have reserved your order and are waiting for your payment to be confirmed.'
      }
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px">
      ${lines(items)}
      <tr><td style="padding:12px 0 0;font-size:14px;color:#5f5a53">Delivery</td>
          <td align="right" style="padding:12px 0 0;font-size:14px;color:#5f5a53">${
            Number(order.shipping_minor) === 0 ? 'Included' : formatMoney(order.shipping_minor, currency)
          }</td></tr>
      <tr><td style="padding:8px 0 0;font-size:15px;font-weight:bold">Total</td>
          <td align="right" style="padding:8px 0 0;font-size:15px;font-weight:bold">${formatMoney(
            order.total_minor,
            currency
          )}</td></tr>
    </table>
    ${instructionHtml}
    <p style="margin:18px 0 0;font-size:13px;line-height:1.7;color:#8b8377">
      Delivery to: ${escapeHtml(order.shipping_name)}, ${escapeHtml(order.shipping_line1)}${
        order.shipping_line2 ? `, ${escapeHtml(order.shipping_line2)}` : ''
      }, ${escapeHtml(order.shipping_city)}, ${escapeHtml(order.shipping_postcode)}
    </p>`;

  return {
    subject: `Order ${order.order_number} received — payment pending`,
    html: layout({
      heading: 'Thank you — your order is reserved',
      intro: '',
      body,
      orderNumber: order.order_number,
      siteUrl
    }),
    text: [
      `Order ${order.order_number} received`,
      isManual
        ? 'We are waiting for your bank transfer. We will only dispatch once payment has been verified.'
        : 'We are waiting for your payment to be confirmed.',
      '',
      ...items.map(
        (item) =>
          `${item.name}${item.variant_name ? ` — ${item.variant_name}` : ''} × ${item.quantity}: ${formatMoney(
            item.line_total_minor,
            currency
          )}`
      ),
      `Delivery: ${Number(order.shipping_minor) === 0 ? 'Included' : formatMoney(order.shipping_minor, currency)}`,
      `Total: ${formatMoney(order.total_minor, currency)}`,
      ...(payment?.instructions ? ['', 'How to pay:', payment.instructions] : []),
      '',
      `Delivery to: ${order.shipping_name}, ${order.shipping_line1}, ${order.shipping_city}, ${order.shipping_postcode}`
    ].join('\n')
  };
}

export function paymentConfirmedEmail({ order, items, siteUrl }) {
  const currency = order.currency || 'GBP';
  return {
    subject: `Payment confirmed for order ${order.order_number}`,
    html: layout({
      heading: 'Payment confirmed',
      intro: 'Thank you. Your payment has been verified and your order is now being prepared.',
      body: `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${lines(items)}
          <tr><td style="padding:8px 0 0;font-size:15px;font-weight:bold">Total paid</td>
              <td align="right" style="padding:8px 0 0;font-size:15px;font-weight:bold">${formatMoney(
                order.total_minor,
                currency
              )}</td></tr>
        </table>
        <p style="margin:18px 0 0;font-size:13px;line-height:1.7;color:#8b8377">
          We will email you again when your order has been dispatched. You can view your order at any time using the
          private link from your confirmation page.
        </p>`,
      orderNumber: order.order_number,
      siteUrl
    }),
    text: [
      `Payment confirmed for order ${order.order_number}`,
      'Your payment has been verified and your order is being prepared.',
      '',
      ...items.map(
        (item) =>
          `${item.name}${item.variant_name ? ` — ${item.variant_name}` : ''} × ${item.quantity}: ${formatMoney(
            item.line_total_minor,
            currency
          )}`
      ),
      `Total paid: ${formatMoney(order.total_minor, currency)}`,
      '',
      'We will email you again when your order has been dispatched.'
    ].join('\n')
  };
}

export function orderDispatchedEmail({ order, siteUrl }) {
  const tracking = order.tracking_number
    ? `Tracking number: ${order.tracking_number}${order.carrier ? ` (${order.carrier})` : ''}`
    : 'Tracking details will follow shortly.';
  return {
    subject: `Order ${order.order_number} has been dispatched`,
    html: layout({
      heading: 'On its way',
      intro: 'Your order has been dispatched by our fulfilment partner.',
      body: `
        <div style="padding:16px;background:#faf6ef;border:1px solid #e7e0d5">
          <p style="margin:0;font-size:14px;line-height:1.7;color:#2b2b2b">${escapeHtml(tracking)}</p>
          ${
            order.tracking_url
              ? `<p style="margin:8px 0 0;font-size:14px"><a href="${escapeHtml(
                  order.tracking_url
                )}" style="color:#1f1f1f">Track your parcel</a></p>`
              : ''
          }
        </div>
        <p style="margin:18px 0 0;font-size:13px;line-height:1.7;color:#8b8377">
          If you have any questions about delivery, reply to this email and our team will help.
        </p>`,
      orderNumber: order.order_number,
      siteUrl
    }),
    text: [
      `Order ${order.order_number} has been dispatched.`,
      tracking,
      order.tracking_url ? `Track your parcel: ${order.tracking_url}` : '',
      '',
      'If you have any questions about delivery, reply to this email and our team will help.'
    ]
      .filter(Boolean)
      .join('\n')
  };
}

export function orderCancelledEmail({ order, reason, siteUrl }) {
  return {
    subject: `Order ${order.order_number} has been cancelled`,
    html: layout({
      heading: 'Order cancelled',
      intro: 'Your order has been cancelled.',
      body: `
        ${
          reason
            ? `<p style="margin:0 0 12px;font-size:14px;line-height:1.7;color:#2b2b2b">${escapeHtml(reason)}</p>`
            : ''
        }
        <p style="margin:0;font-size:14px;line-height:1.7;color:#5f5a53">
          ${
            order.payment_status === 'paid'
              ? 'Any payment taken will be refunded to the original payment method. Refund timing depends on your bank.'
              : 'No payment was taken for this order.'
          }
        </p>`,
      orderNumber: order.order_number,
      siteUrl
    }),
    text: [
      `Order ${order.order_number} has been cancelled.`,
      reason || '',
      order.payment_status === 'paid'
        ? 'Any payment taken will be refunded to the original payment method.'
        : 'No payment was taken for this order.'
    ]
      .filter(Boolean)
      .join('\n')
  };
}

export function contactNotificationEmail({ message, siteUrl }) {
  return {
    subject: `Website enquiry: ${message.subject}`,
    html: layout({
      heading: 'New website enquiry',
      intro: `From ${message.name} &lt;${message.email}&gt;`,
      body: `
        <p style="margin:0 0 12px;font-size:14px;line-height:1.7;color:#2b2b2b;white-space:pre-wrap">${escapeHtml(
          message.message
        )}</p>
        <p style="margin:18px 0 0;font-size:13px;color:#8b8377">
          Reply directly to this email to reach the sender.
        </p>`,
      orderNumber: '',
      siteUrl
    }),
    text: `New website enquiry\nFrom: ${message.name} <${message.email}>\nSubject: ${message.subject}\n\n${message.message}`,
    replyTo: message.email
  };
}

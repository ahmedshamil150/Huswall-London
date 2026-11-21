/** Money helpers. All amounts are integer minor units (pence). */

export function formatMoney(minor, currency = 'GBP') {
  const amount = Number.isFinite(Number(minor)) ? Number(minor) / 100 : 0;
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

export function parsePriceToMinor(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalised = String(value).replace(/[£,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(normalised)) return null;
  return Math.round(Number(normalised) * 100);
}

export function minorToInput(minor) {
  if (minor === null || minor === undefined) return '';
  return (Number(minor) / 100).toFixed(2);
}

export function percentOff(priceMinor, compareAtMinor) {
  if (!compareAtMinor || compareAtMinor <= priceMinor) return 0;
  return Math.round(((compareAtMinor - priceMinor) / compareAtMinor) * 100);
}

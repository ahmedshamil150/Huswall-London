import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateShipping, shippingRegions, storeCurrency } from '../api/_lib/shipping.js';
import { validateSettingsInput } from '../api/_lib/admin.js';

test('shipping defaults to zero when no rate is configured', () => {
  assert.equal(calculateShipping(1000, {}), 0);
  assert.equal(calculateShipping(1000, { 'shipping.flat_rate_minor': 0 }), 0);
});

test('flat rate and free threshold are applied server-side', () => {
  const settings = { 'shipping.flat_rate_minor': 495, 'shipping.free_threshold_minor': 5000 };
  assert.equal(calculateShipping(1000, settings), 495);
  assert.equal(calculateShipping(4999, settings), 495);
  assert.equal(calculateShipping(5000, settings), 0);
  assert.equal(calculateShipping(9000, settings), 0);
});

test('regions and currency are normalised with safe fallbacks', () => {
  assert.deepEqual(shippingRegions({ 'shipping.regions': ['gb', 'IE', 'x'] }), ['GB', 'IE']);
  assert.deepEqual(shippingRegions({}), ['GB']);
  assert.equal(storeCurrency({ 'store.currency': 'eur' }), 'EUR');
  assert.equal(storeCurrency({ 'store.currency': 'nonsense' }), 'GBP');
});

test('settings validation accepts supported values', () => {
  const settings = validateSettingsInput({
    settings: {
      'store.name': 'Hasswell London',
      'store.email': 'HELLO@EXAMPLE.COM',
      'store.currency': 'gbp',
      'shipping.flat_rate_minor': 495,
      'shipping.regions': ['gb', 'IE'],
      ignored: 'value'
    }
  });
  assert.equal(settings['store.name'], 'Hasswell London');
  assert.equal(settings['store.email'], 'hello@example.com');
  assert.equal(settings['store.currency'], 'GBP');
  assert.equal(settings['shipping.flat_rate_minor'], 495);
  assert.deepEqual(settings['shipping.regions'], ['GB', 'IE']);
  assert.equal(settings.ignored, undefined);
});

test('settings validation rejects unsafe values', () => {
  assert.throws(
    () => validateSettingsInput({ settings: { 'store.currency': 'POUNDS' } }),
    /3-letter code/i
  );
  assert.throws(
    () => validateSettingsInput({ settings: { 'store.email': 'not-an-email' } }),
    /valid store email/i
  );
  assert.throws(
    () => validateSettingsInput({ settings: { 'shipping.regions': [] } }),
    /at least one delivery region/i
  );
  assert.throws(
    () => validateSettingsInput({ settings: { 'shipping.flat_rate_minor': -1 } }),
    /valid number/i
  );
  assert.throws(() => validateSettingsInput({ settings: {} }), /No valid settings/i);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractRows,
  normaliseFeed,
  parseMajorUnits,
  normaliseProductRow,
  mapOrderStatus,
  extractTracking
} from '../integrations/suppliers/aw-dropship/mapper.js';

test('feed rows are found under common wrapper keys', () => {
  assert.deepEqual(extractRows([{ sku: 'A' }]), [{ sku: 'A' }]);
  assert.deepEqual(extractRows({ data: [{ sku: 'A' }] }), [{ sku: 'A' }]);
  assert.deepEqual(extractRows({ result: { products: [{ sku: 'A' }] } }), [{ sku: 'A' }]);
  assert.deepEqual(extractRows({ nothing: true }), []);
});

test('major-unit prices convert to integer pence', () => {
  assert.equal(parseMajorUnits('12.34'), 1234);
  assert.equal(parseMajorUnits('£1,299.00'), 129900);
  assert.equal(parseMajorUnits(12), 1200);
  assert.equal(parseMajorUnits('n/a'), null);
});

test('product rows normalise and skip rows without a SKU', () => {
  const row = normaliseProductRow({
    sku: ' AW-100 ',
    name: 'Cedar Candle',
    price: '24.00',
    rrp: '30.00',
    stock: '7',
    status: 'In stock'
  });
  assert.equal(row.supplierSku, 'AW-100');
  assert.equal(row.name, 'Cedar Candle');
  assert.equal(row.priceMinor, 2400);
  assert.equal(row.rrpMinor, 3000);
  assert.equal(row.stock, 7);
  assert.equal(row.availability, 'in_stock');
  assert.equal(normaliseProductRow({ name: 'No SKU' }), null);
});

test('explicit minor-unit fields take priority and duplicate SKUs collapse', () => {
  const products = normaliseFeed({
    products: [
      { sku: 'A', name: 'One', price_minor: 999, price: '99.99' },
      { sku: 'a', name: 'Duplicate' },
      { sku: 'B', name: 'Two', availability: 'out of stock', stock: 0 }
    ]
  });
  assert.equal(products.length, 2);
  assert.equal(products[0].priceMinor, 999);
  assert.equal(products[1].availability, 'out_of_stock');
});

test('order statuses map onto the supplier enum', () => {
  assert.equal(mapOrderStatus('Dispatched'), 'dispatched');
  assert.equal(mapOrderStatus('delivered'), 'delivered');
  assert.equal(mapOrderStatus('Cancelled by supplier'), 'cancelled');
  assert.equal(mapOrderStatus('Picking in warehouse'), 'processing');
  assert.equal(mapOrderStatus('Submitted'), 'submitted');
  assert.equal(mapOrderStatus('something else'), 'pending');
});

test('tracking details are extracted from nested payloads', () => {
  const tracking = extractTracking({
    data: { tracking_number: 'TRACK123', courier: 'Royal Mail', tracking_url: 'https://track.example/123' }
  });
  assert.deepEqual(tracking, {
    number: 'TRACK123',
    carrier: 'Royal Mail',
    url: 'https://track.example/123'
  });
});

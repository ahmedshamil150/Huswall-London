import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCartItems,
  validateCheckoutInput,
  validateContactInput,
  validateNewsletterInput
} from '../api/_lib/validate.js';

const productId = '11111111-1111-4111-8111-111111111111';
const variantId = '22222222-2222-4222-8222-222222222222';

test('cart lines accept identifiers and quantities but never prices', () => {
  const items = validateCartItems([
    { product_id: productId, quantity: 2, unit_price_minor: 1 },
    { product_id: productId, quantity: 1 }
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].quantity, 3);
  assert.equal(items[0].unit_price_minor, undefined);
});

test('cart lines reject bad identifiers and quantities', () => {
  assert.throws(() => validateCartItems([]), /bag is empty/i);
  assert.throws(() => validateCartItems([{ product_id: 'nope', quantity: 1 }]), /invalid item/i);
  assert.throws(() => validateCartItems([{ product_id: productId, quantity: 0 }]), /quantities/i);
  assert.throws(
    () => validateCartItems([{ product_id: productId, variant_id: 'nope', quantity: 1 }]),
    /invalid item option/i
  );
});

function checkoutBody(overrides = {}) {
  return {
    terms_accepted: true,
    items: [{ product_id: productId, quantity: 1 }],
    customer: {
      email: 'Buyer@Example.com',
      phone: '07700 900123',
      shipping_name: 'Ada Lovelace',
      shipping_line1: '1 Analytical Way',
      shipping_city: 'London',
      shipping_postcode: 'SW1A 1AA',
      shipping_country: 'GB'
    },
    ...overrides
  };
}

test('checkout normalises and validates delivery details', () => {
  const result = validateCheckoutInput(checkoutBody());
  assert.equal(result.customer.email, 'buyer@example.com');
  assert.equal(result.customer.shipping_country, 'GB');
  assert.equal(result.customer.shipping_postcode, 'SW1A 1AA');
  assert.equal(result.customer.phone, '07700 900123');
});

test('checkout rejects missing terms, bad postcodes and unsupported countries', () => {
  assert.throws(() => validateCheckoutInput(checkoutBody({ terms_accepted: false })), /accept the terms/i);

  const badPostcode = checkoutBody();
  badPostcode.customer.shipping_postcode = 'NOT A CODE';
  assert.throws(() => validateCheckoutInput(badPostcode), /valid UK postcode/i);

  const unsupported = checkoutBody();
  unsupported.customer.shipping_country = 'US';
  assert.throws(() => validateCheckoutInput(unsupported), /do not currently deliver/i);

  const allowed = checkoutBody();
  allowed.customer.shipping_country = 'IE';
  allowed.customer.shipping_postcode = 'D02 X285';
  assert.equal(
    validateCheckoutInput(allowed, { allowedCountries: ['GB', 'IE'] }).customer.shipping_country,
    'IE'
  );
});

test('contact and newsletter inputs are sanitised', () => {
  const message = validateContactInput({
    name: '  Ada  ',
    email: 'ADA@EXAMPLE.COM ',
    message: '  Hello, I would like to ask about delivery.  '
  });
  assert.equal(message.name, 'Ada');
  assert.equal(message.email, 'ada@example.com');
  assert.equal(message.subject, 'Website enquiry');

  const subscriber = validateNewsletterInput({ email: 'ADA@EXAMPLE.COM', source: 'footer' });
  assert.deepEqual(subscriber, { email: 'ada@example.com', source: 'footer' });
  assert.equal(validateNewsletterInput({ email: 'a@b.co', source: 'evil' }).source, 'website');
  assert.throws(() => validateNewsletterInput({ email: 'nope' }), /valid email/i);
});

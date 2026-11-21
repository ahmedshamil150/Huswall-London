import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyStripeSignature } from '../integrations/payments/stripe.js';

const secret = 'whsec_test_secret';
const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });

function signatureFor(timestamp, body = payload, key = secret) {
  const digest = createHmac('sha256', key).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

test('a valid Stripe signature is accepted', () => {
  const timestamp = Math.floor(Date.now() / 1000);
  assert.equal(verifyStripeSignature({ payload, header: signatureFor(timestamp), secret }), true);
});

test('tampered payloads, wrong secrets and malformed headers are rejected', () => {
  const timestamp = Math.floor(Date.now() / 1000);
  assert.throws(
    () => verifyStripeSignature({ payload: `${payload} `, header: signatureFor(timestamp), secret }),
    /could not be verified/i
  );
  assert.throws(
    () => verifyStripeSignature({ payload, header: signatureFor(timestamp, payload, 'wrong'), secret }),
    /could not be verified/i
  );
  assert.throws(() => verifyStripeSignature({ payload, header: 'garbage', secret }), /malformed/i);
  assert.throws(() => verifyStripeSignature({ payload, header: '', secret }), /missing/i);
});

test('old signatures are rejected outside the tolerance window', () => {
  const oldTimestamp = Math.floor(Date.now() / 1000) - 900;
  assert.throws(
    () => verifyStripeSignature({ payload, header: signatureFor(oldTimestamp), secret }),
    /expired/i
  );
});

test('multiple v1 signatures are supported', () => {
  const timestamp = Math.floor(Date.now() / 1000);
  const good = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  const header = `t=${timestamp},v1=${'0'.repeat(64)},v1=${good}`;
  assert.equal(verifyStripeSignature({ payload, header, secret }), true);
});

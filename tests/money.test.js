import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney, parsePriceToMinor, minorToInput, percentOff } from '../shared/js/money.js';

test('money is handled in integer pence', () => {
  assert.equal(parsePriceToMinor('12.34'), 1234);
  assert.equal(parsePriceToMinor('£12.34'), 1234);
  assert.equal(parsePriceToMinor('1,299.00'), 129900);
  assert.equal(parsePriceToMinor('0.05'), 5);
});

test('invalid prices are rejected rather than guessed', () => {
  assert.equal(parsePriceToMinor(''), null);
  assert.equal(parsePriceToMinor('12.345'), null);
  assert.equal(parsePriceToMinor('abc'), null);
  assert.equal(parsePriceToMinor('-1.00'), null);
});

test('minor units round-trip to form inputs', () => {
  assert.equal(minorToInput(1299), '12.99');
  assert.equal(minorToInput(null), '');
});

test('formatting and percentage off are stable', () => {
  assert.equal(formatMoney(1299, 'GBP'), '£12.99');
  assert.equal(percentOff(1000, 2000), 50);
  assert.equal(percentOff(2000, 1000), 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectOrderLines, NewOrderForm, OrderPaymentForm, OrderStatusForm } from './order-form.ts';

const base = { requestId: '11111111-1111-4111-8111-111111111111', orderType: 'takeaway', customerName: '',
  customerPhone: '', deliveryAddress: '', note: '', paymentMethod: 'unpaid', paymentReference: '',
  expectedTaxMode: 'none', expectedTaxRateMillipercent: '0', lines: [{ menuItemId: '22222222-2222-4222-8222-222222222222',
    quantity: '2', expectedUnitPricePaise: '12550', expectedMenuUpdatedAt: '2026-11-06T00:00:00.000Z' }] };

test('order form preserves integer price/tax claims and accepts only bounded whole item counts', () => {
  const parsed = NewOrderForm.parse(base);
  assert.equal(parsed.lines[0].quantity, 2); assert.equal(parsed.lines[0].expectedUnitPricePaise, 12550n);
  assert.equal(parsed.expectedTaxRateMillipercent, 0n);
  for (const quantity of ['0', '-1', '1.5', '1001', '9999999999999999']) {
    assert.equal(NewOrderForm.safeParse({ ...base, lines: [{ ...base.lines[0], quantity }] }).success, false, quantity);
  }
  assert.equal(NewOrderForm.safeParse({ ...base, expectedTaxMode: 'काही नाही' }).success, false);
  assert.equal(NewOrderForm.safeParse({ ...base, lines: [{ ...base.lines[0], expectedMenuUpdatedAt: '' }] }).success, false);
});

test('delivery and received external-payment claims require their operating details', () => {
  assert.equal(NewOrderForm.safeParse({ ...base, orderType: 'delivery' }).success, false);
  assert.equal(NewOrderForm.safeParse({ ...base, orderType: 'delivery', customerPhone: '0123456789', deliveryAddress: 'Test collection point' }).success, true);
  assert.equal(NewOrderForm.safeParse({ ...base, paymentMethod: 'external' }).success, false);
  assert.equal(NewOrderForm.safeParse({ ...base, paymentMethod: 'external', paymentReference: 'qa-reference' }).success, true);
});

test('cart parsing ignores empty spare lines without dropping half-filled items or using hostile array lengths', () => {
  const rows = collectOrderLines([
    ['lines[0][menuItemId]', ''], ['lines[0][quantity]', ''],
    ['lines[99][menuItemId]', base.lines[0].menuItemId], ['lines[99][quantity]', '2'],
    ['lines[100][quantity]', '3'], ['lines[9999999999999999999][quantity]', '8'],
  ]);
  assert.equal(rows.length, 2); assert.equal(rows[0].quantity, '2'); assert.equal(rows[1].quantity, '3');
  assert.equal(NewOrderForm.safeParse({ ...base, lines: rows }).success, false);
});

test('cancellation requires a reason and status forms retain the state the operator saw', () => {
  const input = { orderId: base.requestId, status: 'cancelled', fromStatus: 'ordered', reason: '' };
  assert.equal(OrderStatusForm.safeParse(input).success, false);
  assert.equal(OrderStatusForm.parse({ ...input, reason: 'Customer changed plan' }).fromStatus, 'ordered');
  assert.equal(OrderStatusForm.safeParse({ ...input, reason: 'Valid', fromStatus: 'something else' }).success, false);
  assert.equal(OrderPaymentForm.safeParse({ orderId: base.requestId, requestId: base.requestId, method: 'external', eventType: 'refund', amount: '10.00', reference: '' }).success, false);
});

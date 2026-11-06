import { z } from 'zod';
import { ORDER_STATUSES, ORDER_TYPES, TAX_MODES } from './orders.ts';
import { collectIndexedRows, isBlankRow } from './form.ts';

const quantity = z.string().trim().regex(/^\d+$/, 'Enter a whole number of items.')
  .max(4, 'Enter at most 1000 of an item.').transform(Number)
  .refine(value => Number.isSafeInteger(value) && value >= 1 && value <= 1000, 'Enter between 1 and 1000 of each item.');

export const NewOrderForm = z.object({
  requestId: z.string().uuid('Refresh the page before creating another order.'),
  orderType: z.enum(ORDER_TYPES),
  customerName: z.string().trim().max(120, 'Customer name is too long.'),
  customerPhone: z.string().trim().max(40, 'Customer contact is too long.'),
  deliveryAddress: z.string().trim().max(1000, 'Delivery address is too long.'),
  note: z.string().trim().max(1000, 'Order notes are too long.'),
  paymentMethod: z.enum(['unpaid', 'cash', 'external']),
  paymentReference: z.string().trim().max(200, 'Payment reference is too long.'),
  expectedTaxMode: z.enum(TAX_MODES),
  expectedTaxRateMillipercent: z.string().regex(/^\d{1,6}$/, 'Refresh the sales settings before confirming.').transform(BigInt),
  lines: z.array(z.object({ menuItemId: z.string().uuid('Choose a menu item on every filled line.'), quantity,
    expectedUnitPricePaise: z.string().regex(/^\d{1,16}$/, 'Refresh the menu before confirming.').transform(BigInt),
    expectedMenuUpdatedAt: z.string().datetime('Refresh the menu before confirming.'),
  }))
    .min(1, 'Add at least one menu item.').max(100, 'An order can have at most 100 lines.'),
}).superRefine((input, context) => {
  if (input.orderType === 'delivery' && (!input.customerPhone || !input.deliveryAddress)) {
    context.addIssue({ code: 'custom', path: ['deliveryAddress'], message: 'Delivery orders need a contact number and delivery address.' });
  }
  if (input.paymentMethod === 'external' && !input.paymentReference) {
    context.addIssue({ code: 'custom', path: ['paymentReference'], message: 'Enter the reference for the payment already received.' });
  }
});

export function collectOrderLines(entries: Iterable<readonly [string, unknown]>) {
  return collectIndexedRows(entries).filter(line => !isBlankRow(line, ['menuItemId', 'quantity']));
}

export const OrderStatusForm = z.object({
  orderId: z.string().uuid('Choose a valid order.'),
  status: z.enum(ORDER_STATUSES),
  fromStatus: z.enum(ORDER_STATUSES),
  reason: z.string().trim().max(1000, 'Order notes are too long.'),
}).refine(input => input.status !== 'cancelled' || Boolean(input.reason), {
  message: 'Enter a reason before cancelling an order.', path: ['reason'],
});

export const OrderPaymentForm = z.object({
  orderId: z.string().uuid('Choose a valid order.'),
  requestId: z.string().uuid('Refresh the page before recording another payment.'),
  method: z.enum(['cash', 'external']),
  eventType: z.enum(['payment', 'refund']),
  amount: z.string().trim().min(1, 'Enter the amount received or refunded.').max(24, 'Payment amount is too long.'),
  reference: z.string().trim().max(200, 'Payment reference is too long.'),
}).refine(input => input.method !== 'external' || Boolean(input.reference), {
  message: 'Enter the reference for the external payment or refund.', path: ['reference'],
});

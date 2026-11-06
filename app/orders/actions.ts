'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '../../src/auth/server.ts';
import { createOrder, changeOrderStatus, recordOrderPayment } from '../../src/db/orders.ts';
import { collectOrderLines, NewOrderForm, OrderPaymentForm, OrderStatusForm } from '../../src/lib/order-form.ts';
import { rupeesToPaise } from '../../src/lib/units.ts';

export type OrderFormState = { error: string | null; ok?: string | null; nextRequestId?: string };

function operatorError(error: unknown): string {
  if (error instanceof RangeError || (error instanceof Error && ['AuthzError', 'MissingCostError', 'UnitMismatchError', 'OrderError', 'ProductionQuantityTooSmallError', 'NotStockedError', 'RecipeCycleError', 'RecipeDepthError', 'MissingSubRecipeError'].includes(error.name))) return error.message;
  throw error;
}

export async function createOrderAction(_previous: OrderFormState, form: FormData): Promise<OrderFormState> {
  const actor = await requirePermission('orders.record');
  const parsed = NewOrderForm.safeParse({ requestId: form.get('requestId'), orderType: form.get('orderType'),
    customerName: String(form.get('customerName') ?? ''), customerPhone: String(form.get('customerPhone') ?? ''),
    deliveryAddress: String(form.get('deliveryAddress') ?? ''), note: String(form.get('note') ?? ''),
    paymentMethod: form.get('paymentMethod'), paymentReference: String(form.get('paymentReference') ?? ''),
    expectedTaxMode: form.get('expectedTaxMode'), expectedTaxRateMillipercent: form.get('expectedTaxRateMillipercent'),
    lines: collectOrderLines(form.entries()) });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  let id: string;
  try {
    id = (await createOrder(actor, parsed.data)).orderId;
  } catch (error) { return { error: operatorError(error) }; }
  revalidatePath('/orders'); revalidatePath('/orders/new'); revalidatePath('/kitchen');
  revalidatePath('/ingredients'); revalidatePath('/stock/history');
  redirect(`/orders/${id}`);
}

export async function changeOrderStatusAction(_previous: OrderFormState, form: FormData): Promise<OrderFormState> {
  const actor = await requirePermission('orders.status');
  const parsed = OrderStatusForm.safeParse({ orderId: form.get('orderId'), status: form.get('status'), fromStatus: form.get('fromStatus'), reason: String(form.get('reason') ?? '') });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (parsed.data.status === 'cancelled') await requirePermission('orders.cancel');
  try {
    await changeOrderStatus(actor, { orderId: parsed.data.orderId, toStatus: parsed.data.status, fromStatus: parsed.data.fromStatus, reason: parsed.data.reason });
  } catch (error) { return { error: operatorError(error) }; }
  revalidatePath('/orders'); revalidatePath(`/orders/${parsed.data.orderId}`); revalidatePath('/kitchen'); revalidatePath('/reports');
  return { error: null, ok: 'Order status updated.' };
}

export async function recordOrderPaymentAction(_previous: OrderFormState, form: FormData): Promise<OrderFormState> {
  const actor = await requirePermission('orders.record');
  const parsed = OrderPaymentForm.safeParse({ orderId: form.get('orderId'), requestId: form.get('requestId'),
    method: form.get('method'), eventType: form.get('eventType'), amount: form.get('amount'), reference: String(form.get('reference') ?? '') });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (parsed.data.eventType === 'refund') await requirePermission('sales.manage');
  try {
    const { amount, ...input } = parsed.data;
    await recordOrderPayment(actor, { ...input, amountPaise: rupeesToPaise(amount) });
  } catch (error) { return { error: operatorError(error) }; }
  revalidatePath('/orders'); revalidatePath(`/orders/${parsed.data.orderId}`);
  return { error: null, ok: parsed.data.eventType === 'refund' ? 'Refund recorded.' : 'Payment recorded.', nextRequestId: crypto.randomUUID() };
}

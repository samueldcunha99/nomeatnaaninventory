'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from '../i18n/provider.tsx';
import { createOrderAction } from './actions.ts';
import { calculateOrderTotals, type OrderType, type TaxMode } from '../../src/lib/orders.ts';
import { formatINR, millipercentToPercent } from '../../src/lib/units.ts';

export type OrderMenuOption = { id: string; name: string; sellingPricePaise: string;
  fulfillmentMode: 'stocked' | 'made_to_order' | null; updatedAt: string };
type Row = { key: string; menuItemId: string; quantity: string };
const blank = (): Row => ({ key: crypto.randomUUID(), menuItemId: '', quantity: '' });

export function OrderForm({ menu, requestId: initialRequestId, taxMode, taxRate }: {
  menu: OrderMenuOption[]; requestId: string; taxMode: TaxMode | null; taxRate: string | null;
}) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(createOrderAction, { error: null });
  const [requestId] = useState(initialRequestId);
  const [rows, setRows] = useState<Row[]>([{ key: 'initial', menuItemId: '', quantity: '' }]);
  const [orderType, setOrderType] = useState<OrderType>('takeaway');
  const [payment, setPayment] = useState('unpaid');
  const configured = taxMode != null && taxRate != null;
  const filled = rows.filter(row => row.menuItemId || row.quantity);
  let totals: ReturnType<typeof calculateOrderTotals> | undefined;
  let previewError: string | undefined;
  if (filled.length && configured) {
    try {
      let subtotal = 0n;
      for (const row of filled) {
        const item = menu.find(candidate => candidate.id === row.menuItemId);
        const quantity = /^\d+$/.test(row.quantity) ? Number(row.quantity) : 0;
        if (!item?.fulfillmentMode || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000) throw new RangeError('Check the item and quantity on every line.');
        subtotal += BigInt(item.sellingPricePaise) * BigInt(quantity);
      }
      totals = calculateOrderTotals(subtotal, taxMode, BigInt(taxRate));
    } catch (error) { previewError = error instanceof Error ? error.message : 'Check the order before confirming.'; }
  }
  function update(index: number, patch: Partial<Row>) { setRows(current => current.map((row, i) => i === index ? { ...row, ...patch } : row)); }

  return <form action={action} className="max-w-4xl" noValidate>
    <input type="hidden" name="requestId" value={requestId} />
    <input type="hidden" name="expectedTaxMode" value={taxMode ?? ''} />
    <input type="hidden" name="expectedTaxRateMillipercent" value={taxRate ?? ''} />
    {state.error ? <p className="msg msg--error" role="alert">{t.message(state.error)}</p> : null}
    <section className="form-section"><h2>{t('Order details')}</h2>
      <div className="field max-w-xs"><label className="label" htmlFor="order-type">{t('Order type')}</label>
        <select className="select" id="order-type" name="orderType" value={orderType} onChange={event => setOrderType(event.target.value as OrderType)} disabled={pending}>
          <option value="dine_in">{t('Dine in')}</option><option value="takeaway">{t('Takeaway')}</option><option value="delivery">{t('Delivery')}</option>
        </select></div>
      <div className="flex flex-wrap gap-4">
        <div className="field grow"><label className="label" htmlFor="customer-name">{t('Customer name (optional)')}</label>
          <input className="input" id="customer-name" name="customerName" maxLength={120} autoComplete="off" disabled={pending} /></div>
        <div className="field grow"><label className="label" htmlFor="customer-phone">{t('Customer contact')}</label>
          <input className="input" id="customer-phone" name="customerPhone" maxLength={40} type="tel" autoComplete="off" required={orderType === 'delivery'} disabled={pending} /></div>
      </div>
      {orderType === 'delivery' ? <div className="field"><label className="label" htmlFor="delivery-address">{t('Delivery address')}</label>
        <textarea className="input" id="delivery-address" name="deliveryAddress" maxLength={1000} rows={2} required disabled={pending} /></div> : null}
      <div className="field"><label className="label" htmlFor="order-note">{t('Order notes (optional)')}</label>
        <textarea className="input" id="order-note" name="note" maxLength={1000} rows={2} disabled={pending} /></div>
    </section>

    <section className="form-section"><h2>{t('Items to prepare')}</h2>
      {rows.map((row, index) => {
        const selected = menu.find(item => item.id === row.menuItemId);
        return <div className="flex flex-wrap items-start gap-3 mb-4" key={row.key}>
          <div className="field grow mb-0"><label className="label" htmlFor={`item-${row.key}`}>{t('Item {0}', { '0': index + 1 })}</label>
            <select className="select w-full" id={`item-${row.key}`} name={`lines[${index}][menuItemId]`} value={row.menuItemId} disabled={pending}
              onChange={event => update(index, { menuItemId: event.target.value, quantity: row.quantity || '1' })}>
              <option value="">{t('Choose a menu item')}</option>
              {menu.map(item => <option value={item.id} key={item.id} disabled={!item.fulfillmentMode}>{item.name} — {formatINR(BigInt(item.sellingPricePaise))}{item.fulfillmentMode ? '' : ` (${t('Needs inventory setup')})`}</option>)}
            </select>
            <input type="hidden" name={`lines[${index}][expectedUnitPricePaise]`} value={selected?.sellingPricePaise ?? ''} />
            <input type="hidden" name={`lines[${index}][expectedMenuUpdatedAt]`} value={selected?.updatedAt ?? ''} />
            {selected ? <p className="prose-note">{selected.fulfillmentMode === 'stocked' ? t('Uses finished stock already made.') : selected.fulfillmentMode === 'made_to_order' ? t('Deducts recipe ingredients when the order is confirmed.') : t('Ask the owner to choose how this item uses stock.')}</p> : null}
          </div>
          <div className="field mb-0"><label className="label" htmlFor={`quantity-${row.key}`}>{t('Quantity')}</label>
            <input className="input w-28" id={`quantity-${row.key}`} name={`lines[${index}][quantity]`} inputMode="numeric" maxLength={4}
              value={row.quantity} placeholder="1" disabled={pending} onChange={event => update(index, { quantity: event.target.value })} /></div>
          <div className="field mb-0"><span className="label">{t('Line total')}</span>
            <span className="block tabular-nums">{selected && /^\d{1,4}$/.test(row.quantity) && BigInt(row.quantity) > 0n && BigInt(row.quantity) <= 1000n ? formatINR(BigInt(selected.sellingPricePaise) * BigInt(row.quantity)) : '—'}</span></div>
          <button className="btn-quiet" type="button" disabled={pending} aria-label={t('Remove item {0}', { '0': index + 1 })} onClick={() => setRows(current => current.length === 1 ? [blank()] : current.filter(candidate => candidate.key !== row.key))}>{t('Remove line')}</button>
        </div>;
      })}
      <button className="btn btn--secondary" type="button" disabled={pending || rows.length >= 100} onClick={() => {
        setRows(current => [...current, blank()]);
      }}>{t('+ Add item')}</button>
      {previewError ? <p className="msg msg--warn" role="status">{t.message(previewError)}</p> : null}
    </section>

    <section className="form-section"><h2>{t('Payment and confirmation')}</h2>
      <div className="field max-w-sm"><label className="label" htmlFor="payment-method">{t('Payment received')}</label>
        <select className="select" id="payment-method" name="paymentMethod" value={payment} onChange={event => setPayment(event.target.value)} disabled={pending}>
          <option value="unpaid">{t('Not received — leave unpaid')}</option><option value="cash">{t('Full amount received in cash')}</option><option value="external">{t('Full amount received externally')}</option>
        </select></div>
      {payment === 'external' ? <div className="field"><label className="label" htmlFor="payment-reference">{t('Payment reference')}</label>
        <input className="input" id="payment-reference" name="paymentReference" maxLength={200} required disabled={pending} /></div> : null}
      <p className="prose-note">{t('Only record money already received. This screen does not charge the customer or transfer funds.')}</p>
      {totals ? <dl className="grid gap-2 max-w-sm tabular-nums">
        <div className="flex justify-between gap-4"><dt>{taxMode === 'inclusive' ? t('Subtotal before included tax') : t('Subtotal')}</dt><dd>{formatINR(totals.subtotalPaise)}</dd></div>
        <div className="flex justify-between gap-4"><dt>{t('Tax')} ({millipercentToPercent(BigInt(taxRate!))}%)</dt><dd>{formatINR(totals.taxPaise)}</dd></div>
        <div className="flex justify-between gap-4 font-semibold"><dt>{t('Total')}</dt><dd>{formatINR(totals.totalPaise)}</dd></div>
      </dl> : null}
      <p className="prose-note mt-4">{t('Confirming creates the order and records its stock deductions. Check the items, quantities and payment before saving.')}</p>
      <button className="btn" type="submit" disabled={pending || !totals}>{pending ? t('Confirming order…') : t('Confirm order')}</button>
    </section>
  </form>;
}

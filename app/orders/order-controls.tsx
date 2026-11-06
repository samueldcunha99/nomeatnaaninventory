'use client';

import { orderLabel } from '../../src/lib/order-labels.ts';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useTranslations } from '../i18n/provider.tsx';
import { allowedOrderStatuses, ORDER_STATUSES, type OrderStatus, type OrderType } from '../../src/lib/orders.ts';
import { changeOrderStatusAction, recordOrderPaymentAction } from './actions.ts';

export function OrderStatusControls({ orderId, status, orderType, canCancel }: {
  orderId: string; status: OrderStatus; orderType: OrderType; canCancel: boolean;
}) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(changeOrderStatusAction, { error: null, ok: null });
  const [cancelState, cancelAction, cancelling] = useActionState(changeOrderStatusAction, { error: null, ok: null });
  const allowed = allowedOrderStatuses(status, orderType);
  const options = allowed.filter(value => value !== 'cancelled');
  const forward = options.find(value => ORDER_STATUSES.indexOf(value) > ORDER_STATUSES.indexOf(status));
  return <div className="no-print">
    {state.error ? <p className="msg msg--error" role="alert">{t.message(state.error)}</p> : null}
    {state.ok ? <p className="msg msg--ok" role="status">{t(state.ok)}</p> : null}
    {forward ? <form action={action} className="mb-3">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="fromStatus" value={status} />
      <button className="btn" type="submit" name="status" value={forward} disabled={pending || cancelling}>
        {pending ? t('Updating…') : t('Move to {status}', { status: t(orderLabel(forward)) })}
      </button></form> : null}
    {options.length ? <details className="mt-3"><summary>{t('Other status changes')}</summary>
      <form action={action} className="mt-3">
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="fromStatus" value={status} />
        <div className="field"><label className="label" htmlFor={`status-${orderId}`}>{t('New status')}</label>
          <select className="select" id={`status-${orderId}`} name="status" defaultValue={options[0]} disabled={pending || cancelling}>
            {options.map(value => <option key={value} value={value}>{t(orderLabel(value))}</option>)}</select></div>
        <div className="field"><label className="label" htmlFor={`status-reason-${orderId}`}>{t('Reason or note')}</label>
          <input className="input" id={`status-reason-${orderId}`} name="reason" maxLength={1000} disabled={pending || cancelling} /></div>
        <p className="prose-note">{t('Backward changes need a reason. Every change is kept in the order history.')}</p>
        <button className="btn btn--secondary" type="submit" disabled={pending || cancelling}>{pending ? t('Updating…') : t('Update status')}</button>
      </form></details> : null}
    {canCancel && allowed.includes('cancelled') ? <details className="mt-4"><summary>{t('Cancel this order')}</summary>
      <form action={cancelAction} className="mt-3">
        <input type="hidden" name="orderId" value={orderId} /><input type="hidden" name="status" value="cancelled" />
        <input type="hidden" name="fromStatus" value={status} />
        <p className="prose-note">{t('Cancellation before preparation restores the reserved stock. Once preparation has started, materials stay used and the cancellation is recorded as a loss. Payments are not automatically refunded.')}</p>
        {cancelState.error ? <p className="msg msg--error" role="alert">{t.message(cancelState.error)}</p> : null}
        <div className="field"><label className="label" htmlFor={`cancel-reason-${orderId}`}>{t('Cancellation reason')}</label>
          <textarea className="input" id={`cancel-reason-${orderId}`} name="reason" maxLength={1000} rows={2} required disabled={pending || cancelling} /></div>
        <button className="btn btn--secondary" type="submit" disabled={pending || cancelling}>{cancelling ? t('Cancelling…') : t('Confirm cancellation')}</button>
      </form></details> : null}
  </div>;
}

export function OrderPaymentControls({ orderId, requestId: initialRequestId, amount, eventType }: {
  orderId: string; requestId: string; amount: string; eventType: 'payment' | 'refund';
}) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(recordOrderPaymentAction, { error: null, ok: null });
  const [requestId, setRequestId] = useState(initialRequestId);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state.ok && state.nextRequestId) { setRequestId(state.nextRequestId); form.current?.reset(); } }, [state]);
  return <form ref={form} action={action} className="form-section max-w-xl no-print" noValidate>
    <h2>{eventType === 'refund' ? t('Record a refund already made') : t('Record a payment already received')}</h2>
    <input type="hidden" name="orderId" value={orderId} /><input type="hidden" name="requestId" value={requestId} /><input type="hidden" name="eventType" value={eventType} />
    {state.error ? <p className="msg msg--error" role="alert">{t.message(state.error)}</p> : null}
    {state.ok ? <p className="msg msg--ok" role="status">{t(state.ok)}</p> : null}
    <div className="field"><label className="label" htmlFor={`${eventType}-amount`}>{t('Amount, ₹')}</label>
      <input className="input" id={`${eventType}-amount`} name="amount" defaultValue={amount} inputMode="decimal" maxLength={24} disabled={pending} required /></div>
    <div className="field"><label className="label" htmlFor={`${eventType}-method`}>{t('Method')}</label>
      <select className="select" id={`${eventType}-method`} name="method" defaultValue="cash" disabled={pending}>
        <option value="cash">{t('Cash')}</option><option value="external">{t('External payment')}</option></select></div>
    <div className="field"><label className="label" htmlFor={`${eventType}-reference`}>{t('Payment reference')}</label>
      <input className="input" id={`${eventType}-reference`} name="reference" maxLength={200} disabled={pending} /></div>
    <p className="prose-note">{t('Record only a payment or refund completed outside this screen. No money is transferred by this action. External transactions need a reference.')}</p>
    <button className="btn btn--secondary" type="submit" disabled={pending}>{pending ? t('Saving…') : eventType === 'refund' ? t('Record refund') : t('Record payment')}</button>
  </form>;
}

export function BillTools({ trackingPath }: { trackingPath: string }) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [address, setAddress] = useState(trackingPath);
  useEffect(() => { setAddress(new URL(trackingPath, window.location.origin).href); }, [trackingPath]);
  return <>
    <div className="flex flex-wrap gap-3 no-print">
      <button className="btn btn--secondary" type="button" onClick={() => window.print()}>{t('Print bill')}</button>
      <a className="btn btn--secondary" href={trackingPath} target="_blank" rel="noopener noreferrer">{t('Open customer tracking')}</a>
      <button className="btn-quiet" type="button" onClick={async () => {
        try { await navigator.clipboard.writeText(new URL(trackingPath, window.location.origin).href); setCopied(true); setCopyError(false); }
        catch { setCopyError(true); }
      }}>{copied ? t('Tracking link copied') : t('Copy tracking link')}</button>
    </div>
    {copyError ? <p className="prose-note no-print" role="status">{t('The link could not be copied. Open customer tracking and copy the address.')}</p> : null}
    <p className="prose-note order-tracking-address">{t('Customer tracking:')} <a href={trackingPath}>{address}</a></p>
  </>;
}

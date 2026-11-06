/** Display labels only. Stored statuses, methods and submitted values stay unchanged. */
export const ORDER_LABELS: Record<string, string> = {
  ordered: 'Order received', in_kitchen: 'In kitchen', baking: 'Baking', out_of_oven: 'Out of oven', ready: 'Ready',
  out_for_delivery: 'Out for delivery', completed: 'Completed', cancelled: 'Cancelled',
  dine_in: 'Dine in', takeaway: 'Takeaway', delivery: 'Delivery', unpaid: 'Unpaid', part_paid: 'Partially paid',
  paid: 'Paid', part_refunded: 'Partially refunded', refunded: 'Refunded', payment: 'Payment', refund: 'Refund', cash: 'Cash', external: 'External payment',
};
export const orderLabel = (value: string): string => Object.hasOwn(ORDER_LABELS, value) ? ORDER_LABELS[value] : value;

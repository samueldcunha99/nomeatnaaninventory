/** Reports read sale snapshots. They never recost an old order from today's recipe. */
export type SaleLine = { menuItemId: string; nameSnapshot: string; quantity: number; lineTotalPaise: bigint; costSnapshotPaise: bigint | null };
export type SaleSnapshot = { id: string; orderNumber: number; status: string; subtotalPaise: bigint; totalPaise: bigint;
  cancelledAfterPreparation: boolean; lines: SaleLine[] };

/** Allocate already-recorded net revenue; largest remainders keep per-item rows additive. */
export function allocateNetRevenue(netPaise: bigint, lineTotals: readonly bigint[]): bigint[] {
  const gross = lineTotals.reduce((sum, amount) => sum + amount, 0n);
  if (netPaise < 0n || netPaise > gross || lineTotals.some(amount => amount < 0n)) throw new RangeError('Invalid sale revenue snapshot.');
  if (gross === 0n) return lineTotals.map(() => 0n);
  const allocated = lineTotals.map(amount => netPaise * amount / gross);
  const extra = netPaise - allocated.reduce((sum, amount) => sum + amount, 0n);
  const ranks = lineTotals.map((amount, index) => ({ index, remainder: netPaise * amount % gross }))
    .sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (let i = 0; BigInt(i) < extra; i++) allocated[ranks[i].index] += 1n;
  return allocated;
}

export function summarizeSales(orders: readonly SaleSnapshot[], payments: readonly { eventType: string; amountPaise: bigint }[]) {
  const byItem = new Map<string, { menuItemId: string; name: string; quantity: bigint; revenuePaise: bigint; costPaise: bigint | null; marginPaise: bigint | null }>();
  let completedCount = 0, openCount = 0, cancelledCount = 0, soldQuantity = 0n;
  let revenuePaise = 0n, costPaise: bigint | null = 0n, cancelledMaterialPaise: bigint | null = 0n;
  for (const order of orders) {
    if (order.status === 'cancelled') {
      cancelledCount++;
      if (order.cancelledAfterPreparation) for (const line of order.lines) {
        if (line.costSnapshotPaise === null) cancelledMaterialPaise = null;
        else if (cancelledMaterialPaise !== null) cancelledMaterialPaise += line.costSnapshotPaise;
      }
      continue;
    }
    if (order.status !== 'completed') { openCount++; continue; }
    completedCount++; revenuePaise += order.subtotalPaise;
    const allocation = allocateNetRevenue(order.subtotalPaise, order.lines.map(line => line.lineTotalPaise));
    for (const [i, line] of order.lines.entries()) {
      const quantity = BigInt(line.quantity); soldQuantity += quantity;
      const row = byItem.get(line.menuItemId) ?? { menuItemId: line.menuItemId, name: line.nameSnapshot, quantity: 0n, revenuePaise: 0n, costPaise: 0n, marginPaise: 0n };
      row.name = line.nameSnapshot; row.quantity += quantity; row.revenuePaise += allocation[i];
      if (line.costSnapshotPaise === null) { row.costPaise = null; costPaise = null; }
      else { if (row.costPaise !== null) row.costPaise += line.costSnapshotPaise; if (costPaise !== null) costPaise += line.costSnapshotPaise; }
      row.marginPaise = row.costPaise === null ? null : row.revenuePaise - row.costPaise;
      byItem.set(line.menuItemId, row);
    }
  }
  let receivedPaise = 0n, refundedPaise = 0n;
  for (const event of payments) {
    if (event.eventType === 'payment') receivedPaise += event.amountPaise;
    else if (event.eventType === 'refund') refundedPaise += event.amountPaise;
    else throw new RangeError('Invalid payment event snapshot.');
  }
  const items = [...byItem.values()];
  return { completedCount, openCount, cancelledCount, soldQuantity, revenuePaise, costPaise,
    marginPaise: costPaise === null ? null : revenuePaise - costPaise, cancelledMaterialPaise,
    receivedPaise, refundedPaise, netReceivedPaise: receivedPaise - refundedPaise, items,
    byVolume: [...items].sort((a, b) => a.quantity === b.quantity ? a.name.localeCompare(b.name) : a.quantity > b.quantity ? -1 : 1),
    byMargin: items.filter(row => row.marginPaise !== null).sort((a, b) => a.marginPaise === b.marginPaise ? a.name.localeCompare(b.name) : a.marginPaise! > b.marginPaise! ? -1 : 1),
  };
}

import { unitCostMillipaisePerBase as sharedUnitCost } from '../lib/units.ts';

/**
 * Seed data, kept separate from the seeding script so it can be checked without a
 * database. See seed-data.test.ts.
 */

export type SeedIngredient = {
  name: string;
  unitType: 'weight' | 'volume' | 'count';
  purchaseUnit: string;
  /** how many base units (g / ml / unit) are in one purchase unit */
  purchaseUnitInBase: number;
  /** paise per ONE purchase unit */
  pricePaise: number;
  /** opening stock, in whole purchase units */
  openingQty: number;
  /** low stock threshold, in purchase units */
  lowStockQty: number;
  supplier: 'flour' | 'dairy' | 'general';
};

// Prices are plausible Chhatrapati Sambhajinagar wholesale, to be replaced with the
// chef's real figures. maida / salt / sugar are the precision canaries: at 2.2 paise
// per gram, salt would round to 2 in whole paise - a 9% error on every recipe using it.
export const SEED_INGREDIENTS: SeedIngredient[] = [
  { name: 'Maida (refined flour)', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, pricePaise: 4200, openingQty: 50, lowStockQty: 10, supplier: 'flour' },
  { name: 'Whole wheat flour (atta)', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, pricePaise: 4800, openingQty: 25, lowStockQty: 5, supplier: 'flour' },
  { name: 'Semolina (rava)', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, pricePaise: 5400, openingQty: 10, lowStockQty: 3, supplier: 'flour' },
  { name: 'Cornflour', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, pricePaise: 8800, openingQty: 5, lowStockQty: 2, supplier: 'flour' },
  { name: 'Salt', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, pricePaise: 2200, openingQty: 10, lowStockQty: 2, supplier: 'general' },
  { name: 'Granulated sugar', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, pricePaise: 4600, openingQty: 40, lowStockQty: 10, supplier: 'general' },
  { name: 'Castor sugar', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, pricePaise: 5800, openingQty: 20, lowStockQty: 5, supplier: 'general' },
  { name: 'Icing sugar', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, pricePaise: 7200, openingQty: 10, lowStockQty: 3, supplier: 'general' },
  { name: 'Brown sugar', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, pricePaise: 9500, openingQty: 8, lowStockQty: 2, supplier: 'general' },
  { name: 'Butter (unsalted)', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, pricePaise: 52000, openingQty: 15, lowStockQty: 4, supplier: 'dairy' },
  { name: 'Cream cheese', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, pricePaise: 68000, openingQty: 6, lowStockQty: 2, supplier: 'dairy' },
  { name: 'Paneer', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, pricePaise: 36000, openingQty: 5, lowStockQty: 2, supplier: 'dairy' },
  { name: 'Milk (full cream)', unitType: 'volume', purchaseUnit: 'litre', purchaseUnitInBase: 1000, pricePaise: 6200, openingQty: 30, lowStockQty: 10, supplier: 'dairy' },
  { name: 'Fresh cream (25% fat)', unitType: 'volume', purchaseUnit: 'litre', purchaseUnitInBase: 1000, pricePaise: 34000, openingQty: 8, lowStockQty: 2, supplier: 'dairy' },
  { name: 'Milk powder', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, pricePaise: 39000, openingQty: 5, lowStockQty: 2, supplier: 'dairy' },
  { name: 'Condensed milk', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, pricePaise: 28000, openingQty: 4, lowStockQty: 1, supplier: 'dairy' },
  { name: 'Eggs', unitType: 'count', purchaseUnit: 'tray', purchaseUnitInBase: 30, pricePaise: 21000, openingQty: 12, lowStockQty: 3, supplier: 'general' },
  { name: 'Active dry yeast', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, pricePaise: 42000, openingQty: 2, lowStockQty: 1, supplier: 'general' },
  { name: 'Baking powder', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, pricePaise: 18000, openingQty: 2, lowStockQty: 1, supplier: 'general' },
  { name: 'Baking soda', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, pricePaise: 6000, openingQty: 2, lowStockQty: 1, supplier: 'general' },
  { name: 'Cinnamon powder', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, pricePaise: 88000, openingQty: 2, lowStockQty: 1, supplier: 'general' },
  { name: 'Cardamom powder', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, pricePaise: 320000, openingQty: 1, lowStockQty: 1, supplier: 'general' },
  { name: 'Nutmeg powder', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, pricePaise: 190000, openingQty: 1, lowStockQty: 1, supplier: 'general' },
  { name: 'Cocoa powder', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, pricePaise: 64000, openingQty: 5, lowStockQty: 2, supplier: 'general' },
  { name: 'Dark chocolate (54%)', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, pricePaise: 72000, openingQty: 6, lowStockQty: 2, supplier: 'general' },
  { name: 'Milk chocolate', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, pricePaise: 68000, openingQty: 4, lowStockQty: 2, supplier: 'general' },
  { name: 'Vanilla essence', unitType: 'volume', purchaseUnit: 'litre', purchaseUnitInBase: 1000, pricePaise: 95000, openingQty: 1, lowStockQty: 1, supplier: 'general' },
  { name: 'Refined sunflower oil', unitType: 'volume', purchaseUnit: 'litre', purchaseUnitInBase: 1000, pricePaise: 14500, openingQty: 15, lowStockQty: 5, supplier: 'general' },
  { name: 'Honey', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, pricePaise: 52000, openingQty: 3, lowStockQty: 1, supplier: 'general' },
  { name: 'Almonds (whole)', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, pricePaise: 78000, openingQty: 4, lowStockQty: 1, supplier: 'general' },
  { name: 'Cashews', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, pricePaise: 88000, openingQty: 3, lowStockQty: 1, supplier: 'general' },
  { name: 'Walnuts', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, pricePaise: 115000, openingQty: 2, lowStockQty: 1, supplier: 'general' },
  { name: 'Raisins', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, pricePaise: 24000, openingQty: 3, lowStockQty: 1, supplier: 'general' },
  { name: 'Espresso coffee beans', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, pricePaise: 140000, openingQty: 5, lowStockQty: 2, supplier: 'general' },
  { name: 'Bakery box (6 inch)', unitType: 'count', purchaseUnit: 'pack of 50', purchaseUnitInBase: 50, pricePaise: 45000, openingQty: 4, lowStockQty: 1, supplier: 'general' },
  { name: 'Paper cup (250 ml)', unitType: 'count', purchaseUnit: 'pack of 100', purchaseUnitInBase: 100, pricePaise: 28000, openingQty: 10, lowStockQty: 2, supplier: 'general' },
  { name: 'Butter paper sheet', unitType: 'count', purchaseUnit: 'pack of 500', purchaseUnitInBase: 500, pricePaise: 35000, openingQty: 4, lowStockQty: 1, supplier: 'general' },
];

export const SEED_SUPPLIERS = {
  flour: { name: 'Shree Grain & Flour Traders', phone: '+91 240 234 5601', notes: 'Flours and grains. Delivers Tue/Fri.' },
  dairy: { name: 'Gokul Dairy Distributors', phone: '+91 240 234 7712', notes: 'Milk, butter, cream. Daily morning drop.' },
  general: { name: 'Ambika Bakery Supplies', phone: '+91 240 234 9930', notes: 'Everything else, including packaging.' },
};

/**
 * paise per purchase unit -> millipaise per base unit, via the shared helper.
 * The seed additionally demands an EXACT quotient: it must not rely on rounding,
 * so that the seeded figures are reproducible by hand.
 */
export function unitCostMillipaisePerBase(i: SeedIngredient): number {
  const qtyMilliBase = BigInt(i.purchaseUnitInBase) * 1000n; // one purchase unit
  const cost = sharedUnitCost(BigInt(i.pricePaise), qtyMilliBase);
  if (BigInt(i.pricePaise) * 1_000_000n !== cost * qtyMilliBase) {
    throw new Error(
      `${i.name}: ${i.pricePaise} paise per ${i.purchaseUnit} does not divide exactly into ` +
        `millipaise per base unit. Pick a seed price that does - this script must not round.`,
    );
  }
  return Number(cost);
}

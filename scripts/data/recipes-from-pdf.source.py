"""The client's recipe PDF, transcribed, mapped to the ingredient catalogue.

Every line is exactly what the PDF says. The RS column is deliberately NOT carried across:
in this system a recipe line has no price - the cost comes from what the ingredient
actually cost on the stock ledger, which is the whole point. Yields are carried across
only where the PDF states one; everywhere else they are left blank for the cafe to fill.

Quantities that are not numbers in the PDF ("3/4 cup", "1 pinch", "half cup") are left
blank with the original text kept in the note, because a cup of ice is not a measurement
the system can cost and only the kitchen knows what it weighs.
"""
import csv
import re
import sys

# ---------------------------------------------------------------------------
# PDF ingredient name -> catalogue name. Only certainties are listed here; the
# generator reports everything it cannot place rather than guessing.
# ---------------------------------------------------------------------------
MAP = {
    'coffee beans': 'Coffee Beans', 'coffee bens': 'Coffee Beans', 'coffee': 'Coffee Beans',
    'espresso': 'Coffee Beans', 'esspresso': 'Coffee Beans', 'espresso shot': 'Coffee Beans',
    'coffee powder': 'Instant Coffee Powder',
    'cold brew coffee': 'Coffee Beans',
    'brown sugar': 'Brown Sugar',
    'sugar': 'Sugar (White)', 'caster sugar': 'Castor Sugar',
    'sugar sachet': 'Sugar Sachet', 'sugar sechet': 'Sugar Sachet',
    'coco powder': 'Cocoa Powder', 'cocoa powder': 'Cocoa Powder',
    'tea powder': 'Tea Powder',
    'matcha powder': 'Matcha Powder', 'matcha': 'Matcha Powder',
    'honey': 'Honey',
    'milk maid': 'MILK MAID', 'milk made': 'MILK MAID', 'condensed milk': 'MILK MAID',
    'mascoporn cream': 'Mascarpone Cheese', 'mascarpone cream': 'Mascarpone Cheese',
    'whipping cream': 'Whipping Cream (Non-Dairy)',
    'butter': 'Butter',
    'fresh cream': 'Fresh Cream',
    'paneer': 'Paneer',
    'cream cheese': 'Cream Cheese',
    'mozzarella cheese': 'Mozerella Cheese',
    'prossed cheese': 'Prosses Cheese', 'process cheese': 'Prosses Cheese',
    'black olive': 'Black Olives (Pitted)', 'olive': 'Black Olives (Pitted)',
    'black olives': 'Black Olives (Pitted)',
    'pasta': 'Penne Pasta', 'speghetti pasta': 'Speghethi Pasta',
    'oil': 'Refined Soybean Oil (Tin)',
    'salt': 'Table Salt', 'black salt': 'Black Salt',
    'red chilly powder': 'Red Chilli Powder',
    'coriander powder': 'Coriander Powder',
    'kitchen king masala': 'Kitchen King Masala', 'kitchen king': 'Kitchen King Masala',
    'kitchen king powder': 'Kitchen King Masala',
    'dry mango powder': 'Amchoor powder',
    'cumin seeds': 'Jeera (Cumin Seeds)', 'jeera': 'Jeera (Cumin Seeds)',
    'turmeric powder': 'Turmeric Powder', 'haldi': 'Turmeric Powder',
    'chilly flaxe': 'Chilli Flakes (Bulk)', 'chilli flakes': 'Chilli Flakes (Bulk)',
    'origano': 'Oregano (Bulk)', 'oregano': 'Oregano (Bulk)',
    'tomato ketchup': 'Tomato Ketchup',
    'white vineger': 'White Vinegar (Can)',
    'dry yeast': 'Dry Yeast',
    'flour': 'Maida (Refined Wheat Flour)', 'maida': 'Maida (Refined Wheat Flour)',
    'cashew nuts': 'Cashew Pieces (Tukda)', 'cashew': 'Cashew Pieces (Tukda)',
    'boiled rajma': 'Rajma (Kidney Beans)',
    'lemon powder': 'Lemon Seasoning Powder',
    'corn flour': 'Corn Flour',
    'lotus cookie': 'Lotus Biscoff Biscuits',
    'orio': 'Oreo Biscuits', 'orio biskit': 'Oreo Biscuits',
    'strawberry crush': 'Strowberry Crush', 'strowberry crush': 'Strowberry Crush',
    'caramal': 'Caramal Topping', 'caramle': 'Caramal Topping',
    'chocolate dressing': 'Chocolate Topping',
    'almond': 'Almond',
    'nutella': 'Nutella spread',
}

# Sub-recipes: a line naming one of these points at another recipe, not an ingredient.
# The importer resolves them by name, which is why the spellings here are the PDF's.
PREP = {
    'vanilla milk', 'tiramissu cream', 'tiramisu cream', 'chocolate ghanash',
    'chocolate ganash', 'white ganash', 'white cho ghanash', 'white chocolate ghanash',
    'white cho ghanache', 'cold brew', 'pesto sauce', 'tomato sauce', 'makhni sauce',
    'paneer makhni sauce', 'makhani sauce', 'makhani tadka', 'mashroom bhaji',
    'mashroom bhaji', 'green chutny', 'red chutney', 'paneer bhaji', 'paneer sabji',
    'rajma curry', 'raja subji', 'pizza dough', 'garlic bhaji', 'cream cheese icing',
    'icing', 'cho+icing', 'blueberry compote', 'strawberry compote', 'brazillian syrup',
    'brazilian lemonade syrup', 'coconut vietnamese syrup', 'brazilian cream', 'nachos',
    'masala sandwich masala', 'sandwich fealing', 'cinnemon roll', 'cinnamon roll',
    'paneer tikka bhaji', 'spinach & paneer bhaji', 'clasic cold coffee',
}


# ---------------------------------------------------------------------------
# Ingredients the menu uses that the September price list does not carry.
#
# The kitchen writes the same thing several ways - "Ice", "Ice cube", "Ice cubes";
# "All harbs", "All hearbs", "Mix harbs" - so these fold the spellings together into
# one name each. They do NOT invent prices: each becomes an ingredient with no
# purchase history, which the app reports as uncosted, by name, until a delivery
# prices it. Same rule the price list import followed.
# ---------------------------------------------------------------------------
NEEDED = {
    'ice': ('Ice', 'weight'), 'ice cube': ('Ice', 'weight'), 'ice cubes': ('Ice', 'weight'),
    'milk': ('Milk (full cream)', 'volume'), 'normal milk': ('Milk (full cream)', 'volume'),
    'water': ('Water', 'volume'), 'hot water': ('Water', 'volume'),
    'normle water': ('Water', 'volume'),
    'bread': ('Bread (slice)', 'count'),
    'ice cream': ('Ice Cream', 'weight'), 'icecream': ('Ice Cream', 'weight'),
    'sprite': ('Sprite', 'volume'),
    'cola': ('Cola', 'volume'), 'colke': ('Cola', 'volume'),
    'onion': ('Onion', 'weight'),
    'sugar syrup': ('Sugar Syrup', 'volume'), 'syrup': ('Sugar Syrup', 'volume'),
    'garlic': ('Garlic', 'weight'),
    'all harbs': ('Mixed Herbs', 'weight'), 'all hearbs': ('Mixed Herbs', 'weight'),
    'mix harbs': ('Mixed Herbs', 'weight'),
    'cheese': ('Cheese (unspecified)', 'weight'),
    'all vegitable': ('Mixed Vegetables', 'weight'),
    'vegitable': ('Mixed Vegetables', 'weight'),
    'onionreen capcicum': ('Mixed Vegetables', 'weight'),
    'black papper': ('Black Pepper', 'weight'),
    'black papper powder': ('Black Pepper', 'weight'),
    'cumin powder': ('Cumin Powder', 'weight'),
    'tomato': ('Tomato', 'weight'),
    'banana': ('Banana', 'count'),
    'blueberry crush': ('Blueberry Crush', 'volume'),
    'bluberry crush': ('Blueberry Crush', 'volume'),
    'chat masala': ('Chat Masala', 'weight'),
    'green chilly': ('Green Chilli', 'weight'),
    'vanilla essence': ('Vanilla Essence', 'volume'),
    'vanilla esence': ('Vanilla Essence', 'volume'),
    'apple': ('Apple', 'count'),
    'blueberry fealing': ('Blueberry Filling', 'weight'),
    'blueberry filling': ('Blueberry Filling', 'weight'),
    'chocolate': ('Chocolate (unspecified)', 'weight'),
    'dark chocolate': ('Dark Chocolate (unspecified)', 'weight'),
    'white chocolate': ('White Chocolate (unspecified)', 'weight'),
    'cinnemon powder': ('Cinnamon Powder', 'weight'),
    'coconut cream': ('Coconut Cream', 'weight'),
    'coconut cream milk': ('Coconut Cream', 'weight'),
    'coconut milk': ('Coconut Milk', 'volume'),
    'coconut milk powder': ('Coconut Milk Powder', 'weight'),
    'coconut powder': ('Coconut Powder', 'weight'),
    'coconut water': ('Coconut Water', 'volume'),
    'cookie': ('Cookie', 'count'),
    'green capcicum': ('Green Capsicum', 'weight'),
    'green capcium': ('Green Capsicum', 'weight'),
    'irish flaver': ('Irish Flavour Syrup', 'volume'),
    'mango crush': ('Mango Crush', 'volume'),
    'mojito lime': ('Mojito Lime Syrup', 'volume'),
    'mojito mint': ('Mojito Mint Syrup', 'volume'),
    'oat milk': ('Oat Milk', 'volume'),
    'peanut butter': ('Peanut Butter', 'weight'),
    'pinut butter': ('Peanut Butter', 'weight'),
    'thyme': ('Thyme', 'weight'),
    'aadrak': ('Ginger', 'weight'), 'ginger': ('Ginger', 'weight'),
    'ajwain': ('Ajwain', 'weight'),
    'almond butter': ('Almond Butter', 'weight'),
    'basil': ('Basil', 'weight'),
    'blueberries': ('Blueberries', 'weight'), 'blueberry': ('Blueberries', 'weight'),
    'browni': ('Brownie', 'count'),
    'citric acid': ('Citric Acid', 'weight'),
    'coriander': ('Coriander (fresh)', 'weight'),
    'fresh coriander': ('Coriander (fresh)', 'weight'),
    'curry leaves': ('Curry Leaves', 'weight'),
    'dates': ('Dates', 'count'),
    'elaichi powder': ('Cardamom Powder', 'weight'),
    'garam masala': ('Garam Masala', 'weight'),
    'ginger ale': ('Ginger Ale', 'volume'),
    'ginger ale syrup': ('Ginger Ale Syrup', 'volume'),
    'ginger garlic paste': ('Ginger Garlic Paste', 'weight'),
    'ginger garlic past': ('Ginger Garlic Paste', 'weight'),
    'green tea': ('Green Tea', 'weight'),
    'gulkand': ('Gulkand', 'weight'),
    'jasmin tea': ('Jasmine Tea', 'weight'),
    'kala khatta': ('Kala Khatta Syrup', 'volume'),
    'kalakhatta syrup': ('Kala Khatta Syrup', 'volume'),
    'kashmiri chilly': ('Kashmiri Chilli', 'weight'),
    'kasturi methi': ('Kasuri Methi', 'weight'),
    'lemon': ('Lemon', 'weight'),
    'lime zest': ('Lime Zest', 'weight'),
    'makai aata': ('Makai Atta (Maize Flour)', 'weight'),
    'mashroom': ('Mushroom', 'weight'),
    'mulburry': ('Mulberry', 'weight'),
    'nachos masala': ('Nachos Masala', 'weight'),
    'peach powder': ('Peach Powder', 'weight'),
    'potato': ('Potato', 'weight'),
    'red chilly': ('Red Chilli (fresh)', 'weight'),
    'rock salt': ('Rock Salt', 'weight'),
    'rosted chana': ('Roasted Chana', 'weight'),
    'sabja seed': ('Sabja Seed', 'weight'),
    'sandwich masala': ('Sandwich Masala', 'weight'),
    'spinach': ('Spinach', 'weight'),
    'troppical tea': ('Tropical Tea', 'weight'),
    'vanilla foam': ('Vanilla Foam', 'weight'),
    'yuzu syrap': ('Yuzu Syrup', 'volume'), 'yuzu syrup': ('Yuzu Syrup', 'volume'),
}

S, P = 'serving', 'prep'


def R(name, kind, yield_qty, yield_unit, lines, note=''):
    return dict(name=name, kind=kind, yield_qty=yield_qty, yield_unit=yield_unit,
                lines=lines, note=note)


# (source, quantity, unit) - quantity None where the PDF is not a number.
RECIPES = [
    # ---- hot coffee -------------------------------------------------------
    R('Cappuccino', S, None, None, [('Coffee beans', 20, 'g'), ('Milk', 100, 'ml')]),
    R('Cafe latte', S, None, None, [('Coffee beans', 20, 'g'), ('Milk', 150, 'ml')]),
    R('White chocolate mocha', S, None, None, [
        ('Coffee beans', 20, 'g'), ('White ganash', 70, 'g'),
        ('Sugar sachet', 1, 'pcs'), ('Milk', 100, 'ml')]),
    R('Cafe mocha', S, None, None, [
        ('Coffee beans', 20, 'g'), ('Chocolate ganash', 50, 'g'),
        ('Coco powder', 5, 'g'), ('Milk', 100, 'ml')]),
    R('Hot chocolate', S, None, None, [
        ('Chocolate dressing', 25, 'g'), ('Chocolate ganash', 100, 'g'),
        ('Coco powder', 10, 'g'), ('Milk', 200, 'ml')]),
    R('Americano', S, None, None, [('Coffee beans', 20, 'g'), ('Hot water', 200, 'ml')]),
    R('Mexican spiced Americano', S, None, None, [
        ('Coffee beans', 20, 'g'), ('Hot water', 200, 'ml'),
        ('Brown sugar', 20, 'g'), ('Cinnemon powder', 2, 'g')]),
    R('Instant hot coffee', S, None, None, [
        ('Milk', 200, 'ml'), ('Coffee powder', 5, 'g'), ('Sugar', 10, 'g')]),
    R('Espresso short', S, None, None, [('Coffee beans', 20, 'g')]),
    R('Affogato', S, None, None, [('Coffee beans', 20, 'g'), ('Ice cream', 80, 'g')]),
    R('Tiramisu latte', S, None, None, [
        ('Coffee beans', 20, 'g'), ('Vanilla milk', 135, 'g'), ('Tiramissu cream', 50, 'g')]),
    R('Matcha latte', S, None, None, [('Vanilla milk', 150, 'g'), ('Matcha powder', 2, 'g')]),
    R('Irish cafe latte', S, None, None, [
        ('Coffee beans', 20, 'g'), ('Milk', None, 'ml'), ('Irish flaver', None, 'ml')],
      'PDF gives no quantities for milk or Irish flavour'),
    R('Irish coffee', S, None, None, [
        ('Hot water', 120, 'ml'), ('Irish flaver', 30, 'ml'),
        ('Espresso', 30, 'ml'), ('Sugar sachet', 1, 'pcs')]),
    R('Hot durty matcha', S, None, None, [
        ('Matcha', 2, 'g'), ('Vanilla milk', 140, 'g'),
        ('Coffee', 20, 'g'), ('Sugar syrup', 20, 'g')]),
    R('Matcha latte (vanilla milk)', S, None, None, [
        ('Matcha', 2.5, 'g'), ('Vanilla milk', 120, 'g')]),
    R('Caramal matcha latte', S, None, None, [
        ('Matcha powder', 2.5, 'g'), ('Caramal', 50, 'g'), ('Vanilla milk', 135, 'g')]),
    R('White chocolate mocha new', S, None, None, [
        ('White chocolate ghanash', 40, 'g'), ('Vanilla milk', 140, 'ml'),
        ('Coffee bens', 20, 'g')]),
    R('Oat milk matcha latte', S, None, None, [
        ('Matcha powder', 3, 'g'), ('Oat milk', 230, 'ml')]),

    # ---- tea --------------------------------------------------------------
    R('Elaichi chai', S, None, None, [
        ('Milk', 250, 'g'), ('Sugar', 15, 'g'),
        ('Tea powder', 5, 'g'), ('Elaichi powder', 3, 'g')]),
    R('Aadrak chai', S, None, None, [
        ('Milk', 250, 'g'), ('Tea powder', 5, 'g'),
        ('Aadrak', 30, 'g'), ('Sugar', 15, 'g')]),
    R('Jasmin tea', S, None, None, [('Jasmin tea', 5, 'g'), ('Hot water', 200, 'g')]),
    R('Tropical green tea', S, None, None, [
        ('Hot water', 200, 'g'), ('Troppical tea', 2, 'g')]),
    R('Chamomile tea', S, None, None, [('Hot water', 200, 'g'), ('Green tea', 2, 'g')]),

    # ---- iced coffee ------------------------------------------------------
    R('Ice coffee', S, None, None, [
        ('Coffee beans', 20, 'g'), ('Vanilla milk', 135, 'g'), ('Ice cube', 5, 'g')]),
    R('Ice latte', S, None, None, [
        ('Coffee beans', 20, 'g'), ('Normal milk', 135, 'g'), ('Ice cube', None, 'g')],
      'ice is "3/4 cup" in the PDF'),
    R('Ice caramel macchiato', S, None, None, [
        ('Coffee beans', 20, 'g'), ('Caramle', 50, 'g'),
        ('Vanilla milk', 135, 'g'), ('Ice', None, 'g')], 'ice is "3/4 cup"'),
    R('Ice americano', S, None, None, [
        ('Coffee beans', 20, 'g'), ('Normle water', 135, 'g'), ('Ice cube', None, 'g')],
      'ice is "3/4 cup"'),
    R('Spiced americano (iced)', S, None, None, [
        ('Coffee beans', 20, 'g'), ('Brown sugar', 20, 'g'), ('Cinnemon powder', 2, 'g'),
        ('Hot water', 100, 'g'), ('Ice', None, 'g')], 'ice is "3/4 cup"'),
    R('Vietnamese coffee', S, None, None, [
        ('Coffee beans', 20, 'g'), ('Milk made', 30, 'g'),
        ('Vanilla milk', 50, 'g'), ('Ice', None, 'g')], 'ice is "3/4 cup"'),
    R('Vietnamese cold brew', S, None, None, [
        ('Cold brew', 90, 'g'), ('Vanilla milk', 50, 'g'),
        ('Milk made', 30, 'g'), ('Ice', None, 'g')], 'ice is "3/4 cup"'),
    R('Ice cold brew', S, None, None, [
        ('Cold brew', 60, 'ml'), ('Water', 135, 'g'), ('Ice', None, 'g')],
      'ice is "3/4 cup"'),
    R('Cold brew with vanilla foam', S, None, None, [
        ('Cold brew', 60, 'g'), ('Water', 50, 'g'),
        ('Ice', None, 'g'), ('Vanilla foam', 50, 'g')], 'ice is "3/4 cup"'),
    R('Tiramisu ice coffee', S, None, None, [
        ('Coffee beans', 20, 'g'), ('Vanilla milk', 135, 'g'),
        ('Ice', None, 'g'), ('Tiramissu cream', 50, 'g')], 'ice is "3/4 cup"'),
    R('Yuzu honey cold brew', S, None, None, [
        ('Cold brew', 60, 'g'), ('Honey', 20, 'g'),
        ('Yuzu syrap', 15, 'g'), ('Ice', None, 'g')], 'ice is "3/4 cup"'),
    R('Ice matcha shakerato', S, None, None, [
        ('Vanilla milk', 135, 'g'), ('Matcha powder', 2, 'g'), ('Ice', None, 'g')],
      'ice is "3/4 cup"'),
    R('Cold brew with vanilla milk', S, None, None, [
        ('Cold brew', 60, 'g'), ('Water', 100, 'g'),
        ('Ice cube', None, 'g'), ('Vanilla milk', 50, 'ml')], 'ice is "3/4 th"'),
    R('Coke cold brew', S, None, None, [
        ('Sugar syrup', 25, 'ml'), ('Cold brew', 65, 'g'), ('Colke', 90, 'ml'),
        ('Salt', None, 'g'), ('Lemon powder', None, 'g'), ('Ice cube', None, 'g')],
      'salt "1 pinch", lemon powder "1 tsp", ice "3/4 cup"'),
    R('Durty cola', S, None, None, [
        ('Cola', 150, 'g'), ('Vanilla milk', 50, 'g'),
        ('Sugar syrup', 20, 'g'), ('Ice cube', None, 'g')], 'ice is "3/4 cup"'),
    R('Ginger ale cold brew', S, None, None, [
        ('Sugar syrup', 25, 'ml'), ('Cold brew', 80, 'ml'), ('Ice', None, 'g'),
        ('Ginger ale', 120, 'ml'), ('Ginger ale syrup', 20, 'ml')], 'ice is "3/4 th"'),
    R('Iced mocha', S, None, None, [
        ('Chocolate ganash', 40, 'ml'), ('Espresso shot', 30, 'ml'),
        ('Vanilla milk', 140, 'ml')]),
    R('Kala khatta cold brew', S, None, None, [
        ('Cold brew', 60, 'g'), ('Kala khatta', 15, 'g'),
        ('Sugar', 25, 'g'), ('Water', 150, 'ml')]),
    R('Iced white cho mocha', S, None, None, [
        ('White cho ghanache', 40, 'g'), ('Vanilla milk', 140, 'ml'),
        ('Espresso', 30, 'ml'), ('Ice cube', None, 'g')], 'ice is "3/4 cup"'),
    R('Coconut vietnamese', S, None, None, [
        ('Coconut cream milk', 135, 'ml'), ('Esspresso', 30, 'ml'),
        ('Ice cube', None, 'g')], 'no prices in the PDF; ice is "1/4 cup"'),
    R('Brazilian creaminess extract', S, None, None, [
        ('Condensed milk', 80, 'g'), ('Coconut milk powder', 20, 'g'),
        ('Hot water', 30, 'ml'), ('Ice', None, 'g'),
        ('Espresso', 20, 'g'), ('Sugar syrup', 20, 'g')], 'ice is "1/4 cup"'),

    # ---- iced matcha ------------------------------------------------------
    R('Blueberry matcha latte', S, None, None, [
        ('Vanilla milk', 140, 'ml'), ('Blueberry compote', 40, 'g'),
        ('Matcha', 2, 'g'), ('Ice', None, 'g')], 'ice is "3/4 th"'),
    R('Dirty matcha latte', S, None, None, [
        ('Matcha', 2, 'g'), ('Vanilla milk', 140, 'ml'), ('Espresso', 60, 'ml'),
        ('Sugar syrup', 10, 'ml'), ('Ice', None, 'g')],
      'espresso is "2 shots (30 ml each)"; ice is "3/4 th"'),
    R('Iced caramal matcha latte', S, None, None, [
        ('Matcha powder', 2.5, 'g'), ('Caramal', 50, 'g'),
        ('Vanilla milk', 135, 'g'), ('Ice cube', None, 'g')], 'ice is "3/4 cup"'),
    R('Strawberry ice matcha latte', S, None, None, [
        ('Strawberry compote', 30, 'g'), ('Vanilla milk', 135, 'g'),
        ('Matcha powder', 2.5, 'g')]),
    R('Coconut iced matcha', S, None, None, [
        ('Coconut water', 120, 'ml'), ('Syrup', 30, 'ml'),
        ('Matcha', 2.5, 'g'), ('Ice', None, 'g')], 'ice is "3/4 cup"'),
    R('Iced durty matcha', S, None, None, [
        ('Matcha', 2, 'g'), ('Vanilla milk', 140, 'g'), ('Coffee', 20, 'g'),
        ('Sugar syrup', 20, 'g'), ('Ice cube', None, 'g')], 'ice is "3/4 cup"'),
    R('Iced oat milk matcha latte', S, None, None, [
        ('Matcha powder', 2, 'g'), ('Oat milk', 150, 'ml'), ('Ice cube', None, 'g')],
      'ice is "1 cup"'),
    R('Blue berry matcha latte', S, None, None, [
        ('Blueberry compote', 40, 'g'), ('Matcha', 2.5, 'g'),
        ('Vanilla milk', 135, 'g'), ('Ice cube', None, 'g')], 'ice is "3/4 cup"'),

    # ---- milkshakes -------------------------------------------------------
    R('Chocolate milk shake', S, None, None, [
        ('Ice cream', 200, 'g'), ('Ice', None, 'g'), ('Chocolate ghanash', 70, 'g'),
        ('Coco powder', 5, 'g'), ('Chocolate dressing', 25, 'g'), ('Rock salt', 5, 'g')],
      'ice is "3/4 cup"'),
    R('Oreo milkshake', S, None, None, [
        ('Icecream', 200, 'g'), ('Orio biskit', 7, 'pcs'),
        ('Milk', 20, 'g'), ('Ice', None, 'g')], 'ice is "half cup"'),
    R('Vanilla milkshake', S, None, None, [
        ('Ice cream', 200, 'g'), ('Vanilla essence', 5, 'ml'),
        ('Milk', 50, 'ml'), ('Ice cube', None, 'g')], 'ice is "half cup"'),
    R('Strawberry milk shake', S, None, None, [
        ('Ice cream', 200, 'g'), ('Strawberry crush', 60, 'g'),
        ('Milk', 50, 'g'), ('Ice cube', None, 'g')], 'ice is "half cup"'),
    R('Blueberry milk shake', S, None, None, [
        ('Ice cream', 200, 'g'), ('Ice cube', None, 'g'),
        ('Bluberry crush', 60, 'g'), ('Milk', 50, 'g')], 'ice is "half cup"'),
    R('Banana & choco milkshake', S, None, None, [
        ('Ice cream', 200, 'g'), ('Ice cube', None, 'g'), ('Chocolate ghanash', 50, 'g'),
        ('Banana', 1, 'pcs'), ('Milk', 50, 'g'), ('Coco powder', 5, 'g')],
      'ice is "half cup"'),
    R('Browni milkshake', S, None, None, [
        ('Ice cream', 200, 'g'), ('Ice cube', None, 'g'), ('Browni', 1, 'pcs'),
        ('Milk', 50, 'g'), ('Chocolate', 50, 'g'), ('Coco powder', 5, 'g')],
      'ice is "half cup"'),
    R('Apple milkshake', S, None, None, [
        ('Ice cream', 150, 'g'), ('Ice cube', None, 'g'),
        ('Milk', 50, 'ml'), ('Apple', 1, 'pcs')], 'ice is "half cup"'),
    R('Banana milkshake', S, None, None, [
        ('Ice cream', 150, 'g'), ('Ice cube', None, 'g'),
        ('Milk', 50, 'ml'), ('Banana', 2, 'pcs')], 'ice is "half cup"'),
    R('Strawberry milkshake (150g)', S, None, None, [
        ('Ice cream', 150, 'g'), ('Ice cubes', 50, 'g'),
        ('Strawberry crush', 100, 'g'), ('Milk', 50, 'g')]),
    R('Blueberry milkshake (150g)', S, None, None, [
        ('Ice cream', 150, 'g'), ('Ice cubes', 50, 'g'), ('Blueberry crush', 100, 'g'),
        ('Blueberry fealing', 20, 'g'), ('Milk', 50, 'g')]),
    R('Dates & banana milk shake', S, None, None, [
        ('Banana', 30, 'g'), ('Dates', 10, 'pcs'), ('Ice cube', None, 'g'),
        ('Ice cream', 80, 'g'), ('Milk', 80, 'g')], 'ice is "half"'),

    # ---- cold drinks ------------------------------------------------------
    R('Yuzu lemonade', S, None, None, [
        ('Yuzu syrup', 30, 'g'), ('Ice', None, 'g'), ('Sprite', 200, 'g')],
      'ice is "3/4 cup"'),
    R('Peach ice tea', S, None, None, [
        ('Peach powder', 12, 'g'), ('Lemon powder', 3, 'g'),
        ('Ice cube', None, 'g'), ('Sprite', 200, 'ml')], 'ice is "3/4 cup"'),
    R('Lemon ice tea', S, None, None, [
        ('Water', 120, 'g'), ('Lemon powder', 7, 'g'),
        ('Sugar syrup', 60, 'g'), ('Ice', None, 'g')], 'ice is "1 cold cup"'),
    R('Vargin mojito', S, None, None, [
        ('Mojito mint', 15, 'ml'), ('Mojito lime', 15, 'ml'), ('Lemon powder', 3, 'g'),
        ('Sprite', 200, 'ml'), ('Ice', 120, 'g')]),
    R('Mint tea shikanji', S, None, None, [
        ('Water', 50, 'g'), ('Sabja seed', 10, 'g'), ('Mojito lime', 5, 'g'),
        ('Chat masala', 6, 'g'), ('Sprite', 100, 'ml'), ('Ice', 100, 'g')]),
    R('Blueberry cream soda', S, None, None, [
        ('Blueberry crush', 60, 'ml'), ('Blueberry filling', 40, 'ml'),
        ('Fresh cream', 20, 'ml'), ('Lemon powder', 2, 'g'),
        ('Sprite', 200, 'ml'), ('Ice', 120, 'g')]),
    R('Strawberry cream soda', S, None, None, [
        ('Strawberry crush', 60, 'ml'), ('Fresh cream', 20, 'ml'),
        ('Lemon powder', 2, 'g'), ('Sprite', 200, 'ml'), ('Ice', 120, 'g')]),
    R('Mango cream soda', S, None, None, [
        ('Mango crush', 60, 'ml'), ('Fresh cream', 20, 'ml'),
        ('Lemon powder', 2, 'g'), ('Sprite', 200, 'ml'), ('Ice', 120, 'g')]),
    R('Strawberry lemonade', S, None, None, [
        ('Strawberry crush', 60, 'ml'), ('Lemon powder', 2, 'g'),
        ('Sprite', 200, 'ml'), ('Ice', 120, 'g')]),
    R('Blueberry lemonade', S, None, None, [
        ('Blueberry filling', 40, 'ml'), ('Blueberry crush', 50, 'ml'),
        ('Lemon powder', 2, 'g'), ('Sprite', 200, 'ml'), ('Ice', 120, 'g')]),
    R('Mango lemonade', S, None, None, [
        ('Mango crush', 60, 'ml'), ('Lemon powder', 2, 'g'),
        ('Sprite', 200, 'ml'), ('Ice', 120, 'ml')]),
    R('Kala khatta lemonade', S, None, None, [
        ('Ice', 130, 'g'), ('Kalakhatta syrup', 15, 'g'),
        ('Sprite', 150, 'g'), ('Chat masala', None, 'g')], 'chat masala "1 pinch"'),
    R('Brazilian lemonade (serve)', S, None, None, [
        ('Brazilian lemonade syrup', 60, 'ml'), ('Sprite', 120, 'ml'),
        ('Ice cube', None, 'g'), ('Coconut cream', 30, 'g')], 'ice is "3/4 cup"'),

    # ---- sandwiches -------------------------------------------------------
    R('Bombay sandwich', S, None, None, [
        ('Bread', 3, 'pcs'), ('Butter', 30, 'g'), ('Green chutny', 15, 'g'),
        ('Prossed cheese', 60, 'g'), ('Onion', 10, 'g'), ('Green capcium', 10, 'g'),
        ('Potato', 20, 'g'), ('Tomato', 20, 'g')],
      'PDF also lists "Bombay masala" with no quantity'),
    R('Paneer makhni sandwich', S, None, None, [
        ('Bread', 2, 'pcs'), ('Butter', 20, 'g'), ('Prossed cheese', 30, 'g'),
        ('Paneer', 50, 'g'), ('Makhni sauce', 50, 'g')]),
    R('Rajma been sandwich', S, None, None, [
        ('Bread', 2, 'pcs'), ('Butter', 20, 'g'), ('Prossed cheese', 30, 'g'),
        ('Raja subji', 100, 'g'), ('Onion', 10, 'g'), ('Chat masala', None, 'g')],
      'chat masala "1 pinch"'),
    R('Ultimate mashroom sandwich', S, None, None, [
        ('Bread', 2, 'pcs'), ('Butter', 20, 'g'), ('Prossed cheese', 30, 'g'),
        ('Onion', 10, 'g'), ('Mashroom bhaji', 100, 'g'), ('Black olive', 10, 'g'),
        ('Cheese', 30, 'g'), ('All harbs', None, 'g')], 'herbs have no quantity'),
    R('Cheese garlic bread', S, None, None, [
        ('Bread', 2, 'pcs'), ('Fresh cream', 50, 'g'), ('Mozzarella cheese', 50, 'g'),
        ('Prossed cheese', 50, 'g'), ('All harbs', None, 'g'), ('Garlic', 20, 'g')]),
    R('American grill cheese', S, None, None, [
        ('Bread', 2, 'pcs'), ('Butter', 20, 'g'), ('Mozzarella cheese', 30, 'g'),
        ('Prossed cheese', 30, 'g'), ('All harbs', None, 'g')]),
    R('Pesto vegetables sandwich', S, None, None, [
        ('Bread', 2, 'pcs'), ('Butter', 20, 'g'), ('Pesto sauce', 50, 'g'),
        ('All vegitable', 100, 'g'), ('Prossed cheese', 30, 'g'), ('All harbs', None, 'g')],
      'PDF total is blank and marked "cheak"'),
    R('Paneer tikka sandwich', S, None, None, [
        ('Paneer tikka bhaji', 100, 'g'), ('Bread', 2, 'pcs'),
        ('Cheese', 30, 'g'), ('Butter', 40, 'g')]),
    R('Peanut butter & blueberry jam', S, None, None, [
        ('Peanut butter', 40, 'g'), ('Blueberry', 30, 'g'), ('Bread', 2, 'pcs')]),
    R('Peanut butter sandwich', S, None, None, [
        ('Peanut butter', 50, 'g'), ('Bread', 2, 'pcs')]),
    R('Pinut butter & gulkand', S, None, None, [
        ('Bread', 2, 'pcs'), ('Pinut butter', 30, 'g'), ('Gulkand', 30, 'g')]),
    R('Simple almond butter sandwich', S, None, None, [
        ('Almond butter', 50, 'g'), ('Bread', 2, 'pcs')]),
    R('Masala sandwich', S, None, None, [
        ('Bread', 2, 'pcs'), ('Butter', 20, 'g'),
        ('Sandwich fealing', None, 'g'), ('Cheese', 30, 'g')],
      'sandwich filling has no quantity in the PDF'),

    # ---- pizza and calzone ------------------------------------------------
    R('Farmers market pizza', S, None, None, [
        ('Pizza dough', 310, 'g'), ('Tomato sauce', 50, 'g'),
        ('Mozzarella cheese', 140, 'g'), ('All vegitable', 100, 'g'),
        ('All harbs', None, 'g')]),
    R('Pizza margarita', S, None, None, [
        ('Pizza dough', 310, 'g'), ('Tomato sauce', 50, 'g'),
        ('Mozzarella cheese', 140, 'g'), ('All hearbs', None, 'g')]),
    R('Pizza capricciosa', S, None, None, [
        ('Pizza dough', 310, 'g'), ('Tomato sauce', 50, 'g'),
        ('Mozzarella cheese', 140, 'g'), ('All hearbs', None, 'g'),
        ('Mashroom bhaji', 100, 'g'), ('Onion', 20, 'g'), ('Olive', 10, 'g')]),
    R('Indian delight pizza', S, None, None, [
        ('Pizza dough', 310, 'g'), ('Paneer makhni sauce', 50, 'g'),
        ('Mozzarella cheese', 140, 'g'), ('Paneer sabji', 100, 'g'),
        ('Onion/green capcicum', 50, 'g')]),
    R('Pesto pizza', S, None, None, [
        ('Pizza dough', 310, 'g'), ('Tomato sauce', 50, 'g'),
        ('Mozzarella cheese', 140, 'g'), ('Pesto sauce', 100, 'g'),
        ('Black olive', 10, 'g'), ('Black papper', None, 'g')],
      'pepper "1 pinch"; PDF total is blank'),
    R('Paneer tikka pizza', S, None, None, [
        ('Paneer tikka bhaji', 100, 'g'), ('Pizza dough', 310, 'g'),
        ('Mozzarella cheese', 140, 'g'), ('Vegitable', 50, 'g')]),
    R('Mashroom calzone', S, None, None, [
        ('Pizza dough', 310, 'g'), ('Tomato sauce', 50, 'g'),
        ('Mozzarella cheese', 100, 'g'), ('All hearbs', None, 'g'),
        ('Mashroom bhaji', 100, 'g'), ('Onion', 20, 'g'), ('Black olive', 10, 'g')]),
    R('Garlic calzone', S, None, None, [
        ('Pizza dough', 310, 'g'), ('Tomato sauce', 50, 'g'),
        ('Mozzarella cheese', 100, 'g'), ('Garlic bhaji', 20, 'g')]),
    R('Paneer makhani calzone', S, None, None, [
        ('Pizza dough', 310, 'g'), ('Paneer makhni sauce', 50, 'g'),
        ('Mozzarella cheese', 100, 'g'), ('Paneer bhaji', 100, 'g'),
        ('Onion', 20, 'g'), ('Green capcicum', 20, 'g')], 'PDF total is blank'),
    R('Paneer tikka calzone', S, None, None, [
        ('Paneer tikka bhaji', 100, 'g'), ('Pizza dough', 310, 'g'),
        ('Mozzarella cheese', 140, 'g'), ('Vegitable', 50, 'g')]),
    R('Triple cheese pizza', S, None, None, [
        ('Pizza dough', 310, 'g'), ('Tomato sauce', 50, 'g'),
        ('Mozzarella cheese', 100, 'g'), ('Process cheese', 50, 'g'),
        ('All hearbs', None, 'g')]),

    # ---- pasta ------------------------------------------------------------
    R('Mornay sauce pasta', S, None, None, [
        ('All vegitable', 100, 'g'), ('Oil', 10, 'g'), ('Garlic bhaji', 30, 'g'),
        ('Milk', 50, 'g'), ('Cheese', 50, 'g'), ('All hearbs', None, 'g'),
        ('Pasta', 120, 'g')]),
    R('Provencal sauce pasta', S, None, None, [
        ('All vegitable', 100, 'g'), ('Oil', 10, 'g'), ('Garlic bhaji', 30, 'g'),
        ('Tomato sauce', 100, 'g'), ('Cheese', 40, 'g'), ('All hearbs', None, 'g'),
        ('Water', 20, 'g'), ('Pasta', 120, 'g')]),
    R('Pesto sauce pasta', S, None, None, [
        ('All vegitable', 100, 'g'), ('Oil', 10, 'g'), ('Pesto sauce', 100, 'g'),
        ('Black papper', None, 'g'), ('Cheese', 40, 'g'), ('Pasta', 120, 'g')],
      'PDF total is blank'),
    R('Spinach & mashroom spaghetti pasta', S, None, None, [
        ('Mashroom bhaji', 30, 'g'), ('Spinach & paneer bhaji', 70, 'g'),
        ('Speghetti pasta', 120, 'g'), ('Butter', 10, 'g')]),

    # ---- cinnamon rolls ---------------------------------------------------
    R('Old scool cinnemon roll', S, None, None, [
        ('Cinnemon roll', 1, 'pcs'), ('Icing', 70, 'g')]),
    R('Cookie monstar cinnemon roll', S, None, None, [
        ('Cinnemon roll', 1, 'pcs'), ('Icing', 70, 'g'),
        ('Cookie', 20, 'g'), ('Chocolate', 20, 'g')]),
    R('Coffee magic cinnemon roll', S, None, None, [
        ('Cinnemon roll', 1, 'pcs'), ('Icing', 70, 'g'),
        ('Coffee', 2, 'g'), ('Orio', 20, 'g')]),
    R('Blueberry cinnemon roll', S, None, None, [
        ('Cinnemon roll', 1, 'pcs'), ('Icing', 70, 'g'),
        ('Coconut powder', 2, 'g'), ('Blueberry fealing', 10, 'g')]),
    R('Apple caramal cinnemon roll', S, None, None, [
        ('Cinnemon roll', 1, 'pcs'), ('Icing', 70, 'g'),
        ('Apple', 30, 'g'), ('Caramal', 20, 'g')]),
    R('Hot cho & cookies', S, None, None, [
        ('Cinnemon roll', 1, 'pcs'), ('Cho+icing', 70, 'g'), ('Cookie', 20, 'g')]),
    R('Strawberry nutella cinnemon roll', S, None, None, [
        ('Cinnemon roll', 1, 'pcs'), ('Icing', 70, 'g')],
      'PDF total is 44 but lists only two lines'),
    R('Biscoff bliss', S, None, None, [
        ('Cinnemon roll', 1, 'pcs'), ('Icing', 70, 'g'), ('Lotus Cookie', 20, 'g')]),

    # ---- preparations, with the yields the PDF states ---------------------
    R('Vanilla milk', P, 1520, 'g', [
        ('Milk', 1000, 'g'), ('Milk maid', 400, 'g'),
        ('Sugar syrup', 120, 'g'), ('Vanilla essence', None, 'ml')],
      'PDF gives two versions; this is the later one. Essence is "2 drop"'),
    R('Tiramisu cream', P, 635, 'g', [
        ('Mascoporn cream', 300, 'g'), ('Whipping cream', 250, 'g'),
        ('Vanilla esence', 5, 'g'), ('Sugar', 80, 'g')]),
    R('Cream cheese icing', P, 1775, 'g', [
        ('Cream cheese', 600, 'g'), ('Sugar', 600, 'g'), ('Milk', 400, 'ml'),
        ('Vanilla essence', 25, 'g'), ('Butter', 150, 'g')]),
    R('White cho ghanash', P, 150, 'g', [
        ('White chocolate', 100, 'g'), ('Fresh cream', 70, 'g')]),
    R('Chocolate ghanash', P, 170, 'g', [
        ('Dark chocolate', 100, 'g'), ('Fresh cream', 100, 'g')]),
    R('Cold brew', P, 3200, 'g', [
        ('Cold brew coffee', 500, 'g'), ('Water', 3000, 'ml'),
        ('Sugar sachet', 4, 'pcs')]),
    R('Pesto sauce', P, 2320, 'g', [
        ('Basil', 1200, 'g'), ('Cashew', 450, 'g'), ('Oil', 300, 'g'),
        ('Garlic', 10, 'g'), ('Salt', 50, 'g'), ('Black papper', 4, 'g'),
        ('Cheese', 300, 'g')]),
    R('Mashroom bhaji', P, 1100, 'g', [
        ('Mashroom', 600, 'g'), ('Garlic', 160, 'g'), ('Onion', 250, 'g'),
        ('Thyme', 7, 'g'), ('Chilly flaxe', 7, 'g'), ('Origano', 7, 'g'),
        ('Black papper', 7, 'g'), ('Oil', 100, 'g')]),
    R('Green chutny', P, 1230, 'g', [
        ('Coriander', 870, 'g'), ('Spinach', 170, 'g'), ('Green chilly', 30, 'g'),
        ('Garlic', 70, 'g'), ('Sandwich masala', 30, 'g'), ('Curry leaves', 14, 'g'),
        ('Salt', 10, 'g'), ('Rosted chana', 70, 'g')]),
    R('Paneer bhaji', P, 1300, 'g', [
        ('Paneer', 1000, 'g'), ('Oil', 100, 'g'), ('Ginger garlic paste', 100, 'g'),
        ('Red chilly powder', 20, 'g'), ('Coriander powder', 20, 'g'),
        ('Kitchen king masala', 20, 'g'), ('Black salt', 10, 'g'),
        ('Dry mango powder', 10, 'g'), ('Cumin powder', 3, 'g'),
        ('Fresh cream', 150, 'g')]),
    R('Red chutney', P, 550, 'g', [
        ('Red chilly', 150, 'g'), ('Green chilly', 150, 'g'), ('Garlic', 150, 'g'),
        ('Cumin powder', 30, 'g'), ('Black salt', 15, 'g'), ('Salt', 20, 'g'),
        ('Lemon powder', 30, 'g'), ('Water', 50, 'g')]),
    R('Tomato sauce', P, 3900, 'g', [
        ('Oil', 100, 'g'), ('Garlic', 180, 'g'), ('Onion', 500, 'g'),
        ('Green capcicum', 300, 'g'), ('Tomato', 3300, 'g'),
        ('Tomato ketchup', 40, 'g'), ('White vineger', 70, 'g'),
        ('Mix harbs', 7, 'g'), ('Origano', 7, 'g'), ('Salt', 20, 'g'),
        ('Thyme', 4, 'g')]),
    R('Makhani sauce', P, 3000, 'g', [
        ('Oil', 100, 'g'), ('Garlic', 30, 'g'), ('Onion', 420, 'g'),
        ('Green chilly', 25, 'g'), ('Tomato', 2240, 'g'), ('Cumin seeds', 20, 'g'),
        ('Ginger', 35, 'g'), ('Kashmiri chilly', 35, 'g'), ('Cashew nuts', 90, 'g'),
        ('Water', 200, 'g')]),
    R('Makhani tadka', P, 420, 'g', [
        ('Oil', 70, 'g'), ('Butter', 30, 'g'), ('Red chilly powder', 25, 'g'),
        ('Coriander powder', 25, 'g'), ('Sugar', 65, 'g'), ('Salt', 40, 'g'),
        ('Kitchen king', 11, 'g'), ('Kasturi methi', 3, 'g'),
        ('Fresh cream', 150, 'g'), ('Fresh coriander', 30, 'g')]),
    R('Pizza dough', P, 2170, 'g', [
        ('Water', 900, 'g'), ('Salt', 30, 'g'),
        ('Dry yeast', 12, 'g'), ('Flour', 1330, 'g')],
      'PDF says "7 dough, 1 ball = 310 gm"; 7 x 310 = 2170 g. Confirm the yield.'),
    R('Rajma curry', P, 2100, 'g', [
        ('Oil', 60, 'g'), ('Ginger garlic past', 87, 'g'), ('Onion', 385, 'g'),
        ('Coriander powder', 11, 'g'), ('Cumin powder', 16, 'g'),
        ('Kitchen king powder', 16, 'g'), ('Red chilly powder', 16, 'g'),
        ('Tomato', 664, 'g'), ('Boiled rajma', 1000, 'g'), ('Salt', None, 'g')],
      'salt has no quantity in the PDF'),
    R('Garlic bhaji', P, 130, 'g', [
        ('Garlic', 100, 'g'), ('Oil', 50, 'g'), ('All hearbs', None, 'g')]),
    R('Nachos', P, 150, 'g', [
        ('Makai aata', 125, 'g'), ('Maida', 75, 'g'), ('Jeera', 1.5, 'g'),
        ('Salt', 3, 'g'), ('Black papper powder', 1, 'g'), ('Ajwain', 1.5, 'g'),
        ('Haldi', 1, 'g'), ('Oil', 4, 'g'), ('Butter', 12, 'g'),
        ('Nachos masala', 20, 'g')]),
    R('Blueberry compote', P, 525, 'g', [
        ('Blueberries', 250, 'g'), ('Mulburry', 250, 'g'), ('Sugar', 170, 'g'),
        ('Corn flour', 11, 'g'), ('Lemon powder', 1, 'g')]),
    R('Brazilian lemonade syrup', P, 800, 'ml', [
        ('Lemon', 850, 'g'), ('Caster sugar', 70, 'g'), ('Water', 400, 'ml'),
        ('Lime zest', None, 'g'), ('Citric acid', 1.5, 'g')]),
    R('Brazillian syrup', P, 1000, 'g', [
        ('Sugar', 700, 'g'), ('Water', 400, 'ml'), ('Lemon powder', 10, 'g')]),
    R('Coconut vietnamese syrup', P, None, 'g', [
        ('Coconut cream', 80, 'g'), ('Coconut milk', 160, 'g'),
        ('Salt', None, 'g'), ('Condensed milk', 100, 'g')],
      'PDF has no yield; salt "1 pinch"'),
    R('Brazilian cream', P, 120, 'g', [
        ('Milk maid', 80, 'g'), ('Coconut milk', 20, 'g'), ('Hot water', 30, 'ml')]),
    R('Clasic cold coffee', P, None, 'ml', [
        ('Ice cream', 9200, 'g'), ('Sugar', 2000, 'g'), ('Ice cube', 3200, 'g'),
        ('Milk', 7000, 'ml'), ('Coffee powder', 370, 'g')],
      'PDF says "82 glasses at 25 per glass" - confirm the yield in ml'),
    R('Masala sandwich masala', P, None, 'g', [
        ('Butter', 20, 'g'), ('Cumin powder', 2, 'g'), ('Coriander powder', 2, 'g'),
        ('Turmeric powder', 1, 'g'), ('Red chilly powder', 2, 'g'),
        ('Garam masala', 1, 'g'), ('Salt', 2, 'g')], 'PDF has no yield'),
]


def slug(s):
    return re.sub(r'[^a-z0-9& ]', '', s.strip().lower())


# A line names a sub-recipe by whatever the kitchen calls it. These point the
# reference at the recipe that actually exists. Anything genuinely ambiguous is
# left unresolved on purpose - see the report.
ALIAS = {
    'icing': 'Cream cheese icing',
    'chocolate ganash': 'Chocolate ghanash',
    'chocolate ghanash': 'Chocolate ghanash',
    'white ganash': 'White cho ghanash',
    'white chocolate ghanash': 'White cho ghanash',
    'white cho ghanache': 'White cho ghanash',
    'tiramissu cream': 'Tiramisu cream',
    'raja subji': 'Rajma curry',
    'paneer sabji': 'Paneer bhaji',
    'mashroom bhaji': 'Mashroom bhaji',
    'tomato sauce': 'Tomato sauce',
    'pesto sauce': 'Pesto sauce',
    'pizza dough': 'Pizza dough',
    'garlic bhaji': 'Garlic bhaji',
    'green chutny': 'Green chutny',
    'cold brew': 'Cold brew',
    'vanilla milk': 'Vanilla milk',
    'blueberry compote': 'Blueberry compote',
    'brazilian lemonade syrup': 'Brazilian lemonade syrup',
    'sandwich fealing': 'Masala sandwich masala',
    'coffee powder': 'Instant Coffee Powder',
}

RECIPE_NAMES = {}


def classify(source):
    key = slug(source)
    if key in RECIPE_NAMES:
        return 'recipe', RECIPE_NAMES[key]
    if key in ALIAS and slug(ALIAS[key]) in RECIPE_NAMES:
        return 'recipe', ALIAS[key]
    if key in MAP:
        return 'ingredient', MAP[key]
    if key in NEEDED:
        return 'new-ingredient', NEEDED[key][0]
    return 'unknown', source


def main(out_dir):
    RECIPE_NAMES.update({slug(r['name']): r['name'] for r in RECIPES})
    unknown = {}
    with open(f'{out_dir}/recipes-2026-09.csv', 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh)
        w.writerow(['name', 'kind', 'yield_qty', 'yield_unit', 'batch_minutes', 'note'])
        for r in RECIPES:
            w.writerow([r['name'], r['kind'], r['yield_qty'] or '',
                        r['yield_unit'] or '', '', r['note']])

    with open(f'{out_dir}/recipe-lines-2026-09.csv', 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh)
        w.writerow(['recipe', 'source_kind', 'source', 'as_written', 'quantity', 'unit'])
        for r in RECIPES:
            for source, qty, unit in r['lines']:
                kind, resolved = classify(source)
                if kind in ('unknown', 'new-ingredient'):
                    unknown.setdefault(resolved, []).append((kind, r['name']))
                w.writerow([r['name'], kind, resolved, source,
                            '' if qty is None else qty, unit or ''])

    lines = sum(len(r['lines']) for r in RECIPES)
    print(f'{len(RECIPES)} recipes, {lines} lines')
    print(f"  {sum(1 for r in RECIPES if r['kind'] == 'prep')} preparations")
    print(f"  {sum(1 for r in RECIPES if r['yield_qty'])} have a yield in the PDF")
    print(f'  {len(unknown)} ingredient names are not in the catalogue\n')
    new = {k: v for k, v in unknown.items() if v[0][0] == 'new-ingredient'}
    lost = {k: v for k, v in unknown.items() if v[0][0] == 'unknown'}

    print('MUST BE CREATED AS INGREDIENTS (%d), no price until a delivery:' % len(new))
    for name in sorted(new, key=lambda n: (-len(new[n]), n.lower()))[:12]:
        print('  %-30s used by %3d' % (name[:30], len(new[name])))
    print('  ... and %d more\n' % max(0, len(new) - 12))

    print('STILL UNRESOLVED (%d) - the PDF names these but never defines them:' % len(lost))
    for name in sorted(lost, key=lambda n: (-len(lost[n]), n.lower())):
        print('  %-30s used by %3d  e.g. %s' % (name[:30], len(lost[name]), lost[name][0][1][:28]))

    order = []
    seen = set()
    for key in NEEDED:
        nm, ut = NEEDED[key]
        if nm not in seen:
            seen.add(nm)
            order.append((nm, ut))
    with open(out_dir + '/ingredients-needed-2026-09.csv', 'w', newline='', encoding='utf-8') as fh:
        wr = csv.writer(fh)
        wr.writerow(['name', 'brand', 'unit_type', 'purchase_unit', 'purchase_unit_in_base',
                     'opening_qty', 'opening_cost_rupees', 'source_row', 'note'])
        for nm, ut in order:
            unit, in_base = {'weight': ('kg', 1000), 'volume': ('litre', 1000),
                             'count': ('piece', 1)}[ut]
            wr.writerow([nm, '', ut, unit, in_base, '', '', 'recipe PDF',
                         'used by %d recipes; fill in the pack size and what you paid'
                         % len(new.get(nm, []))])


if __name__ == '__main__':
    main(sys.argv[1])

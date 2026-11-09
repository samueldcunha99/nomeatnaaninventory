import type { Role } from './auth.ts';

/** Each sentence travels with its Hindi and Marathi translations. No business data. */
type Text = readonly [english: string, hindi: string, marathi: string];
type Step = { text: Text; roles?: readonly Role[] };
type Tutorial = { description: Text; steps: readonly Step[]; result: Text };
const step = (text: Text, roles?: readonly Role[]): Step => ({ text, roles });
const managers = ['owner', 'manager'] as const;

export const pageTutorials = {
  stockImport: {
    description: ['Import an ingredient list, verified opening stock or a delivery from a CSV file.', 'CSV फ़ाइल से सामग्री सूची, सत्यापित शुरुआती स्टॉक या डिलीवरी आयात करें।', 'CSV फाइलमधून साहित्य यादी, पडताळलेला सुरुवातीचा साठा किंवा डिलिव्हरी आयात करा.'],
    steps: [
      step(['Download the template, fill it in Excel and save as CSV UTF-8. Keep the headings unchanged.', 'नमूना डाउनलोड करें, Excel में भरें और CSV UTF-8 में सहेजें। शीर्षक न बदलें।', 'नमुना डाउनलोड करा, Excel मध्ये भरा आणि CSV UTF-8 म्हणून जतन करा. मथळे बदलू नका.']),
      step(['Choose opening stock or a new delivery. Quantities use purchase units; costs are the full rupee value of each row.', 'शुरुआती स्टॉक या नई डिलीवरी चुनें। मात्रा खरीद इकाई में और लागत हर पंक्ति का पूरा रुपया मूल्य है।', 'सुरुवातीचा साठा किंवा नवीन डिलिव्हरी निवडा. प्रमाण खरेदी एककात व खर्च प्रत्येक ओळीचे पूर्ण रुपयातील मूल्य आहे.']),
      step(['Upload the file, fix every listed error and review the preview before confirming the import.', 'फ़ाइल चुनें, हर बताई गई गलती सुधारें और आयात की पुष्टि से पहले पूर्वावलोकन जाँचें।', 'फाइल निवडा, दाखवलेल्या सर्व चुका सुधारा आणि आयात निश्चित करण्यापूर्वी पूर्वावलोकन तपासा.']),
    ],
    result: ['Nothing changes during preview. Confirmation saves the whole file together; the same file and reference cannot add stock twice.', 'पूर्वावलोकन में कुछ नहीं बदलता। पुष्टि पूरी फ़ाइल साथ सहेजती है; समान फ़ाइल और संदर्भ स्टॉक दो बार नहीं जोड़ते।', 'पूर्वावलोकनात काहीही बदलत नाही. निश्चित केल्यावर पूर्ण फाइल एकत्र जतन होते; तीच फाइल आणि संदर्भ साठा दोनदा वाढवत नाहीत.'],
  },
  login: {
    description: ['Sign in with the staff account created for you.', 'अपने लिए बनाए गए कर्मचारी खाते से साइन इन करें।', 'तुमच्यासाठी तयार केलेल्या कर्मचारी खात्याने साइन इन करा.'],
    steps: [
      step(['Choose English, Hindi or Marathi above the sign-in form.', 'साइन इन फॉर्म के ऊपर अंग्रेज़ी, हिन्दी या मराठी चुनें।', 'साइन इन फॉर्मच्या वर इंग्रजी, हिंदी किंवा मराठी निवडा.']),
      step(['Enter your staff email and password. Use the eye button to check a mistyped password.', 'कर्मचारी ईमेल और पासवर्ड दर्ज करें। पासवर्ड जाँचने के लिए आँख वाला बटन दबाएँ।', 'कर्मचारी ईमेल आणि पासवर्ड भरा. पासवर्ड तपासण्यासाठी डोळ्याचे बटण वापरा.']),
      step(['Select Sign in. If you cannot get in, ask an owner or manager to check your account or reset your password.', 'साइन इन दबाएँ। प्रवेश न मिले तो मालिक या प्रबंधक से खाता जाँचने या पासवर्ड रीसेट करने को कहें।', 'साइन इन दाबा. प्रवेश मिळत नसल्यास मालक किंवा व्यवस्थापकाला खाते तपासण्यास किंवा पासवर्ड रीसेट करण्यास सांगा.']),
    ],
    result: ['You will see the pages allowed for your staff role. Sign out when leaving a shared device.', 'आपको अपनी भूमिका के लिए अनुमत पृष्ठ दिखेंगे। साझा डिवाइस छोड़ते समय साइन आउट करें।', 'तुमच्या भूमिकेसाठी परवानगी असलेली पाने दिसतील. सामायिक उपकरण सोडताना साइन आउट करा.'],
  },
  overview: {
    description: ['Start here to see what needs attention in the cafe today.', 'कैफे में आज किस काम पर ध्यान देना है, यहाँ देखें।', 'कॅफेमध्ये आज कोणत्या कामाकडे लक्ष द्यायचे आहे ते येथे पहा.'],
    steps: [
      step(['Check low-stock notices and today’s recorded deliveries before the shift gets busy.', 'काम बढ़ने से पहले कम स्टॉक की सूचनाएँ और आज की दर्ज डिलीवरी जाँचें।', 'गर्दी सुरू होण्यापूर्वी कमी साठ्याच्या सूचना आणि आजच्या नोंदवलेल्या डिलिव्हरी तपासा.']),
      step(['Use the navigation menu to open the task you want to do; the overview itself does not record a purchase or batch.', 'अपने काम का पृष्ठ मेनू से खोलें; अवलोकन पृष्ठ खुद खरीद या बैच दर्ज नहीं करता।', 'हवे असलेले काम मेनूमधून उघडा; आढावा पान स्वतः खरेदी किंवा बॅच नोंदवत नाही.']),
      step(['For a new cafe, add ingredients and recipes, record opening stock, then configure menu prices and sales settings.', 'नए कैफे के लिए सामग्री और व्यंजन जोड़ें, शुरुआती स्टॉक दर्ज करें, फिर मेनू कीमतें और बिक्री सेटिंग तय करें।', 'नवीन कॅफेसाठी साहित्य व पाककृती जोडा, सुरुवातीचा साठा नोंदवा, मग मेनू किमती आणि विक्री सेटिंग ठरवा.'], managers),
    ],
    result: ['These figures come from saved records. Missing purchase costs must be entered before recipe costs can be trusted.', 'ये आँकड़े सहेजी गई नोंदों से आते हैं। विश्वसनीय व्यंजन लागत के लिए खरीद की गुम लागत पहले दर्ज करें।', 'हे आकडे जतन केलेल्या नोंदींवर आधारित आहेत. विश्वासार्ह पाककृती खर्चासाठी खरेदीचा गहाळ खर्च आधी नोंदवा.'],
  },
  ingredients: {
    description: ['Your ingredient list shows quantities on hand and the latest weighted-average purchase costs.', 'सामग्री सूची में उपलब्ध मात्रा और भारित औसत खरीद लागत दिखती है।', 'साहित्य यादीमध्ये उपलब्ध प्रमाण आणि भारित सरासरी खरेदी खर्च दिसतो.'],
    steps: [
      step(['Search by name. Include inactive ingredients when checking an older item.', 'नाम से खोजें। पुराने आइटम के लिए निष्क्रिय सामग्री भी शामिल करें।', 'नावाने शोधा. जुना पदार्थ तपासताना निष्क्रिय साहित्यही समाविष्ट करा.']),
      step(['Add or edit an ingredient to set its purchase pack, measurement unit and low-stock threshold.', 'खरीद पैक, माप इकाई और कम स्टॉक सीमा तय करने के लिए सामग्री जोड़ें या संपादित करें।', 'खरेदी पॅक, मोजमापाचे एकक आणि कमी साठ्याची मर्यादा ठरवण्यासाठी साहित्य जोडा किंवा संपादित करा.'], managers),
      step(['Use Stock receipts for a new delivery and Adjustments & waste for a count correction or loss.', 'नई डिलीवरी के लिए स्टॉक रसीद और गिनती सुधार या नुकसान के लिए समायोजन व बर्बादी का उपयोग करें।', 'नवीन डिलिव्हरीसाठी साठा पावती आणि मोजणीतील दुरुस्ती किंवा नुकसानीसाठी समायोजन व वाया गेलेला साठा वापरा.']),
    ],
    result: ['Looking at this list does not change stock. A cost marked unknown needs a recorded purchase or opening valuation.', 'सूची देखने से स्टॉक नहीं बदलता। अज्ञात लागत के लिए खरीद या शुरुआती मूल्यांकन की नोंद चाहिए।', 'यादी पाहिल्याने साठा बदलत नाही. अज्ञात खर्चासाठी खरेदी किंवा सुरुवातीच्या मूल्यांकनाची नोंद आवश्यक आहे.'],
  },
  ingredientNew: {
    description: ['Define what you buy before recording its stock or using it in a recipe.', 'स्टॉक दर्ज करने या व्यंजन में उपयोग से पहले खरीदी जाने वाली सामग्री की जानकारी भरें।', 'साठा नोंदवण्यापूर्वी किंवा पाककृतीत वापरण्यापूर्वी खरेदीच्या साहित्याची माहिती भरा.'],
    steps: [
      step(['Enter a clear ingredient name and optional brand so staff can identify the correct item.', 'स्पष्ट सामग्री नाम और चाहें तो ब्रांड दर्ज करें ताकि कर्मचारी सही आइटम पहचान सकें।', 'कर्मचाऱ्यांना योग्य साहित्य ओळखता यावे म्हणून स्पष्ट नाव आणि ऐच्छिक ब्रँड भरा.']),
      step(['Choose weight, volume or count. Define the purchase pack: for example, one kg contains 1,000 g, or one tray contains 30 eggs.', 'वज़न, आयतन या गिनती चुनें। खरीद पैक बताएँ: जैसे एक किलो में 1,000 ग्राम या एक ट्रे में 30 अंडे।', 'वजन, आकारमान किंवा संख्या निवडा. खरेदी पॅक ठरवा: उदा. एका किलोत 1,000 ग्रॅम किंवा एका ट्रेमध्ये 30 अंडी.']),
      step(['Set the low-stock threshold in the displayed unit, check the details, then save.', 'दिखाई गई इकाई में कम स्टॉक सीमा भरें, जानकारी जाँचें और सहेजें।', 'दाखवलेल्या एककात कमी साठ्याची मर्यादा भरा, माहिती तपासा आणि जतन करा.']),
    ],
    result: ['Saving creates the ingredient only. Record opening stock or a receipt separately to add quantity and value.', 'सहेजने से केवल सामग्री बनती है। मात्रा और मूल्य जोड़ने के लिए शुरुआती स्टॉक या खरीद रसीद अलग दर्ज करें।', 'जतन केल्याने फक्त साहित्य तयार होते. प्रमाण आणि मूल्य जोडण्यासाठी सुरुवातीचा साठा किंवा खरेदी पावती स्वतंत्र नोंदवा.'],
  },
  ingredientEdit: {
    description: ['Update an ingredient’s details while keeping its stock history intact.', 'स्टॉक इतिहास बनाए रखते हुए सामग्री की जानकारी बदलें।', 'साठ्याचा इतिहास कायम ठेवून साहित्याची माहिती बदला.'],
    steps: [
      step(['Check the ingredient name and current unit before changing its pack size or threshold.', 'पैक आकार या सीमा बदलने से पहले सामग्री का नाम और मौजूदा इकाई जाँचें।', 'पॅकचा आकार किंवा मर्यादा बदलण्यापूर्वी साहित्याचे नाव व सध्याचे एकक तपासा.']),
      step(['Update the details shown in the form. If a unit change is blocked by a recipe or stock history, keep the existing unit.', 'फॉर्म की जानकारी बदलें। व्यंजन या स्टॉक इतिहास के कारण इकाई बदलना रुके तो मौजूदा इकाई रखें।', 'फॉर्ममधील माहिती बदला. पाककृती किंवा साठ्याच्या इतिहासामुळे एकक बदलण्यास मनाई असल्यास सध्याचे एकक ठेवा.']),
      step(['Save the edit. Use a receipt or stock correction for changes to quantity, rather than editing ingredient details.', 'संपादन सहेजें। मात्रा बदलने के लिए सामग्री संपादन के बजाय रसीद या स्टॉक सुधार दर्ज करें।', 'बदल जतन करा. प्रमाण बदलण्यासाठी साहित्य संपादनाऐवजी पावती किंवा साठा दुरुस्ती नोंदवा.']),
    ],
    result: ['Editing details does not add stock, change past purchases or rewrite historical costs.', 'जानकारी बदलने से स्टॉक नहीं जुड़ता और पिछली खरीद या ऐतिहासिक लागत नहीं बदलती।', 'माहिती बदलल्याने साठा वाढत नाही किंवा जुनी खरेदी व ऐतिहासिक खर्च बदलत नाही.'],
  },
  recipes: {
    description: ['Browse recipes and sub-recipes, check costing, and set portions for your menu.', 'व्यंजन और उप-व्यंजन देखें, लागत जाँचें और मेनू के हिस्से तय करें।', 'पाककृती आणि उपपाककृती पहा, खर्च तपासा आणि मेनूसाठी भाग ठरवा.'],
    steps: [
      step(['Open a recipe name to see its cost breakdown and any missing ingredient costs.', 'लागत विवरण और गुम सामग्री लागत देखने के लिए व्यंजन का नाम खोलें।', 'खर्चाचा तपशील आणि गहाळ साहित्य खर्च पाहण्यासाठी पाककृतीचे नाव उघडा.']),
      step(['Create a recipe with measured ingredients and usable batch yield. A sauce or dough can be reused as a sub-recipe.', 'मापी गई सामग्री और उपयोग योग्य बैच उत्पादन के साथ व्यंजन बनाएँ। सॉस या आटे को उप-व्यंजन की तरह दोबारा उपयोग कर सकते हैं।', 'मोजलेले साहित्य आणि वापरण्यायोग्य बॅच उत्पादन भरून पाककृती तयार करा. सॉस किंवा पीठ उपपाककृती म्हणून पुन्हा वापरता येते.']),
      step(['Open its menu editor to set serving sizes, selling prices and how stock will be consumed.', 'हिस्से, बिक्री कीमतें और स्टॉक उपयोग का तरीका तय करने के लिए मेनू संपादक खोलें।', 'भाग, विक्री किमती आणि साठा वापरण्याची पद्धत ठरवण्यासाठी मेनू संपादक उघडा.']),
    ],
    result: ['Recipe costs follow saved purchase values. Unknown cost or missing batch timing is shown instead of assumed to be free.', 'व्यंजन लागत सहेजी गई खरीद कीमतों से आती है। अज्ञात लागत या गुम बैच समय को मुफ्त नहीं माना जाता।', 'पाककृती खर्च जतन केलेल्या खरेदी मूल्यांवर आधारित असतो. अज्ञात खर्च किंवा नसलेला बॅच वेळ मोफत मानला जात नाही.'],
  },
  recipeNew: {
    description: ['Describe one real batch: what goes in and how much usable food comes out.', 'एक वास्तविक बैच बताएँ: उसमें क्या जाता है और कितना उपयोग योग्य खाना बनता है।', 'एका प्रत्यक्ष बॅचची माहिती द्या: काय वापरले जाते आणि किती वापरण्यायोग्य पदार्थ तयार होतो.'],
    steps: [
      step(['Name the recipe and enter its measured usable yield with g, kg, ml, L or pieces.', 'व्यंजन का नाम और मापा गया उपयोग योग्य उत्पादन g, kg, ml, L या नग में दर्ज करें।', 'पाककृतीचे नाव आणि मोजलेले वापरण्यायोग्य उत्पादन g, kg, ml, L किंवा नगमध्ये भरा.']),
      step(['Add each ingredient or sub-recipe, its quantity and any extra wastage allowance. Use only measured conversions.', 'हर सामग्री या उप-व्यंजन की मात्रा और अतिरिक्त बर्बादी की छूट दर्ज करें। केवल मापे गए रूपांतरण उपयोग करें।', 'प्रत्येक साहित्य किंवा उपपाककृतीचे प्रमाण आणि अतिरिक्त वाया जाण्याची तरतूद भरा. फक्त मोजलेली रूपांतरे वापरा.']),
      step(['Enter batch preparation minutes if known, review the units, and save the recipe.', 'बैच बनाने का समय पता हो तो मिनट दर्ज करें, इकाइयाँ जाँचें और व्यंजन सहेजें।', 'बॅच बनवण्याचा वेळ माहीत असल्यास मिनिटे भरा, एकके तपासा आणि पाककृती जतन करा.']),
    ],
    result: ['Saving a recipe does not make a batch or use stock. Record actual batches on Daily production, or sell made-to-order items through Orders.', 'व्यंजन सहेजने से बैच नहीं बनता और स्टॉक नहीं घटता। वास्तविक बैच दैनिक उत्पादन में और ऑर्डर पर बने आइटम ऑर्डर में दर्ज करें।', 'पाककृती जतन केल्याने बॅच तयार होत नाही किंवा साठा कमी होत नाही. प्रत्यक्ष बॅच दैनंदिन उत्पादनात आणि मागणीनुसार तयार होणारे पदार्थ ऑर्डरमध्ये नोंदवा.'],
  },
  recipeEdit: {
    description: ['Update the quantities, yield or timing used for future recipe calculations and batches.', 'आगे की लागत गणना और बैच के लिए मात्रा, उत्पादन या समय बदलें।', 'पुढील खर्च गणना आणि बॅचसाठी प्रमाण, उत्पादन किंवा वेळ बदला.'],
    steps: [
      step(['Check every ingredient and sub-recipe quantity against the kitchen’s measured batch.', 'हर सामग्री और उप-व्यंजन की मात्रा रसोई में मापे गए बैच से मिलाएँ।', 'प्रत्येक साहित्य आणि उपपाककृतीचे प्रमाण स्वयंपाकघरात मोजलेल्या बॅचशी जुळवा.']),
      step(['Update usable yield, units, wastage and preparation minutes only when the kitchen process really changes.', 'उपयोग योग्य उत्पादन, इकाइयाँ, बर्बादी और समय तभी बदलें जब रसोई प्रक्रिया वास्तव में बदले।', 'वापरण्यायोग्य उत्पादन, एकके, वाया जाणे आणि वेळ हे स्वयंपाकघराची प्रक्रिया प्रत्यक्ष बदलल्यावरच बदला.']),
      step(['Save, then review the cost breakdown and menu portions. Follow any message about recipes that depend on this one.', 'सहेजें, फिर लागत विवरण और मेनू हिस्से जाँचें। इस पर निर्भर व्यंजनों से जुड़ा संदेश ध्यान से पढ़ें।', 'जतन करा, मग खर्चाचा तपशील व मेनूचे भाग तपासा. यावर अवलंबून असलेल्या पाककृतींबाबतचा संदेश पाळा.']),
    ],
    result: ['Past production and sold orders keep their original snapshots. Saving this form does not change stock.', 'पुराने उत्पादन और बिके ऑर्डर अपनी मूल नोंद रखते हैं। यह फॉर्म सहेजने से स्टॉक नहीं बदलता।', 'जुने उत्पादन आणि विकलेल्या ऑर्डरची मूळ माहिती कायम राहते. हा फॉर्म जतन केल्याने साठा बदलत नाही.'],
  },
  recipeCost: {
    description: ['Understand the ingredient cost and overhead behind one batch and each menu serving.', 'एक बैच और हर मेनू हिस्से की सामग्री लागत तथा अतिरिक्त खर्च समझें।', 'एका बॅचचा आणि प्रत्येक मेनू भागाचा साहित्य खर्च व इतर खर्च समजून घ्या.'],
    steps: [
      step(['Read each ingredient or sub-recipe contribution and check the batch yield used to calculate the serving cost.', 'हर सामग्री या उप-व्यंजन का योगदान पढ़ें और हिस्से की लागत के लिए उपयोग हुआ बैच उत्पादन जाँचें।', 'प्रत्येक साहित्य किंवा उपपाककृतीचा खर्च पहा आणि भागाचा खर्च काढण्यासाठी वापरलेले बॅच उत्पादन तपासा.']),
      step(['Resolve named missing costs with real purchases or opening valuation. Add batch time and hourly rates for complete overhead.', 'बताई गई गुम लागत वास्तविक खरीद या शुरुआती मूल्यांकन से पूरी करें। पूर्ण अतिरिक्त खर्च के लिए बैच समय और प्रति घंटा दर जोड़ें।', 'दाखवलेला गहाळ खर्च प्रत्यक्ष खरेदी किंवा सुरुवातीच्या मूल्यांकनातून भरा. पूर्ण इतर खर्चासाठी बॅच वेळ आणि तासाचे दर जोडा.']),
      step(['Use the what-if price control to preview a supplier price change, then compare portions and selling prices.', 'आपूर्तिकर्ता की कीमत बदलने का असर देखने के लिए अनुमानित कीमत का नियंत्रण उपयोग करें, फिर हिस्से और बिक्री कीमतें मिलाएँ।', 'पुरवठादाराची किंमत बदलल्याचा परिणाम पाहण्यासाठी अंदाज किंमतीचे नियंत्रण वापरा, मग भाग व विक्री किमती तुलना करा.']),
    ],
    result: ['A what-if calculation is only a preview. It does not save a purchase price, change stock or alter old sales.', 'अनुमानित गणना केवल पूर्वावलोकन है। इससे खरीद कीमत सहेजी नहीं जाती, स्टॉक या पुरानी बिक्री नहीं बदलती।', 'अंदाज गणना हे फक्त पूर्वावलोकन आहे. याने खरेदी किंमत जतन होत नाही, साठा किंवा जुनी विक्री बदलत नाही.'],
  },
  recipeMenu: {
    description: ['Turn a recipe into sellable menu servings with an explicit stock method.', 'स्पष्ट स्टॉक तरीके के साथ व्यंजन को बेचने योग्य मेनू हिस्सों में बदलें।', 'साठा वापरण्याची स्पष्ट पद्धत ठरवून पाककृतीचे विक्रीयोग्य मेनू भाग तयार करा.'],
    steps: [
      step(['Give each menu item a name, serving quantity and selling price in rupees.', 'हर मेनू आइटम का नाम, हिस्से की मात्रा और रुपये में बिक्री कीमत भरें।', 'प्रत्येक मेनू पदार्थाचे नाव, भागाचे प्रमाण आणि रुपयांत विक्री किंमत भरा.']),
      step(['Choose prepared stock if you make batches in advance, or made when ordered if the order should consume recipe ingredients.', 'पहले से बैच बनाते हैं तो तैयार स्टॉक चुनें; ऑर्डर पर सामग्री घटनी चाहिए तो ऑर्डर पर बनाया गया चुनें।', 'आधीच बॅच बनवत असल्यास तयार साठा निवडा; ऑर्डरवेळी साहित्य कमी व्हावे असेल तर ऑर्डरनुसार तयार करणे निवडा.']),
      step(['Activate only complete items and save. Prepared items need shelf stock from recorded production before sale.', 'पूरे आइटम ही सक्रिय करें और सहेजें। तैयार आइटम बेचने से पहले दर्ज उत्पादन से तैयार स्टॉक चाहिए।', 'पूर्ण पदार्थच सक्रिय करा आणि जतन करा. तयार पदार्थ विकण्यापूर्वी नोंदवलेल्या उत्पादनातून तयार साठा आवश्यक आहे.']),
    ],
    result: ['Menu changes apply to future orders. Never log manual production again for servings already consumed by a made-to-order sale.', 'मेनू बदलाव आगे के ऑर्डर पर लागू होते हैं। ऑर्डर पर बनी बिक्री में उपयोग हुए हिस्सों का अलग उत्पादन दोबारा दर्ज न करें।', 'मेनू बदल पुढील ऑर्डरना लागू होतात. ऑर्डरनुसार विक्रीत वापरलेल्या भागांचे स्वतंत्र उत्पादन पुन्हा नोंदवू नका.'],
  },
  production: {
    description: ['Record batches actually made and the usable output measured by the kitchen.', 'वास्तव में बने बैच और रसोई द्वारा मापा उपयोग योग्य उत्पादन दर्ज करें।', 'प्रत्यक्ष तयार केलेल्या बॅच आणि स्वयंपाकघरात मोजलेले वापरण्यायोग्य उत्पादन नोंदवा.'],
    steps: [
      step(['Choose the production date and recipe, then enter how many batches were made.', 'उत्पादन की तारीख और व्यंजन चुनें, फिर बने बैच की संख्या भरें।', 'उत्पादनाची तारीख व पाककृती निवडा, मग तयार केलेल्या बॅचची संख्या भरा.']),
      step(['Enter the actual usable output in the shown unit. A completely lost batch can have zero usable output.', 'दिखाई गई इकाई में वास्तविक उपयोग योग्य उत्पादन भरें। पूरी तरह खराब बैच का उपयोग योग्य उत्पादन शून्य हो सकता है।', 'दाखवलेल्या एककात प्रत्यक्ष वापरण्यायोग्य उत्पादन भरा. पूर्ण वाया गेलेल्या बॅचचे वापरण्यायोग्य उत्पादन शून्य असू शकते.']),
      step(['Review material usage and save once. Use Correct this batch only for a recording mistake; later stock activity may block reversal.', 'सामग्री उपयोग जाँचें और एक बार सहेजें। केवल नोंद की गलती पर बैच सुधारें; बाद की स्टॉक गतिविधि उलटना रोक सकती है।', 'साहित्य वापर तपासा आणि एकदाच जतन करा. फक्त नोंदीतील चुकीसाठी बॅच दुरुस्त करा; नंतरची साठा हालचाल उलट नोंद रोखू शकते.']),
    ],
    result: ['Recording uses recipe materials and adds output to a shelf when output stocking is enabled. Made-to-order sales are recorded through Orders instead.', 'नोंद करने पर व्यंजन की सामग्री घटती है और तैयार स्टॉक सक्षम हो तो उत्पादन जुड़ता है। ऑर्डर पर बनी बिक्री ऑर्डर में दर्ज करें।', 'नोंद केल्यावर पाककृतीचे साहित्य कमी होते आणि तयार साठा सुरू असल्यास उत्पादन जमा होते. ऑर्डरनुसार विक्री ऑर्डरमध्ये नोंदवा.'],
  },
  dailyReports: {
    description: ['See what was purchased, produced, used and wasted on a selected cafe working day.', 'चुने गए कैफे कार्यदिवस की खरीद, उत्पादन, उपयोग और बर्बादी देखें।', 'निवडलेल्या कॅफेच्या कामकाजाच्या दिवशीची खरेदी, उत्पादन, वापर आणि वाया गेलेला साठा पहा.'],
    steps: [
      step(['Select the date and show the report. Dates follow India time.', 'तारीख चुनें और रिपोर्ट दिखाएँ। तारीखें भारत के समय के अनुसार हैं।', 'तारीख निवडा आणि अहवाल पहा. तारखा भारताच्या वेळेनुसार असतात.']),
      step(['Filter by recipe when you want one product’s batches and material usage; read purchases and separate wastage in their own sections.', 'एक उत्पाद के बैच और सामग्री उपयोग के लिए व्यंजन चुनें; खरीद और अलग बर्बादी उनके खंडों में पढ़ें।', 'एका पदार्थाच्या बॅच व साहित्य वापरासाठी पाककृती निवडा; खरेदी आणि स्वतंत्र वाया गेलेला साठा त्यांच्या विभागांत पहा.']),
      step(['Compare the report with kitchen and delivery records, then download CSV if you need a copy.', 'रिपोर्ट को रसोई और डिलीवरी नोंद से मिलाएँ, और प्रति चाहिए तो CSV डाउनलोड करें।', 'अहवाल स्वयंपाकघर व डिलिव्हरी नोंदींशी जुळवा आणि प्रत हवी असल्यास CSV डाउनलोड करा.']),
    ],
    result: ['Filters and downloads do not change records. Opening valuation is not a purchase, and reversed batches stay in history but are excluded from effective production totals.', 'फ़िल्टर और डाउनलोड नोंद नहीं बदलते। शुरुआती मूल्यांकन खरीद नहीं है; उलटे बैच इतिहास में रहते हैं लेकिन प्रभावी उत्पादन योग में नहीं जुड़ते।', 'फिल्टर आणि डाउनलोड नोंदी बदलत नाहीत. सुरुवातीचे मूल्यांकन खरेदी नाही; उलट केलेल्या बॅच इतिहासात राहतात पण प्रभावी उत्पादनाच्या एकूणात धरल्या जात नाहीत.'],
  },
  receipt: {
    description: ['Record a real delivery and what the cafe actually paid for its ingredients.', 'वास्तविक डिलीवरी और सामग्री के लिए कैफे द्वारा चुकाई गई रकम दर्ज करें।', 'प्रत्यक्ष डिलिव्हरी आणि साहित्याकरिता कॅफेने दिलेली खरी रक्कम नोंदवा.'],
    steps: [
      step(['Select the ingredient and enter received quantity in its displayed purchase unit.', 'सामग्री चुनें और दिखाई गई खरीद इकाई में प्राप्त मात्रा भरें।', 'साहित्य निवडा आणि दाखवलेल्या खरेदी एककात मिळालेले प्रमाण भरा.']),
      step(['Enter the total amount paid for that line, not a per-kg guess. Add other delivered ingredients as separate lines.', 'उस पंक्ति की कुल चुकाई रकम भरें, अनुमानित प्रति किलो दर नहीं। अन्य प्राप्त सामग्री अलग पंक्तियों में जोड़ें।', 'त्या ओळीची एकूण दिलेली रक्कम भरा, अंदाजे प्रति किलो दर नाही. इतर मिळालेले साहित्य स्वतंत्र ओळींमध्ये जोडा.']),
      step(['Check quantities, totals and any supplier or note, then submit the complete receipt once.', 'मात्रा, कुल रकम और आपूर्तिकर्ता या नोट जाँचें, फिर पूरी रसीद एक बार जमा करें।', 'प्रमाण, एकूण रक्कम आणि पुरवठादार किंवा टिपण तपासा, मग पूर्ण पावती एकदाच नोंदवा.']),
    ],
    result: ['The receipt adds stock and updates weighted-average costs for all its lines together. Enter zero only for an actually free delivery.', 'रसीद सभी पंक्तियों का स्टॉक और भारित औसत लागत साथ में अपडेट करती है। शून्य केवल वास्तव में मुफ्त डिलीवरी के लिए भरें।', 'पावती सर्व ओळींचा साठा आणि भारित सरासरी खर्च एकत्र अद्ययावत करते. शून्य फक्त प्रत्यक्ष मोफत डिलिव्हरीसाठी भरा.'],
  },
  adjustment: {
    description: ['Record a physical-count correction or ingredients genuinely lost or wasted.', 'भौतिक गिनती का सुधार या वास्तव में खोई या बर्बाद हुई सामग्री दर्ज करें।', 'प्रत्यक्ष मोजणीतील दुरुस्ती किंवा खरोखर हरवलेले अथवा वाया गेलेले साहित्य नोंदवा.'],
    steps: [
      step(['Select the ingredient and choose count adjustment or wastage for what actually happened.', 'सामग्री चुनें और वास्तविक घटना के अनुसार गिनती समायोजन या बर्बादी चुनें।', 'साहित्य निवडा आणि प्रत्यक्ष घटनेनुसार मोजणी समायोजन किंवा वाया जाणे निवडा.']),
      step(['Enter the difference to add or remove, not the final shelf balance. For waste, enter the positive amount lost.', 'जोड़ने या घटाने का अंतर भरें, अंतिम स्टॉक नहीं। बर्बादी के लिए खोई मात्रा धनात्मक भरें।', 'वाढवायचा किंवा कमी करायचा फरक भरा, अंतिम शिल्लक नाही. वाया गेलेले प्रमाण धन संख्येत भरा.']),
      step(['Choose the reason, add an explanation and review the direction before saving.', 'कारण चुनें, स्पष्टीकरण जोड़ें और सहेजने से पहले बढ़ाने या घटाने की दिशा जाँचें।', 'कारण निवडा, स्पष्टीकरण जोडा आणि जतन करण्यापूर्वी वाढ किंवा घट करण्याची दिशा तपासा.']),
    ],
    result: ['A new movement corrects quantity and keeps the original history. It does not record a new purchase price.', 'नई नोंद मात्रा सुधारती है और मूल इतिहास रखती है। इससे नई खरीद कीमत दर्ज नहीं होती।', 'नवीन हालचाल प्रमाण दुरुस्त करते आणि मूळ इतिहास ठेवते. याने नवीन खरेदी किंमत नोंदवली जात नाही.'],
  },
  opening: {
    description: ['Set up the verified stock already in the cafe when you start using this software.', 'सॉफ्टवेयर शुरू करते समय कैफे में पहले से मौजूद सत्यापित स्टॉक दर्ज करें।', 'सॉफ्टवेअर सुरू करताना कॅफेमध्ये आधीपासून असलेला पडताळलेला साठा नोंदवा.'],
    steps: [
      step(['Physically count the ingredient and obtain a reliable total value from your existing records.', 'सामग्री की भौतिक गिनती करें और पुरानी नोंद से विश्वसनीय कुल मूल्य लें।', 'साहित्याची प्रत्यक्ष मोजणी करा आणि जुन्या नोंदींमधून विश्वासार्ह एकूण मूल्य मिळवा.']),
      step(['Select the ingredient and enter quantity in its purchase unit plus the total value of that quantity.', 'सामग्री चुनें और खरीद इकाई में मात्रा तथा उस मात्रा का कुल मूल्य भरें।', 'साहित्य निवडा आणि खरेदी एककात प्रमाण तसेच त्या प्रमाणाचे एकूण मूल्य भरा.']),
      step(['If positive stock already exists with unknown value, enter exactly its current quantity to value it without adding stock again.', 'धनात्मक स्टॉक पहले से है पर मूल्य अज्ञात है तो वही मौजूदा मात्रा भरें ताकि दोबारा स्टॉक जोड़े बिना मूल्यांकन हो।', 'धन साठा आधीपासून आहे पण मूल्य अज्ञात असल्यास सध्याचेच प्रमाण भरा, म्हणजे साठा पुन्हा न वाढवता मूल्यांकन होईल.']),
    ],
    result: ['Opening valuation establishes a cost basis without counting as today’s purchase. Correct physical differences separately using Adjustments & waste.', 'शुरुआती मूल्यांकन आज की खरीद में गिने बिना लागत आधार देता है। भौतिक अंतर अलग से समायोजन व बर्बादी में सुधारें।', 'सुरुवातीचे मूल्यांकन आजची खरेदी न मानता खर्चाचा आधार देते. प्रत्यक्ष फरक स्वतंत्रपणे समायोजन व वाया गेलेला साठा येथे दुरुस्त करा.'],
  },
  history: {
    description: ['Trace every saved stock movement and the balance it contributed to.', 'हर सहेजी गई स्टॉक नोंद और उससे बनी शेष मात्रा देखें।', 'प्रत्येक जतन केलेली साठा हालचाल आणि त्यामुळे तयार झालेली शिल्लक पहा.'],
    steps: [
      step(['Choose an ingredient, date range or movement type, then apply the filters.', 'सामग्री, तारीख अवधि या नोंद का प्रकार चुनें, फिर फ़िल्टर लागू करें।', 'साहित्य, तारीख कालावधी किंवा हालचालीचा प्रकार निवडा, मग फिल्टर लागू करा.']),
      step(['Read the quantity, time, staff member and reference to understand why stock changed.', 'स्टॉक क्यों बदला समझने के लिए मात्रा, समय, कर्मचारी और संदर्भ पढ़ें।', 'साठा का बदलला हे समजण्यासाठी प्रमाण, वेळ, कर्मचारी व संदर्भ वाचा.']),
      step(['Use the running balance to investigate differences; a filtered date range does not restart stock at zero.', 'अंतर जाँचने के लिए चलती शेष मात्रा देखें; फ़िल्टर की तारीख अवधि स्टॉक को शून्य से शुरू नहीं करती।', 'फरक तपासण्यासाठी चालू शिल्लक पहा; फिल्टर केलेला कालावधी साठा शून्यापासून सुरू करत नाही.']),
    ],
    result: ['This page is read-only. Fix mistakes with a new correction or an eligible batch reversal, rather than editing a historical row.', 'यह पृष्ठ केवल देखने के लिए है। पुरानी पंक्ति बदलने के बजाय नई सुधार नोंद या अनुमत बैच उलट नोंद करें।', 'हे पान फक्त पाहण्यासाठी आहे. जुनी ओळ बदलण्याऐवजी नवीन दुरुस्ती किंवा पात्र बॅचची उलट नोंद करा.'],
  },
  lowStock: {
    description: ['Find ingredients at or below their reorder threshold before they run out.', 'सामग्री खत्म होने से पहले पुनः खरीद सीमा पर या नीचे का स्टॉक देखें।', 'साहित्य संपण्यापूर्वी पुनर्खरेदी मर्यादेवर किंवा त्याखाली असलेला साठा पहा.'],
    steps: [
      step(['Compare current stock with the threshold and check the physical shelf before ordering.', 'ऑर्डर देने से पहले मौजूदा स्टॉक को सीमा से मिलाएँ और वास्तविक स्टॉक जाँचें।', 'खरेदी मागवण्यापूर्वी सध्याचा साठा मर्यादेशी तुलना करा आणि प्रत्यक्ष साठा तपासा.']),
      step(['Arrange the needed purchase, then record the delivery under Stock receipts when it actually arrives.', 'ज़रूरी खरीद का इंतज़ाम करें और वास्तव में आने पर डिलीवरी स्टॉक रसीद में दर्ज करें।', 'आवश्यक खरेदीची व्यवस्था करा आणि प्रत्यक्ष डिलिव्हरी आल्यानंतर ती साठा पावतीमध्ये नोंदवा.']),
      step(['If the threshold is unsuitable, edit it on the ingredient instead of entering a fake receipt.', 'सीमा उपयुक्त न हो तो नकली रसीद दर्ज करने के बजाय सामग्री में सीमा बदलें।', 'मर्यादा योग्य नसल्यास खोटी पावती नोंदवण्याऐवजी साहित्यामध्ये मर्यादा बदला.'], managers),
    ],
    result: ['This list does not place supplier orders or add stock. It refreshes from recorded quantities and thresholds.', 'यह सूची आपूर्तिकर्ता को ऑर्डर नहीं भेजती और स्टॉक नहीं जोड़ती। यह दर्ज मात्रा और सीमा से बनती है।', 'ही यादी पुरवठादाराकडे ऑर्डर देत नाही किंवा साठा वाढवत नाही. ती नोंदवलेले प्रमाण व मर्यादेवर आधारित असते.'],
  },
  orders: {
    description: ['Find customer orders and see their preparation and payment progress.', 'ग्राहक ऑर्डर खोजें और उनकी तैयारी व भुगतान की स्थिति देखें।', 'ग्राहक ऑर्डर शोधा आणि त्यांची तयारी व देयकाची स्थिती पहा.'],
    steps: [
      step(['Select the date range or status filters to locate the orders you need.', 'आवश्यक ऑर्डर खोजने के लिए तारीख अवधि या स्थिति के फ़िल्टर चुनें।', 'हवे असलेले ऑर्डर शोधण्यासाठी तारीख कालावधी किंवा स्थितीचे फिल्टर निवडा.']),
      step(['Open an order to inspect its items, saved bill, preparation events and recorded payments.', 'आइटम, सहेजा बिल, तैयारी की घटनाएँ और दर्ज भुगतान देखने के लिए ऑर्डर खोलें।', 'पदार्थ, जतन केलेले बिल, तयारीच्या घटना आणि नोंदवलेली देयके पाहण्यासाठी ऑर्डर उघडा.']),
      step(['Use New order for a new sale. Do not create a second order just to record payment for an existing one.', 'नई बिक्री के लिए नया ऑर्डर उपयोग करें। मौजूदा ऑर्डर का भुगतान दर्ज करने के लिए दूसरा ऑर्डर न बनाएँ।', 'नवीन विक्रीसाठी नवीन ऑर्डर वापरा. जुन्या ऑर्डरचे देयक नोंदवण्यासाठी दुसरी ऑर्डर तयार करू नका.']),
    ],
    result: ['Browsing and filtering do not consume stock. Stock is deducted when an order is confirmed.', 'देखने और फ़िल्टर करने से स्टॉक नहीं घटता। ऑर्डर पक्का होने पर स्टॉक घटता है।', 'पाहिल्याने किंवा फिल्टर केल्याने साठा कमी होत नाही. ऑर्डर पक्की केल्यावर साठा कमी होतो.'],
  },
  orderNew: {
    description: ['Create a real sale and choose how the customer will receive it.', 'वास्तविक बिक्री बनाएँ और ग्राहक को मिलने का तरीका चुनें।', 'प्रत्यक्ष विक्री नोंदवा आणि ग्राहकाला पदार्थ मिळण्याची पद्धत निवडा.'],
    steps: [
      step(['Choose dine-in, takeaway or delivery; add menu items and serving counts. Delivery needs contact and address.', 'कैफे में खाना, साथ ले जाना या डिलीवरी चुनें; मेनू आइटम और संख्या जोड़ें। डिलीवरी में संपर्क और पता ज़रूरी है।', 'कॅफेमध्ये खाणे, सोबत नेणे किंवा डिलिव्हरी निवडा; मेनू पदार्थ व संख्या जोडा. डिलिव्हरीसाठी संपर्क व पत्ता आवश्यक आहे.']),
      step(['Check the items, subtotal, tax and final total. Ask an owner or manager to complete any missing menu or tax setup.', 'आइटम, उप-योग, कर और अंतिम रकम जाँचें। अधूरी मेनू या कर सेटिंग के लिए मालिक या प्रबंधक से कहें।', 'पदार्थ, उपएकूण, कर आणि अंतिम रक्कम तपासा. अपूर्ण मेनू किंवा कर सेटिंगसाठी मालक किंवा व्यवस्थापकाला सांगा.']),
      step(['Choose unpaid unless money has already arrived. Confirm once and open the resulting order for its bill and tracking link.', 'पैसे मिल चुके हों तभी भुगतान चुनें, वरना बकाया रखें। एक बार पक्का करें और बिल व ट्रैकिंग लिंक के लिए बना ऑर्डर खोलें।', 'पैसे आधीच मिळाले असल्यासच देयक निवडा, नाहीतर बाकी ठेवा. एकदाच पक्की करा आणि बिल व ट्रॅकिंग दुव्यासाठी तयार ऑर्डर उघडा.']),
    ],
    result: ['Confirmation saves the bill and consumes prepared stock or recipe ingredients once. Payment selection records money received elsewhere; it does not charge the customer.', 'पक्का करने से बिल सहेजता है और तैयार स्टॉक या सामग्री एक बार घटती है। भुगतान चयन पहले मिले पैसे दर्ज करता है; ग्राहक से रकम नहीं काटता।', 'पक्की केल्याने बिल जतन होते आणि तयार साठा किंवा साहित्य एकदाच कमी होते. देयक निवड आधी मिळालेली रक्कम नोंदवते; ग्राहकाकडून पैसे घेत नाही.'],
  },
  orderDetail: {
    description: ['Manage this saved order, its bill, preparation progress and payments.', 'इस सहेजे ऑर्डर का बिल, तैयारी की स्थिति और भुगतान सँभालें।', 'या जतन केलेल्या ऑर्डरचे बिल, तयारीची स्थिती आणि देयके सांभाळा.'],
    steps: [
      step(['Check the saved items and balance. Print the bill or copy the private tracking link for the customer.', 'सहेजे आइटम और बकाया जाँचें। बिल छापें या ग्राहक के लिए निजी ट्रैकिंग लिंक कॉपी करें।', 'जतन केलेले पदार्थ आणि बाकी रक्कम तपासा. बिल छापा किंवा ग्राहकासाठी खाजगी ट्रॅकिंग दुवा कॉपी करा.']),
      step(['Advance preparation to the stage actually reached. Record an additional payment only after receiving it.', 'तैयारी की वास्तविक स्थिति दर्ज करें। अतिरिक्त भुगतान मिलने के बाद ही उसकी नोंद करें।', 'तयारीची प्रत्यक्ष गाठलेली पायरी नोंदवा. अतिरिक्त पैसे मिळाल्यानंतरच देयक नोंदवा.']),
      step(['For cancellation, enter the real reason. Stock can be restored before preparation; after preparation starts, materials remain used.', 'रद्द करने पर वास्तविक कारण दें। तैयारी से पहले स्टॉक लौट सकता है; तैयारी शुरू होने के बाद सामग्री उपयोग में रहती है।', 'रद्द करताना खरे कारण भरा. तयारीपूर्वी साठा परत मिळू शकतो; तयारी सुरू झाल्यावर साहित्य वापरलेलेच राहते.']),
      step(['Record a refund only after returning the money outside the app, and check its payment history.', 'ऐप के बाहर पैसे लौटाने के बाद ही रिफंड दर्ज करें और भुगतान इतिहास जाँचें।', 'अॅपबाहेर पैसे परत दिल्यानंतरच परतावा नोंदवा आणि देयक इतिहास तपासा.'], managers),
    ],
    result: ['Status changes do not deduct ingredients again. Old bill prices and costs remain the values saved at confirmation.', 'स्थिति बदलने से सामग्री दोबारा नहीं घटती। पुराने बिल की कीमतें और लागत पक्का करते समय सहेजी गई रहती हैं।', 'स्थिती बदलल्याने साहित्य पुन्हा कमी होत नाही. जुन्या बिलाच्या किमती व खर्च पक्की करताना जतन केलेलेच राहतात.'],
  },
  kitchen: {
    description: ['See the orders that need preparation and keep their progress accurate for the team.', 'तैयार किए जाने वाले ऑर्डर देखें और टीम के लिए सही स्थिति रखें।', 'तयार करायच्या ऑर्डर पहा आणि टीमसाठी त्यांची स्थिती अचूक ठेवा.'],
    steps: [
      step(['Read the order number, type, items and counts before starting preparation.', 'तैयारी से पहले ऑर्डर नंबर, प्रकार, आइटम और संख्या पढ़ें।', 'तयारी सुरू करण्यापूर्वी ऑर्डर क्रमांक, प्रकार, पदार्थ आणि संख्या वाचा.']),
      step(['Use the next status button only when the kitchen actually reaches that stage.', 'अगली स्थिति का बटन तभी दबाएँ जब रसोई वास्तव में उस चरण पर पहुँचे।', 'स्वयंपाकघर प्रत्यक्ष त्या टप्प्यावर पोहोचल्यावरच पुढील स्थितीचे बटण दाबा.']),
      step(['Mark ready when the food is ready to hand over. Let the counter handle customer questions or cancellations.', 'खाना देने योग्य हो तभी तैयार चिन्हित करें। ग्राहक प्रश्न या रद्दीकरण काउंटर को सँभालने दें।', 'पदार्थ देण्यासाठी तयार झाल्यावरच तयार म्हणून नोंदवा. ग्राहकांचे प्रश्न किंवा रद्दीकरण काउंटरला हाताळू द्या.']),
    ],
    result: ['The board refreshes automatically and updates customer tracking. Changing a stage does not create another batch or deduct stock again.', 'बोर्ड अपने आप ताज़ा होता है और ग्राहक ट्रैकिंग बदलती है। चरण बदलने से नया बैच नहीं बनता या स्टॉक दोबारा नहीं घटता।', 'फलक आपोआप ताजा होतो आणि ग्राहक ट्रॅकिंग बदलते. टप्पा बदलल्याने दुसरी बॅच तयार होत नाही किंवा साठा पुन्हा कमी होत नाही.'],
  },
  salesReport: {
    description: ['Review completed sales, recorded material margins and payment activity for a date range.', 'तारीख अवधि की पूरी बिक्री, दर्ज सामग्री मार्जिन और भुगतान गतिविधि देखें।', 'निवडलेल्या कालावधीतील पूर्ण विक्री, नोंदवलेला साहित्य नफा आणि देयक हालचाली पहा.'],
    steps: [
      step(['Choose the start and end dates, or use Today, Last 7 days or This month.', 'शुरू और अंत की तारीख चुनें, या आज, पिछले 7 दिन या इस महीने का विकल्प लें।', 'सुरुवात व शेवटची तारीख निवडा, किंवा आज, मागील 7 दिवस किंवा या महिन्याचा पर्याय वापरा.']),
      step(['Compare servings, revenue and saved material costs by item. Unknown cost means the margin is not yet known.', 'आइटम के अनुसार हिस्से, आय और सहेजी सामग्री लागत मिलाएँ। अज्ञात लागत का मतलब मार्जिन अभी अज्ञात है।', 'पदार्थानुसार भाग, उत्पन्न आणि जतन केलेला साहित्य खर्च तुलना करा. अज्ञात खर्च म्हणजे नफा अजून अज्ञात आहे.']),
      step(['Read payments, refunds and cancellations separately, then download CSV for review or reconciliation.', 'भुगतान, रिफंड और रद्दीकरण अलग पढ़ें, फिर समीक्षा या मिलान के लिए CSV डाउनलोड करें।', 'देयके, परतावे आणि रद्दीकरण स्वतंत्र पहा, मग पुनरावलोकन किंवा जुळवणीसाठी CSV डाउनलोड करा.']),
    ],
    result: ['Sales use completed orders grouped by creation date and exclude tax. Material margins are before refunds, labour and overhead; payment totals use their own recording dates.', 'बिक्री में बनाए जाने की तारीख के अनुसार पूरे ऑर्डर गिने जाते हैं और कर शामिल नहीं है। सामग्री मार्जिन रिफंड, श्रम व अतिरिक्त खर्च से पहले है; भुगतान अपनी नोंद की तारीख से गिने जाते हैं।', 'विक्रीमध्ये तयार केल्याच्या तारखेनुसार पूर्ण ऑर्डर मोजल्या जातात आणि कर वगळला जातो. साहित्य नफा परतावे, मजुरी व इतर खर्चापूर्वीचा आहे; देयकांची बेरीज त्यांच्या नोंदीच्या तारखेनुसार होते.'],
  },
  staff: {
    description: ['Give each staff member their own account and only the access their work requires.', 'हर कर्मचारी को अपना खाता और काम के लिए आवश्यक अनुमति दें।', 'प्रत्येक कर्मचाऱ्याला स्वतःचे खाते आणि कामासाठी आवश्यक तेवढाच प्रवेश द्या.'],
    steps: [
      step(['Review existing staff first. Reactivate a returning person instead of creating a duplicate account.', 'पहले मौजूदा कर्मचारी देखें। लौटने वाले व्यक्ति का नया खाता बनाने के बजाय पुराना सक्रिय करें।', 'आधी सध्याचे कर्मचारी पहा. परत आलेल्या व्यक्तीसाठी दुसरे खाते तयार करण्याऐवजी जुने सक्रिय करा.']),
      step(['Add the person’s name, email, role and a private password. Owners alone can grant or manage another owner’s access.', 'नाम, ईमेल, भूमिका और निजी पासवर्ड जोड़ें। दूसरे मालिक की अनुमति केवल मालिक दे या बदल सकते हैं।', 'नाव, ईमेल, भूमिका आणि खाजगी पासवर्ड भरा. दुसऱ्या मालकाचा प्रवेश फक्त मालकच देऊ किंवा बदलू शकतो.']),
      step(['Deactivate leavers promptly. Use the staff password reset for a forgotten password, and share the new password privately.', 'काम छोड़ने वालों को तुरंत निष्क्रिय करें। भूले पासवर्ड के लिए कर्मचारी पासवर्ड रीसेट करें और नया पासवर्ड निजी रूप से दें।', 'काम सोडलेल्यांचे खाते लगेच निष्क्रिय करा. विसरलेल्या पासवर्डसाठी कर्मचारी पासवर्ड रीसेट करा आणि नवीन पासवर्ड खाजगीपणे द्या.']),
    ],
    result: ['Deactivation and password resets revoke that person’s sessions. Their past purchases, batches and other records remain attributed to them.', 'निष्क्रिय करने और पासवर्ड रीसेट से उस व्यक्ति के सत्र रद्द होते हैं। पिछली खरीद, बैच और अन्य नोंद उन्हीं के नाम रहती हैं।', 'निष्क्रिय करणे आणि पासवर्ड रीसेट केल्याने त्या व्यक्तीची सत्रे रद्द होतात. त्यांची जुनी खरेदी, बॅच व इतर नोंदी त्यांच्याच नावाने राहतात.'],
  },
  password: {
    description: ['Change your own sign-in password without changing another staff account.', 'दूसरे कर्मचारी खाते को बदले बिना अपना साइन इन पासवर्ड बदलें।', 'दुसऱ्या कर्मचारी खात्यात बदल न करता स्वतःचा साइन इन पासवर्ड बदला.'],
    steps: [
      step(['Enter your current password so the app can verify the change is yours.', 'मौजूदा पासवर्ड दर्ज करें ताकि ऐप बदलाव आपका होने की पुष्टि कर सके।', 'सध्याचा पासवर्ड भरा म्हणजे बदल तुम्हीच करत आहात याची अॅप खात्री करू शकेल.']),
      step(['Choose a new private password and enter the same value in the confirmation box.', 'नया निजी पासवर्ड चुनें और पुष्टि वाले बॉक्स में वही दोबारा भरें।', 'नवीन खाजगी पासवर्ड निवडा आणि पुष्टीच्या चौकटीत तोच पुन्हा भरा.']),
      step(['Save the change, then sign in again using the new password.', 'बदलाव सहेजें, फिर नए पासवर्ड से दोबारा साइन इन करें।', 'बदल जतन करा, मग नवीन पासवर्डने पुन्हा साइन इन करा.']),
    ],
    result: ['Changing your password signs out your existing sessions. If you forgot it, ask an owner or manager for a staff password reset.', 'पासवर्ड बदलने से आपके मौजूदा सत्र साइन आउट होते हैं। पासवर्ड भूलने पर मालिक या प्रबंधक से रीसेट करवाएँ।', 'पासवर्ड बदलल्याने तुमची सध्याची सत्रे साइन आउट होतात. तो विसरल्यास मालक किंवा व्यवस्थापकाला रीसेट करण्यास सांगा.'],
  },
  costingSettings: {
    description: ['Set hourly labour and kitchen rates so recipe costs can include preparation time.', 'प्रति घंटा श्रम और रसोई दर तय करें ताकि व्यंजन लागत में तैयारी का समय जुड़ सके।', 'तासाची मजुरी आणि स्वयंपाकघराचे दर ठरवा म्हणजे पाककृती खर्चात तयारीचा वेळ धरता येईल.'],
    steps: [
      step(['Work out the cafe’s actual labour cost per hour and kitchen cost per hour from its own records.', 'कैफे की अपनी नोंद से प्रति घंटा वास्तविक श्रम और रसोई लागत निकालें।', 'कॅफेच्या स्वतःच्या नोंदींवरून प्रतितास प्रत्यक्ष मजुरी व स्वयंपाकघर खर्च काढा.']),
      step(['Enter both rates in rupees per hour. Leave unknown rates blank; enter zero only when the rate is genuinely free.', 'दोनों दर रुपये प्रति घंटा में भरें। अज्ञात दर खाली रखें; दर वास्तव में मुफ्त हो तभी शून्य दें।', 'दोन्ही दर रुपये प्रतितास भरा. अज्ञात दर रिकामे ठेवा; खर्च खरोखर मोफत असेल तेव्हाच शून्य भरा.']),
      step(['Save, then add measured batch minutes to the recipes you want to cost fully.', 'सहेजें, फिर पूर्ण लागत के लिए व्यंजनों में मापा गया बैच समय मिनट में जोड़ें।', 'जतन करा, मग पूर्ण खर्चासाठी पाककृतींमध्ये मोजलेला बॅच वेळ मिनिटांत भरा.']),
    ],
    result: ['New recipe calculations allocate hourly costs by batch time and usable yield. Missing rates or timing stay visibly incomplete.', 'नई व्यंजन गणना घंटे की लागत को बैच समय और उपयोग योग्य उत्पादन से बाँटती है। गुम दर या समय स्पष्ट रूप से अपूर्ण रहते हैं।', 'नवीन पाककृती गणना तासाचा खर्च बॅच वेळ व वापरण्यायोग्य उत्पादनानुसार वाटते. नसलेले दर किंवा वेळ स्पष्टपणे अपूर्ण राहतात.'],
  },
  salesSettings: {
    description: ['Tell the app how the cafe’s verified tax treatment should apply to new orders.', 'बताएँ कि कैफे की सत्यापित कर व्यवस्था नए ऑर्डर पर कैसे लागू होगी।', 'कॅफेची पडताळलेली कर पद्धत नवीन ऑर्डरना कशी लागू होईल ते ठरवा.'],
    steps: [
      step(['Confirm the correct tax treatment and rate with the person responsible for the cafe’s accounts.', 'कैफे के खातों के ज़िम्मेदार व्यक्ति से सही कर व्यवस्था और दर की पुष्टि करें।', 'कॅफेच्या हिशेबासाठी जबाबदार व्यक्तीकडून योग्य कर पद्धत व दर निश्चित करा.']),
      step(['Choose no tax, tax added to menu prices, or tax already included in menu prices, as appropriate.', 'लागू अनुसार बिना कर, मेनू कीमत पर अतिरिक्त कर या मेनू कीमत में शामिल कर चुनें।', 'लागू असल्याप्रमाणे कर नाही, मेनू किमतीवर अतिरिक्त कर किंवा मेनू किमतीत आधीच समाविष्ट कर निवडा.']),
      step(['Enter the verified percentage if needed and save before taking the first order.', 'ज़रूरत हो तो सत्यापित प्रतिशत भरें और पहला ऑर्डर लेने से पहले सहेजें।', 'गरज असल्यास पडताळलेली टक्केवारी भरा आणि पहिली ऑर्डर घेण्यापूर्वी जतन करा.']),
    ],
    result: ['This setting affects new orders only. Existing bills keep their original tax; the software does not choose a tax rate for the cafe.', 'यह सेटिंग केवल नए ऑर्डर पर लागू होती है। पुराने बिल का कर वैसा रहता है; सॉफ्टवेयर कैफे के लिए कर दर नहीं चुनता।', 'ही सेटिंग फक्त नवीन ऑर्डरना लागू होते. जुन्या बिलाचा कर कायम राहतो; सॉफ्टवेअर कॅफेसाठी कर दर निवडत नाही.'],
  },
  tracking: {
    description: ['Use this private link to follow the preparation of your order.', 'अपने ऑर्डर की तैयारी देखने के लिए इस निजी लिंक का उपयोग करें।', 'तुमच्या ऑर्डरची तयारी पाहण्यासाठी हा खाजगी दुवा वापरा.'],
    steps: [
      step(['Check the order number and items to make sure this is your order.', 'ऑर्डर नंबर और आइटम जाँचें ताकि यह आपका ऑर्डर हो।', 'ऑर्डर क्रमांक व पदार्थ तपासून ही तुमचीच ऑर्डर असल्याची खात्री करा.']),
      step(['Read the current status and progress below. This page refreshes as the cafe records new preparation stages.', 'नीचे मौजूदा स्थिति और प्रगति देखें। कैफे तैयारी के चरण दर्ज करता है तो पृष्ठ ताज़ा होता है।', 'खाली सध्याची स्थिती व प्रगती पहा. कॅफे तयारीचे नवीन टप्पे नोंदवते तसे हे पान ताजे होते.']),
      step(['Keep the link private. Contact the cafe directly for a change, cancellation or payment question.', 'लिंक निजी रखें। बदलाव, रद्दीकरण या भुगतान के सवाल के लिए सीधे कैफे से संपर्क करें।', 'दुवा खाजगी ठेवा. बदल, रद्दीकरण किंवा देयकाबाबत प्रश्नासाठी कॅफेशी थेट संपर्क करा.']),
    ],
    result: ['Viewing tracking does not change the order or make a payment. Anyone with this link can view its preparation progress.', 'ट्रैकिंग देखने से ऑर्डर नहीं बदलता या भुगतान नहीं होता। लिंक रखने वाला कोई भी तैयारी की प्रगति देख सकता है।', 'ट्रॅकिंग पाहिल्याने ऑर्डर बदलत नाही किंवा देयक दिले जात नाही. हा दुवा असलेली कोणतीही व्यक्ती तयारीची प्रगती पाहू शकते.'],
  },
} satisfies Record<string, Tutorial>;

export type TutorialTopic = keyof typeof pageTutorials;

/** Role-specific steps are omitted, including from rendered page markup. */
export function getPageTutorial(topic: TutorialTopic, role?: Role) {
  const guide: Tutorial = pageTutorials[topic];
  return {
    description: guide.description[0],
    steps: guide.steps.filter(item => !item.roles || (role && item.roles.includes(role))).map(item => item.text[0]),
    result: guide.result[0],
  };
}

const labels: readonly Text[] = [
  ['How this page works', 'यह पृष्ठ कैसे काम करता है', 'हे पान कसे वापरावे'],
  ['Step-by-step guide', 'चरण-दर-चरण मार्गदर्शिका', 'टप्प्याटप्प्याने मार्गदर्शन'],
  ['What happens next', 'आगे क्या होता है', 'पुढे काय होते'],
];
const texts = [...labels, ...Object.values(pageTutorials).flatMap(guide => [guide.description, ...guide.steps.map(item => item.text), guide.result])];
export const tutorialMessages: Readonly<Record<string, readonly [string, string]>> = Object.fromEntries(texts.map(([en, hi, mr]) => [en, [hi, mr] as const]));

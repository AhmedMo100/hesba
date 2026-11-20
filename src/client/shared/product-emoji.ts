/**
 * @file product-emoji.ts
 * @description The emoji a product's tile shows (V19 gives every product its own: 🥤 🥖 🧀).
 * Products carry no emoji of their own here, so it comes from what the product is — its name
 * and category — and then from how it is sold (a jar, a can, a bag, a carton); the scale is
 * only the last resort for weighed goods. Pure.
 */

const BY_WORD: Array<[RegExp, string]> = [
  [/لبنة/, "🫙"],
  [/جبن|جبنة|رومي|شيدر|موتزاريلا/, "🧀"],
  [/زبادي|لبن|حليب|ألبان|الألبان/, "🥛"],
  [/عيش|خبز|رغيف|توست|مخبوز/, "🥖"],
  [/بيض/, "🥚"],
  [/مياه|مية |ماء/, "💧"],
  [/عصير/, "🧃"],
  [/شاي|قهوة|نسكافيه|كابتشينو|مشروبات ساخنة/, "☕"],
  [/كوكا|كولا|بيبسي|سفن|سبرايت|فانتا|غاز|مشروب/, "🥤"],
  [/شيبس|شيبسي|مقرمش|تسالي|سناك|فشار/, "🥔"],
  [/بسكويت|ويفر|كيك|كوكيز/, "🍪"],
  [/عسل/, "🍯"],
  [/شوكولا|حلوي|حلاوة|مربى/, "🍫"],
  [/مكرونة|اسباجتي|معكرونة/, "🍝"],
  [/أرز|رز|حبوب/, "🍚"],
  [/سكر|ملح|دقيق/, "🍚"],
  [/فول|عدس|بقول|فاصوليا|حمص/, "🫘"],
  [/زيت|سمن|خل/, "🫗"],
  [/تونة|سردين|معلب|صلص|كاتشب|مايونيز/, "🥫"],
  [/توابل|بهار|كمون|فلفل/, "🌶️"],
  [/صابون|شامبو|معجون|عناية شخصية|مزيل/, "🧼"],
  [/منظف|مسحوق|غسيل|كلور|صابون سائل|أطباق/, "🧴"],
  [/مناديل|ورق تواليت|كلينكس/, "🧻"],
  [/مجمد|لحم|لحوم|فراخ|دجاج|سجق|برجر|لانشون/, "🍗"],
  [/أطفال|حفاض|بامبرز|رضع/, "🍼"],
  [/سجائر|سجاير|دخان|معسل/, "🚬"],
  [/خضار|فاكه|طماطم|بطاطس|بصل|موز|تفاح/, "🥕"],
  [/كارت|شحن/, "📱"],
];

const BY_UNIT: Record<string, string> = {
  برطمان: "🫙",
  jar: "🫙",
  علبة: "🥫",
  can: "🥫",
  كيس: "🛍️",
  bag: "🛍️",
  كرتونة: "📦",
  carton: "📦",
  طبق: "🥚",
};

export function productEmoji(p: {
  name?: string | null;
  category?: string | null;
  unit?: string | null;
  weighed?: boolean;
}): string {
  const text = `${p.name ?? ""} ${p.category ?? ""}`;
  for (const [re, em] of BY_WORD) if (re.test(text)) return em;
  const byUnit = BY_UNIT[(p.unit ?? "").trim()];
  if (byUnit) return byUnit;
  if (p.weighed || p.unit === "kg" || p.unit === "g") return "⚖️";
  return "📦";
}

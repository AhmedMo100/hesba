import { PrismaClient } from "@prisma/client";
import { normalizeArabic } from "../src/domain/normalize";

const directUrl =
  process.env.HESBA_DIRECT_URL ||
  process.env.DIRECT_URL ||
  process.env.DATABASE_URL;

const prisma = new PrismaClient({
  datasourceUrl: directUrl,
});

const TELECOM_BRANDS = [
  { nameAr: "فودافون", nameEn: "Vodafone" },
  { nameAr: "أورانج", nameEn: "Orange" },
  { nameAr: "اتصالات", nameEn: "Etisalat" },
  { nameAr: "وي", nameEn: "WE" },
  { nameAr: "إنستاباي", nameEn: "InstaPay" },
  { nameAr: "شركة الكهرباء", nameEn: "Electricity Company" },
  { nameAr: "شركة مياه الشرب", nameEn: "Water Company" },
];

const TELECOM_PRODUCTS = [
  // كروت شحن (Prepaid cards)
  {
    brandAr: "فودافون",
    nameAr: "كارت شحن فودافون فكة 10",
    category: "كروت شحن",
    type: "prepaid" as const,
    flavor: "فكة 10",
    sellPricePiasters: 1100,
    buyCostPiasters: 1050,
  },
  {
    brandAr: "فودافون",
    nameAr: "كارت شحن فودافون 25",
    category: "كروت شحن",
    type: "prepaid" as const,
    flavor: "فئة 25",
    sellPricePiasters: 2800,
    buyCostPiasters: 2650,
  },
  {
    brandAr: "فودافون",
    nameAr: "كارت شحن فودافون 50",
    category: "كروت شحن",
    type: "prepaid" as const,
    flavor: "فئة 50",
    sellPricePiasters: 5600,
    buyCostPiasters: 5300,
  },
  {
    brandAr: "فودافون",
    nameAr: "كارت شحن فودافون 100",
    category: "كروت شحن",
    type: "prepaid" as const,
    flavor: "فئة 100",
    sellPricePiasters: 11200,
    buyCostPiasters: 10600,
  },
  {
    brandAr: "أورانج",
    nameAr: "كارت شحن أورانج أحسن ناس 10",
    category: "كروت شحن",
    type: "prepaid" as const,
    flavor: "أحسن ناس 10",
    sellPricePiasters: 1100,
    buyCostPiasters: 1050,
  },
  {
    brandAr: "أورانج",
    nameAr: "كارت شحن أورانج 25",
    category: "كروت شحن",
    type: "prepaid" as const,
    flavor: "فئة 25",
    sellPricePiasters: 2800,
    buyCostPiasters: 2650,
  },
  {
    brandAr: "أورانج",
    nameAr: "كارت شحن أورانج 50",
    category: "كروت شحن",
    type: "prepaid" as const,
    flavor: "فئة 50",
    sellPricePiasters: 5600,
    buyCostPiasters: 5300,
  },
  {
    brandAr: "أورانج",
    nameAr: "كارت شحن أورانج 100",
    category: "كروت شحن",
    type: "prepaid" as const,
    flavor: "فئة 100",
    sellPricePiasters: 11200,
    buyCostPiasters: 10600,
  },
  {
    brandAr: "اتصالات",
    nameAr: "كارت شحن اتصالات حكاية 10",
    category: "كروت شحن",
    type: "prepaid" as const,
    flavor: "حكاية 10",
    sellPricePiasters: 1100,
    buyCostPiasters: 1050,
  },
  {
    brandAr: "اتصالات",
    nameAr: "كارت شحن اتصالات 25",
    category: "كروت شحن",
    type: "prepaid" as const,
    flavor: "فئة 25",
    sellPricePiasters: 2800,
    buyCostPiasters: 2650,
  },
  {
    brandAr: "اتصالات",
    nameAr: "كارت شحن اتصالات 50",
    category: "كروت شحن",
    type: "prepaid" as const,
    flavor: "فئة 50",
    sellPricePiasters: 5600,
    buyCostPiasters: 5300,
  },
  {
    brandAr: "اتصالات",
    nameAr: "كارت شحن اتصالات 100",
    category: "كروت شحن",
    type: "prepaid" as const,
    flavor: "فئة 100",
    sellPricePiasters: 11200,
    buyCostPiasters: 10600,
  },
  {
    brandAr: "وي",
    nameAr: "كارت شحن وي فكة 10",
    category: "كروت شحن",
    type: "prepaid" as const,
    flavor: "فكة 10",
    sellPricePiasters: 1100,
    buyCostPiasters: 1050,
  },
  {
    brandAr: "وي",
    nameAr: "كارت شحن وي 25",
    category: "كروت شحن",
    type: "prepaid" as const,
    flavor: "فئة 25",
    sellPricePiasters: 2800,
    buyCostPiasters: 2650,
  },
  {
    brandAr: "وي",
    nameAr: "كارت شحن وي 50",
    category: "كروت شحن",
    type: "prepaid" as const,
    flavor: "فئة 50",
    sellPricePiasters: 5600,
    buyCostPiasters: 5300,
  },
  {
    brandAr: "وي",
    nameAr: "كارت شحن وي 100",
    category: "كروت شحن",
    type: "prepaid" as const,
    flavor: "فئة 100",
    sellPricePiasters: 11200,
    buyCostPiasters: 10600,
  },

  // فواتير إنترنت (Internet bills)
  {
    brandAr: "وي",
    nameAr: "دفع فاتورة إنترنت منزلي وي",
    category: "فواتير إنترنت",
    type: "service" as const,
    flavor: "سداد فاتورة",
    sellPricePiasters: 500, // 5.00 EGP commission
    buyCostPiasters: 0,
  },
  {
    brandAr: "أورانج",
    nameAr: "دفع فاتورة إنترنت منزلي أورانج",
    category: "فواتير إنترنت",
    type: "service" as const,
    flavor: "سداد فاتورة",
    sellPricePiasters: 500,
    buyCostPiasters: 0,
  },
  {
    brandAr: "فودافون",
    nameAr: "دفع فاتورة إنترنت منزلي فودافون",
    category: "فواتير إنترنت",
    type: "service" as const,
    flavor: "سداد فاتورة",
    sellPricePiasters: 500,
    buyCostPiasters: 0,
  },
  {
    brandAr: "اتصالات",
    nameAr: "دفع فاتورة إنترنت منزلي اتصالات",
    category: "فواتير إنترنت",
    type: "service" as const,
    flavor: "سداد فاتورة",
    sellPricePiasters: 500,
    buyCostPiasters: 0,
  },
  {
    brandAr: "وي",
    nameAr: "دفع فاتورة التليفون الأرضي وي",
    category: "فواتير إنترنت",
    type: "service" as const,
    flavor: "سداد فاتورة",
    sellPricePiasters: 500,
    buyCostPiasters: 0,
  },

  // شحن رصيد (Top-up recharge)
  {
    brandAr: "فودافون",
    nameAr: "شحن رصيد فودافون على الهواء",
    category: "شحن رصيد",
    type: "service" as const,
    flavor: "شحن فوري",
    sellPricePiasters: 300, // 3.00 EGP commission
    buyCostPiasters: 0,
  },
  {
    brandAr: "أورانج",
    nameAr: "شحن رصيد أورانج على الهواء",
    category: "شحن رصيد",
    type: "service" as const,
    flavor: "شحن فوري",
    sellPricePiasters: 300,
    buyCostPiasters: 0,
  },
  {
    brandAr: "اتصالات",
    nameAr: "شحن رصيد اتصالات على الهواء",
    category: "شحن رصيد",
    type: "service" as const,
    flavor: "شحن فوري",
    sellPricePiasters: 300,
    buyCostPiasters: 0,
  },
  {
    brandAr: "وي",
    nameAr: "شحن رصيد وي على الهواء",
    category: "شحن رصيد",
    type: "service" as const,
    flavor: "شحن فوري",
    sellPricePiasters: 300,
    buyCostPiasters: 0,
  },

  // تحويل أموال (Money transfers)
  {
    brandAr: "فودافون",
    nameAr: "تحويل فودافون كاش إيداع وسحب",
    category: "تحويل أموال",
    type: "service" as const,
    flavor: "إيداع أو سحب",
    sellPricePiasters: 500, // 5.00 EGP commission
    buyCostPiasters: 0,
  },
  {
    brandAr: "إنستاباي",
    nameAr: "تحويل إنستاباي InstaPay",
    category: "تحويل أموال",
    type: "service" as const,
    flavor: "تحويل فوري",
    sellPricePiasters: 500,
    buyCostPiasters: 0,
  },
  {
    brandAr: "أورانج",
    nameAr: "تحويل أورانج كاش إيداع وسحب",
    category: "تحويل أموال",
    type: "service" as const,
    flavor: "إيداع أو سحب",
    sellPricePiasters: 500,
    buyCostPiasters: 0,
  },
  {
    brandAr: "اتصالات",
    nameAr: "تحويل اتصالات كاش إيداع وسحب",
    category: "تحويل أموال",
    type: "service" as const,
    flavor: "إيداع أو سحب",
    sellPricePiasters: 500,
    buyCostPiasters: 0,
  },
  {
    brandAr: "وي",
    nameAr: "تحويل محفظة وي باي إيداع وسحب",
    category: "تحويل أموال",
    type: "service" as const,
    flavor: "إيداع أو سحب",
    sellPricePiasters: 500,
    buyCostPiasters: 0,
  },
  // خدمات مرافق وكروت ذكية
  {
    brandAr: "شركة الكهرباء",
    nameAr: "شحن كارت كهرباء مسبق الدفع",
    category: "خدمات مرافق",
    type: "service" as const,
    flavor: "شحن رصيد كارت",
    sellPricePiasters: 500,
    buyCostPiasters: 0,
  },
  {
    brandAr: "شركة مياه الشرب",
    nameAr: "شحن كارت مياه مسبق الدفع",
    category: "خدمات مرافق",
    type: "service" as const,
    flavor: "شحن رصيد كارت",
    sellPricePiasters: 500,
    buyCostPiasters: 0,
  },
  {
    brandAr: "شركة الكهرباء",
    nameAr: "كارت كهرباء ذكي جديد",
    category: "كروت مرافق",
    type: "stock" as const,
    flavor: "كارت فيزيائي جديد",
    sellPricePiasters: 10000,
    buyCostPiasters: 8000,
  },
  {
    brandAr: "شركة مياه الشرب",
    nameAr: "كارت مياه ذكي جديد",
    category: "كروت مرافق",
    type: "stock" as const,
    flavor: "كارت فيزيائي جديد",
    sellPricePiasters: 10000,
    buyCostPiasters: 8000,
  },
];

async function main() {
  console.log("Seeding Telecom brands and products...");

  // 1. Seed Brands
  const brandMap = new Map<string, string>();
  for (const b of TELECOM_BRANDS) {
    let brand = await prisma.brand.findFirst({
      where: { nameAr: b.nameAr },
    });
    if (!brand) {
      brand = await prisma.brand.create({
        data: {
          nameAr: b.nameAr,
          nameEn: b.nameEn,
        },
      });
      console.log(`Created brand: ${b.nameAr}`);
    }
    brandMap.set(b.nameAr, brand.id);
  }

  // 2. Seed Global Products and Global Variants
  let inserted = 0;
  for (const p of TELECOM_PRODUCTS) {
    const brandId = brandMap.get(p.brandAr);
    const nameNorm = normalizeArabic(p.nameAr);

    let globalProd = await prisma.globalProduct.findFirst({
      where: { nameNorm },
    });

    if (!globalProd) {
      globalProd = await prisma.globalProduct.create({
        data: {
          brandId,
          nameAr: p.nameAr,
          nameNorm,
          category: p.category,
          type: p.type,
          status: "approved",
        },
      });
      inserted++;
      console.log(`Created global product: ${p.nameAr} (${p.category})`);
    }

    // Ensure variant exists
    const variantNorm = normalizeArabic(`${p.nameAr} ${p.flavor}`);
    const existingVar = await prisma.globalVariant.findFirst({
      where: {
        globalProductId: globalProd.id,
        flavor: p.flavor,
      },
    });

    if (!existingVar) {
      await prisma.globalVariant.create({
        data: {
          globalProductId: globalProd.id,
          flavor: p.flavor,
          sizeValue: 1,
          sizeUnit: "piece",
          packQty: 1,
          nameNorm: variantNorm,
        },
      });
      console.log(`Created variant for: ${p.nameAr} - ${p.flavor}`);
    }
  }

  console.log(`Done seeding telecom products! Inserted: ${inserted}`);
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

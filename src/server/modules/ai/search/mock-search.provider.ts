import "server-only";
import { SearchProvider, SearchResult } from "./search-provider.interface";

export class MockSearchProvider implements SearchProvider {
  readonly name = "mock-search";

  async search(query: string): Promise<SearchResult> {
    const q = query.toLowerCase();

    if (q.includes("وقود") || q.includes("بنزين") || q.includes("سولار")) {
      return {
        query,
        source: "mock",
        summary:
          "أسعار السولار والبنزين تؤثر على تكاليف نقل وتوزيع السلع الغذائية بنسب تتراوح بين 5% و15% حسب المسافة ونوع السلعة.",
        citations: [
          {
            title: "لجنة التسعير التلقائي للمنتجات البترولية — مصر",
            url: "https://www.petroleum.gov.eg",
            snippet:
              "بيان متابعة أسعار الوقود وتأثيرها على قطاع النقل الداخلي.",
            publishedDate: "2026-10-01",
          },
          {
            title: "شعبة المواد الغذائية بالغرفة التجارية بالقاهرة",
            url: "https://www.cairochamber.org.eg",
            snippet:
              "تقرير دوري حول تأثير تكلفة الشحن على أسعار الجملة بالأسواق.",
            publishedDate: "2026-10-15",
          },
        ],
      };
    }

    if (
      q.includes("سكر") ||
      q.includes("زيت") ||
      q.includes("أرز") ||
      q.includes("ارز")
    ) {
      return {
        query,
        source: "mock",
        summary:
          "استقرار نسبي في أسعار السلع التموينية والاستراتيجية مع تفاوت في أسعار التجزئة الحرة حسب المنطقة والمورد.",
        citations: [
          {
            title:
              "بوابة الأسعار المحلية والعالمية — مركز معلومات مجلس الوزراء",
            url: "https://prices.idsc.gov.eg",
            snippet:
              "رصد متوسط أسعار السلع الغذائية الأساسية بمحافظات الجمهورية.",
            publishedDate: "2026-10-25",
          },
        ],
      };
    }

    return {
      query,
      source: "mock",
      summary:
        "حركة الأسواق تتأثر بعوامل العرض والطلب وتكلفة الاستيراد والنقل، مع نصيحة بمراجعة هوامش الربح أسبوعياً.",
      citations: [
        {
          title: "الغرفة التجارية — شعبة البقالة والسوبر ماركت",
          url: "https://www.cairochamber.org.eg",
          snippet:
            "توجيهات لأصحاب المتاجر بمتابعة الفواتير وهوامش الربح السريع.",
          publishedDate: "2026-10-20",
        },
      ],
    };
  }
}

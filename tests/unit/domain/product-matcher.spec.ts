import { describe, expect, it } from "vitest";
import { matchProducts } from "@/domain/product-matcher";

describe("domain/product-matcher - Egyptian Product Matching & Anti-Merging Rules", () => {
  describe("1. Confirmed Exact Matches (تطابق مؤكد)", () => {
    it("matches exact same product with identical attributes across spelling variations", () => {
      const candidate = {
        name: "شاي ليبتون ناعم",
        brand: "ليبتون",
        flavor: "عادي",
        sizeValue: 250,
        sizeUnit: "جم",
        packQty: 1,
      };

      const catalogItem = {
        name: "شاى ليبتون ناعم",
        brand: "ليبتون",
        flavor: "عادي",
        sizeValue: 250,
        sizeUnit: "g",
        packQty: 1,
      };

      const result = matchProducts(candidate, catalogItem);
      expect(result.matchType).toBe("exact_match");
      expect(result.confidence).toBe(1.0);
      expect(result.details.brandMatch).toBe(true);
      expect(result.details.sizeMatch).toBe(true);
    });

    it("matches product when size units differ only by scale (1000 ml vs 1 L)", () => {
      const candidate = {
        name: "حليب جهينة كامل الدسم",
        brand: "جهينة",
        flavor: "كامل الدسم",
        sizeValue: 1000,
        sizeUnit: "مل",
        packQty: 1,
      };

      const catalogItem = {
        name: "حليب جهينه كامل الدسم",
        brand: "جهينه",
        flavor: "كامل الدسم",
        sizeValue: 1,
        sizeUnit: "لتر",
        packQty: 1,
      };

      const result = matchProducts(candidate, catalogItem);
      expect(result.matchType).toBe("exact_match");
      expect(result.confidence).toBe(1.0);
    });

    it("matches pasta across Arabic spelling differences (1000 جم vs 1 كجم)", () => {
      const candidate = {
        name: "مكرونة الملكة فرن",
        brand: "الملكة",
        sizeValue: 1000,
        sizeUnit: "جم",
      };

      const catalogItem = {
        name: "مكرونه الملكه فرن",
        brand: "الملكه",
        sizeValue: 1,
        sizeUnit: "كجم",
      };

      const result = matchProducts(candidate, catalogItem);
      expect(result.matchType).toBe("exact_match");
    });
  });

  describe("2. Brand Conflicts: MUST NEVER Merge (اختلاف الماركة)", () => {
    it("never merges tea of different brands (ليبتون vs العروسة)", () => {
      const teaA = {
        name: "شاي ناعم أسود",
        brand: "ليبتون",
        sizeValue: 250,
        sizeUnit: "جم",
      };

      const teaB = {
        name: "شاي ناعم أسود",
        brand: "العروسة",
        sizeValue: 250,
        sizeUnit: "جم",
      };

      const result = matchProducts(teaA, teaB);
      expect(result.matchType).toBe("no_match");
      expect(result.confidence).toBe(0);
      expect(result.reason).toContain("Brands conflict");
    });

    it("never merges milk of different brands (جهينة vs المراعي)", () => {
      const milkJuhayna = {
        name: "حليب كامل الدسم",
        brand: "جهينة",
        sizeValue: 1,
        sizeUnit: "لتر",
      };

      const milkAlmarai = {
        name: "حليب كامل الدسم",
        brand: "المراعي",
        sizeValue: 1,
        sizeUnit: "لتر",
      };

      const result = matchProducts(milkJuhayna, milkAlmarai);
      expect(result.matchType).toBe("no_match");
      expect(result.reason).toContain("Brands conflict");
    });

    it("never merges white cheese of different brands (دومتي vs عبور لاند)", () => {
      const cheeseDomty = {
        name: "جبنة فيتا بيضاء",
        brand: "دومتي",
        sizeValue: 500,
        sizeUnit: "جم",
      };

      const cheeseObour = {
        name: "جبنة فيتا بيضاء",
        brand: "عبور لاند",
        sizeValue: 500,
        sizeUnit: "جم",
      };

      const result = matchProducts(cheeseDomty, cheeseObour);
      expect(result.matchType).toBe("no_match");
      expect(result.reason).toContain("Brands conflict");
    });
  });

  describe("3. Flavor Conflicts: MUST NEVER Merge (اختلاف النكهة)", () => {
    it("never merges different potato chips flavors (جبنة متبلة vs شطة وليمون)", () => {
      const chipsCheese = {
        name: "شيبسي بطاطس",
        brand: "شيبسي",
        flavor: "جبنة متبلة",
        sizeValue: 50,
        sizeUnit: "جم",
      };

      const chipsChiliLemon = {
        name: "شيبسي بطاطس",
        brand: "شيبسي",
        flavor: "شطة وليمون",
        sizeValue: 50,
        sizeUnit: "جم",
      };

      const result = matchProducts(chipsCheese, chipsChiliLemon);
      expect(result.matchType).toBe("no_match");
      expect(result.reason).toContain("Flavors conflict");
    });

    it("never merges yogurt with different fruit flavors (فراولة vs خوخ)", () => {
      const yogurtStrawberry = {
        name: "زبادي فواكه",
        brand: "دانون",
        flavor: "فراولة",
        sizeValue: 110,
        sizeUnit: "جم",
      };

      const yogurtPeach = {
        name: "زبادي فواكه",
        brand: "دانون",
        flavor: "خوخ",
        sizeValue: 110,
        sizeUnit: "جم",
      };

      const result = matchProducts(yogurtStrawberry, yogurtPeach);
      expect(result.matchType).toBe("no_match");
    });
  });

  describe("4. Size Conflicts: MUST NEVER Merge (اختلاف الحجم والوزن)", () => {
    it("never merges different sizes of the same product (100 جم vs 250 جم)", () => {
      const tea100g = {
        name: "شاي العروسة ناعم",
        brand: "العروسة",
        sizeValue: 100,
        sizeUnit: "جم",
      };

      const tea250g = {
        name: "شاي العروسة ناعم",
        brand: "العروسة",
        sizeValue: 250,
        sizeUnit: "جم",
      };

      const result = matchProducts(tea100g, tea250g);
      expect(result.matchType).toBe("no_match");
      expect(result.reason).toContain("Sizes conflict");
    });

    it("never merges 800 ml oil with 1.6 L oil", () => {
      const oil800 = {
        name: "زيت ذرة عافية",
        brand: "عافية",
        sizeValue: 800,
        sizeUnit: "مل",
      };

      const oil1600 = {
        name: "زيت ذرة عافية",
        brand: "عافية",
        sizeValue: 1.6,
        sizeUnit: "لتر",
      };

      const result = matchProducts(oil800, oil1600);
      expect(result.matchType).toBe("no_match");
      expect(result.reason).toContain("Sizes conflict");
    });

    it("never merges single piece with carton pack of 24", () => {
      const singleItem = {
        name: "عصير جهينة مانجو",
        brand: "جهينة",
        packQty: 1,
      };

      const cartonItem = {
        name: "عصير جهينة مانجو",
        brand: "جهينة",
        packQty: 24,
      };

      const result = matchProducts(singleItem, cartonItem);
      expect(result.matchType).toBe("no_match");
      expect(result.reason).toContain("Pack quantities conflict");
    });
  });

  describe("5. Potential Matches (احتمال تطابق يحتاج مراجعة)", () => {
    it("classifies similar names with missing flavor/size as potential match and NEVER auto-merges", () => {
      const cand = {
        name: "شاي العروسة ناعم فاخر ممتاز",
        brand: "العروسة",
      };

      const target = {
        name: "شاي العروسة ناعم",
        brand: "العروسة",
      };

      const result = matchProducts(cand, target);
      expect(result.matchType).toBe("potential_match");
      expect(result.confidence).toBeGreaterThanOrEqual(0.65);
      expect(result.confidence).toBeLessThan(0.95);
      expect(result.reason).toContain("requires verification");
    });
  });
});

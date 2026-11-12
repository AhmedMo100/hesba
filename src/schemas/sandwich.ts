import { z } from "zod";
import { MAX_UNIT_PRICE_PIASTERS } from "@/domain/limits";
import { MAX_RECIPE_INGREDIENTS } from "@/domain/recipe";

/**
 * One recipe line as the sandwich form sends it. The amount is in the unit the user picked;
 * the server converts it to integer base units (grams or pieces) and checks the unit matches
 * the ingredient product (`g`/`kg` for weighed goods, `piece` otherwise).
 */
export const sandwichIngredientInputSchema = z.object({
  variantId: z.string().uuid("اختار المنتج"),
  quantity: z
    .number({ message: "اكتب الكمية" })
    .finite("اكتب الكمية")
    .positive("الكمية لازم تكون أكبر من صفر"),
  unit: z.enum(["g", "kg", "piece"], { message: "وحدة غير صحيحة" }),
});

export type SandwichIngredientInput = z.infer<
  typeof sandwichIngredientInputSchema
>;

/**
 * Body of `POST /api/sandwiches` and `PATCH /api/sandwiches/:id`.
 *
 * Money is integer piasters. The cost is never accepted from the client: it is always
 * calculated from the recipe (ADR-0018).
 */
export const sandwichInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "اكتب اسم الساندوتش (حرفين على الأقل)")
      .max(80, "اسم الساندوتش طويل قوي"),
    sellPricePiasters: z
      .number({ message: "اكتب سعر البيع" })
      .int("سعر البيع غير صحيح")
      .positive("سعر البيع لازم يكون أكبر من صفر")
      .max(MAX_UNIT_PRICE_PIASTERS, "سعر البيع كبير قوي"),
    ingredients: z
      .array(sandwichIngredientInputSchema)
      .min(1, "ضيف مكوّن واحد على الأقل")
      .max(MAX_RECIPE_INGREDIENTS, `أقصى عدد مكونات ${MAX_RECIPE_INGREDIENTS}`),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.ingredients.forEach((ing, index) => {
      if (seen.has(ing.variantId)) {
        ctx.addIssue({
          code: "custom",
          message: "المكوّن ده متكرر، عدّل كميته بدل ما تضيفه مرتين",
          path: ["ingredients", index, "variantId"],
        });
      }
      seen.add(ing.variantId);
    });
  });

export type SandwichInput = z.infer<typeof sandwichInputSchema>;

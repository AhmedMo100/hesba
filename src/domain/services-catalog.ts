/**
 * @file services-catalog.ts
 * @description The services a shop performs for customers (wallets, Fawry / Aman, recharge,
 * internet, utilities, cards) and how each one moves money. Pure data + pure math.
 *
 * Hesba has NO provider integration: the owner performs the operation on the provider's app or
 * machine, then records it here. Nothing here claims a provider confirmation.
 *
 * Money (piasters), with `c` = the shop's commission and `a` = the operation's amount:
 * - direction 'send' (the customer gives money, the shop sends it out of its float):
 *     customer_fee:      customer pays a + c, float −a
 *     provider_discount: customer pays a,     float −(a − c)
 * - direction 'receive' (money arrives in the shop's float, the shop pays the customer):
 *     customer_fee:      float +a,       customer gets a − c
 *     provider_discount: float +(a + c), customer gets a
 * In every case: (money in) − (money out) = c. Only `c` is income; `a` is never revenue.
 */

export type ServiceDirection = "send" | "receive";
export type CommissionMode = "customer_fee" | "provider_discount";

export interface ServiceDefinition {
  key: string;
  category: ServiceCategory;
  label: string;
  serviceType: string;
  direction: ServiceDirection;
  /** Providers offered on the form (the owner may type another one). */
  providers: string[];
  defaultMode: CommissionMode;
}

export const SERVICE_CATEGORIES = [
  "wallet",
  "fawry_aman",
  "mobile",
  "internet",
  "utilities",
  "cards",
  "other",
] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export const SERVICE_CATEGORY_LABELS: Record<ServiceCategory, string> = {
  wallet: "فودافون كاش والمحافظ",
  fawry_aman: "فوري وأمان",
  mobile: "شحن الموبايل",
  internet: "النت والتليفون الأرضي",
  utilities: "كهربا ومياه وغاز",
  cards: "كروت الشحن",
  other: "خدمات تانية",
};

const MOBILE = ["فودافون", "أورانج", "اتصالات", "WE"];
const WALLETS = [
  "فودافون كاش",
  "أورانج كاش",
  "اتصالات كاش",
  "WE Pay",
  "إنستاباي",
];

export const SERVICES: ServiceDefinition[] = [
  {
    key: "wallet_deposit",
    category: "wallet",
    label: "إيداع في محفظة الزبون",
    serviceType: "deposit",
    direction: "send",
    providers: WALLETS,
    defaultMode: "customer_fee",
  },
  {
    key: "wallet_withdrawal",
    category: "wallet",
    label: "سحب من محفظة الزبون",
    serviceType: "withdrawal",
    direction: "receive",
    providers: WALLETS,
    defaultMode: "customer_fee",
  },
  {
    key: "wallet_transfer",
    category: "wallet",
    label: "تحويل فلوس لحد",
    serviceType: "transfer",
    direction: "send",
    providers: WALLETS,
    defaultMode: "customer_fee",
  },
  {
    key: "fawry_payment",
    category: "fawry_aman",
    label: "دفع على فوري",
    serviceType: "bill",
    direction: "send",
    providers: ["فوري"],
    defaultMode: "customer_fee",
  },
  {
    key: "aman_payment",
    category: "fawry_aman",
    label: "دفع على أمان",
    serviceType: "bill",
    direction: "send",
    providers: ["أمان"],
    defaultMode: "customer_fee",
  },
  {
    key: "fawry_withdrawal",
    category: "fawry_aman",
    label: "سحب كاش (فوري / أمان)",
    serviceType: "withdrawal",
    direction: "receive",
    providers: ["فوري", "أمان"],
    defaultMode: "customer_fee",
  },
  {
    key: "mobile_recharge",
    category: "mobile",
    label: "شحن رصيد",
    serviceType: "recharge",
    direction: "send",
    providers: MOBILE,
    defaultMode: "provider_discount",
  },
  {
    key: "mobile_package",
    category: "mobile",
    label: "باقة موبايل",
    serviceType: "package",
    direction: "send",
    providers: MOBILE,
    defaultMode: "provider_discount",
  },
  {
    key: "internet_renewal",
    category: "internet",
    label: "تجديد نت منزلي",
    serviceType: "bill",
    direction: "send",
    providers: ["WE", "فودافون", "أورانج", "اتصالات"],
    defaultMode: "customer_fee",
  },
  {
    key: "landline_bill",
    category: "internet",
    label: "فاتورة تليفون أرضي",
    serviceType: "bill",
    direction: "send",
    providers: ["WE"],
    defaultMode: "customer_fee",
  },
  {
    key: "electricity_bill",
    category: "utilities",
    label: "فاتورة / شحن كهربا",
    serviceType: "bill",
    direction: "send",
    providers: ["الكهربا"],
    defaultMode: "customer_fee",
  },
  {
    key: "water_bill",
    category: "utilities",
    label: "فاتورة / شحن مياه",
    serviceType: "bill",
    direction: "send",
    providers: ["المياه"],
    defaultMode: "customer_fee",
  },
  {
    key: "gas_bill",
    category: "utilities",
    label: "فاتورة / شحن غاز",
    serviceType: "bill",
    direction: "send",
    providers: ["الغاز"],
    defaultMode: "customer_fee",
  },
  {
    key: "recharge_card",
    category: "cards",
    label: "كارت شحن",
    serviceType: "card",
    direction: "send",
    providers: MOBILE,
    defaultMode: "provider_discount",
  },
  {
    key: "utility_card",
    category: "cards",
    label: "كارت كهربا / مياه",
    serviceType: "card",
    direction: "send",
    providers: ["الكهربا", "المياه"],
    defaultMode: "customer_fee",
  },
  {
    key: "other_send",
    category: "other",
    label: "خدمة تانية (الزبون بيدفع)",
    serviceType: "other",
    direction: "send",
    providers: [],
    defaultMode: "customer_fee",
  },
  {
    key: "other_receive",
    category: "other",
    label: "خدمة تانية (الزبون بياخد فلوس)",
    serviceType: "other",
    direction: "receive",
    providers: [],
    defaultMode: "customer_fee",
  },
];

export const SERVICE_BY_KEY: ReadonlyMap<string, ServiceDefinition> = new Map(
  SERVICES.map((s) => [s.key, s]),
);

export interface ServiceMoney {
  /** What the customer hands over (send) or is paid (receive). */
  customerPiasters: number;
  /** The signed change of the provider float: send ≤ 0, receive > 0. */
  floatDeltaPiasters: number;
}

/**
 * The money of one service operation. Throws when the commission would leave the customer
 * with nothing or less (receive + customer_fee) or exceed what is sent (send + provider_discount).
 */
export function serviceMoney(
  direction: ServiceDirection,
  mode: CommissionMode,
  amountPiasters: number,
  commissionPiasters: number,
): ServiceMoney {
  const a = amountPiasters;
  const c = commissionPiasters;
  if (!Number.isSafeInteger(a) || a <= 0) throw new Error("amount");
  if (!Number.isSafeInteger(c) || c < 0) throw new Error("commission");
  if (direction === "send") {
    if (mode === "customer_fee")
      return { customerPiasters: a + c, floatDeltaPiasters: -a };
    if (c > a) throw new Error("commission-exceeds-amount");
    return { customerPiasters: a, floatDeltaPiasters: -(a - c) };
  }
  if (mode === "customer_fee") {
    if (c >= a) throw new Error("commission-exceeds-amount");
    return { customerPiasters: a - c, floatDeltaPiasters: a };
  }
  return { customerPiasters: a, floatDeltaPiasters: a + c };
}

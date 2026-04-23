export type Currency = "AED" | "CNY" | "USDT";

export type AccountGroup = "bank" | "wallet" | "exchange" | "cash";

export type CategoryType =
  | "expense"
  | "income"
  | "transfer"
  | "investment"
  | "interest";

export type CategoryKey =
  | "food"
  | "transport"
  | "shopping"
  | "service"
  | "transfer"
  | "investment"
  | "salary"
  | "cash"
  | "other";

export type PageKey = "home" | "bills" | "stats" | "assets";

export interface Account {
  id: string;
  name: string;
  nickname?: string;
  group: AccountGroup;
  currency: Currency;
  balance: number;
  mask?: string;
  color: string;
  brand: string;
}

export interface Transaction {
  id: string;
  title: string;
  accountId: string;
  amount: number;
  currency: Currency;
  type: CategoryType;
  category: CategoryKey;
  tag: string;
  date: string;
  note?: string;
  direction: "in" | "out";
  relatedAccountId?: string;
  targetAmount?: number;
}

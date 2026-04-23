import { Account, CategoryKey, PageKey, Transaction } from "./types";

export const exchangeRates = {
  AED: 1,
  CNY: 0.505,
  USDT: 3.67
} as const;

export const navItems: { key: PageKey; label: string }[] = [
  { key: "home", label: "首页" },
  { key: "bills", label: "账单" },
  { key: "stats", label: "统计" },
  { key: "assets", label: "资产" }
];

export const groupLabels = {
  bank: "银行账户",
  wallet: "电子钱包",
  exchange: "交易所资产",
  cash: "现金"
} as const;

export const groupCounts: Record<string, string> = {
  bank: "2个账户",
  wallet: "2个账户",
  exchange: "3个账户",
  cash: "1个账户"
};

export const typeFilters = [
  { key: "all", label: "全部" },
  { key: "expense", label: "支出" },
  { key: "income", label: "收入" },
  { key: "investment", label: "理财" },
  { key: "transfer", label: "转账" }
] as const;

export const accountChipOrder = [
  "all",
  "alipay",
  "binance",
  "mashreq",
  "okx",
  "wechat"
] as const;

export const chipLabelMap: Record<string, string> = {
  all: "全部",
  alipay: "支付宝",
  binance: "币安",
  mashreq: "Mashreq Bank",
  okx: "OKX",
  wechat: "微信"
};

export const categoryLabels: Record<CategoryKey, string> = {
  food: "餐饮",
  transport: "交通",
  shopping: "购物",
  service: "服务",
  transfer: "转账",
  investment: "理财",
  salary: "工资",
  cash: "现金",
  other: "其他"
};

export const seedAccounts: Account[] = [
  {
    id: "mashreq",
    name: "Mashreq Bank",
    mask: "8890",
    group: "bank",
    currency: "AED",
    balance: 62210.45,
    color: "#ff8a00",
    brand: "M"
  },
  {
    id: "ccb",
    name: "中国建设银行",
    mask: "2211",
    group: "bank",
    currency: "CNY",
    balance: 47556.16,
    color: "#1e6aff",
    brand: "建"
  },
  {
    id: "alipay",
    name: "支付宝",
    mask: "3487",
    group: "wallet",
    currency: "CNY",
    balance: 1842.63,
    color: "#1f78ff",
    brand: "支"
  },
  {
    id: "wechat",
    name: "微信",
    mask: "5566",
    group: "wallet",
    currency: "CNY",
    balance: 892.35,
    color: "#1bcf66",
    brand: "微"
  },
  {
    id: "okx",
    name: "OKX",
    group: "exchange",
    currency: "USDT",
    balance: 3698.45,
    color: "#111111",
    brand: "OKX"
  },
  {
    id: "binance",
    name: "币安",
    group: "exchange",
    currency: "USDT",
    balance: 2421.36,
    color: "#f5b400",
    brand: "币"
  },
  {
    id: "bitget",
    name: "Bitget",
    group: "exchange",
    currency: "USDT",
    balance: 1803.26,
    color: "#59e1ec",
    brand: "S"
  },
  {
    id: "cash-aed",
    name: "现金 (AED)",
    group: "cash",
    currency: "AED",
    balance: 2520,
    color: "#6bd596",
    brand: "现"
  }
];

export const seedTransactions: Transaction[] = [
  {
    id: "t1",
    title: "Apple Pay 自动记账",
    accountId: "mashreq",
    amount: 27.25,
    currency: "AED",
    type: "expense",
    category: "service",
    tag: "消费",
    date: "2026-04-23T09:10:00+08:00",
    direction: "out"
  },
  {
    id: "t2",
    title: "转账给 张三",
    accountId: "mashreq",
    amount: 500,
    currency: "AED",
    type: "transfer",
    category: "transfer",
    tag: "转账",
    date: "2026-04-23T08:50:00+08:00",
    direction: "out",
    relatedAccountId: "cash-aed"
  },
  {
    id: "t3",
    title: "Ai",
    accountId: "mashreq",
    amount: 114.24,
    currency: "AED",
    type: "expense",
    category: "service",
    tag: "消费",
    date: "2026-04-22T21:20:00+08:00",
    direction: "out"
  },
  {
    id: "t4",
    title: "火币 理财收益",
    accountId: "binance",
    amount: 0.4434729,
    currency: "USDT",
    type: "interest",
    category: "investment",
    tag: "理财收益",
    date: "2026-04-22T19:50:00+08:00",
    direction: "in"
  },
  {
    id: "t5",
    title: "OKX 理财收益",
    accountId: "okx",
    amount: 0.03619824,
    currency: "USDT",
    type: "interest",
    category: "investment",
    tag: "理财收益",
    date: "2026-04-22T15:45:00+08:00",
    direction: "in"
  },
  {
    id: "t6",
    title: "Bitget 理财收益",
    accountId: "bitget",
    amount: 8.22109589,
    currency: "USDT",
    type: "interest",
    category: "investment",
    tag: "理财收益",
    date: "2026-04-22T08:45:00+08:00",
    direction: "in"
  },
  {
    id: "t7",
    title: "Mashreq Bank 存款",
    accountId: "mashreq",
    amount: 5000,
    currency: "AED",
    type: "income",
    category: "salary",
    tag: "银行账户",
    date: "2026-04-22T10:30:00+08:00",
    direction: "in"
  },
  {
    id: "t8",
    title: "微信 转入支付宝",
    accountId: "wechat",
    amount: 200,
    currency: "CNY",
    type: "transfer",
    category: "transfer",
    tag: "电子钱包",
    date: "2026-04-22T09:12:00+08:00",
    direction: "out",
    relatedAccountId: "alipay"
  },
  {
    id: "t9",
    title: "OKX 现货交易收益",
    accountId: "okx",
    amount: 28.74,
    currency: "USDT",
    type: "income",
    category: "investment",
    tag: "交易所资产",
    date: "2026-04-22T08:45:00+08:00",
    direction: "in"
  },
  {
    id: "t10",
    title: "币安 充值",
    accountId: "binance",
    amount: 500,
    currency: "USDT",
    type: "income",
    category: "investment",
    tag: "交易所资产",
    date: "2026-04-22T08:00:00+08:00",
    direction: "in"
  },
  {
    id: "t11",
    title: "Apple Pay 自动记账",
    accountId: "mashreq",
    amount: 20,
    currency: "AED",
    type: "expense",
    category: "service",
    tag: "消费",
    date: "2026-04-20T08:30:00+08:00",
    direction: "out"
  },
  {
    id: "t12",
    title: "工资入账",
    accountId: "ccb",
    amount: 12000,
    currency: "CNY",
    type: "income",
    category: "salary",
    tag: "收入",
    date: "2026-04-18T10:30:00+08:00",
    direction: "in"
  }
];

export const monthlyIncome = [32800, 35600, 42100, 38700, 50300, 47556];
export const monthlyExpense = [5600, 6100, 6800, 5900, 6300, 7109.71];
export const dailyIncome = [0, 3200, 4700, 4300, 7200, 7100, 10400, 10600, 16400];
export const dailyExpense = [0, 1800, 1500, 1200, 2100, 4300, 5200, 4100, 8800];

export const expenseBreakdown = [
  { label: "转账", value: 40.2, amount: 2858.3 },
  { label: "消费", value: 28.6, amount: 2033.38 },
  { label: "服务", value: 18.4, amount: 1308.19 },
  { label: "投资", value: 12.8, amount: 909.84 }
];

export const statsRanking = [
  { rank: 1, label: "餐饮", amount: 2260.35, ratio: 31.8 },
  { rank: 2, label: "交通", amount: 1451.7, ratio: 20.4 },
  { rank: 3, label: "购物", amount: 1184.26, ratio: 16.7 },
  { rank: 4, label: "转账", amount: 961.2, ratio: 13.5 },
  { rank: 5, label: "理财", amount: 682.1, ratio: 9.6 }
];

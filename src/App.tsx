import { useMemo, useState } from "react";
import {
  ArrowRightLeft,
  ArrowUpRight,
  Bell,
  BookText,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  CreditCard,
  Eye,
  Filter,
  Home,
  Info,
  Landmark,
  PieChart,
  Search,
  TrendingUp,
  UtensilsCrossed,
  Wallet
} from "lucide-react";

type PageKey = "home" | "bills" | "stats" | "assets";

type ShareItem = {
  label: string;
  percent: number;
  color: string;
};

type DistributionItem = ShareItem & {
  amount: string;
};

type RankingItem = {
  rank: number;
  label: string;
  amount: string;
  percent: string;
  percentColor: string;
  rankBg: string;
  icon: "food" | "traffic" | "shopping" | "transfer" | "finance";
  iconColor: string;
};

type QuickAction = {
  label: string;
  icon: typeof BookText;
  bg: string;
  iconColor: string;
};

type SummaryCard = {
  title: string;
  amount: string;
  amountColor: string;
  delta: string;
  deltaColor: string;
  iconBg: string;
  icon: string;
};

type BillTag = {
  label: string;
  bg: string;
  color: string;
};

type BillItem = {
  name: string;
  account: string;
  tag: BillTag;
  amount: string;
  time: string;
  type: "收入" | "支出";
  iconBg: string;
  iconColor: string;
  iconText: string;
};

type BillGroup = {
  title: string;
  subtitle: string;
  expense: string;
  income: string;
  items: BillItem[];
};

type TrendItem = {
  month: string;
  income: number;
  expense: number;
  incomeLabel: string;
  expenseLabel: string;
  highlight?: boolean;
};

type AccountRow = {
  name: string;
  amount: string;
  iconBg: string;
  iconColor: string;
  iconText: string;
};

type AssetCard = {
  title: string;
  total: string;
  icon: "bank" | "wallet" | "exchange" | "cash";
  iconBg: string;
  iconColor: string;
  rows: AccountRow[];
};

type ChangeRow = {
  name: string;
  sub: string;
  amount: string;
  currency: string;
  time: string;
  positive: boolean;
  iconBg: string;
  iconColor: string;
  iconText: string;
};

const homeShareItems: ShareItem[] = [
  { label: "餐饮", percent: 31.8, color: "#2F6BFF" },
  { label: "交通", percent: 20.4, color: "#7AA7FF" },
  { label: "购物", percent: 16.7, color: "#19B47A" },
  { label: "娱乐", percent: 13.5, color: "#FFB347" },
  { label: "理财", percent: 9.6, color: "#8B7BFF" },
  { label: "其他", percent: 8.0, color: "#D6DCE8" }
];

const statsShareItems: ShareItem[] = [
  { label: "餐饮", percent: 31.8, color: "#2F6BFF" },
  { label: "交通", percent: 20.4, color: "#7A7BFF" },
  { label: "购物", percent: 16.7, color: "#92B8FF" },
  { label: "转账", percent: 13.5, color: "#A9B8FF" },
  { label: "理财", percent: 9.6, color: "#C9D7FF" },
  { label: "其他", percent: 8.0, color: "#E3ECFF" }
];

const homeTransactions = [
  {
    name: "Apple Pay 自动记账",
    type: "支出" as const,
    tag: "购物",
    amount: "-128.00",
    time: "今天 09:38",
    iconBg: "#111111",
    iconFg: "#FFFFFF",
    mark: ""
  },
  {
    name: "OKX 理财收益",
    type: "收入" as const,
    tag: "理财",
    amount: "+256.32",
    time: "今天 08:21",
    iconBg: "#0E1116",
    iconFg: "#FFFFFF",
    mark: "OK"
  },
  {
    name: "火币 理财收益",
    type: "收入" as const,
    tag: "理财",
    amount: "+512.00",
    time: "昨天 21:16",
    iconBg: "#F8FAFC",
    iconFg: "#2563EB",
    mark: "火"
  },
  {
    name: "Bitget 理财收益",
    type: "收入" as const,
    tag: "理财",
    amount: "+320.50",
    time: "昨天 18:42",
    iconBg: "#0B0F14",
    iconFg: "#26D0FF",
    mark: "B"
  },
  {
    name: "支付宝转账-餐饮",
    type: "支出" as const,
    tag: "餐饮",
    amount: "-68.00",
    time: "昨天 12:09",
    iconBg: "#1677FF",
    iconFg: "#FFFFFF",
    mark: "支"
  }
];

const quickActions: QuickAction[] = [
  { label: "记一笔", icon: BookText, bg: "#EAF1FF", iconColor: "#2F6BFF" },
  { label: "预算", icon: PieChart, bg: "#EAFBF3", iconColor: "#17B26A" },
  { label: "转账", icon: ArrowRightLeft, bg: "#F0ECFF", iconColor: "#7B61FF" },
  { label: "报表", icon: CreditCard, bg: "#FFF3E6", iconColor: "#FF9F2F" }
];

const homeTrendPoints = [
  [0, 56],
  [28, 52],
  [52, 30],
  [78, 36],
  [108, 18],
  [146, 26],
  [176, 24],
  [208, 16],
  [248, 20],
  [282, 42],
  [320, 36],
  [360, 8]
] as const;

const filterChips = ["全部", "支出", "收入", "理财", "转账"];
const ranges = ["日", "周", "月"];

const billGroups: BillGroup[] = [
  {
    title: "今天",
    subtitle: "4月23日",
    expense: "522.45 AED",
    income: "3,100.00 AED",
    items: [
      {
        name: "Apple Pay 自动记账",
        account: "ADCB **** 1234",
        tag: { label: "购物", bg: "#FFECEF", color: "#FF5A6B" },
        amount: "-89.90 AED",
        time: "18:45",
        type: "支出",
        iconBg: "#111111",
        iconColor: "#FFFFFF",
        iconText: "Pay"
      },
      {
        name: "Ai",
        account: "ADCB **** 1234",
        tag: { label: "订阅", bg: "#F4EBFF", color: "#8B5CF6" },
        amount: "-19.99 AED",
        time: "16:32",
        type: "支出",
        iconBg: "#10A37F",
        iconColor: "#FFFFFF",
        iconText: "AI"
      },
      {
        name: "OKX 理财收益",
        account: "OKX 资金账户",
        tag: { label: "理财", bg: "#EEF4FF", color: "#2F6BFF" },
        amount: "+1,200.00 USDT",
        time: "09:15",
        type: "收入",
        iconBg: "#23B26D",
        iconColor: "#FFFFFF",
        iconText: "T"
      },
      {
        name: "转账给张三",
        account: "ADCB **** 1234",
        tag: { label: "转账", bg: "#FFF3E8", color: "#F59E0B" },
        amount: "-500.00 AED",
        time: "08:20",
        type: "支出",
        iconBg: "#4F86FF",
        iconColor: "#FFFFFF",
        iconText: "银"
      }
    ]
  },
  {
    title: "昨天",
    subtitle: "4月22日",
    expense: "1,245.60 AED",
    income: "6,500.00 AED",
    items: [
      {
        name: "火币 理财收益",
        account: "火币 资金账户",
        tag: { label: "理财", bg: "#EEF4FF", color: "#2F6BFF" },
        amount: "+2,500.00 USDT",
        time: "21:35",
        type: "收入",
        iconBg: "#FF6A00",
        iconColor: "#FFFFFF",
        iconText: "火"
      },
      {
        name: "Bitget 理财收益",
        account: "Bitget 资金账户",
        tag: { label: "理财", bg: "#EEF4FF", color: "#2F6BFF" },
        amount: "+4,000.00 USDT",
        time: "14:10",
        type: "收入",
        iconBg: "#111111",
        iconColor: "#FFFFFF",
        iconText: "BG"
      },
      {
        name: "Noon",
        account: "ADCB **** 1234",
        tag: { label: "购物", bg: "#FFECEF", color: "#FF5A6B" },
        amount: "-245.60 AED",
        time: "11:05",
        type: "支出",
        iconBg: "#84BD00",
        iconColor: "#FFFFFF",
        iconText: "n"
      }
    ]
  },
  {
    title: "4月21日",
    subtitle: "星期一",
    expense: "1,862.36 AED",
    income: "2,300.00 AED",
    items: [
      {
        name: "Amazon.ae",
        account: "ADCB **** 1234",
        tag: { label: "购物", bg: "#FFECEF", color: "#FF5A6B" },
        amount: "-112.36 AED",
        time: "20:22",
        type: "支出",
        iconBg: "#232F3E",
        iconColor: "#FFFFFF",
        iconText: "a"
      },
      {
        name: "Careem",
        account: "ADCB **** 1234",
        tag: { label: "交通", bg: "#EEF4FF", color: "#3B82F6" },
        amount: "-35.00 AED",
        time: "18:08",
        type: "支出",
        iconBg: "#FFFFFF",
        iconColor: "#FF5A00",
        iconText: "MC"
      },
      {
        name: "OKX 理财收益",
        account: "OKX 资金账户",
        tag: { label: "理财", bg: "#EEF4FF", color: "#2F6BFF" },
        amount: "+2,300.00 USDT",
        time: "10:30",
        type: "收入",
        iconBg: "#23B26D",
        iconColor: "#FFFFFF",
        iconText: "T"
      }
    ]
  }
];

const statSummaryCards: SummaryCard[] = [
  {
    title: "本月支出（CNY）",
    amount: "7,109.71",
    amountColor: "#FF5A6B",
    delta: "13.2%",
    deltaColor: "#FF5A6B",
    iconBg: "#FFECEF",
    icon: "↘"
  },
  {
    title: "本月收入（CNY）",
    amount: "47,556.16",
    amountColor: "#17B26A",
    delta: "18.7%",
    deltaColor: "#17B26A",
    iconBg: "#EAFBF3",
    icon: "↗"
  },
  {
    title: "本月结余（CNY）",
    amount: "40,446.45",
    amountColor: "#2F6BFF",
    delta: "20.1%",
    deltaColor: "#2F6BFF",
    iconBg: "#EEF4FF",
    icon: "◻"
  }
];

const trendData: TrendItem[] = [
  { month: "11月", income: 32.8, expense: 5.6, incomeLabel: "32.8K", expenseLabel: "5.6K" },
  { month: "12月", income: 35.6, expense: 6.1, incomeLabel: "35.6K", expenseLabel: "6.1K" },
  { month: "1月", income: 42.1, expense: 6.8, incomeLabel: "42.1K", expenseLabel: "6.8K" },
  { month: "2月", income: 38.7, expense: 5.9, incomeLabel: "38.7K", expenseLabel: "5.9K" },
  { month: "3月", income: 50.3, expense: 6.3, incomeLabel: "50.3K", expenseLabel: "6.3K" },
  { month: "4月", income: 47.6, expense: 7.1, incomeLabel: "47.6K", expenseLabel: "7.1K", highlight: true }
];

const rankingItems: RankingItem[] = [
  {
    rank: 1,
    label: "餐饮",
    amount: "2,260.35",
    percent: "31.8%",
    percentColor: "#FF5A6B",
    rankBg: "#FFCB45",
    icon: "food",
    iconColor: "#344054"
  },
  {
    rank: 2,
    label: "交通",
    amount: "1,451.70",
    percent: "20.4%",
    percentColor: "#667085",
    rankBg: "#D9DCE3",
    icon: "traffic",
    iconColor: "#2F6BFF"
  },
  {
    rank: 3,
    label: "购物",
    amount: "1,184.26",
    percent: "16.7%",
    percentColor: "#667085",
    rankBg: "#FF9E57",
    icon: "shopping",
    iconColor: "#2892E4"
  },
  {
    rank: 4,
    label: "转账",
    amount: "961.20",
    percent: "13.5%",
    percentColor: "#667085",
    rankBg: "#EEF2F6",
    icon: "transfer",
    iconColor: "#344054"
  },
  {
    rank: 5,
    label: "理财",
    amount: "682.10",
    percent: "9.6%",
    percentColor: "#667085",
    rankBg: "#EEF2F6",
    icon: "finance",
    iconColor: "#344054"
  }
];

const assetDistributionItems: DistributionItem[] = [
  { label: "银行账户", percent: 45.3, amount: "58,486.81 AED", color: "#2F6BFF" },
  { label: "交易所资产", percent: 25.7, amount: "33,196.20 AED", color: "#7AA7FF" },
  { label: "电子钱包", percent: 16.1, amount: "20,764.31 AED", color: "#8B7BFF" },
  { label: "现金", percent: 6.3, amount: "8,129.00 AED", color: "#F5C45E" },
  { label: "其他", percent: 6.6, amount: "8,370.06 AED", color: "#D0D5DD" }
];

const assetCards: AssetCard[] = [
  {
    title: "银行账户",
    total: "58,486.81 AED",
    icon: "bank",
    iconBg: "#EEF4FF",
    iconColor: "#2F6BFF",
    rows: [
      { name: "Mashreq Bank", amount: "39,256.54 AED", iconBg: "#FF8A1E", iconColor: "#FFFFFF", iconText: "M" },
      { name: "中国建设银行", amount: "19,230.27 AED", iconBg: "#115DBD", iconColor: "#FFFFFF", iconText: "CCB" }
    ]
  },
  {
    title: "电子钱包",
    total: "20,764.31 AED",
    icon: "wallet",
    iconBg: "#EEF4FF",
    iconColor: "#2F6BFF",
    rows: [
      { name: "支付宝", amount: "12,450.80 CNY", iconBg: "#1677FF", iconColor: "#FFFFFF", iconText: "支" },
      { name: "微信", amount: "8,313.51 CNY", iconBg: "#1AAD19", iconColor: "#FFFFFF", iconText: "微" }
    ]
  },
  {
    title: "交易所资产",
    total: "33,196.20 AED",
    icon: "exchange",
    iconBg: "#EEF4FF",
    iconColor: "#2F6BFF",
    rows: [
      { name: "OKX", amount: "12,845.68 AED", iconBg: "#111111", iconColor: "#FFFFFF", iconText: "OK" },
      { name: "币安", amount: "11,237.41 AED", iconBg: "#F3BA2F", iconColor: "#FFFFFF", iconText: "币" },
      { name: "Bitget", amount: "9,113.11 AED", iconBg: "#0B0F14", iconColor: "#26D0FF", iconText: "BG" }
    ]
  },
  {
    title: "现金",
    total: "8,129.00 AED",
    icon: "cash",
    iconBg: "#EEF4FF",
    iconColor: "#2F6BFF",
    rows: [
      { name: "现金（AED）", amount: "8,129.00 AED", iconBg: "#7BE495", iconColor: "#FFFFFF", iconText: "$" }
    ]
  }
];

const changeRows: ChangeRow[] = [
  {
    name: "Mashreq Bank",
    sub: "存款",
    amount: "+5,000.00",
    currency: "AED",
    time: "今天 09:23",
    positive: true,
    iconBg: "#FF8A1E",
    iconColor: "#FFFFFF",
    iconText: "M"
  },
  {
    name: "微信 → 支付宝",
    sub: "转入支付宝",
    amount: "-200.00",
    currency: "CNY",
    time: "今天 08:45",
    positive: false,
    iconBg: "#1AAD19",
    iconColor: "#FFFFFF",
    iconText: "微"
  },
  {
    name: "OKX",
    sub: "现货交易收益",
    amount: "+28.74",
    currency: "USDT",
    time: "昨天 22:16",
    positive: true,
    iconBg: "#111111",
    iconColor: "#FFFFFF",
    iconText: "OK"
  },
  {
    name: "币安",
    sub: "充值",
    amount: "+500.00",
    currency: "USDT",
    time: "昨天 20:35",
    positive: true,
    iconBg: "#F3BA2F",
    iconColor: "#FFFFFF",
    iconText: "币"
  }
];

const assetLinePoints = [
  [0, 50],
  [18, 42],
  [38, 22],
  [58, 24],
  [78, 20],
  [96, 18],
  [116, 6],
  [136, 10],
  [156, -8],
  [176, -4],
  [194, -16],
  [212, -8],
  [232, -22],
  [252, -8],
  [272, -12],
  [292, -26],
  [312, -20],
  [332, -30],
  [352, -16],
  [372, -10]
] as const;

export default function App() {
  const [page, setPage] = useState<PageKey>("home");

  return (
    <div className="min-h-screen bg-[#F5F7FB] text-[#1F2A44]">
      <div className="mx-auto flex min-h-screen w-full justify-center">
        <div className="relative w-full max-w-[430px] bg-[#F5F7FB]">
          <main className="mx-auto flex min-h-[932px] w-[430px] flex-col gap-4 px-4 pb-[132px] pt-[28px]">
            <StatusBar />
            <BrandBar />
            {page === "home" && <HomePage />}
            {page === "bills" && <BillsPage />}
            {page === "stats" && <StatsPage />}
            {page === "assets" && <AssetsPage />}
          </main>
          <TabBar page={page} onChange={setPage} />
        </div>
      </div>
    </div>
  );
}

function HomePage() {
  const homeDonut = useMemo(() => buildDonutSegments(homeShareItems, 36), []);
  const linePath = createSmoothPath(homeTrendPoints);
  const areaPath = `${linePath} L 360 72 L 0 72 Z`;

  return (
    <>
      <FilterRow />
      <section className="flex h-[194px] w-[398px] flex-col justify-between rounded-[28px] border border-[rgba(15,23,42,0.04)] bg-white p-5 shadow-[0_4px_20px_rgba(15,23,42,0.04)]">
        <div className="flex items-center gap-[10px]">
          <span className="text-[16px] font-medium text-[#667085]">本月结余（CNY）</span>
          <Eye className="h-[18px] w-[18px] text-[#667085]" />
        </div>
        <div className="text-[52px] font-bold leading-[58px] tracking-[-0.04em] text-[#2F6BFF]">
          40,446.45
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[14px] text-[#667085]">较上月</span>
          <span className="inline-flex h-7 items-center rounded-[14px] bg-[#EEF4FF] px-[10px] text-[14px] font-semibold text-[#2F6BFF]">
            <span className="mr-[6px] inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white text-[12px]">
              ↑
            </span>
            20.1%
          </span>
        </div>
        <div className="relative h-[72px] w-full">
          <svg viewBox="0 0 360 72" className="h-[72px] w-full">
            <defs>
              <linearGradient id="homeArea" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#2F6BFF" stopOpacity="0.2" />
                <stop offset="100%" stopColor="#2F6BFF" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            <path d={areaPath} fill="url(#homeArea)" />
            <path d="M0 63.5H360" stroke="#D9E4FF" strokeDasharray="3 3" />
            <path
              d={linePath}
              fill="none"
              stroke="#2F6BFF"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="3.5"
            />
            <circle cx="360" cy="8" r="6.5" fill="#2F6BFF" />
            <circle cx="360" cy="8" r="10.5" fill="#2F6BFF" fillOpacity="0.16" />
          </svg>
          <div className="absolute right-[26px] top-[-16px] rounded-[18px] bg-white px-[12px] py-[8px] text-center shadow-[0_12px_24px_rgba(47,107,255,0.12)]">
            <div className="text-[12px] font-medium text-[#667085]">4月30日</div>
            <div className="text-[14px] font-semibold text-[#2F6BFF]">40,446.45</div>
            <div className="absolute bottom-[-7px] left-1/2 h-4 w-4 -translate-x-1/2 rotate-45 rounded-[4px] bg-white" />
          </div>
        </div>
      </section>
      <div className="flex h-[112px] w-[398px] gap-3">
        <HomeSummaryCard
          title="本月收入（CNY）"
          amount="47,556.16"
          amountColor="#17B26A"
          delta="18.7%"
          deltaColor="#17B26A"
          plateBg="#EAFBF3"
        />
        <HomeSummaryCard
          title="本月支出（CNY）"
          amount="7,109.71"
          amountColor="#FF5A6B"
          delta="13.2%"
          deltaColor="#FF5A6B"
          plateBg="#FFECEF"
          rotate
        />
      </div>
      <section className="flex h-[108px] w-[398px] items-center justify-between rounded-[24px] border border-[rgba(15,23,42,0.04)] bg-white px-5 py-[18px] shadow-[0_4px_20px_rgba(15,23,42,0.04)]">
        {quickActions.map((item) => (
          <button key={item.label} className="flex w-[72px] flex-col items-center gap-[10px]">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-[16px]"
              style={{ background: item.bg }}
            >
              <item.icon className="h-6 w-6" style={{ color: item.iconColor }} />
            </div>
            <span className="text-[14px] font-semibold text-[#344054]">{item.label}</span>
          </button>
        ))}
      </section>
      <div className="flex w-[398px] gap-3">
        <section className="h-[206px] w-[193px] rounded-[24px] border border-[rgba(15,23,42,0.04)] bg-white p-[18px] shadow-[0_4px_20px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between">
            <h3 className="text-[18px] font-bold text-[#1F2A44]">预算进度</h3>
            <button className="flex items-center gap-[4px] text-[14px] font-semibold text-[#667085]">
              本月
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 text-[14px] text-[#667085]">
            总预算 <span className="font-semibold text-[#1F2A44]">20,000.00</span> CNY
          </div>
          <div className="mt-[14px] flex items-center gap-3">
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-[#E8EEF8]">
              <div className="h-3 w-[53%] rounded-full bg-[#2F6BFF]" />
            </div>
            <span className="text-[18px] font-bold text-[#2F6BFF]">53%</span>
          </div>
          <div className="mt-4 flex flex-col gap-[10px]">
            <BudgetRow color="#2F6BFF" label="已支出" value="10,653.28" />
            <BudgetRow color="#D6DCE8" label="剩余额度" value="9,346.72" />
          </div>
        </section>
        <section className="h-[206px] w-[193px] rounded-[24px] border border-[rgba(15,23,42,0.04)] bg-white p-[18px] shadow-[0_4px_20px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between">
            <h3 className="text-[18px] font-bold text-[#1F2A44]">支出分类概览</h3>
            <button className="flex items-center gap-[4px] text-[14px] font-semibold text-[#667085]">
              本月
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-[14px] flex items-center gap-[14px]">
            <svg viewBox="0 0 102 102" className="h-[102px] w-[102px] shrink-0">
              <circle cx="51" cy="51" r="36" fill="none" stroke="#EEF2F7" strokeWidth="14" />
              {homeDonut.map((segment) => (
                <circle
                  key={segment.label}
                  cx="51"
                  cy="51"
                  r="36"
                  fill="none"
                  stroke={segment.color}
                  strokeDasharray={`${segment.length} ${segment.gap}`}
                  strokeDashoffset={segment.offset}
                  strokeWidth="14"
                  transform="rotate(-90 51 51)"
                />
              ))}
            </svg>
            <div className="flex min-w-0 flex-1 flex-col gap-[10px]">
              {homeShareItems.map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-[8px] text-[14px] font-medium text-[#667085]">
                    <span className="h-[8px] w-[8px] rounded-full" style={{ background: item.color }} />
                    {item.label}
                  </div>
                  <span className="text-[14px] font-medium text-[#667085]">
                    {item.percent.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
      <section className="w-[398px] rounded-[24px] border border-[rgba(15,23,42,0.04)] bg-white p-[18px] shadow-[0_4px_20px_rgba(15,23,42,0.04)]">
        <div className="flex items-center justify-between">
          <h3 className="text-[18px] font-bold text-[#1F2A44]">最近交易</h3>
          <button className="flex items-center gap-[4px] text-[14px] font-semibold text-[#667085]">
            查看全部
            <ChevronRight className="h-[16px] w-[16px]" />
          </button>
        </div>
        <div className="mt-3 flex flex-col">
          {homeTransactions.map((item, index) => (
            <article
              key={`${item.name}-${item.time}`}
              className={`grid h-[68px] grid-cols-[40px_1fr_auto] items-center gap-x-3 ${
                index === 0 ? "" : "border-t border-[#F1F5F9]"
              }`}
            >
              <div
                className="flex h-10 w-10 items-center justify-center rounded-full text-[18px] font-bold"
                style={{ background: item.iconBg, color: item.iconFg }}
              >
                {item.mark}
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex items-center gap-[8px]">
                  <span className="truncate text-[15px] font-semibold text-[#1F2A44]">
                    {item.name}
                  </span>
                  <span
                    className={`inline-flex h-6 items-center rounded-[10px] px-2 text-[12px] font-semibold ${
                      item.type === "收入"
                        ? "bg-[#EAFBF3] text-[#17B26A]"
                        : "bg-[#EEF4FF] text-[#2F6BFF]"
                    }`}
                  >
                    {item.type}
                  </span>
                  <span className="text-[12px] font-medium text-[#98A2B3]">{item.tag}</span>
                </div>
              </div>
              <div className="text-right">
                <div
                  className="text-[16px] font-bold"
                  style={{ color: item.type === "收入" ? "#17B26A" : "#FF5A6B" }}
                >
                  {item.amount}
                </div>
                <div className="mt-[4px] text-[12px] font-medium text-[#98A2B3]">{item.time}</div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function BillsPage() {
  return (
    <>
      <div className="flex h-[52px] w-[398px] items-center justify-between">
        <button className="flex h-[52px] w-[132px] items-center gap-[10px] rounded-[16px] border border-[rgba(15,23,42,0.04)] bg-white px-[14px]">
          <CalendarDays className="h-5 w-5 text-[#344054]" />
          <span className="text-[18px] font-semibold text-[#1F2A44]">2026年4月</span>
          <ChevronDown className="ml-auto h-[18px] w-[18px] text-[#667085]" />
        </button>
        <div className="flex h-[52px] w-[184px] items-center gap-[10px] rounded-[16px] border border-[rgba(15,23,42,0.04)] bg-white px-4">
          <Search className="h-5 w-5 text-[#98A2B3]" />
          <span className="text-[14px] text-[#98A2B3]">搜索账单、商家、备注</span>
        </div>
        <button className="flex h-[52px] w-[58px] items-center justify-center rounded-[16px] border border-[rgba(15,23,42,0.04)] bg-white">
          <Filter className="h-5 w-5 text-[#344054]" />
        </button>
      </div>
      <div className="flex h-[44px] w-[398px] gap-[10px]">
        {filterChips.map((item, index) => (
          <button
            key={item}
            className={`flex h-[44px] min-w-[64px] items-center justify-center rounded-[14px] border px-[18px] text-[16px] font-semibold ${
              index === 0
                ? "border-[#2F6BFF] bg-[#2F6BFF] text-white"
                : "border-[rgba(15,23,42,0.04)] bg-white text-[#344054]"
            }`}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="flex h-[46px] w-[398px] rounded-[16px] border border-[rgba(15,23,42,0.04)] bg-white p-[6px]">
        {ranges.map((item, index) => (
          <button
            key={item}
            className={`flex h-[34px] flex-1 items-center justify-center rounded-[10px] text-[16px] font-semibold ${
              index === 0 ? "bg-[#EEF4FF] text-[#2F6BFF]" : "text-[#667085]"
            }`}
          >
            {item}
          </button>
        ))}
      </div>
      <section className="grid h-[116px] w-[398px] grid-cols-2 items-center rounded-[24px] border border-[rgba(15,23,42,0.04)] bg-white p-5 shadow-[0_4px_20px_rgba(15,23,42,0.04)]">
        <div className="pr-5">
          <div className="text-[14px] font-medium text-[#667085]">本月支出（AED）</div>
          <div className="mt-[10px] text-[24px] font-bold leading-[30px] text-[#FF5A6B]">7,109.71</div>
          <div className="mt-[12px] flex items-center justify-between">
            <div className="text-[14px] font-medium text-[#667085]">较上月</div>
            <div className="flex h-[44px] w-[44px] items-center justify-center rounded-[14px] bg-[#FFECEF]">
              <span className="text-[26px] font-semibold leading-none text-[#FF5A6B]">↗</span>
            </div>
          </div>
        </div>
        <div className="border-l border-[#EEF2F7] pl-5">
          <div className="text-[14px] font-medium text-[#667085]">本月收入（AED）</div>
          <div className="mt-[10px] text-[24px] font-bold leading-[30px] text-[#17B26A]">47,556.16</div>
          <div className="mt-[12px] flex items-center justify-between">
            <div className="text-[14px] font-medium text-[#667085]">较上月</div>
            <div className="flex h-[44px] w-[44px] items-center justify-center rounded-[14px] bg-[#EAFBF3]">
              <span className="text-[26px] font-semibold leading-none text-[#17B26A]">↗</span>
            </div>
          </div>
        </div>
      </section>
      <section className="flex w-[398px] flex-col gap-[14px]">
        {billGroups.map((group) => (
          <article
            key={`${group.title}-${group.subtitle}`}
            className="w-[398px] overflow-hidden rounded-[24px] border border-[rgba(15,23,42,0.04)] bg-white shadow-[0_4px_20px_rgba(15,23,42,0.04)]"
          >
            <header className="flex h-[52px] items-center justify-between px-[18px]">
              <div className="flex items-baseline gap-2">
                <span className="text-[18px] font-bold text-[#1F2A44]">{group.title}</span>
                <span className="text-[14px] font-medium text-[#667085]">{group.subtitle}</span>
              </div>
              <div className="flex items-center gap-4 text-[14px] font-medium">
                <span className="text-[#667085]">
                  支出 <span className="text-[#FF5A6B]">{group.expense}</span>
                </span>
                <span className="text-[#667085]">
                  收入 <span className="text-[#17B26A]">{group.income}</span>
                </span>
              </div>
            </header>
            <div className="px-[18px] pb-2">
              {group.items.map((item, index) => (
                <div
                  key={`${item.name}-${item.time}`}
                  className={`grid h-[76px] grid-cols-[48px_1fr_auto_16px] items-center gap-x-3 ${
                    index === 0 ? "" : "border-t border-[#F1F5F9]"
                  }`}
                >
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-full text-[18px] font-bold"
                    style={{ background: item.iconBg, color: item.iconColor }}
                  >
                    {item.iconText}
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="truncate text-[16px] font-semibold text-[#1F2A44]">{item.name}</div>
                    <div className="text-[13px] font-medium text-[#667085]">{item.account}</div>
                    <span
                      className="mt-1 inline-flex h-6 w-fit items-center rounded-[10px] px-[10px] text-[12px] font-semibold"
                      style={{ background: item.tag.bg, color: item.tag.color }}
                    >
                      {item.tag.label}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1 text-right">
                    <span
                      className="text-[16px] font-bold"
                      style={{ color: item.type === "收入" ? "#17B26A" : "#FF5A6B" }}
                    >
                      {item.amount}
                    </span>
                    <span className="text-[12px] font-medium text-[#98A2B3]">{item.time}</span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-[#98A2B3]" />
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>
    </>
  );
}

function StatsPage() {
  const statsDonut = useMemo(() => buildDonutSegments(statsShareItems, 36), []);
  const maxValue = 80;
  const chartHeight = 190;

  return (
    <>
      <FilterRow />
      <div className="flex h-[132px] w-[398px] gap-3">
        {statSummaryCards.map((card) => (
          <article
            key={card.title}
            className="flex h-[132px] w-[124.67px] flex-col justify-between rounded-[24px] border border-[rgba(15,23,42,0.04)] bg-white p-4 shadow-[0_4px_20px_rgba(15,23,42,0.04)]"
          >
            <div className="text-[14px] font-medium leading-5 text-[#667085]">{card.title}</div>
            <div className="text-[24px] font-bold leading-[30px]" style={{ color: card.amountColor }}>
              {card.amount}
            </div>
            <div className="text-[13px] leading-[18px] text-[#98A2B3]">较上月</div>
            <div className="flex items-center justify-between">
              <div className="inline-flex items-center gap-[6px] text-[12px] font-semibold" style={{ color: card.deltaColor }}>
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white shadow-[0_1px_4px_rgba(15,23,42,0.08)]">
                  ↑
                </span>
                {card.delta}
              </div>
              <div
                className="flex h-[44px] w-[44px] items-center justify-center rounded-[14px]"
                style={{ background: card.iconBg }}
              >
                <span className="text-[24px] font-semibold leading-none" style={{ color: card.amountColor }}>
                  {card.icon}
                </span>
              </div>
            </div>
          </article>
        ))}
      </div>
      <section className="h-[286px] w-[398px] rounded-[28px] border border-[rgba(15,23,42,0.04)] bg-white p-5 shadow-[0_4px_20px_rgba(15,23,42,0.04)]">
        <div className="flex h-8 items-center justify-between">
          <h2 className="text-[18px] font-bold text-[#1F2A44]">收支趋势</h2>
          <button className="flex items-center gap-1 text-[14px] font-semibold text-[#667085]">
            本年
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-2 flex h-6 items-center gap-5 text-[14px] font-medium text-[#667085]">
          <div className="flex items-center gap-[8px]">
            <span className="h-[10px] w-[10px] rounded-full bg-[#31C48D]" />
            收入（CNY）
          </div>
          <div className="flex items-center gap-[8px]">
            <span className="h-[10px] w-[10px] rounded-full bg-[#FF5A6B]" />
            支出（CNY）
          </div>
        </div>
        <div className="mt-3 flex h-[190px] w-full px-1">
          <div className="flex w-9 flex-col justify-between pb-8 pt-[10px] text-[12px] text-[#667085]">
            {["80K", "60K", "40K", "20K", "0"].map((tick) => (
              <span key={tick}>{tick}</span>
            ))}
          </div>
          <div className="relative flex-1">
            <div className="absolute inset-x-0 top-[14px] border-t border-dashed border-[#E4EAF5]" />
            <div className="absolute inset-x-0 top-[48px] border-t border-dashed border-[#E4EAF5]" />
            <div className="absolute inset-x-0 top-[88px] border-t border-dashed border-[#E4EAF5]" />
            <div className="absolute inset-x-0 top-[128px] border-t border-dashed border-[#E4EAF5]" />
            <div className="absolute inset-x-0 bottom-8 border-t border-[#EEF2F7]" />
            <div className="flex h-full items-end justify-between pb-0">
              {trendData.map((item) => {
                const incomeHeight = (item.income / maxValue) * chartHeight;
                const expenseHeight = (item.expense / maxValue) * chartHeight;

                return (
                  <div key={item.month} className="flex w-[42px] flex-col items-center justify-end">
                    <div className="relative flex h-[166px] items-end gap-2">
                      <TrendBubble color={item.highlight ? "#2F6BFF" : "#31C48D"} label={item.incomeLabel} y={incomeHeight} />
                      <TrendBubble color="#FF5A6B" label={item.expenseLabel} y={expenseHeight} align="right" />
                      <div
                        className="w-[18px] rounded-t-[10px]"
                        style={{
                          height: `${incomeHeight}px`,
                          background: item.highlight
                            ? "linear-gradient(180deg, #4C8DFF 0%, #2F6BFF 100%)"
                            : "linear-gradient(180deg, #6AD6A8 0%, #55C996 100%)"
                        }}
                      />
                      <div
                        className="w-[18px] rounded-t-[10px]"
                        style={{
                          height: `${expenseHeight}px`,
                          background: "linear-gradient(180deg, #FF8A95 0%, #FF5A6B 100%)"
                        }}
                      />
                    </div>
                    <div className={`mt-[10px] text-[12px] ${item.highlight ? "font-semibold text-[#2F6BFF]" : "text-[#667085]"}`}>
                      {item.month}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>
      <div className="flex w-[398px] gap-3">
        <section className="h-[206px] w-[193px] rounded-[24px] border border-[rgba(15,23,42,0.04)] bg-white p-[18px] shadow-[0_4px_20px_rgba(15,23,42,0.04)]">
          <h3 className="mb-[14px] text-[18px] font-bold text-[#1F2A44]">支出分类占比</h3>
          <div className="flex items-center gap-[14px]">
            <div className="relative h-[102px] w-[102px] shrink-0">
              <svg viewBox="0 0 102 102" className="h-[102px] w-[102px]">
                <circle cx="51" cy="51" r="36" fill="none" stroke="#EEF4FF" strokeWidth="14" />
                {statsDonut.map((segment) => (
                  <circle
                    key={segment.label}
                    cx="51"
                    cy="51"
                    r="36"
                    fill="none"
                    stroke={segment.color}
                    strokeDasharray={`${segment.length} ${segment.gap}`}
                    strokeDashoffset={segment.offset}
                    strokeWidth="14"
                    transform="rotate(-90 51 51)"
                  />
                ))}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="text-[16px] font-bold text-[#1F2A44]">7,109.71</div>
                <div className="text-[12px] text-[#98A2B3]">总支出</div>
              </div>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-[10px]">
              {statsShareItems.map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
                    <span className="text-[13px] font-medium text-[#667085]">{item.label}</span>
                  </div>
                  <span className="text-[13px] font-semibold text-[#667085]">{item.percent.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="h-[206px] w-[193px] rounded-[24px] border border-[rgba(15,23,42,0.04)] bg-white p-[18px] shadow-[0_4px_20px_rgba(15,23,42,0.04)]">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[18px] font-bold text-[#1F2A44]">支出分类排行</h3>
            <button className="flex items-center gap-1 text-[14px] font-semibold text-[#667085]">
              查看全部
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="flex flex-col gap-3">
            {rankingItems.map((item) => (
              <div key={item.rank} className="grid h-6 grid-cols-[24px_24px_1fr_auto_auto] items-center gap-x-[10px]">
                <div
                  className="flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold text-white"
                  style={{ background: item.rankBg, color: item.rank >= 4 ? "#667085" : "#FFFFFF" }}
                >
                  {item.rank}
                </div>
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#F8FAFC]">
                  <RankingIcon type={item.icon} color={item.iconColor} />
                </div>
                <div className="truncate text-[14px] font-semibold text-[#344054]">{item.label}</div>
                <div className="text-[14px] font-semibold text-[#344054]">{item.amount}</div>
                <div className="text-[14px] font-semibold" style={{ color: item.percentColor }}>
                  {item.percent}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
      <section className="flex h-[78px] w-[398px] items-center justify-between rounded-[24px] border border-[rgba(15,23,42,0.04)] bg-white px-[18px] shadow-[0_4px_20px_rgba(15,23,42,0.04)]">
        <div className="flex items-center gap-[14px]">
          <div className="flex h-[42px] w-[42px] items-center justify-center rounded-full bg-[linear-gradient(135deg,#7C6CFF_0%,#8C7BFF_100%)]">
            <TrendingUp className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="text-[16px] font-bold leading-[22px] text-[#1F2A44]">
              本月支出较上月增加 <span className="text-[#FF5A6B]">13.2%</span>
            </div>
            <div className="text-[13px] font-medium leading-[18px] text-[#667085]">
              主要增长来自 餐饮（+18.6%） 和 购物（+17.3%）
            </div>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-[#98A2B3]" />
      </section>
    </>
  );
}

function AssetsPage() {
  const assetDonut = useMemo(() => buildDonutSegments(assetDistributionItems, 40), []);
  const smoothPath = createNormalizedSmoothPath(assetLinePoints, 56);
  const areaPath = `${smoothPath} L 372 56 L 0 56 Z`;

  return (
    <>
      <div className="flex h-[44px] w-[398px] items-center justify-between">
        <div className="flex items-center gap-[10px]">
          <h1 className="text-[28px] font-bold leading-[34px] text-[#1F2A44]">资产</h1>
          <Eye className="h-5 w-5 text-[#98A2B3]" />
        </div>
        <button className="flex h-[44px] w-[96px] items-center justify-center gap-2 rounded-[14px] border border-[rgba(15,23,42,0.04)] bg-white text-[14px] font-semibold text-[#667085]">
          所有账户
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
      <section className="flex h-[178px] w-[398px] flex-col justify-between rounded-[24px] border border-[rgba(15,23,42,0.04)] bg-white p-5 shadow-[0_4px_20px_rgba(15,23,42,0.04)]">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-[6px] text-[16px] font-medium text-[#667085]">
              总资产（估值）
              <Info className="h-4 w-4 text-[#98A2B3]" />
            </div>
            <div className="mt-2 flex items-end gap-[6px]">
              <span className="text-[52px] font-bold leading-[58px] tracking-[-0.04em] text-[#1F2A44]">
                128,946.38
              </span>
              <span className="mb-[8px] text-[18px] font-semibold text-[#667085]">AED</span>
            </div>
            <div className="mt-[10px] text-[18px] font-semibold text-[#17B26A]">
              +7,718.23 AED (+6.34%)
            </div>
          </div>
          <div className="flex h-10 w-[176px] rounded-[14px] border border-[rgba(15,23,42,0.04)] bg-white p-1">
            {["1天", "7天", "30天", "自定义"].map((item, index) => (
              <button
                key={item}
                className={`flex h-8 flex-1 items-center justify-center rounded-[10px] text-[14px] font-semibold ${
                  index === 0 ? "bg-[#EEF4FF] text-[#2F6BFF]" : "text-[#667085]"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="h-[56px] w-full">
          <svg viewBox="0 0 372 56" className="h-[56px] w-full">
            <defs>
              <linearGradient id="assetArea" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#2F6BFF" stopOpacity="0.16" />
                <stop offset="100%" stopColor="#2F6BFF" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            <path d={areaPath} fill="url(#assetArea)" />
            <path
              d={smoothPath}
              fill="none"
              stroke="#2F6BFF"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="372" cy="10" r="5.5" fill="#2F6BFF" />
            <circle cx="372" cy="10" r="9" fill="#2F6BFF" fillOpacity="0.14" />
          </svg>
        </div>
      </section>
      <section className="h-[194px] w-[398px] rounded-[24px] border border-[rgba(15,23,42,0.04)] bg-white p-5 shadow-[0_4px_20px_rgba(15,23,42,0.04)]">
        <div className="flex items-center justify-between">
          <h2 className="text-[18px] font-bold text-[#1F2A44]">资产分布（占比）</h2>
          <button className="flex items-center gap-[4px] text-[14px] font-semibold text-[#667085]">
            查看详情
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-[14px] flex items-center gap-[18px]">
          <div className="relative h-[118px] w-[118px] shrink-0">
            <svg viewBox="0 0 118 118" className="h-[118px] w-[118px]">
              <circle cx="59" cy="59" r="40" fill="none" stroke="#EEF4FF" strokeWidth="16" />
              {assetDonut.map((segment) => (
                <circle
                  key={segment.label}
                  cx="59"
                  cy="59"
                  r="40"
                  fill="none"
                  stroke={segment.color}
                  strokeDasharray={`${segment.length} ${segment.gap}`}
                  strokeDashoffset={segment.offset}
                  strokeWidth="16"
                  transform="rotate(-90 59 59)"
                />
              ))}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-[16px] font-bold text-[#1F2A44]">128,946.38</div>
              <div className="text-[12px] font-medium text-[#98A2B3]">AED</div>
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-[10px]">
            {assetDistributionItems.map((item) => (
              <div key={item.label} className="grid grid-cols-[10px_1fr_auto_auto] items-center gap-x-[10px]">
                <span className="h-[10px] w-[10px] rounded-full" style={{ background: item.color }} />
                <span className="text-[14px] text-[#344054]">{item.label}</span>
                <span className="text-[14px] font-semibold text-[#667085]">{item.percent.toFixed(1)}%</span>
                <span className="text-[14px] font-semibold text-[#667085]">{item.amount}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
      <div className="grid w-[398px] grid-cols-2 gap-3">
        {assetCards.map((card) => (
          <section
            key={card.title}
            className="min-h-[162px] w-[193px] rounded-[24px] border border-[rgba(15,23,42,0.04)] bg-white p-[18px] shadow-[0_4px_20px_rgba(15,23,42,0.04)]"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-[10px]">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-[12px]"
                  style={{ background: card.iconBg, color: card.iconColor }}
                >
                  <AssetTypeIcon type={card.icon} />
                </div>
                <div className="text-[16px] font-bold text-[#1F2A44]">{card.title}</div>
              </div>
              <div className="text-[16px] font-bold text-[#2F6BFF]">{card.total}</div>
            </div>
            <div className="mt-[2px] text-[13px] text-[#98A2B3]">&nbsp;</div>
            <div className="mt-[14px] flex flex-col gap-3">
              {card.rows.map((row) => (
                <div key={row.name} className="grid grid-cols-[32px_1fr_auto_12px] items-center gap-x-[10px]">
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-bold"
                    style={{ background: row.iconBg, color: row.iconColor }}
                  >
                    {row.iconText}
                  </div>
                  <div className="text-[14px] font-semibold text-[#344054]">{row.name}</div>
                  <div className="text-[14px] font-semibold text-[#344054]">{row.amount}</div>
                  <ChevronRight className="h-3 w-3 text-[#98A2B3]" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      <section className="w-[398px] rounded-[24px] border border-[rgba(15,23,42,0.04)] bg-white p-[18px] shadow-[0_4px_20px_rgba(15,23,42,0.04)]">
        <div className="flex items-center justify-between">
          <h2 className="text-[18px] font-bold text-[#1F2A44]">最近变动</h2>
          <button className="flex items-center gap-[4px] text-[14px] font-semibold text-[#667085]">
            查看全部
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 flex flex-col">
          {changeRows.map((row, index) => (
            <div
              key={`${row.name}-${row.time}`}
              className={`grid h-[68px] grid-cols-[40px_1fr_auto_auto] items-center gap-x-3 ${
                index === 0 ? "" : "border-t border-[#F1F5F9]"
              }`}
            >
              <div
                className="flex h-10 w-10 items-center justify-center rounded-full text-[14px] font-bold"
                style={{ background: row.iconBg, color: row.iconColor }}
              >
                {row.iconText}
              </div>
              <div>
                <div className="text-[15px] font-semibold text-[#1F2A44]">{row.name}</div>
                <div className="text-[12px] text-[#98A2B3]">{row.sub}</div>
              </div>
              <div className="text-right">
                <div className="text-[16px] font-bold" style={{ color: row.positive ? "#17B26A" : "#FF5A6B" }}>
                  {row.amount}
                </div>
                <div className="text-[12px] text-[#98A2B3]">{row.currency}</div>
              </div>
              <div className="text-right">
                <div className="text-[12px] text-[#98A2B3]">{row.time}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function FilterRow() {
  return (
    <div className="flex h-[52px] w-[398px] items-center justify-between">
      <button className="flex h-[52px] w-[132px] items-center gap-[10px] rounded-[16px] border border-[rgba(15,23,42,0.04)] bg-white px-[14px] shadow-[0_4px_20px_rgba(15,23,42,0.04)]">
        <CalendarDays className="h-5 w-5 text-[#344054]" />
        <span className="text-[18px] font-semibold text-[#1F2A44]">2026年4月</span>
        <ChevronDown className="ml-auto h-[18px] w-[18px] text-[#667085]" />
      </button>
      <div className="flex h-[52px] w-[176px] rounded-[16px] border border-[rgba(15,23,42,0.04)] bg-white p-[6px] shadow-[0_4px_20px_rgba(15,23,42,0.04)]">
        {["月", "年", "自定义"].map((item, index) => (
          <button
            key={item}
            className={`flex-1 rounded-[12px] text-[16px] font-semibold ${
              index === 0 ? "bg-[#EEF4FF] text-[#2F6BFF]" : "bg-transparent text-[#667085]"
            }`}
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}

function StatusBar() {
  return (
    <div className="flex h-7 w-[398px] items-center justify-between">
      <span className="text-[18px] font-bold leading-none text-[#101828]">9:41</span>
      <div className="flex h-[18px] w-[86px] items-center justify-end gap-[6px]">
        <div className="flex h-[14px] items-end gap-[3px]">
          {[8, 11, 14, 17].map((height, index) => (
            <span
              key={height}
              className="w-[4px] rounded-full bg-[#101828]"
              style={{ height, opacity: index === 0 ? 0.7 : 1 }}
            />
          ))}
        </div>
        <WifiGlyph />
        <div className="relative flex h-[18px] w-[32px] items-center justify-center rounded-[6px] bg-[#101828] text-[11px] font-bold leading-none text-white">
          100
          <span className="absolute -right-[2px] top-[5px] h-[8px] w-[2px] rounded-r-full bg-[#101828]" />
        </div>
      </div>
    </div>
  );
}

function BrandBar() {
  return (
    <div className="flex h-12 w-[398px] items-center justify-between">
      <div className="flex items-center gap-[10px]">
        <div className="flex h-[34px] w-[34px] items-center justify-center overflow-hidden rounded-[10px] bg-[linear-gradient(150deg,#7AB2FF_0%,#2F6BFF_58%,#DCEBFF_100%)] shadow-[0_8px_18px_rgba(47,107,255,0.18)]">
          <div className="relative h-[24px] w-[18px]">
            <span className="absolute left-0 top-0 h-full w-[9px] rounded-r-[8px] rounded-tl-[8px] bg-white/95" />
            <span className="absolute right-0 top-[2px] h-[10px] w-[10px] rounded-full bg-white/80" />
            <span className="absolute right-[1px] bottom-[1px] h-[10px] w-[10px] rounded-full bg-white/80" />
          </div>
        </div>
        <div className="flex items-baseline text-[24px] font-bold leading-[30px] tracking-[-0.04em] text-[#1D2B53]">
          <span className="italic">BitLedger</span>
          <span className="ml-2 italic text-[#2F6BFF]">Pro</span>
        </div>
      </div>
      <div className="flex items-center gap-[18px] text-[#344054]">
        <Search className="h-6 w-6 stroke-[2.1]" />
        <div className="relative">
          <Bell className="h-6 w-6 stroke-[2.1]" />
          <span className="absolute right-[1px] top-[1px] h-2 w-2 rounded-full bg-[#FF4D5E]" />
        </div>
        <div className="h-9 w-9 rounded-full bg-[radial-gradient(circle_at_50%_25%,#D9ECFF_0%,#93B9FF_35%,#165DFF_64%,#0838AE_100%)] shadow-[0_8px_18px_rgba(47,107,255,0.16)]" />
      </div>
    </div>
  );
}

function HomeSummaryCard({
  title,
  amount,
  amountColor,
  delta,
  deltaColor,
  plateBg,
  rotate
}: {
  title: string;
  amount: string;
  amountColor: string;
  delta: string;
  deltaColor: string;
  plateBg: string;
  rotate?: boolean;
}) {
  return (
    <article className="flex h-[112px] w-[193px] flex-col rounded-[24px] border border-[rgba(15,23,42,0.04)] bg-white p-4 shadow-[0_4px_20px_rgba(15,23,42,0.04)]">
      <div className="text-[14px] font-medium text-[#667085]">{title}</div>
      <div className="mt-[8px] text-[24px] font-bold leading-[30px]" style={{ color: amountColor }}>
        {amount}
      </div>
      <div className="mt-auto flex items-end justify-between">
        <div className="space-y-[4px]">
          <div className="text-[13px] font-medium text-[#98A2B3]">较上月</div>
          <div className="inline-flex items-center gap-[6px] text-[12px] font-semibold" style={{ color: deltaColor }}>
            <span className="inline-flex h-[16px] w-[16px] items-center justify-center rounded-full bg-white shadow-[0_1px_4px_rgba(15,23,42,0.08)]">
              ↑
            </span>
            {delta}
          </div>
        </div>
        <div className="flex h-[44px] w-[44px] items-center justify-center rounded-[14px]" style={{ background: plateBg }}>
          <ArrowUpRight
            className={`h-6 w-6 stroke-[2.4] ${rotate ? "rotate-90" : ""}`}
            style={{ color: amountColor }}
          />
        </div>
      </div>
    </article>
  );
}

function BudgetRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-[10px] text-[14px] font-medium text-[#667085]">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        {label}
      </div>
      <span className="text-[14px] font-medium text-[#1F2A44]">{value}</span>
    </div>
  );
}

function TrendBubble({
  color,
  label,
  y,
  align = "left"
}: {
  color: string;
  label: string;
  y: number;
  align?: "left" | "right";
}) {
  return (
    <div
      className={`absolute min-w-[36px] rounded-[10px] border bg-white px-2 py-[3px] text-center text-[12px] font-semibold ${
        align === "left" ? "left-[-10px]" : "right-[-10px]"
      }`}
      style={{
        bottom: `${y + 14}px`,
        color,
        borderColor: `${color}55`
      }}
    >
      {label}
      <span
        className="absolute left-1/2 top-full h-[8px] w-[8px] -translate-x-1/2 rotate-45 border-b border-r bg-white"
        style={{ borderColor: `${color}55` }}
      />
    </div>
  );
}

function TabBar({ page, onChange }: { page: PageKey; onChange: (page: PageKey) => void }) {
  const items = [
    { key: "home" as const, label: "首页", icon: Home },
    { key: "bills" as const, label: "账单", icon: BookText },
    { key: "stats" as const, label: "统计", icon: PieChart },
    { key: "assets" as const, label: "资产", icon: Wallet }
  ];

  return (
    <div className="pointer-events-none fixed bottom-3 left-1/2 z-20 w-full max-w-[430px] -translate-x-1/2 px-4">
      <nav className="pointer-events-auto flex h-[84px] w-[398px] items-center justify-around rounded-[28px] border border-[rgba(15,23,42,0.04)] bg-[rgba(255,255,255,0.96)] shadow-[0_8px_32px_rgba(15,23,42,0.08)] backdrop-blur-[16px]">
        {items.map((item) => {
          const active = page === item.key;
          return (
            <button
              key={item.key}
              onClick={() => onChange(item.key)}
              className="flex h-[60px] w-[72px] flex-col items-center justify-center gap-[6px]"
            >
              <item.icon className="h-6 w-6" style={{ color: active ? "#2F6BFF" : "#667085" }} />
              <span className="text-[12px] font-semibold" style={{ color: active ? "#2F6BFF" : "#667085" }}>
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function AssetTypeIcon({ type }: { type: AssetCard["icon"] }) {
  if (type === "bank") return <Landmark className="h-4 w-4" />;
  if (type === "wallet") return <Wallet className="h-4 w-4" />;
  if (type === "exchange") return <Building2 className="h-4 w-4" />;
  return <CircleDollarSign className="h-4 w-4" />;
}

function RankingIcon({ type, color }: { type: RankingItem["icon"]; color: string }) {
  if (type === "food") return <UtensilsCrossed className="h-[14px] w-[14px]" style={{ color }} />;
  if (type === "traffic") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M3 9V6.8C3 5.1 4.4 3.8 6.1 3.8H7.9C9.6 3.8 11 5.1 11 6.8V9" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M2.5 9H11.5V10.4C11.5 10.7 11.2 11 10.9 11H3.1C2.8 11 2.5 10.7 2.5 10.4V9Z" fill={color} />
        <circle cx="4.2" cy="10.8" r="1" fill={color} />
        <circle cx="9.8" cy="10.8" r="1" fill={color} />
      </svg>
    );
  }
  if (type === "shopping") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M4.2 4.7H9.8L10.5 11H3.5L4.2 4.7Z" stroke={color} strokeWidth="1.4" />
        <path d="M5.2 5V4.2C5.2 3.2 6 2.4 7 2.4C8 2.4 8.8 3.2 8.8 4.2V5" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "transfer") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M3 4.5H10.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M8.5 2.8L10.8 4.5L8.5 6.2" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M11 9.5H3.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M5.5 7.8L3.2 9.5L5.5 11.2" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return <TrendingUp className="h-[14px] w-[14px]" style={{ color }} />;
}

function WifiGlyph() {
  return (
    <svg width="18" height="14" viewBox="0 0 18 14" fill="none" aria-hidden="true">
      <path d="M1 4.5C5.8 0.8 12.2 0.8 17 4.5" stroke="#101828" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M4 8C7 5.8 11 5.8 14 8" stroke="#101828" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M7.5 11.2C8.4 10.6 9.6 10.6 10.5 11.2" stroke="#101828" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function createSmoothPath(points: ReadonlyArray<readonly [number, number]>) {
  if (points.length === 0) return "";
  let path = `M ${points[0][0]} ${points[0][1]}`;
  for (let index = 1; index < points.length; index += 1) {
    const [x0, y0] = points[index - 1];
    const [x1, y1] = points[index];
    const controlX = (x0 + x1) / 2;
    path += ` C ${controlX} ${y0} ${controlX} ${y1} ${x1} ${y1}`;
  }
  return path;
}

function createNormalizedSmoothPath(points: ReadonlyArray<readonly [number, number]>, baseY: number) {
  const normalized = points.map(([x, y]) => [x, baseY + y] as const);
  return createSmoothPath(normalized);
}

function buildDonutSegments(items: Array<{ label: string; percent: number; color: string }>, radius: number) {
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return items.map((item) => {
    const length = (item.percent / 100) * circumference;
    const segment = {
      label: item.label,
      color: item.color,
      length,
      gap: circumference - length,
      offset: -offset
    };
    offset += length;
    return segment;
  });
}

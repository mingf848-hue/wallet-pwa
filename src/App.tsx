import {
  Bell,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Eye,
  FileText,
  Menu,
  Plus,
  Search,
  Wallet,
  ChartNoAxesColumn,
  SlidersHorizontal,
  Sparkles,
  Signal,
  Wifi,
  BatteryFull,
} from "lucide-react";

type SummaryCardProps = {
  title: string;
  amount: string;
  delta: string;
  deltaDirection: "up" | "down";
  amountColor: string;
  chartColor: string;
  background: string;
  border: string;
  glow: string;
  chartPath: string;
};

type LedgerItem = {
  id: number;
  title: string;
  subtitle: string;
  tag: string;
  amount: string;
  currency: string;
  amountClassName: string;
  icon: "apple" | "okx" | "bitget";
};

const tabs = ["全部", "支付平台", "交易所", "银行", "电子钱包", "更多"];

const ledgerItems: LedgerItem[] = [
  {
    id: 1,
    title: "Apple Pay 自动记账",
    subtitle: "4/22   Mashreq Bank",
    tag: "消费",
    amount: "−27.25",
    currency: "AED",
    amountClassName: "text-[#23d169]",
    icon: "apple",
  },
  {
    id: 2,
    title: "Ai",
    subtitle: "4/22   Mashreq Bank",
    tag: "消费",
    amount: "−114.24",
    currency: "AED",
    amountClassName: "text-[#23d169]",
    icon: "apple",
  },
  {
    id: 3,
    title: "OKX 理财收益",
    subtitle: "4/22   OKX",
    tag: "理财",
    amount: "+0.03619824",
    currency: "USDT",
    amountClassName: "text-[#ff5a5f]",
    icon: "okx",
  },
  {
    id: 4,
    title: "火币 理财收益",
    subtitle: "4/22   火币",
    tag: "理财",
    amount: "+0.4434729",
    currency: "USDT",
    amountClassName: "text-[#ff5a5f]",
    icon: "bitget",
  },
  {
    id: 5,
    title: "Bitget 理财收益",
    subtitle: "4/22   Bitget",
    tag: "理财",
    amount: "+8.22109589",
    currency: "USDT",
    amountClassName: "text-[#ff5a5f]",
    icon: "bitget",
  },
  {
    id: 6,
    title: "Apple Pay 自动记账",
    subtitle: "4/22   Mashreq Bank",
    tag: "消费",
    amount: "−20.00",
    currency: "AED",
    amountClassName: "text-[#23d169]",
    icon: "apple",
  },
];

function SummaryCard({
  title,
  amount,
  delta,
  deltaDirection,
  amountColor,
  chartColor,
  background,
  border,
  glow,
  chartPath,
}: SummaryCardProps) {
  const deltaColor = deltaDirection === "down" ? "#23d169" : "#ff5a5f";

  return (
    <div
      className="relative h-[124px] flex-1 overflow-hidden rounded-[24px] border px-[18px] pb-[16px] pt-[18px]"
      style={{ background, borderColor: border, boxShadow: glow }}
    >
      <div
        className="absolute right-[-8px] top-[-24px] h-[106px] w-[106px] rounded-full opacity-80"
        style={{
          background:
            deltaDirection === "down"
              ? "radial-gradient(circle, rgba(35,209,105,0.18) 0%, rgba(35,209,105,0.06) 50%, rgba(35,209,105,0) 72%)"
              : "radial-gradient(circle, rgba(255,90,95,0.22) 0%, rgba(255,90,95,0.08) 50%, rgba(255,90,95,0) 72%)",
        }}
      />
      <div className="relative flex items-center gap-2 text-[15px] font-semibold tracking-[0.01em] text-white/85">
        <span>{title}</span>
        <Eye size={16} strokeWidth={2.2} className="text-white/55" />
      </div>
      <div className="relative mt-[20px] text-[33px] font-semibold leading-none tracking-[-0.04em]" style={{ color: amountColor }}>
        {amount}
      </div>
      <div className="relative mt-[22px] flex items-end justify-between">
        <div className="flex items-center gap-[8px] text-[14px]">
          <span className="text-white/45">较上月</span>
          <span className="font-semibold" style={{ color: deltaColor }}>
            {delta}
          </span>
        </div>
        <svg width="118" height="34" viewBox="0 0 118 34" fill="none" className="opacity-95">
          <path
            d={chartPath}
            stroke={chartColor}
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}

function AppIcon({ type }: { type: LedgerItem["icon"] }) {
  if (type === "apple") {
    return (
      <div className="flex h-[50px] w-[50px] items-center justify-center rounded-full bg-[#f5f1ed] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
        <div className="relative h-[22px] w-[26px]">
          <span className="absolute left-[1px] top-[10px] h-[9px] w-[11px] rotate-[-18deg] rounded-[10px_10px_10px_2px] bg-[#ff9b2f]" />
          <span className="absolute left-[8px] top-[5px] h-[13px] w-[12px] rotate-[12deg] rounded-[12px_12px_12px_2px] bg-[#ff6937]" />
          <span className="absolute left-[15px] top-[10px] h-[10px] w-[9px] rotate-[28deg] rounded-[10px_10px_2px_10px] bg-[#ff7e1f]" />
          <span className="absolute left-[11px] top-0 h-[6px] w-[4px] rotate-[18deg] rounded-full bg-[#f8b348]" />
        </div>
      </div>
    );
  }

  if (type === "okx") {
    return (
      <div className="flex h-[50px] w-[50px] items-center justify-center rounded-full bg-[#d6d3cf]">
        <div className="grid grid-cols-3 gap-[2px]">
          {["bg-black", "bg-black", "bg-black", "bg-black", "bg-black", "bg-black", "bg-black", "bg-black", "bg-black"].map(
            (className, index) => (
              <span
                key={index}
                className={`${className} h-[6px] w-[6px] ${index === 1 || index === 5 || index === 7 ? "opacity-0" : ""}`}
              />
            ),
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[50px] w-[50px] items-center justify-center rounded-full bg-[#39d7f1]">
      <div className="relative h-[22px] w-[22px]">
        <span className="absolute left-0 top-[2px] h-[8px] w-[18px] -rotate-45 rounded-[2px] bg-[#041117]" />
        <span className="absolute right-0 top-[12px] h-[8px] w-[18px] -rotate-45 rounded-[2px] bg-[#041117]" />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <div className="min-h-screen bg-[#090f21] text-white">
      <div className="mx-auto min-h-screen w-full max-w-[430px] bg-[#090f21]">
        <div className="relative min-h-screen overflow-hidden px-[20px] pb-[30px] pt-[8px]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(12,25,58,0.6),rgba(9,15,33,0)_38%)]" />
          <div className="relative z-10 flex min-h-screen flex-col">
            <header className="pt-[calc(env(safe-area-inset-top)+4px)]">
              <div className="flex items-center justify-between text-white">
                <span className="text-[16px] font-semibold tracking-[0.02em]">9:41</span>
                <div className="flex items-center gap-[7px]">
                  <Signal size={15} strokeWidth={2.4} />
                  <Wifi size={15} strokeWidth={2.4} />
                  <BatteryFull size={20} strokeWidth={2.1} />
                </div>
              </div>

              <div className="mt-[18px] flex items-start justify-between">
                <div className="flex items-start gap-[16px]">
                  <button className="mt-[8px] text-white/75">
                    <Menu size={33} strokeWidth={2.2} />
                  </button>
                  <div>
                    <div className="flex items-baseline gap-[8px]">
                      <h1 className="text-[34px] font-bold leading-none tracking-[-0.05em] text-white">BitLedger</h1>
                      <span className="text-[34px] font-bold leading-none tracking-[-0.05em] text-[#13d6ff]">Pro</span>
                    </div>
                    <div className="mt-[10px] inline-flex h-[28px] items-center gap-[7px] rounded-full bg-[linear-gradient(90deg,#4d4eff_0%,#7c55ff_45%,#8d5cff_100%)] px-[14px]">
                      <span className="text-[14px] leading-none">💎</span>
                      <span className="text-[13px] font-semibold tracking-[0.01em] text-white">Pro</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-[16px]">
                  <button className="flex h-[48px] items-center gap-[10px] rounded-[18px] border border-white/10 bg-[rgba(20,28,50,0.92)] px-[18px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]">
                    <Sparkles size={17} className="text-[#7f5cff]" />
                    <span className="text-[16px] font-medium text-white/92">Gemini</span>
                  </button>
                  <button className="relative pr-[2px] text-white/75">
                    <Bell size={29} strokeWidth={2.1} />
                    <span className="absolute right-0 top-0 h-[10px] w-[10px] rounded-full bg-[#13d6ff]" />
                  </button>
                </div>
              </div>
            </header>

            <main className="flex-1">
              <div className="mt-[26px]">
                <button className="flex h-[64px] w-[150px] items-center justify-between rounded-[20px] border border-white/8 bg-[linear-gradient(180deg,rgba(25,34,57,0.92)_0%,rgba(20,28,48,0.94)_100%)] px-[18px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)]">
                  <div className="flex items-center gap-[12px]">
                    <CalendarDays size={22} className="text-[#13d6ff]" />
                    <span className="text-[17px] font-semibold tracking-[0.01em] text-white">2026年4月</span>
                  </div>
                  <ChevronDown size={18} className="text-white/45" />
                </button>
              </div>

              <section className="mt-[28px] grid grid-cols-2 gap-[20px]">
                <SummaryCard
                  title="本月支出（CNY）"
                  amount="-¥7,109.71"
                  delta="↓ 18.6%"
                  deltaDirection="down"
                  amountColor="#23d169"
                  chartColor="#23d169"
                  background="linear-gradient(135deg, rgba(12,22,39,0.96) 0%, rgba(9,20,32,0.96) 100%)"
                  border="rgba(36, 209, 105, 0.22)"
                  glow="inset 0 0 0 1px rgba(35,209,105,0.06)"
                  chartPath="M3 13.5L17 3L31 12L44 6.5L58 10.5L70 10L81 14L95 14.5L108 21L115 14"
                />
                <SummaryCard
                  title="本月收入（CNY）"
                  amount="¥47,556.16"
                  delta="↑ 32.4%"
                  deltaDirection="up"
                  amountColor="#ff5a5f"
                  chartColor="#ff5a5f"
                  background="linear-gradient(135deg, rgba(27,20,35,0.95) 0%, rgba(29,19,32,0.95) 100%)"
                  border="rgba(255, 90, 95, 0.22)"
                  glow="inset 0 0 0 1px rgba(255,90,95,0.05)"
                  chartPath="M3 19L17 3.5L32 12L46 8L59 14L71 12L85 19L98 6L109 10L115 8"
                />
              </section>

              <section className="mt-[24px] rounded-[24px] bg-[linear-gradient(90deg,#2b1b7d_0%,#241d6a_56%,#1f1d56_100%)] px-[18px] pb-[18px] pt-[16px]">
                <div className="text-[15px] font-semibold text-white/92">本月结余 (CNY)</div>
                <div className="mt-[16px] flex items-end justify-between gap-[16px]">
                  <div className="text-[46px] font-medium leading-none tracking-[-0.05em] text-white">¥40,446.45</div>
                  <button className="flex h-[64px] min-w-[138px] items-center justify-center gap-[12px] rounded-[20px] bg-white/8 px-[20px]">
                    <ChartNoAxesColumn size={22} className="text-white/82" />
                    <span className="text-[17px] font-semibold text-white/92">查看分析</span>
                    <ChevronRight size={20} className="text-white/66" />
                  </button>
                </div>
              </section>

              <section className="mt-[26px] flex gap-[12px] overflow-x-auto pb-[4px]">
                {tabs.map((tab, index) => (
                  <button
                    key={tab}
                    className={`h-[46px] shrink-0 rounded-[16px] px-[18px] text-[16px] font-semibold ${
                      index === 0
                        ? "bg-[linear-gradient(90deg,#8e54ff_0%,#3bc9ff_100%)] text-white shadow-[0_0_0_1px_rgba(255,255,255,0.05)]"
                        : "bg-[#161f34] text-white/82"
                    } ${tab === "更多" ? "flex items-center gap-[4px] pr-[16px]" : ""}`}
                  >
                    <span>{tab}</span>
                    {tab === "更多" ? <ChevronDown size={16} className="text-white/60" /> : null}
                  </button>
                ))}
              </section>

              <section className="mt-[34px]">
                <div className="flex items-center justify-between">
                  <h2 className="text-[28px] font-bold tracking-[-0.04em] text-white">账单明细</h2>
                  <div className="flex items-center gap-[20px] text-white/78">
                    <Search size={30} strokeWidth={2.1} />
                    <SlidersHorizontal size={30} strokeWidth={2.1} />
                  </div>
                </div>

                <div className="mt-[18px] overflow-hidden rounded-[22px] border border-white/5 bg-[rgba(15,22,41,0.95)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)]">
                  {ledgerItems.map((item, index) => (
                    <div
                      key={item.id}
                      className={`flex items-center gap-[14px] px-[16px] py-[16px] ${
                        index !== ledgerItems.length - 1 ? "border-b border-white/[0.04]" : ""
                      }`}
                    >
                      <AppIcon type={item.icon} />

                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[18px] font-semibold tracking-[-0.02em] text-white">{item.title}</div>
                        <div className="mt-[6px] flex items-center gap-[10px] text-[16px] text-white/42">
                          <span>{item.subtitle}</span>
                          <span className="rounded-[10px] bg-white/[0.04] px-[10px] py-[4px] text-[14px] text-white/35">
                            {item.tag}
                          </span>
                        </div>
                      </div>

                      <div className="text-right">
                        <div className={`text-[23px] font-semibold tracking-[-0.04em] ${item.amountClassName}`}>{item.amount}</div>
                        <div className="mt-[6px] text-[16px] text-white/48">{item.currency}</div>
                      </div>

                      <ChevronRight size={24} className="shrink-0 text-white/42" />
                    </div>
                  ))}
                </div>
              </section>
            </main>

            <footer className="relative mt-[18px] -mx-[20px] mb-[-30px] border-t border-white/[0.06] bg-[rgba(14,21,40,0.96)] px-[40px] pb-[calc(env(safe-area-inset-bottom)+10px)] pt-[18px]">
              <div className="flex items-end justify-between">
                <button className="flex w-[88px] flex-col items-center gap-[8px]">
                  <FileText size={30} className="text-[#13d6ff]" />
                  <span className="text-[16px] font-medium text-[#13d6ff]">账单</span>
                </button>

                <div className="relative -mt-[36px] flex w-[120px] justify-center">
                  <button className="flex h-[86px] w-[86px] items-center justify-center rounded-full bg-[linear-gradient(135deg,#985bff_0%,#5a78ff_48%,#33d7ff_100%)] text-white shadow-fab ring-4 ring-[#111a30]">
                    <Plus size={40} strokeWidth={2.2} />
                  </button>
                </div>

                <button className="flex w-[88px] flex-col items-center gap-[8px]">
                  <Wallet size={30} className="text-white/68" />
                  <span className="text-[16px] font-medium text-white/58">资产</span>
                </button>
              </div>

              <div className="mx-auto mt-[18px] h-[5px] w-[154px] rounded-full bg-white/90" />
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}

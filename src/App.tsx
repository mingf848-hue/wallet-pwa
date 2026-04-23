import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Menu,
  PencilLine,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  WalletCards,
  X
} from "lucide-react";
import {
  accountChipOrder,
  categoryLabels,
  chipLabelMap,
  dailyExpense,
  dailyIncome,
  expenseBreakdown,
  groupCounts,
  monthlyExpense,
  monthlyIncome,
  navItems,
  seedAccounts,
  seedTransactions,
  statsRanking,
  typeFilters
} from "./data";
import { Account, AccountGroup, CategoryKey, PageKey, Transaction } from "./types";
import {
  formatAmount,
  formatCompact,
  getAccount,
  getCurrentMonthSummary,
  getDistribution,
  getExpenseCategoryData,
  getNetWorth,
  getTagLabel,
  groupAccounts,
  groupTransactionsByDay
} from "./utils";

const STORAGE_KEY = "bitledger-pro-v2";
const NOW = "2026-04-23T12:00";

type PeriodKey = "day" | "week" | "month";
type BillFilterKey = (typeof typeFilters)[number]["key"];

type TransactionDraft = {
  id?: string;
  title: string;
  accountId: string;
  type: Transaction["type"];
  category: CategoryKey;
  amount: string;
  currency: Transaction["currency"];
  date: string;
  note: string;
  relatedAccountId: string;
  targetAmount: string;
};

type AccountDraft = {
  id?: string;
  name: string;
  mask: string;
  group: AccountGroup;
  currency: Account["currency"];
  balance: string;
  color: string;
  brand: string;
};

const emptyTransactionDraft: TransactionDraft = {
  title: "",
  accountId: "mashreq",
  type: "expense",
  category: "service",
  amount: "0",
  currency: "AED",
  date: NOW,
  note: "",
  relatedAccountId: "alipay",
  targetAmount: ""
};

const emptyAccountDraft: AccountDraft = {
  name: "",
  mask: "",
  group: "wallet",
  currency: "CNY",
  balance: "0",
  color: "#2d83ff",
  brand: "账"
};

function App() {
  const [page, setPage] = useState<PageKey>("home");
  const [accounts, setAccounts] = useState<Account[]>(seedAccounts);
  const [transactions, setTransactions] = useState<Transaction[]>(seedTransactions);
  const [privacyMode, setPrivacyMode] = useState(false);
  const [hideSmallAssets, setHideSmallAssets] = useState(false);
  const [billFilter, setBillFilter] = useState<BillFilterKey>("all");
  const [billRange, setBillRange] = useState<PeriodKey>("day");
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [transactionModalOpen, setTransactionModalOpen] = useState(false);
  const [transactionMode, setTransactionMode] = useState<"create" | "edit">("create");
  const [draft, setDraft] = useState<TransactionDraft>(emptyTransactionDraft);
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [accountMode, setAccountMode] = useState<"create" | "edit">("create");
  const [accountDraft, setAccountDraft] = useState<AccountDraft>(emptyAccountDraft);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return;
    }

    try {
      const parsed = JSON.parse(stored) as {
        accounts: Account[];
        transactions: Transaction[];
        privacyMode: boolean;
        hideSmallAssets: boolean;
      };
      setAccounts(parsed.accounts ?? seedAccounts);
      setTransactions(parsed.transactions ?? seedTransactions);
      setPrivacyMode(parsed.privacyMode ?? false);
      setHideSmallAssets(parsed.hideSmallAssets ?? false);
    } catch (error) {
      console.warn("Failed to restore local state", error);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ accounts, transactions, privacyMode, hideSmallAssets })
    );
  }, [accounts, transactions, privacyMode, hideSmallAssets]);

  const currentMonth = useMemo(
    () => transactions.filter((item) => item.date.startsWith("2026-04")),
    [transactions]
  );

  const summary = useMemo(() => getCurrentMonthSummary(currentMonth), [currentMonth]);
  const groupedAccounts = useMemo(() => groupAccounts(accounts), [accounts]);
  const distribution = useMemo(() => getDistribution(accounts), [accounts]);
  const netWorth = useMemo(() => getNetWorth(accounts), [accounts]);
  const selectedTransaction = useMemo(
    () => transactions.find((item) => item.id === selectedTransactionId) ?? null,
    [selectedTransactionId, transactions]
  );

  const filteredTransactions = useMemo(() => {
    return currentMonth
      .filter((item) => {
        if (billFilter !== "all" && item.type !== billFilter) {
          return false;
        }
        if (
          accountFilter !== "all" &&
          item.accountId !== accountFilter &&
          item.relatedAccountId !== accountFilter
        ) {
          return false;
        }
        if (
          search &&
          !`${item.title}${item.note ?? ""}${getTagLabel(item)}`
            .toLowerCase()
            .includes(search.toLowerCase())
        ) {
          return false;
        }
        if (billRange === "week") {
          return item.date >= "2026-04-17";
        }
        if (billRange === "day") {
          return item.date >= "2026-04-21";
        }
        return true;
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [accountFilter, billFilter, billRange, currentMonth, search]);

  const billGroups = useMemo(
    () => groupTransactionsByDay(filteredTransactions),
    [filteredTransactions]
  );

  const visibleAssetGroups = useMemo(() => {
    if (!hideSmallAssets) {
      return groupedAccounts;
    }

    return groupedAccounts.map((group) => ({
      ...group,
      accounts: group.accounts.filter((account) => account.balance > 1000)
    }));
  }, [groupedAccounts, hideSmallAssets]);

  function openCreateTransaction(prefill?: Partial<TransactionDraft>) {
    const baseAccount =
      accounts.find((account) => account.id === (prefill?.accountId ?? "mashreq")) ??
      accounts[0];
    const fallbackRelated =
      accounts.find((account) => account.id !== baseAccount.id)?.id ?? baseAccount.id;

    setTransactionMode("create");
    setDraft({
      ...emptyTransactionDraft,
      accountId: baseAccount.id,
      currency: baseAccount.currency,
      relatedAccountId: fallbackRelated,
      ...prefill
    });
    setTransactionModalOpen(true);
  }

  function openEditTransaction(transaction: Transaction) {
    const related =
      transaction.relatedAccountId ??
      accounts.find((account) => account.id !== transaction.accountId)?.id ??
      transaction.accountId;

    setTransactionMode("edit");
    setDraft({
      id: transaction.id,
      title: transaction.title,
      accountId: transaction.accountId,
      type: transaction.type,
      category: transaction.category,
      amount: String(transaction.amount),
      currency: transaction.currency,
      date: toDatetimeLocal(transaction.date),
      note: transaction.note ?? "",
      relatedAccountId: related,
      targetAmount: transaction.targetAmount ? String(transaction.targetAmount) : ""
    });
    setSelectedTransactionId(null);
    setTransactionModalOpen(true);
  }

  function openCreateAccount() {
    setAccountMode("create");
    setAccountDraft(emptyAccountDraft);
    setAccountModalOpen(true);
  }

  function openEditAccount(account: Account) {
    setAccountMode("edit");
    setAccountDraft({
      id: account.id,
      name: account.name,
      mask: account.mask ?? "",
      group: account.group,
      currency: account.currency,
      balance: String(account.balance),
      color: account.color,
      brand: account.brand
    });
    setAccountModalOpen(true);
  }

  function submitTransaction() {
    const amount = Number.parseFloat(draft.amount);
    if (!amount || amount <= 0) {
      return;
    }

    const account = accounts.find((item) => item.id === draft.accountId);
    if (!account) {
      return;
    }

    const relatedAccount =
      draft.type === "transfer"
        ? accounts.find((item) => item.id === draft.relatedAccountId)
        : undefined;
    if (draft.type === "transfer" && (!relatedAccount || relatedAccount.id === account.id)) {
      return;
    }

    const nextTransaction: Transaction = {
      id: draft.id ?? `tx-${Date.now()}`,
      title: draft.title || categoryLabels[draft.category],
      accountId: draft.accountId,
      amount,
      currency: account.currency,
      type: draft.type,
      category: draft.category,
      tag: categoryLabels[draft.category],
      date: new Date(draft.date).toISOString(),
      direction: draft.type === "income" || draft.type === "interest" ? "in" : "out",
      note: draft.note
    };

    if (draft.type === "transfer" && relatedAccount) {
      nextTransaction.relatedAccountId = relatedAccount.id;
      nextTransaction.targetAmount = Number.parseFloat(draft.targetAmount) || amount;
      nextTransaction.currency = account.currency;
      nextTransaction.direction = "out";
    }

    setAccounts((prevAccounts) => {
      let nextAccounts = prevAccounts;

      if (transactionMode === "edit" && draft.id) {
        const previous = transactions.find((item) => item.id === draft.id);
        if (previous) {
          nextAccounts = applyTransactionToAccounts(nextAccounts, previous, -1);
        }
      }

      return applyTransactionToAccounts(nextAccounts, nextTransaction, 1);
    });

    setTransactions((prev) => {
      if (transactionMode === "edit" && draft.id) {
        return prev
          .map((item) => (item.id === draft.id ? nextTransaction : item))
          .sort((a, b) => (a.date < b.date ? 1 : -1));
      }

      return [nextTransaction, ...prev].sort((a, b) => (a.date < b.date ? 1 : -1));
    });

    setTransactionModalOpen(false);
    setDraft(emptyTransactionDraft);
  }

  function deleteTransaction(transactionId: string) {
    const previous = transactions.find((item) => item.id === transactionId);
    if (!previous) {
      return;
    }

    setAccounts((prev) => applyTransactionToAccounts(prev, previous, -1));
    setTransactions((prev) => prev.filter((item) => item.id !== transactionId));
    setSelectedTransactionId(null);
  }

  function submitAccount() {
    const balance = Number.parseFloat(accountDraft.balance);
    if (!accountDraft.name.trim() || Number.isNaN(balance)) {
      return;
    }

    const nextAccount: Account = {
      id: accountDraft.id ?? `acc-${Date.now()}`,
      name: accountDraft.name.trim(),
      mask: accountDraft.mask.trim(),
      group: accountDraft.group,
      currency: accountDraft.currency,
      balance,
      color: accountDraft.color.trim() || "#2d83ff",
      brand: accountDraft.brand.trim() || accountDraft.name.trim().slice(0, 1)
    };

    setAccounts((prev) => {
      if (accountMode === "edit" && accountDraft.id) {
        return prev.map((item) => (item.id === accountDraft.id ? nextAccount : item));
      }
      return [...prev, nextAccount];
    });

    setAccountModalOpen(false);
    setAccountDraft(emptyAccountDraft);
  }

  function deleteAccount(accountId: string) {
    setAccounts((prev) => prev.filter((item) => item.id !== accountId));
    setTransactions((prev) =>
      prev.filter(
        (item) => item.accountId !== accountId && item.relatedAccountId !== accountId
      )
    );
    setAccountModalOpen(false);
  }

  return (
    <div className="app-shell">
      <div className="phone-frame">
        <div className="phone-screen">
          <main className="page-scroll">
            <TopBar />
            {page === "home" && (
              <HomePage
                privacyMode={privacyMode}
                onTogglePrivacy={() => setPrivacyMode((value) => !value)}
                accounts={accounts}
                transactions={currentMonth}
                summary={summary}
                onTransactionOpen={(transaction) => setSelectedTransactionId(transaction.id)}
              />
            )}
            {page === "bills" && (
              <BillsPage
                billFilter={billFilter}
                billGroups={billGroups}
                billRange={billRange}
                search={search}
                accountFilter={accountFilter}
                onFilterChange={setBillFilter}
                onRangeChange={setBillRange}
                onSearchChange={setSearch}
                onAccountFilterChange={setAccountFilter}
                accounts={accounts}
                onTransactionOpen={(transaction) => setSelectedTransactionId(transaction.id)}
              />
            )}
            {page === "stats" && <StatsPage summary={summary} />}
            {page === "assets" && (
              <AssetsPage
                accounts={visibleAssetGroups}
                accountsFlat={accounts}
                distribution={distribution}
                netWorth={netWorth}
                hideSmallAssets={hideSmallAssets}
                privacyMode={privacyMode}
                onToggleHideSmall={() => setHideSmallAssets((value) => !value)}
                onTogglePrivacy={() => setPrivacyMode((value) => !value)}
                transactions={transactions}
                onTransactionOpen={(transaction) => setSelectedTransactionId(transaction.id)}
                onAccountOpen={openEditAccount}
                onAddAccount={openCreateAccount}
              />
            )}
          </main>

          {page === "bills" && (
            <button className="floating-action" onClick={() => openCreateTransaction()}>
              <Plus size={28} strokeWidth={2.2} />
            </button>
          )}

          <BottomNav page={page} onChange={setPage} />
          <TransactionFormModal
            open={transactionModalOpen}
            draft={draft}
            accounts={accounts}
            mode={transactionMode}
            onClose={() => setTransactionModalOpen(false)}
            onDraftChange={setDraft}
            onSubmit={submitTransaction}
          />
          <TransactionDetailModal
            open={Boolean(selectedTransaction)}
            transaction={selectedTransaction}
            accounts={accounts}
            onClose={() => setSelectedTransactionId(null)}
            onEdit={(transaction) => openEditTransaction(transaction)}
            onDelete={(transactionId) => deleteTransaction(transactionId)}
          />
          <AccountFormModal
            open={accountModalOpen}
            draft={accountDraft}
            mode={accountMode}
            onClose={() => setAccountModalOpen(false)}
            onDraftChange={setAccountDraft}
            onSubmit={submitAccount}
            onDelete={
              accountMode === "edit" && accountDraft.id
                ? () => deleteAccount(accountDraft.id!)
                : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}

function TopBar() {
  return (
    <header className="topbar">
      <div className="status-row">
        <span className="status-time">03:28</span>
        <div className="status-icons">
          <span className="signal-bars" />
          <span className="wifi-dot" />
          <span className="battery-pill">44</span>
        </div>
      </div>
      <div className="brand-row">
        <div className="brand-lockup">
          <div className="brand-mark">B</div>
          <div className="brand-text">
            <span>BitLedger</span>
            <em>Pro</em>
          </div>
        </div>
        <div className="toolbar-actions">
          <button className="icon-button" type="button">
            <Search size={24} />
          </button>
          <button className="icon-button notification-dot" type="button">
            <Bell size={24} />
          </button>
          <button className="avatar-button" type="button">
            <div className="avatar-glow" />
          </button>
        </div>
      </div>
    </header>
  );
}

function HomePage({
  accounts,
  privacyMode,
  onTogglePrivacy,
  summary,
  transactions,
  onTransactionOpen
}: {
  accounts: Account[];
  privacyMode: boolean;
  onTogglePrivacy: () => void;
  summary: { income: number; expense: number; balance: number };
  transactions: Transaction[];
  onTransactionOpen: (transaction: Transaction) => void;
}) {
  return (
    <section className="page page-home">
      <div className="month-pill">
        <span>2026年4月</span>
        <ChevronDown size={18} />
      </div>

      <div className="hero-grid">
        <div className="balance-card">
          <div className="balance-meta">
            <span>本月结余（CNY）</span>
            <button className="inline-icon-button" onClick={onTogglePrivacy}>
              {privacyMode ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <div className="balance-number">
            {privacyMode ? "••••••" : formatAmount(summary.balance)}
          </div>
          <div className="balance-subline">
            <span>收入 - 支出</span>
            <span className="positive-pill">↑ 13.2%</span>
          </div>
          <MiniSparkline values={[12, 16, 19, 17, 24, 29, 27, 35, 40]} color="#2e84ff" />
        </div>

        <div className="stack-card">
          <MetricBlock title="本月支出（CNY）" value={summary.expense} accent="negative" icon="↘" />
          <MetricBlock title="本月收入（CNY）" value={summary.income} accent="positive" icon="↙" />
        </div>
      </div>

      <div className="double-card-grid">
        <Card>
          <div className="section-head compact">
            <span>收支趋势</span>
            <span className="muted">本月</span>
          </div>
          <Legend items={[["#ff4f79", "支出"], ["#24bb78", "收入"]]} />
          <LineChart income={dailyIncome} expense={dailyExpense} />
        </Card>
        <Card>
          <div className="section-head compact">
            <span>支出分类占比</span>
          </div>
          <DonutCard
            centerTop="7,109.71"
            centerBottom="总支出"
            values={expenseBreakdown.map((item) => item.value)}
          />
          <BreakdownList
            items={expenseBreakdown.map((item) => ({
              color: "#2e84ff",
              label: item.label,
              value: `${item.value}%`
            }))}
          />
        </Card>
      </div>

      <div className="chip-row">
        {accountChipOrder.map((chip) => (
          <button
            key={chip}
            className={`filter-chip ${chip === "all" ? "active" : ""}`}
            type="button"
          >
            {chipLabelMap[chip]}
          </button>
        ))}
      </div>

      <div className="section-head">
        <span>最近账单</span>
        <button className="text-link" type="button">
          查看全部 <ChevronRight size={16} />
        </button>
      </div>

      <div className="list-card">
        {transactions.slice(0, 6).map((item) => (
          <TransactionItem
            key={item.id}
            transaction={item}
            accounts={accounts}
            onOpen={onTransactionOpen}
          />
        ))}
      </div>
    </section>
  );
}

function BillsPage({
  accounts,
  accountFilter,
  billFilter,
  billGroups,
  billRange,
  onAccountFilterChange,
  onFilterChange,
  onRangeChange,
  onSearchChange,
  onTransactionOpen,
  search
}: {
  accounts: Account[];
  accountFilter: string;
  billFilter: BillFilterKey;
  billGroups: ReturnType<typeof groupTransactionsByDay>;
  billRange: PeriodKey;
  onAccountFilterChange: (value: string) => void;
  onFilterChange: (value: BillFilterKey) => void;
  onRangeChange: (value: PeriodKey) => void;
  onSearchChange: (value: string) => void;
  onTransactionOpen: (transaction: Transaction) => void;
  search: string;
}) {
  const periodLabels: { key: PeriodKey; label: string }[] = [
    { key: "day", label: "日" },
    { key: "week", label: "周" },
    { key: "month", label: "月" }
  ];

  return (
    <section className="page page-bills">
      <div className="toolbar-grid">
        <div className="month-pill">
          <span>2026年4月</span>
          <ChevronDown size={18} />
        </div>
        <div className="search-box">
          <Search size={20} />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="搜索账单、商家或备注"
          />
        </div>
        <button className="square-action" type="button">
          <SlidersHorizontal size={20} />
        </button>
      </div>

      <div className="chip-row">
        {typeFilters.map((item) => (
          <button
            key={item.key}
            className={`filter-chip ${billFilter === item.key ? "active" : ""}`}
            onClick={() => onFilterChange(item.key)}
            type="button"
          >
            {item.label}
          </button>
        ))}
        <button className="square-action compact" type="button">
          <Menu size={18} />
        </button>
      </div>

      <div className="segmented-control">
        {periodLabels.map((item) => (
          <button
            key={item.key}
            className={billRange === item.key ? "active" : ""}
            onClick={() => onRangeChange(item.key)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="dual-summary-card">
        <MetricStrip title="本月支出（CNY）" value="7,109.71" accent="negative" icon="↘" />
        <MetricStrip title="本月收入（CNY）" value="47,556.16" accent="positive" icon="↗" />
      </div>

      <div className="chip-row account-row">
        {accountChipOrder.map((chip) => (
          <button
            key={chip}
            className={`filter-chip ${accountFilter === chip ? "active" : ""}`}
            onClick={() => onAccountFilterChange(chip)}
            type="button"
          >
            {chipLabelMap[chip]}
          </button>
        ))}
      </div>

      {billGroups.map((group) => (
        <section key={group.dateKey} className="bill-group">
          <div className="section-head">
            <div className="group-title">
              <strong>{group.dateLabel}</strong>
              <span>{group.dateKey.slice(5).replace("-", "月")}日</span>
            </div>
            <button className="group-total" type="button">
              {group.total >= 0 ? "收入" : "支出"} {Math.abs(group.total).toFixed(2)}{" "}
              {Math.abs(group.total) > 100 ? "AED" : "USDT"} <ChevronDown size={16} />
            </button>
          </div>
          <div className="list-card">
            {group.items.map((item) => (
              <TransactionItem
                key={item.id}
                transaction={item}
                accounts={accounts}
                onOpen={onTransactionOpen}
              />
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}

function StatsPage({ summary }: { summary: { income: number; expense: number; balance: number } }) {
  return (
    <section className="page page-stats">
      <div className="stats-toolbar">
        <div className="month-pill">
          <span>2026年4月</span>
          <ChevronDown size={18} />
        </div>
        <div className="segmented-mini">
          <button className="active" type="button">
            月
          </button>
          <button type="button">年</button>
          <button type="button">自定义</button>
        </div>
      </div>

      <div className="triple-metric-grid">
        <SmallMetricCard title="本月支出（CNY）" value={summary.expense} accent="negative" />
        <SmallMetricCard title="本月收入（CNY）" value={summary.income} accent="positive" />
        <SmallMetricCard title="本月结余（CNY）" value={summary.balance} accent="primary" />
      </div>

      <Card>
        <div className="section-head compact">
          <span>收支趋势</span>
          <span className="muted">本年</span>
        </div>
        <Legend items={[["#7adfb4", "收入（CNY）"], ["#ff718f", "支出（CNY）"]]} />
        <BarChart income={monthlyIncome} expense={monthlyExpense} />
      </Card>

      <div className="double-card-grid">
        <Card>
          <div className="section-head compact">
            <span>支出分类占比</span>
          </div>
          <DonutCard
            centerTop="7,109.71"
            centerBottom="总支出"
            values={getExpenseCategoryData().map((item) => item.value)}
          />
          <BreakdownList
            items={getExpenseCategoryData().map((item) => ({
              color: "#62a9ff",
              label: item.label,
              value: `${item.value.toFixed(1)}%`
            }))}
          />
        </Card>

        <Card>
          <div className="section-head compact">
            <span>支出分类排行</span>
            <button className="text-link tiny" type="button">
              查看全部 <ChevronRight size={14} />
            </button>
          </div>
          <div className="ranking-list">
            {statsRanking.map((item) => (
              <div key={item.rank} className="ranking-row">
                <span className={`rank-badge rank-${item.rank}`}>{item.rank}</span>
                <span className="ranking-label">{item.label}</span>
                <span>{formatAmount(item.amount)}</span>
                <span className="ratio-accent">{item.ratio}%</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="insight-banner">
        <div className="insight-icon">⚡</div>
        <div>
          <div className="insight-title">
            本月支出较上月增加 <strong>13.2%</strong>
          </div>
          <div className="insight-text">主要增长来自 餐饮（+18.6%） 和 购物（+17.3%）</div>
        </div>
        <ChevronRight size={20} />
      </div>
    </section>
  );
}

function AssetsPage({
  accounts,
  accountsFlat,
  distribution,
  hideSmallAssets,
  netWorth,
  onToggleHideSmall,
  onTogglePrivacy,
  privacyMode,
  transactions,
  onTransactionOpen,
  onAccountOpen,
  onAddAccount
}: {
  accounts: ReturnType<typeof groupAccounts>;
  accountsFlat: Account[];
  distribution: ReturnType<typeof getDistribution>;
  hideSmallAssets: boolean;
  netWorth: number;
  onToggleHideSmall: () => void;
  onTogglePrivacy: () => void;
  privacyMode: boolean;
  transactions: Transaction[];
  onTransactionOpen: (transaction: Transaction) => void;
  onAccountOpen: (account: Account) => void;
  onAddAccount: () => void;
}) {
  return (
    <section className="page page-assets">
      <Card className="hero-asset-card">
        <div className="asset-overview">
          <div>
            <div className="balance-meta">
              <span>总资产（估值）</span>
              <button className="inline-icon-button" onClick={onTogglePrivacy}>
                {privacyMode ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <div className="asset-balance">
              {privacyMode ? "••••••" : formatAmount(netWorth)}
              <span>AED</span>
            </div>
            <div className="balance-subline">
              <span className="positive-pill">↑ 6.38%</span>
              <span>
                今日变化 <strong className="positive">+7,718.23</strong> AED
              </span>
            </div>
            <MiniSparkline values={[8, 13, 12, 17, 15, 18, 24, 29, 34]} color="#2b7dff" />
          </div>

          <div className="asset-chart-panel">
            <DonutCard
              centerTop="128,946.38"
              centerBottom="AED"
              values={distribution.map((item) => item.ratio)}
              compact
            />
            <BreakdownList
              items={distribution.map((item) => ({
                color: "#2d83ff",
                label: item.title,
                value: `${item.ratio.toFixed(1)}%`
              }))}
            />
          </div>
        </div>
      </Card>

      <div className="section-head">
        <span>账户总览</span>
        <div className="action-inline-group">
          <button className="ghost-link" onClick={onAddAccount} type="button">
            <WalletCards size={16} />
            新增账户
          </button>
          <button className="ghost-link" onClick={onToggleHideSmall} type="button">
            {hideSmallAssets ? "显示全部账户" : "隐藏小额账户"}
            <Eye size={16} />
          </button>
        </div>
      </div>

      <div className="double-card-grid">
        {accounts.map((group) => (
          <Card key={group.group}>
            <div className="section-head compact">
              <span>{group.title}</span>
              <span className="muted">
                {groupCounts[group.group]} <ChevronRight size={16} />
              </span>
            </div>
            <div className="account-stack">
              {group.accounts.map((account) => (
                <AccountRow key={account.id} account={account} onOpen={onAccountOpen} />
              ))}
            </div>
            <button className="see-all-link" type="button">
              查看全部
            </button>
          </Card>
        ))}
      </div>

      <div className="section-head">
        <span>最近变动</span>
        <button className="text-link" type="button">
          查看全部 <ChevronRight size={16} />
        </button>
      </div>

      <div className="list-card">
        {transactions.slice(0, 4).map((item) => (
          <TransactionItem
            key={item.id}
            transaction={item}
            accounts={accountsFlat}
            condensed
            onOpen={onTransactionOpen}
          />
        ))}
      </div>
    </section>
  );
}

function MetricBlock({
  accent,
  icon,
  title,
  value
}: {
  accent: "positive" | "negative";
  icon: string;
  title: string;
  value: number;
}) {
  return (
    <div className="metric-block">
      <div>
        <div className="metric-title">{title}</div>
        <div className={`metric-value ${accent}`}>{formatAmount(value)}</div>
      </div>
      <div className={`metric-icon ${accent}`}>{icon}</div>
    </div>
  );
}

function SmallMetricCard({
  accent,
  title,
  value
}: {
  accent: "negative" | "positive" | "primary";
  title: string;
  value: number;
}) {
  return (
    <Card className="small-metric-card">
      <div className="metric-title">{title}</div>
      <div className={`metric-value ${accent}`}>{formatAmount(value)}</div>
      <div className="metric-foot">
        <span>较上月</span>
        <span className="positive-pill">
          ↑ {accent === "negative" ? "13.2" : accent === "positive" ? "18.7" : "20.1"}%
        </span>
      </div>
    </Card>
  );
}

function Card({
  children,
  className = ""
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`card ${className}`}>{children}</div>;
}

function AccountRow({
  account,
  onOpen
}: {
  account: Account;
  onOpen: (account: Account) => void;
}) {
  return (
    <button className="account-row account-row-button" onClick={() => onOpen(account)} type="button">
      <div className="account-meta">
        <div className="brand-badge" style={{ background: account.color }}>
          {account.brand}
        </div>
        <div>
          <div className="account-name">{account.name}</div>
          {account.mask ? <div className="account-mask">•••• {account.mask}</div> : null}
        </div>
      </div>
      <div className="account-value">
        <strong>{formatAmount(account.balance)}</strong>
        <span>{account.currency}</span>
      </div>
    </button>
  );
}

function TransactionItem({
  accounts,
  condensed = false,
  onOpen,
  transaction
}: {
  accounts: Account[];
  condensed?: boolean;
  onOpen: (transaction: Transaction) => void;
  transaction: Transaction;
}) {
  const account = getAccount(accounts, transaction.accountId);
  const relatedAccount = transaction.relatedAccountId
    ? getAccount(accounts, transaction.relatedAccountId)
    : null;
  const positive = transaction.direction === "in";
  return (
    <button
      className={`transaction-row transaction-button ${condensed ? "condensed" : ""}`}
      onClick={() => onOpen(transaction)}
      type="button"
    >
      <div className="transaction-left">
        <div className="brand-badge large" style={{ background: account?.color ?? "#dbe7ff" }}>
          {account?.brand ?? "?"}
        </div>
        <div>
          <div className="transaction-title">{transaction.title}</div>
          <div className="transaction-meta">
            {new Intl.DateTimeFormat("zh-CN", {
              month: "numeric",
              day: "numeric"
            }).format(new Date(transaction.date))}
            {" · "}
            {transaction.type === "transfer" && relatedAccount
              ? `${account?.name} → ${relatedAccount.name}`
              : account?.name}
            <span className={`tag-chip ${positive ? "income" : "expense"}`}>
              {getTagLabel(transaction)}
            </span>
          </div>
        </div>
      </div>
      <div className="transaction-amount">
        <strong className={positive ? "positive" : "negative"}>
          {positive ? "+" : "-"}
          {transaction.amount.toFixed(transaction.amount < 1 ? 8 : 2)}
        </strong>
        <span>{transaction.currency}</span>
      </div>
    </button>
  );
}

function BottomNav({
  onChange,
  page
}: {
  onChange: (next: PageKey) => void;
  page: PageKey;
}) {
  return (
    <nav className="bottom-nav">
      {navItems.map((item) => (
        <button
          key={item.key}
          className={`nav-item ${page === item.key ? "active" : ""}`}
          onClick={() => onChange(item.key)}
          type="button"
        >
          <span className="nav-icon">
            {item.key === "home" ? "⌂" : item.key === "bills" ? "📄" : item.key === "stats" ? "◔" : "◫"}
          </span>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

function MiniSparkline({ color, values }: { color: string; values: number[] }) {
  const width = 280;
  const height = 88;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const path = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const ratio = max === min ? 0.5 : (value - min) / (max - min);
      const y = height - ratio * (height - 8) - 6;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${path} L ${width} ${height} L 0 ${height} Z`} fill="url(#spark-fill)" />
      <path d={path} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
      <circle cx={width - 2} cy={12} r="4" fill={color} />
    </svg>
  );
}

function DonutCard({
  centerBottom,
  centerTop,
  compact = false,
  values
}: {
  centerBottom: string;
  centerTop: string;
  compact?: boolean;
  values: number[];
}) {
  const total = values.reduce((sum, value) => sum + value, 0);
  const colors = ["#2a7eff", "#5ba5ff", "#8fc4ff", "#c7e1ff", "#e7f0ff"];
  let offset = 0;
  const radius = compact ? 42 : 56;
  const circumference = Math.PI * 2 * radius;

  return (
    <div className={`donut-wrap ${compact ? "compact" : ""}`}>
      <svg viewBox="0 0 160 160" className="donut-svg">
        <circle cx="80" cy="80" r={radius} stroke="#edf3ff" strokeWidth="18" fill="none" />
        {values.map((value, index) => {
          const stroke = total === 0 ? 0 : (value / total) * circumference;
          const dash = `${stroke} ${circumference - stroke}`;
          const element = (
            <circle
              key={`${value}-${index}`}
              cx="80"
              cy="80"
              r={radius}
              fill="none"
              stroke={colors[index % colors.length]}
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              strokeWidth="18"
              strokeLinecap="round"
              transform="rotate(-90 80 80)"
            />
          );
          offset += stroke;
          return element;
        })}
      </svg>
      <div className="donut-center">
        <strong>{centerTop}</strong>
        <span>{centerBottom}</span>
      </div>
    </div>
  );
}

function BreakdownList({
  items
}: {
  items: Array<{ color: string; label: string; value: string }>;
}) {
  return (
    <div className="breakdown-list">
      {items.map((item, index) => (
        <div key={`${item.label}-${index}`} className="breakdown-row">
          <span
            className="breakdown-dot"
            style={{ background: item.color || `hsl(214, 100%, ${52 + index * 8}%)` }}
          />
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

function Legend({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="legend-row">
      {items.map(([color, label]) => (
        <span key={label}>
          <i style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}

function LineChart({ expense, income }: { expense: number[]; income: number[] }) {
  const width = 320;
  const height = 160;
  const merged = [...income, ...expense];
  const max = Math.max(...merged);

  const toPath = (values: number[]) =>
    values
      .map((value, index) => {
        const x = 28 + (index / (values.length - 1)) * 268;
        const y = 132 - (value / max) * 110;
        return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg">
      {[0, 1, 2].map((line) => (
        <line
          key={line}
          x1="28"
          y1={30 + line * 34}
          x2="300"
          y2={30 + line * 34}
          stroke="#edf2fb"
          strokeWidth="1"
        />
      ))}
      <path d={toPath(expense)} fill="none" stroke="#ff4f79" strokeWidth="3" strokeLinecap="round" />
      <path d={toPath(income)} fill="none" stroke="#20c07b" strokeWidth="3" strokeLinecap="round" />
      {["4/1", "4/10", "4/20", "4/30"].map((label, index) => (
        <text key={label} x={40 + index * 80} y="154" fill="#68758f" fontSize="12">
          {label}
        </text>
      ))}
      <text x="0" y="30" fill="#68758f" fontSize="12">
        16K
      </text>
      <text x="8" y="83" fill="#68758f" fontSize="12">
        8K
      </text>
      <text x="16" y="136" fill="#68758f" fontSize="12">
        0
      </text>
    </svg>
  );
}

function BarChart({ expense, income }: { expense: number[]; income: number[] }) {
  const width = 330;
  const height = 210;
  const max = Math.max(...income, ...expense) * 1.1;
  const months = ["11月", "12月", "1月", "2月", "3月", "4月"];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg">
      {[0, 1, 2, 3].map((line) => (
        <line
          key={line}
          x1="26"
          y1={24 + line * 42}
          x2="312"
          y2={24 + line * 42}
          stroke="#edf2fb"
          strokeWidth="1"
        />
      ))}
      {months.map((month, index) => {
        const x = 42 + index * 46;
        const incomeHeight = (income[index] / max) * 120;
        const expenseHeight = (expense[index] / max) * 120;
        return (
          <g key={month}>
            <rect
              x={x}
              y={156 - incomeHeight}
              width="18"
              height={incomeHeight}
              rx="9"
              fill={index === months.length - 1 ? "#2e84ff" : "#83dfb8"}
            />
            <rect
              x={x + 22}
              y={156 - expenseHeight}
              width="18"
              height={expenseHeight}
              rx="9"
              fill="#ff8799"
            />
            <text x={x - 2} y={174} fill="#68758f" fontSize="11">
              {month}
            </text>
            <text x={x - 4} y={148 - incomeHeight} fill="#4fb68b" fontSize="10">
              {formatCompact(income[index])}
            </text>
            <text x={x + 18} y={148 - expenseHeight} fill="#e86f83" fontSize="10">
              {formatCompact(expense[index])}
            </text>
          </g>
        );
      })}
      <text x="0" y="26" fill="#68758f" fontSize="12">
        80K
      </text>
      <text x="0" y="68" fill="#68758f" fontSize="12">
        60K
      </text>
      <text x="0" y="110" fill="#68758f" fontSize="12">
        40K
      </text>
      <text x="0" y="152" fill="#68758f" fontSize="12">
        20K
      </text>
      <text x="14" y="192" fill="#68758f" fontSize="12">
        0
      </text>
    </svg>
  );
}

function MetricStrip({
  accent,
  icon,
  title,
  value
}: {
  accent: "negative" | "positive";
  icon: string;
  title: string;
  value: string;
}) {
  return (
    <div className="metric-strip">
      <div className={`metric-icon ${accent}`}>{icon}</div>
      <div>
        <div className="metric-title">{title}</div>
        <div className={`metric-value ${accent}`}>{value}</div>
      </div>
    </div>
  );
}

function TransactionFormModal({
  accounts,
  draft,
  mode,
  onClose,
  onDraftChange,
  onSubmit,
  open
}: {
  accounts: Account[];
  draft: TransactionDraft;
  mode: "create" | "edit";
  onClose: () => void;
  onDraftChange: (next: TransactionDraft) => void;
  onSubmit: () => void;
  open: boolean;
}) {
  if (!open) {
    return null;
  }

  const sourceAccount = accounts.find((item) => item.id === draft.accountId);
  const transferTargets = accounts.filter((item) => item.id !== draft.accountId);
  const isTransfer = draft.type === "transfer";

  return (
    <ModalShell onClose={onClose} title={mode === "create" ? "新增账单" : "编辑账单"}>
      <div className="modal-grid">
        <label>
          <span>类型</span>
          <select
            value={draft.type}
            onChange={(event) => {
              const nextType = event.target.value as Transaction["type"];
              onDraftChange({
                ...draft,
                type: nextType,
                category:
                  nextType === "transfer"
                    ? "transfer"
                    : nextType === "investment"
                      ? "investment"
                      : nextType === "income"
                        ? "salary"
                        : "service"
              });
            }}
          >
            <option value="expense">支出</option>
            <option value="income">收入</option>
            <option value="transfer">转账</option>
            <option value="investment">理财</option>
          </select>
        </label>
        <label>
          <span>{isTransfer ? "转出账户" : "账户"}</span>
          <select
            value={draft.accountId}
            onChange={(event) => {
              const nextAccount = accounts.find((item) => item.id === event.target.value);
              const nextRelated =
                transferTargets.find((item) => item.id !== event.target.value)?.id ??
                draft.relatedAccountId;
              onDraftChange({
                ...draft,
                accountId: event.target.value,
                currency: nextAccount?.currency ?? draft.currency,
                relatedAccountId: isTransfer ? nextRelated : draft.relatedAccountId
              });
            }}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        {isTransfer ? (
          <label>
            <span>转入账户</span>
            <select
              value={draft.relatedAccountId}
              onChange={(event) =>
                onDraftChange({
                  ...draft,
                  relatedAccountId: event.target.value
                })
              }
            >
              {transferTargets.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            <span>标题</span>
            <input
              value={draft.title}
              onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
              placeholder="例如：Apple Pay 自动记账"
            />
          </label>
        )}
        <label>
          <span>分类</span>
          <select
            value={draft.category}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                category: event.target.value as CategoryKey
              })
            }
          >
            {Object.entries(categoryLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{isTransfer ? `转出金额（${sourceAccount?.currency ?? draft.currency}）` : "金额"}</span>
          <input
            value={draft.amount}
            inputMode="decimal"
            onChange={(event) => onDraftChange({ ...draft, amount: event.target.value })}
          />
        </label>
        {isTransfer ? (
          <label>
            <span>转入金额（可选）</span>
            <input
              value={draft.targetAmount}
              inputMode="decimal"
              onChange={(event) => onDraftChange({ ...draft, targetAmount: event.target.value })}
              placeholder="不填则按原金额处理"
            />
          </label>
        ) : (
          <label>
            <span>时间</span>
            <input
              type="datetime-local"
              value={draft.date}
              onChange={(event) => onDraftChange({ ...draft, date: event.target.value })}
            />
          </label>
        )}
        {isTransfer ? (
          <label>
            <span>时间</span>
            <input
              type="datetime-local"
              value={draft.date}
              onChange={(event) => onDraftChange({ ...draft, date: event.target.value })}
            />
          </label>
        ) : null}
        <label className="full-width">
          <span>备注</span>
          <textarea
            value={draft.note}
            onChange={(event) => onDraftChange({ ...draft, note: event.target.value })}
            placeholder={isTransfer ? "例如：钱包调仓 / 跨币种转移" : "可选"}
          />
        </label>
      </div>
      <div className="modal-actions">
        <button className="secondary-button" onClick={onClose} type="button">
          取消
        </button>
        <button className="primary-button" onClick={onSubmit} type="button">
          {mode === "create" ? "保存账单" : "更新账单"}
        </button>
      </div>
    </ModalShell>
  );
}

function TransactionDetailModal({
  accounts,
  onClose,
  onDelete,
  onEdit,
  open,
  transaction
}: {
  accounts: Account[];
  onClose: () => void;
  onDelete: (transactionId: string) => void;
  onEdit: (transaction: Transaction) => void;
  open: boolean;
  transaction: Transaction | null;
}) {
  if (!open || !transaction) {
    return null;
  }

  const account = accounts.find((item) => item.id === transaction.accountId);
  const related = transaction.relatedAccountId
    ? accounts.find((item) => item.id === transaction.relatedAccountId)
    : null;

  return (
    <ModalShell onClose={onClose} title="账单详情">
      <div className="detail-stack">
        <div className="detail-hero">
          <div className="brand-badge large" style={{ background: account?.color ?? "#dbe7ff" }}>
            {account?.brand ?? "?"}
          </div>
          <div>
            <div className="detail-title">{transaction.title}</div>
            <div className="detail-subtitle">{getTagLabel(transaction)}</div>
          </div>
        </div>
        <DetailRow label="金额" value={`${transaction.direction === "in" ? "+" : "-"}${formatAmount(transaction.amount, transaction.amount < 1 ? 8 : 2)} ${transaction.currency}`} />
        <DetailRow label="账户" value={account?.name ?? "未知账户"} />
        {related ? <DetailRow label="转入账户" value={related.name} /> : null}
        {related && transaction.targetAmount ? (
          <DetailRow label="转入金额" value={`${formatAmount(transaction.targetAmount, transaction.targetAmount < 1 ? 8 : 2)} ${related.currency}`} />
        ) : null}
        <DetailRow
          label="时间"
          value={new Intl.DateTimeFormat("zh-CN", {
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
          }).format(new Date(transaction.date))}
        />
        <DetailRow label="备注" value={transaction.note || "无"} />
      </div>
      <div className="modal-actions modal-actions-split">
        <button className="danger-button" onClick={() => onDelete(transaction.id)} type="button">
          <Trash2 size={16} />
          删除
        </button>
        <button className="primary-button inline-button" onClick={() => onEdit(transaction)} type="button">
          <PencilLine size={16} />
          编辑
        </button>
      </div>
    </ModalShell>
  );
}

function AccountFormModal({
  draft,
  mode,
  onClose,
  onDelete,
  onDraftChange,
  onSubmit,
  open
}: {
  draft: AccountDraft;
  mode: "create" | "edit";
  onClose: () => void;
  onDelete?: () => void;
  onDraftChange: (next: AccountDraft) => void;
  onSubmit: () => void;
  open: boolean;
}) {
  if (!open) {
    return null;
  }

  return (
    <ModalShell onClose={onClose} title={mode === "create" ? "新增账户" : "账户管理"}>
      <div className="modal-grid">
        <label>
          <span>账户名称</span>
          <input
            value={draft.name}
            onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
            placeholder="例如：Revolut / 火币 / 现金"
          />
        </label>
        <label>
          <span>品牌字符</span>
          <input
            maxLength={3}
            value={draft.brand}
            onChange={(event) => onDraftChange({ ...draft, brand: event.target.value })}
            placeholder="如：支 / OKX"
          />
        </label>
        <label>
          <span>账户分组</span>
          <select
            value={draft.group}
            onChange={(event) =>
              onDraftChange({ ...draft, group: event.target.value as AccountGroup })
            }
          >
            <option value="bank">银行账户</option>
            <option value="wallet">电子钱包</option>
            <option value="exchange">交易所资产</option>
            <option value="cash">现金</option>
          </select>
        </label>
        <label>
          <span>币种</span>
          <select
            value={draft.currency}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                currency: event.target.value as Account["currency"]
              })
            }
          >
            <option value="AED">AED</option>
            <option value="CNY">CNY</option>
            <option value="USDT">USDT</option>
          </select>
        </label>
        <label>
          <span>初始余额</span>
          <input
            value={draft.balance}
            inputMode="decimal"
            onChange={(event) => onDraftChange({ ...draft, balance: event.target.value })}
          />
        </label>
        <label>
          <span>尾号 / 标识</span>
          <input
            value={draft.mask}
            onChange={(event) => onDraftChange({ ...draft, mask: event.target.value })}
            placeholder="例如：8890"
          />
        </label>
        <label className="full-width">
          <span>品牌色</span>
          <div className="color-input-row">
            <input
              type="color"
              value={normalizeColor(draft.color)}
              onChange={(event) => onDraftChange({ ...draft, color: event.target.value })}
            />
            <input
              value={draft.color}
              onChange={(event) => onDraftChange({ ...draft, color: event.target.value })}
              placeholder="#2d83ff"
            />
          </div>
        </label>
      </div>
      <div className={`modal-actions ${onDelete ? "modal-actions-triple" : ""}`}>
        {onDelete ? (
          <button className="danger-button" onClick={onDelete} type="button">
            <Trash2 size={16} />
            删除账户
          </button>
        ) : null}
        <button className="secondary-button" onClick={onClose} type="button">
          取消
        </button>
        <button className="primary-button" onClick={onSubmit} type="button">
          {mode === "create" ? "创建账户" : "保存修改"}
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  children,
  onClose,
  title
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <div className="sheet-title">{title}</div>
          <button className="sheet-close" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function toDatetimeLocal(value: string) {
  const date = new Date(value);
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  return formatter.format(date).replace(" ", "T");
}

function normalizeColor(color: string) {
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    return color;
  }
  return "#2d83ff";
}

function applyTransactionToAccounts(accounts: Account[], transaction: Transaction, direction: 1 | -1) {
  return accounts.map((account) => {
    let nextBalance = account.balance;

    if (account.id === transaction.accountId) {
      if (transaction.type === "transfer") {
        nextBalance -= direction * transaction.amount;
      } else if (transaction.direction === "in") {
        nextBalance += direction * transaction.amount;
      } else {
        nextBalance -= direction * transaction.amount;
      }
    }

    if (
      transaction.type === "transfer" &&
      transaction.relatedAccountId &&
      account.id === transaction.relatedAccountId
    ) {
      nextBalance += direction * (transaction.targetAmount ?? transaction.amount);
    }

    return { ...account, balance: Number(nextBalance.toFixed(8)) };
  });
}

export default App;

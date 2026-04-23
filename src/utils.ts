import {
  categoryLabels,
  exchangeRates,
  expenseBreakdown,
  groupLabels
} from "./data";
import { Account, AccountGroup, Currency, Transaction } from "./types";

export function formatAmount(value: number, digits = 2) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

export function formatCompact(value: number) {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return value.toFixed(1);
}

export function convert(value: number, from: Currency, to: Currency) {
  const base = value * exchangeRates[from];
  return base / exchangeRates[to];
}

export function getAccount(accounts: Account[], accountId: string) {
  return accounts.find((account) => account.id === accountId);
}

export function groupAccounts(accounts: Account[]) {
  return (Object.keys(groupLabels) as AccountGroup[]).map((group) => ({
    group,
    title: groupLabels[group],
    accounts: accounts.filter((account) => account.group === group)
  }));
}

export function getNetWorth(accounts: Account[]) {
  return accounts.reduce(
    (sum, account) => sum + convert(account.balance, account.currency, "AED"),
    0
  );
}

export function getDistribution(accounts: Account[]) {
  const total = getNetWorth(accounts);
  return groupAccounts(accounts).map((item) => {
    const amount = item.accounts.reduce(
      (sum, account) => sum + convert(account.balance, account.currency, "AED"),
      0
    );

    return {
      ...item,
      amount,
      ratio: total === 0 ? 0 : (amount / total) * 100
    };
  });
}

export function getCurrentMonthSummary(transactions: Transaction[]) {
  const income = transactions
    .filter((item) => item.direction === "in")
    .reduce((sum, item) => sum + convert(item.amount, item.currency, "CNY"), 0);

  const expense = transactions
    .filter((item) => item.direction === "out")
    .reduce((sum, item) => sum + convert(item.amount, item.currency, "CNY"), 0);

  return {
    income,
    expense,
    balance: income - expense
  };
}

export function groupTransactionsByDay(transactions: Transaction[]) {
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    weekday: "short"
  });
  const today = new Date("2026-04-23T12:00:00+08:00").toDateString();
  const yesterday = new Date("2026-04-22T12:00:00+08:00").toDateString();

  const grouped = new Map<string, Transaction[]>();

  transactions.forEach((item) => {
    const date = new Date(item.date);
    const key = date.toISOString().slice(0, 10);
    const list = grouped.get(key) ?? [];
    list.push(item);
    grouped.set(key, list);
  });

  return Array.from(grouped.entries())
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([dateKey, items]) => {
      const date = new Date(`${dateKey}T12:00:00+08:00`);
      const dateLabel =
        date.toDateString() === today
          ? "今天"
          : date.toDateString() === yesterday
            ? "昨天"
            : formatter.format(date).replace("周", "星期");

      const total = items.reduce((sum, item) => {
        const signed = item.direction === "in" ? item.amount : -item.amount;
        return sum + signed;
      }, 0);

      return {
        dateKey,
        dateLabel,
        items: items.sort((a, b) => (a.date < b.date ? 1 : -1)),
        total
      };
    });
}

export function getExpenseCategoryData() {
  return expenseBreakdown;
}

export function getTagLabel(transaction: Transaction) {
  return categoryLabels[transaction.category] ?? transaction.tag;
}

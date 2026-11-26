import type { Expense, Participant } from './types';

/**
 * Parser numérico único es-AR:
 * Acepta "10.000", "10000", "10.500,50", "$ 10.000" sin generar NaN.
 */
export function parseMoneyInput(raw: string | number): number {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : 0;
  }
  const cleaned = raw
    .trim()
    .replace(/\$/g, '')
    .replace(/\s+/g, '')
    .replace(/\./g, '')
    .replace(',', '.');

  if (!cleaned) return 0;
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num);
}

export function formatARS(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.round(amount) : 0;
  return '$ ' + new Intl.NumberFormat('es-AR').format(safe);
}

export interface SettlementTransfer {
  from: string;
  to: string;
  amount: number;
}

export interface ExpenseSplitSummary {
  totalSpent: number;
  perPerson: number;
  balances: Array<{ clientId: string; name: string; paid: number; net: number }>;
  transfers: SettlementTransfer[];
}

/**
 * Calcula cuánto gastó cada persona y las transferencias mínimas
 * ("quién le paga cuánto a quién") para saldar la juntada.
 */
export function calculateExpenseSplit(
  participants: Participant[],
  expenses: Expense[]
): ExpenseSplitSummary {
  const totalSpent = expenses.reduce((acc, e) => acc + Math.max(0, Math.round(e.amount)), 0);
  const count = Math.max(1, participants.length);
  const perPerson = Math.round(totalSpent / count);

  const paidMap = new Map<string, number>();
  for (const p of participants) {
    paidMap.set(p.clientId, 0);
  }
  for (const e of expenses) {
    paidMap.set(e.paidByClientId, (paidMap.get(e.paidByClientId) ?? 0) + Math.max(0, Math.round(e.amount)));
  }

  const balances = participants.map((p) => {
    const paid = paidMap.get(p.clientId) ?? 0;
    return {
      clientId: p.clientId,
      name: p.name,
      paid,
      net: paid - perPerson
    };
  });

  // Algoritmo greedy de transferencias mínimas
  const debtors = balances
    .filter((b) => b.net < -1)
    .map((b) => ({ name: b.name, amount: Math.abs(b.net) }))
    .sort((a, b) => b.amount - a.amount);

  const creditors = balances
    .filter((b) => b.net > 1)
    .map((b) => ({ name: b.name, amount: b.net }))
    .sort((a, b) => b.amount - a.amount);

  const transfers: SettlementTransfer[] = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amount, creditors[j].amount);
    if (pay > 0) {
      transfers.push({
        from: debtors[i].name,
        to: creditors[j].name,
        amount: Math.round(pay)
      });
    }
    debtors[i].amount -= pay;
    creditors[j].amount -= pay;
    if (debtors[i].amount <= 1) i++;
    if (creditors[j].amount <= 1) j++;
  }

  return { totalSpent, perPerson, balances, transfers };
}

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseMoneyInput, formatARS, calculateExpenseSplit } from '../../src/lib/money';
import type { Expense, Participant } from '../../src/lib/types';

describe('Capa 3 — Fuzzing de lógica financiera (money.ts)', () => {
  it('parseMoneyInput nunca devuelve NaN, Infinity ni negativos ante cualquier string o número', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.double({ noDefaultInfinity: false, noNaN: false }),
          fc.constant(''),
          fc.constant('10.000'),
          fc.constant('$ 30.000,50'),
          fc.constant('---NaN---'),
          fc.constant('🔥10.000')
        ),
        (input) => {
          const result = parseMoneyInput(input as string | number);
          expect(Number.isFinite(result)).toBe(true);
          expect(Number.isNaN(result)).toBe(false);
          expect(result).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('parseMoneyInput interpreta correctamente formatos argentinos es-AR', () => {
    expect(parseMoneyInput('10.000')).toBe(10000);
    expect(parseMoneyInput('$ 30.000')).toBe(30000);
    expect(parseMoneyInput('15.500,40')).toBe(15500);
    expect(parseMoneyInput('15.500,60')).toBe(15501);
    expect(parseMoneyInput('')).toBe(0);
    expect(parseMoneyInput(-500)).toBe(0);
    expect(parseMoneyInput(Number.NaN)).toBe(0);
    expect(parseMoneyInput(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('formatARS nunca lanza excepciones ni contiene NaN', () => {
    fc.assert(
      fc.property(fc.double({ noDefaultInfinity: false, noNaN: false }), (n) => {
        const formatted = formatARS(n);
        expect(typeof formatted).toBe('string');
        expect(formatted).not.toContain('NaN');
        expect(formatted.startsWith('$ ')).toBe(true);
      }),
      { numRuns: 300 }
    );
  });

  it('calculateExpenseSplit jamás produce NaN, transferencias negativas ni pierde dinero significativo', () => {
    const participantArb = fc.record({
      publicId: fc.string({ minLength: 1, maxLength: 12 }),
      name: fc.string({ minLength: 1, maxLength: 20 }),
      status: fc.constant('pendiente' as const),
      paidAmount: fc.constant(0),
      joinedAt: fc.constant('2026-11-25T00:00:00Z'),
      isOnline: fc.boolean(),
      isMe: fc.boolean(),
      isManual: fc.boolean()
    });

    fc.assert(
      fc.property(
        fc.uniqueArray(participantArb, { selector: (p) => p.publicId, minLength: 1, maxLength: 35 }),
        fc.array(
          fc.record({
            id: fc.integer({ min: 1, max: 10000 }),
            paidByIdx: fc.nat(34),
            description: fc.string({ minLength: 1, maxLength: 40 }),
            amount: fc.integer({ min: 0, max: 5_000_000 })
          }),
          { minLength: 0, maxLength: 60 }
        ),
        (participants: Participant[], rawExpenses) => {
          const expenses: Expense[] = rawExpenses.map((e) => {
            const p = participants[e.paidByIdx % participants.length];
            return {
              id: e.id,
              paidByPublicId: p.publicId,
              paidByName: p.name,
              description: e.description,
              amount: e.amount,
              createdAt: '2026-11-25T00:00:00Z',
              isMine: false
            };
          });

          const res = calculateExpenseSplit(participants, expenses);
          expect(Number.isFinite(res.totalSpent)).toBe(true);
          expect(Number.isFinite(res.perPerson)).toBe(true);
          expect(res.totalSpent).toBeGreaterThanOrEqual(0);
          expect(res.perPerson).toBeGreaterThanOrEqual(0);

          for (const t of res.transfers) {
            expect(Number.isFinite(t.amount)).toBe(true);
            expect(t.amount).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 250 }
    );
  });
});

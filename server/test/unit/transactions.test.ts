import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma, type PrismaClient } from '@prisma/client';
import { withTransaction } from '../../src/db.js';
import { AppError } from '../../src/errors.js';

const prismaError = (code: string) => new Prisma.PrismaClientKnownRequestError('Synthetic database failure', { code, clientVersion: 'unit-test' });
function transactionStub() {
  const calls: { options: unknown; tx: Prisma.TransactionClient }[] = [];
  const prisma = { $transaction: async <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>, options: unknown) => {
    const tx = Object.freeze({ attempt: calls.length + 1 }) as unknown as Prisma.TransactionClient;
    calls.push({ options, tx });
    return callback(tx);
  } } as unknown as PrismaClient;
  return { prisma, calls };
}

test('Transacción exitosa devuelve el resultado y usa aislamiento Serializable una vez', async () => {
  const { prisma, calls } = transactionStub();
  const expected = Object.freeze({ id: 'created-id' });
  const result = await withTransaction(prisma, async tx => { assert.equal(tx, calls[0].tx); return expected; });
  assert.equal(result, expected);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options, { isolationLevel: 'Serializable' });
});

test('Conflicto Prisma P2034 reejecuta el callback hasta dos veces y puede recuperarse', async () => {
  const { prisma, calls } = transactionStub();
  let attempts = 0;
  const result = await withTransaction(prisma, async () => { if (++attempts < 3) throw prismaError('P2034'); return 'committed'; });
  assert.equal(result, 'committed');
  assert.equal(attempts, 3);
  assert.equal(calls.length, 3);
  assert.equal(new Set(calls.map(call => call.tx)).size, 3);
  assert.ok(calls.every(call => JSON.stringify(call.options) === '{"isolationLevel":"Serializable"}'));
});

test('P2034 persistente termina en tres intentos y conserva el error final', async () => {
  const { prisma, calls } = transactionStub();
  const failure = prismaError('P2034');
  await assert.rejects(withTransaction(prisma, async () => { throw failure; }), error => error === failure);
  assert.equal(calls.length, 3);
});

for (const [label, failure] of [['unicidad P2002', prismaError('P2002')], ['conexión P1001', prismaError('P1001')], ['auditoría', new AppError(503, 'AUDIT_UNAVAILABLE', 'Auditoría no disponible.')], ['error genérico', new Error('Unexpected')], ['objeto que imita P2034', { code: 'P2034' }]] as const) {
  test(`No reintenta ${label} y propaga la misma excepción`, async () => {
    const { prisma, calls } = transactionStub();
    await assert.rejects(withTransaction(prisma, async () => { throw failure; }), error => error === failure);
    assert.equal(calls.length, 1);
  });
}

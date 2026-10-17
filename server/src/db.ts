import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

export function createPrisma(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}

export function isTransactionConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2034') return true;
  if (error.code !== 'P2010') return false;
  const adapter = error.meta?.driverAdapterError as { cause?: { originalCode?: string; kind?: string } } | undefined;
  return ['40001', '40P01'].includes(String(error.meta?.code ?? adapter?.cause?.originalCode)) || adapter?.cause?.kind === 'TransactionWriteConflict';
}

/** Reintenta únicamente conflictos de serialización; los callbacks no tienen efectos externos. */
export async function withTransaction<T>(prisma: PrismaClient, callback: (tx: Prisma.TransactionClient) => Promise<T>, isolationLevel: Prisma.TransactionIsolationLevel = Prisma.TransactionIsolationLevel.Serializable): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(callback, { isolationLevel });
    } catch (error) {
      if (!isTransactionConflict(error) || attempt >= 2) throw error;
    }
  }
}

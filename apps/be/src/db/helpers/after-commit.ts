import type { Transaction } from 'sequelize';

/**
 * Runs a side effect outside the database (e.g. removing files) only once
 * the change is committed: after the commit of `transaction` (never after a
 * rollback), or right away without a transaction.
 */
export const afterCommit = async (
  transaction: Transaction | null | undefined,
  action: () => Promise<void>
) => {
  if (transaction) transaction.afterCommit(action);
  else await action();
};

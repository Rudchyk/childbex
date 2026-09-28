import type { QueryInterface, Sequelize } from 'sequelize';

export interface MigrationContext {
  sequelize: Sequelize;
  queryInterface: QueryInterface;
}

/**
 * A versioned schema change. Migrations never import application models
 * (models change over time; a migration must keep doing exactly the same).
 * `down` is omitted when reverting is not safe (e.g. it would drop data).
 */
export interface Migration {
  /** `YYYYMMDDHHmm-<description>`; the order of application. */
  name: string;
  up(context: MigrationContext): Promise<void>;
  down?(context: MigrationContext): Promise<void>;
}

import { Injectable } from '@nestjs/common';
import { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { DatabaseService } from './database.service';

type QueryFunction = <T extends QueryResultRow>(
  text: string,
  values?: readonly unknown[],
) => Promise<QueryResult<T>>;

class DaoQueryBoundary {
  constructor(private readonly runQuery: QueryFunction) {}

  query<T extends QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<T>> {
    return this.runQuery<T>(text, values);
  }

  async one<T extends QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<T> {
    const result = await this.query<T>(text, values);
    if (result.rows.length !== 1) {
      throw new Error(
        `Database cardinality violation: expected 1 row, received ${result.rows.length}`,
      );
    }
    return result.rows[0];
  }

  async optional<T extends QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<T | undefined> {
    const result = await this.query<T>(text, values);
    if (result.rows.length > 1) {
      throw new Error(
        `Database cardinality violation: expected at most 1 row, received ${result.rows.length}`,
      );
    }
    return result.rows[0];
  }

  async many<T extends QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<T[]> {
    return (await this.query<T>(text, values)).rows;
  }

  async execute(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<number> {
    const result = await this.query(text, values);
    return result.rowCount ?? 0;
  }
}

export class DaoTransaction extends DaoQueryBoundary {
  constructor(client: PoolClient) {
    super(
      <T extends QueryResultRow>(
        text: string,
        values: readonly unknown[] = [],
      ) => client.query<T>(text, [...values]),
    );
  }
}

@Injectable()
export class CentralDao extends DaoQueryBoundary {
  constructor(private readonly database: DatabaseService) {
    super(
      <T extends QueryResultRow>(
        text: string,
        values: readonly unknown[] = [],
      ) => database.query<T>(text, values),
    );
  }

  transaction<T>(work: (transaction: DaoTransaction) => Promise<T>): Promise<T> {
    return this.database.transaction((client) =>
      work(new DaoTransaction(client)),
    );
  }
}

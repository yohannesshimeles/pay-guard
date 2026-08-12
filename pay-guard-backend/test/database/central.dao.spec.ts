import { QueryResult } from 'pg';
import { CentralDao } from '../../src/database/central.dao';
import { DatabaseService } from '../../src/database/database.service';

function result<T extends Record<string, unknown>>(rows: T[]): QueryResult<T> {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

describe('CentralDao', () => {
  const query = jest.fn();
  const transaction = jest.fn();
  const database = { query, transaction } as unknown as DatabaseService;
  const dao = new CentralDao(database);

  beforeEach(() => jest.clearAllMocks());

  it('returns exactly one row and forwards parameter values', async () => {
    query.mockResolvedValue(result([{ id: 'row-1' }]));

    await expect(dao.one<{ id: string }>('SELECT $1::text AS id', ['row-1']))
      .resolves.toEqual({ id: 'row-1' });
    expect(query).toHaveBeenCalledWith('SELECT $1::text AS id', ['row-1']);
  });

  it('rejects invalid one-row and optional-row cardinality', async () => {
    query.mockResolvedValueOnce(result([]));
    await expect(dao.one('SELECT 1 WHERE false')).rejects.toThrow(
      'expected 1 row, received 0',
    );

    query.mockResolvedValueOnce(result([{ id: 1 }, { id: 2 }]));
    await expect(dao.optional('SELECT id FROM example')).rejects.toThrow(
      'expected at most 1 row, received 2',
    );
  });

  it('returns row arrays and affected-row counts', async () => {
    query.mockResolvedValueOnce(result([{ id: 1 }, { id: 2 }]));
    await expect(dao.many('SELECT id FROM example')).resolves.toHaveLength(2);

    query.mockResolvedValueOnce({ ...result([]), rowCount: 3 });
    await expect(dao.execute('UPDATE example SET active = false')).resolves.toBe(3);
  });

  it('delegates transaction lifecycle ownership to DatabaseService', async () => {
    transaction.mockImplementation(
      async (work: (client: { query: typeof query }) => Promise<string>) =>
        work({ query }),
    );
    query.mockResolvedValue(result([{ value: 'ok' }]));

    await expect(
      dao.transaction((current) =>
        current.one<{ value: string }>('SELECT $1::text AS value', ['ok']),
      ),
    ).resolves.toEqual({ value: 'ok' });
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});

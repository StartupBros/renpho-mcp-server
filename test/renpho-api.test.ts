import test from 'node:test';
import assert from 'node:assert/strict';
import { RenphoApiService } from '../src/services/renpho-api.js';
import type { RenphoMeasurement } from '../src/types/renpho.js';

function createService() {
  return new RenphoApiService('test@example.com', 'password');
}

function createSession() {
  return {
    token: 'token',
    userId: 'user-1',
    scaleUserIds: ['scale-1', 'scale-2'],
    scaleTables: [
      { table_name: 'table_a', user_ids: ['scale-1'], count: 120 },
      { table_name: 'table_b', user_ids: ['scale-2'], count: 120 }
    ],
    user: {
      id: 'user-1',
      email: 'test@example.com'
    },
    expires_at: Date.now() + 60_000
  };
}

function measurement(overrides: Partial<RenphoMeasurement>): RenphoMeasurement {
  return {
    id: 'm-1',
    time_stamp: 1,
    weight: 80,
    ...overrides
  };
}

test('getScaleUsers returns every discovered scale user across tables', async () => {
  const service = createService() as any;
  service.authenticate = async () => createSession();

  const scaleUsers = await service.getScaleUsers();

  assert.equal(scaleUsers.length, 2);
  assert.deepEqual(
    scaleUsers.map((entry: any) => ({ user_id: entry.user_id, table_name: entry.table_name })),
    [
      { user_id: 'scale-1', table_name: 'table_a' },
      { user_id: 'scale-2', table_name: 'table_b' }
    ]
  );
});

test('getMeasurements prefers measurements already bound to the logged in user', async () => {
  const service = createService() as any;
  const session = createSession();
  service.authenticate = async () => session;
  service.getAssociatedMeasurements = async () => [
    measurement({
      id: 'hidden-newer',
      time_stamp: 200,
      scale_user_id: 'scale-2',
      user_id: 'other-user'
    }),
    measurement({
      id: 'visible-current-user',
      time_stamp: 150,
      scale_user_id: 'scale-1',
      user_id: 'user-1'
    })
  ];

  const measurements = await service.getMeasurements(undefined, undefined, 10);

  assert.equal(measurements.length, 1);
  assert.equal(measurements[0].id, 'visible-current-user');
});

test('getMeasurements falls back to the only scale user when measurements are not yet bound', async () => {
  const service = createService() as any;
  const session = {
    ...createSession(),
    scaleUserIds: ['scale-1'],
    scaleTables: [{ table_name: 'table_a', user_ids: ['scale-1'], count: 2 }]
  };
  service.authenticate = async () => session;
  service.getAssociatedMeasurements = async () => [
    measurement({ id: 'pending-bind', time_stamp: 300, scale_user_id: 'scale-1' })
  ];

  const measurements = await service.getMeasurements(undefined, undefined, 10);

  assert.equal(measurements.length, 1);
  assert.equal(measurements[0].id, 'pending-bind');
});

test('fetchMeasurementPage preserves big integer ids as strings', async () => {
  const service = createService() as any;
  service.postEncryptedRaw = async () => '[{"id":5919278420902642176,"timeStamp":1771059525,"bUserId":5245536005636456320,"subUserId":5245536005636456320,"weight":88.15}]';

  const page = await service.fetchMeasurementPage(createSession(), 'table_a', ['scale-1'], 1, 50);
  const mapped = service.mapMeasurement(page[0]);

  assert.equal(mapped.id, '5919278420902642176');
  assert.equal(mapped.user_id, '5245536005636456320');
  assert.equal(mapped.scale_user_id, '5245536005636456320');
});

test('fetchMeasurementsForTable pulls newest pages first when filtering recent timestamps', async () => {
  const service = createService() as any;
  const pagesVisited: number[] = [];
  service.fetchMeasurementPage = async (
    _session: unknown,
    _tableName: string,
    _userIds: string[],
    pageNum: number
  ) => {
    pagesVisited.push(pageNum);

    if (pageNum === 3) {
      return [
        { id: 3, timeStamp: 300, weight: 80 },
        { id: 4, timeStamp: 250, weight: 79 }
      ];
    }

    if (pageNum === 2) {
      return [
        { id: 2, timeStamp: 150, weight: 78 },
        { id: 5, timeStamp: 120, weight: 77 }
      ];
    }

    return [
      { id: 1, timeStamp: 90, weight: 76 }
    ];
  };

  const results = await service.fetchMeasurementsForTable(
    createSession(),
    { table_name: 'table_a', user_ids: ['scale-1'], count: 120 },
    ['scale-1'],
    2,
    200
  );

  assert.deepEqual(pagesVisited, [3]);
  assert.deepEqual(results.map((entry: any) => entry.id), [3, 4]);
});

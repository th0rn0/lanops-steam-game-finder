jest.mock('../../auth');

// Mock gameSearch so we control exactly what events fire
jest.mock('../../lib/gameSearch', () => {
  const actual = jest.requireActual('../../lib/gameSearch');
  return {
    ...actual,
    runGameSearch: jest.fn(),
  };
});

const { runGameSearchSync } = require('../../lib/searchApi');
const { runGameSearch } = require('../../lib/gameSearch');

const PUBLIC_ACCOUNTS = [
  { steamid: '111', name: 'Alice', avatar: '' },
  { steamid: '222', name: 'Bob', avatar: '' },
];
const COMMON_GAMES = [
  { appId: 730, name: 'CS2', avgHours: 10, totalMinutes: 1200, playtime: [] },
];

function makeSearchThatFires(events) {
  runGameSearch.mockImplementation(async (_inputs, _key, onEvent) => {
    for (const [event, data] of events) onEvent(event, data);
  });
}

describe('runGameSearchSync', () => {
  afterEach(() => jest.clearAllMocks());

  it('resolves with commonGames and accounts on done event', async () => {
    makeSearchThatFires([
      ['accounts', { publicAccounts: PUBLIC_ACCOUNTS, privateAccounts: [], resolutionErrors: [] }],
      ['done', { commonGames: COMMON_GAMES }],
    ]);

    const result = await runGameSearchSync(['111', '222'], 'key');
    expect(result.commonGames).toEqual(COMMON_GAMES);
    expect(result.publicAccounts).toEqual(PUBLIC_ACCOUNTS);
    expect(result.privateAccounts).toEqual([]);
    expect(result.resolutionErrors).toEqual([]);
  });

  it('collects private accounts from accounts-update events', async () => {
    const latePrivate = { steamid: '333', name: 'Charlie', avatar: '' };
    makeSearchThatFires([
      ['accounts', { publicAccounts: PUBLIC_ACCOUNTS, privateAccounts: [], resolutionErrors: [] }],
      ['accounts-update', { newPrivateAccounts: [latePrivate] }],
      ['done', { commonGames: [] }],
    ]);

    const result = await runGameSearchSync(['111', '222', '333'], 'key');
    expect(result.privateAccounts).toContainEqual(latePrivate);
  });

  it('includes resolutionErrors from accounts event', async () => {
    const err = { input: 'badvanity', error: 'Could not resolve' };
    makeSearchThatFires([
      ['accounts', { publicAccounts: PUBLIC_ACCOUNTS, privateAccounts: [], resolutionErrors: [err] }],
      ['done', { commonGames: [] }],
    ]);

    const result = await runGameSearchSync(['111', '222', 'badvanity'], 'key');
    expect(result.resolutionErrors).toContainEqual(err);
  });

  it('rejects when an error event fires', async () => {
    makeSearchThatFires([
      ['error', { message: 'Not enough valid Steam IDs' }],
    ]);

    await expect(runGameSearchSync(['bad1', 'bad2'], 'key'))
      .rejects.toThrow('Not enough valid Steam IDs');
  });

  it('rejects when runGameSearch throws directly', async () => {
    runGameSearch.mockRejectedValue(new Error('Steam API timeout'));

    await expect(runGameSearchSync(['111', '222'], 'key'))
      .rejects.toThrow('Steam API timeout');
  });

  it('includes optional message field from done event', async () => {
    makeSearchThatFires([
      ['accounts', { publicAccounts: [PUBLIC_ACCOUNTS[0]], privateAccounts: [PUBLIC_ACCOUNTS[1]], resolutionErrors: [] }],
      ['done', { commonGames: [], message: 'Not enough public accounts to compare.' }],
    ]);

    const result = await runGameSearchSync(['111', '222'], 'key');
    expect(result.message).toBe('Not enough public accounts to compare.');
    expect(result.commonGames).toEqual([]);
  });

  it('ignores events fired after done', async () => {
    makeSearchThatFires([
      ['accounts', { publicAccounts: PUBLIC_ACCOUNTS, privateAccounts: [], resolutionErrors: [] }],
      ['done', { commonGames: COMMON_GAMES }],
      ['error', { message: 'should be ignored' }],
    ]);

    // Should resolve, not reject
    const result = await runGameSearchSync(['111', '222'], 'key');
    expect(result.commonGames).toEqual(COMMON_GAMES);
  });

  it('passes empty arrays as defaults when accounts fields are missing', async () => {
    makeSearchThatFires([
      ['accounts', {}],
      ['done', {}],
    ]);

    const result = await runGameSearchSync(['111', '222'], 'key');
    expect(result.publicAccounts).toEqual([]);
    expect(result.privateAccounts).toEqual([]);
    expect(result.resolutionErrors).toEqual([]);
    expect(result.commonGames).toEqual([]);
  });
});

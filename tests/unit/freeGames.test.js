jest.mock('../../auth');

// These are hoisted — modules required inside tests will get these mocks
jest.mock('axios');
jest.mock('../../lib/gameSearch', () => ({
  getGameDetails: jest.fn(),
  isMultiplayer: jest.fn(),
  MULTIPLAYER_CATEGORY_IDS: new Set([1, 9, 27, 36, 47]),
}));

let getFreeMultiplayerGames;
let axios;
let getGameDetails;
let isMultiplayer;

beforeEach(() => {
  // Reset module registry so each test gets a fresh freeGames module (fresh cache)
  jest.resetModules();
  jest.mock('../../auth');
  jest.mock('axios');
  jest.mock('../../lib/gameSearch', () => ({
    getGameDetails: jest.fn(),
    isMultiplayer: jest.fn(),
    MULTIPLAYER_CATEGORY_IDS: new Set([1, 9, 27, 36, 47]),
  }));
  axios = require('axios');
  ({ getGameDetails, isMultiplayer } = require('../../lib/gameSearch'));
  ({ getFreeMultiplayerGames } = require('../../lib/freeGames'));
});

function makeSearchItems(appIds) {
  return appIds.map(id => ({
    logo: `https://cdn.akamai.steamstatic.com/steam/apps/${id}/header.jpg`,
    name: `Game ${id}`,
  }));
}

describe('getFreeMultiplayerGames', () => {
  it('returns multiplayer games from Steam search', async () => {
    axios.get.mockResolvedValueOnce({ data: { items: makeSearchItems([440]) } });
    getGameDetails.mockResolvedValueOnce({ type: 'game', name: 'Team Fortress 2', categories: [{ id: 1 }] });
    isMultiplayer.mockReturnValueOnce(true);

    const games = await getFreeMultiplayerGames();
    expect(Array.isArray(games)).toBe(true);
    expect(games.length).toBe(1);
    expect(games[0]).toMatchObject({ appId: 440, free: true, name: 'Team Fortress 2' });
  });

  it('extracts appId from logo URL regex', async () => {
    axios.get.mockResolvedValueOnce({ data: { items: makeSearchItems([570]) } });
    getGameDetails.mockResolvedValueOnce({ type: 'game', name: 'Dota 2', categories: [{ id: 1 }] });
    isMultiplayer.mockReturnValueOnce(true);

    const games = await getFreeMultiplayerGames();
    expect(games[0].appId).toBe(570);
  });

  it('filters out items with no logo URL match', async () => {
    axios.get.mockResolvedValueOnce({
      data: { items: [{ logo: 'https://example.com/no-app-id', name: 'Bad Item' }] },
    });

    const games = await getFreeMultiplayerGames();
    expect(games).toEqual([]);
  });

  it('filters out non-multiplayer games', async () => {
    axios.get.mockResolvedValueOnce({ data: { items: makeSearchItems([252490]) } });
    getGameDetails.mockResolvedValueOnce({ type: 'game', name: 'Rust', categories: [{ id: 2 }] });
    isMultiplayer.mockReturnValueOnce(false);

    const games = await getFreeMultiplayerGames();
    expect(games).toEqual([]);
  });

  it('filters out DLC (non-game type)', async () => {
    axios.get.mockResolvedValueOnce({ data: { items: makeSearchItems([12345]) } });
    getGameDetails.mockResolvedValueOnce({ type: 'dlc', name: 'Some DLC', categories: [{ id: 1 }] });
    isMultiplayer.mockReturnValueOnce(true);

    const games = await getFreeMultiplayerGames();
    expect(games).toEqual([]);
  });

  it('allows items where type is missing (old cache entries pass through)', async () => {
    axios.get.mockResolvedValueOnce({ data: { items: makeSearchItems([99999]) } });
    getGameDetails.mockResolvedValueOnce({ name: 'Old Game', categories: [{ id: 1 }] });
    isMultiplayer.mockReturnValueOnce(true);

    const games = await getFreeMultiplayerGames();
    expect(games.length).toBe(1);
    expect(games[0].appId).toBe(99999);
  });

  it('returns empty array when Steam search API throws with no prior cache', async () => {
    axios.get.mockRejectedValueOnce(new Error('Network error'));

    const games = await getFreeMultiplayerGames();
    expect(games).toEqual([]);
  });

  it('falls back to search result name when details.name is missing', async () => {
    axios.get.mockResolvedValueOnce({ data: { items: makeSearchItems([77777]) } });
    getGameDetails.mockResolvedValueOnce({ type: 'game', categories: [{ id: 1 }] });
    isMultiplayer.mockReturnValueOnce(true);

    const games = await getFreeMultiplayerGames();
    expect(games[0].name).toBe('Game 77777');
  });
});

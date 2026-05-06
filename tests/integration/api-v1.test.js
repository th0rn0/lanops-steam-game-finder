jest.mock('../../auth');

// Prevent the on-disk game-details cache from bleeding into tests —
// module-level loadCache() runs on require and would return stale entries
// that skip nock-intercepted HTTP calls.
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: (p) => {
    if (typeof p === 'string' && p.includes('game-details.json')) return false;
    return jest.requireActual('fs').existsSync(p);
  },
}));

const request = require('supertest');
const nock = require('nock');

const STEAM_API = 'https://api.steampowered.com';
const STEAM_STORE = 'https://store.steampowered.com';

const PLAYER_1 = '76561197960287930';
const PLAYER_2 = '76561197960287931';

beforeAll(() => {
  nock.disableNetConnect();
  nock.enableNetConnect('127.0.0.1');
});
afterAll(() => {
  nock.cleanAll();
  nock.enableNetConnect();
});
afterEach(() => {
  nock.cleanAll();
  delete process.env.API_KEY;
});

// Re-require app after each env change so API_KEY is picked up
function getApp() {
  jest.resetModules();
  jest.mock('../../auth');
  return require('../../server').app;
}

// ── Input validation ──────────────────────────────────────────────────────────

describe('POST /api/v1/search — validation', () => {
  let app;
  beforeAll(() => { app = getApp(); });

  it('returns 400 when steamIds is missing', async () => {
    const res = await request(app).post('/api/v1/search').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 2/i);
  });

  it('returns 400 when steamIds has only one entry', async () => {
    const res = await request(app).post('/api/v1/search').send({ steamIds: [PLAYER_1] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when steamIds is empty', async () => {
    const res = await request(app).post('/api/v1/search').send({ steamIds: [] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when steamIds contains only blank strings', async () => {
    const res = await request(app).post('/api/v1/search').send({ steamIds: ['', '  '] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when steamIds is not an array', async () => {
    const res = await request(app).post('/api/v1/search').send({ steamIds: PLAYER_1 });
    expect(res.status).toBe(400);
  });
});

// ── API key authentication ────────────────────────────────────────────────────

describe('POST /api/v1/search — authentication', () => {
  beforeEach(() => {
    process.env.API_KEY = 'secret-test-key';
  });

  it('returns 401 when API_KEY is set but no key is provided', async () => {
    const app = getApp();
    const res = await request(app).post('/api/v1/search').send({ steamIds: [PLAYER_1, PLAYER_2] });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/required/i);
  });

  it('returns 403 when wrong key is provided via X-Api-Key', async () => {
    const app = getApp();
    const res = await request(app)
      .post('/api/v1/search')
      .set('X-Api-Key', 'wrong-key')
      .send({ steamIds: [PLAYER_1, PLAYER_2] });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it('returns 403 when wrong key is provided via Authorization header', async () => {
    const app = getApp();
    const res = await request(app)
      .post('/api/v1/search')
      .set('Authorization', 'Bearer wrong-key')
      .send({ steamIds: [PLAYER_1, PLAYER_2] });
    expect(res.status).toBe(403);
  });

  it('passes through when correct key is provided via X-Api-Key', async () => {
    const app = getApp();
    // Mock enough Steam API to get past auth and return a valid response
    nock(STEAM_API).get('/ISteamUser/GetPlayerSummaries/v2/').query(true)
      .reply(200, { response: { players: [
        { steamid: PLAYER_1, personaname: 'Alice', communityvisibilitystate: 3, avatarmedium: '' },
        { steamid: PLAYER_2, personaname: 'Bob', communityvisibilitystate: 3, avatarmedium: '' },
      ] } });
    nock(STEAM_API).get('/IPlayerService/GetOwnedGames/v1/').query(true)
      .reply(200, { response: { games: [] } });
    nock(STEAM_API).get('/IPlayerService/GetOwnedGames/v1/').query(true)
      .reply(200, { response: { games: [] } });

    const res = await request(app)
      .post('/api/v1/search')
      .set('X-Api-Key', 'secret-test-key')
      .send({ steamIds: [PLAYER_1, PLAYER_2] });

    expect(res.status).toBe(200);
  });

  it('passes through when correct key is provided via Authorization Bearer', async () => {
    const app = getApp();
    nock(STEAM_API).get('/ISteamUser/GetPlayerSummaries/v2/').query(true)
      .reply(200, { response: { players: [
        { steamid: PLAYER_1, personaname: 'Alice', communityvisibilitystate: 3, avatarmedium: '' },
        { steamid: PLAYER_2, personaname: 'Bob', communityvisibilitystate: 3, avatarmedium: '' },
      ] } });
    nock(STEAM_API).get('/IPlayerService/GetOwnedGames/v1/').query(true)
      .reply(200, { response: { games: [] } });
    nock(STEAM_API).get('/IPlayerService/GetOwnedGames/v1/').query(true)
      .reply(200, { response: { games: [] } });

    const res = await request(app)
      .post('/api/v1/search')
      .set('Authorization', 'Bearer secret-test-key')
      .send({ steamIds: [PLAYER_1, PLAYER_2] });

    expect(res.status).toBe(200);
  });

  it('is open (no auth required) when API_KEY env is not set', async () => {
    delete process.env.API_KEY;
    const app = getApp();
    nock(STEAM_API).get('/ISteamUser/GetPlayerSummaries/v2/').query(true)
      .reply(200, { response: { players: [
        { steamid: PLAYER_1, personaname: 'Alice', communityvisibilitystate: 3, avatarmedium: '' },
        { steamid: PLAYER_2, personaname: 'Bob', communityvisibilitystate: 3, avatarmedium: '' },
      ] } });
    nock(STEAM_API).get('/IPlayerService/GetOwnedGames/v1/').query(true)
      .reply(200, { response: { games: [] } });
    nock(STEAM_API).get('/IPlayerService/GetOwnedGames/v1/').query(true)
      .reply(200, { response: { games: [] } });

    const res = await request(app).post('/api/v1/search').send({ steamIds: [PLAYER_1, PLAYER_2] });
    expect(res.status).toBe(200);
  });
});

// ── Success response shape ────────────────────────────────────────────────────

describe('POST /api/v1/search — response shape', () => {
  let app;
  beforeAll(() => { app = getApp(); });

  it('returns commonGames, publicAccounts, privateAccounts, resolutionErrors', async () => {
    nock(STEAM_API).get('/ISteamUser/GetPlayerSummaries/v2/').query(true)
      .reply(200, { response: { players: [
        { steamid: PLAYER_1, personaname: 'Alice', communityvisibilitystate: 3, avatarmedium: '' },
        { steamid: PLAYER_2, personaname: 'Bob', communityvisibilitystate: 3, avatarmedium: '' },
      ] } });
    nock(STEAM_API).get('/IPlayerService/GetOwnedGames/v1/').query(true)
      .reply(200, { response: { games: [] } });
    nock(STEAM_API).get('/IPlayerService/GetOwnedGames/v1/').query(true)
      .reply(200, { response: { games: [] } });

    const res = await request(app).post('/api/v1/search').send({ steamIds: [PLAYER_1, PLAYER_2] });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('commonGames');
    expect(res.body).toHaveProperty('publicAccounts');
    expect(res.body).toHaveProperty('privateAccounts');
    expect(res.body).toHaveProperty('resolutionErrors');
    expect(Array.isArray(res.body.commonGames)).toBe(true);
    expect(Array.isArray(res.body.publicAccounts)).toBe(true);
    expect(Array.isArray(res.body.privateAccounts)).toBe(true);
  });

  it('includes shared multiplayer games in commonGames', async () => {
    nock(STEAM_API).get('/ISteamUser/GetPlayerSummaries/v2/').query(true)
      .reply(200, { response: { players: [
        { steamid: PLAYER_1, personaname: 'Alice', communityvisibilitystate: 3, avatarmedium: '' },
        { steamid: PLAYER_2, personaname: 'Bob', communityvisibilitystate: 3, avatarmedium: '' },
      ] } });
    // Both own app 730 (CS2)
    nock(STEAM_API).get('/IPlayerService/GetOwnedGames/v1/').query(true)
      .reply(200, { response: { games: [{ appid: 730, playtime_forever: 600 }] } });
    nock(STEAM_API).get('/IPlayerService/GetOwnedGames/v1/').query(true)
      .reply(200, { response: { games: [{ appid: 730, playtime_forever: 300 }] } });
    // CS2 store details — multiplayer
    nock(STEAM_STORE).get('/api/appdetails').query(true)
      .reply(200, { 730: { success: true, data: {
        type: 'game', name: 'Counter-Strike 2',
        categories: [{ id: 1, description: 'Multi-player' }],
      } } });

    const res = await request(app).post('/api/v1/search').send({ steamIds: [PLAYER_1, PLAYER_2] });

    expect(res.status).toBe(200);
    expect(res.body.commonGames.length).toBe(1);
    expect(res.body.commonGames[0].name).toBe('Counter-Strike 2');
    expect(res.body.commonGames[0]).toHaveProperty('appId');
    expect(res.body.commonGames[0]).toHaveProperty('avgHours');
    expect(res.body.commonGames[0]).toHaveProperty('totalMinutes');
    expect(res.body.commonGames[0]).toHaveProperty('playtimeInfo');
    expect(res.body.publicAccounts).toHaveLength(2);
    expect(res.body.privateAccounts).toHaveLength(0);
  });

  it('reports private accounts correctly', async () => {
    nock(STEAM_API).get('/ISteamUser/GetPlayerSummaries/v2/').query(true)
      .reply(200, { response: { players: [
        { steamid: PLAYER_1, personaname: 'Alice', communityvisibilitystate: 3, avatarmedium: '' },
        { steamid: PLAYER_2, personaname: 'Bob', communityvisibilitystate: 1, avatarmedium: '' },
      ] } });

    const res = await request(app).post('/api/v1/search').send({ steamIds: [PLAYER_1, PLAYER_2] });

    expect(res.status).toBe(200);
    expect(res.body.privateAccounts.length).toBeGreaterThan(0);
    expect(res.body.privateAccounts[0].name).toBe('Bob');
  });

  it('returns 502 when Steam IDs cannot be resolved', async () => {
    // ResolveVanityURL fails for unknown vanity names
    nock(STEAM_API).get('/ISteamUser/ResolveVanityURL/v1/').query(true)
      .reply(200, { response: { success: 42 } });
    nock(STEAM_API).get('/ISteamUser/ResolveVanityURL/v1/').query(true)
      .reply(200, { response: { success: 42 } });

    const res = await request(app)
      .post('/api/v1/search')
      .send({ steamIds: ['notarealvanity1111', 'notarealvanity2222'] });

    expect(res.status).toBe(502);
    expect(res.body).toHaveProperty('error');
  });
});

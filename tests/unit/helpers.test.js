jest.mock('../../auth');
jest.mock('axios');

const axios = require('axios');
const { isMultiplayer, Semaphore, normaliseSteamInput } = require('../../server');

// ── isMultiplayer ─────────────────────────────────────────────────────────────

describe('isMultiplayer', () => {
  it('returns false for null', () => {
    expect(isMultiplayer(null)).toBe(false);
  });

  it('returns false when categories missing', () => {
    expect(isMultiplayer({})).toBe(false);
  });

  it('returns false for single-player-only categories', () => {
    expect(isMultiplayer({ categories: [{ id: 2 }, { id: 22 }] })).toBe(false);
  });

  it('returns true for Multi-player (id 1)', () => {
    expect(isMultiplayer({ categories: [{ id: 1 }] })).toBe(true);
  });

  it('returns true for Co-op (id 9)', () => {
    expect(isMultiplayer({ categories: [{ id: 9 }] })).toBe(true);
  });

  it('returns true for Online PvP (id 36)', () => {
    expect(isMultiplayer({ categories: [{ id: 36 }] })).toBe(true);
  });

  it('returns true for Online Co-op (id 38)', () => {
    expect(isMultiplayer({ categories: [{ id: 38 }] })).toBe(true);
  });

  it('returns true when multiplayer is mixed with non-multiplayer categories', () => {
    expect(isMultiplayer({ categories: [{ id: 2 }, { id: 1 }, { id: 22 }] })).toBe(true);
  });

  it('returns true for Local Co-op (id 47)', () => {
    expect(isMultiplayer({ categories: [{ id: 47 }] })).toBe(true);
  });

  it('returns true for Cross-Platform Multiplayer (id 27)', () => {
    expect(isMultiplayer({ categories: [{ id: 27 }] })).toBe(true);
  });
});

// ── Semaphore ─────────────────────────────────────────────────────────────────

describe('Semaphore', () => {
  it('allows up to max concurrent acquisitions without queuing', async () => {
    const sem = new Semaphore(2);
    await sem.acquire();
    await sem.acquire();
    expect(sem.count).toBe(2);
  });

  it('queues acquisitions beyond max and unblocks on release', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    let resolved = false;
    const pending = sem.acquire().then(() => { resolved = true; });

    expect(resolved).toBe(false);
    sem.release();
    await pending;
    expect(resolved).toBe(true);
  });

  it('decrements count on release', async () => {
    const sem = new Semaphore(2);
    await sem.acquire();
    sem.release();
    expect(sem.count).toBe(0);
  });

  it('processes queued items in FIFO order', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    const order = [];
    const p1 = sem.acquire().then(() => order.push(1));
    const p2 = sem.acquire().then(() => order.push(2));

    sem.release();
    await p1;
    sem.release();
    await p2;

    expect(order).toEqual([1, 2]);
  });
});

// ── normaliseSteamInput ───────────────────────────────────────────────────────

describe('normaliseSteamInput', () => {
  beforeEach(() => jest.clearAllMocks());

  it('resolves a valid 64-bit Steam ID without an API call', async () => {
    const result = await normaliseSteamInput('76561197960287930');
    expect(result.steamid).toBe('76561197960287930');
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('strips a /profiles/ URL and resolves the 64-bit ID', async () => {
    const result = await normaliseSteamInput('https://steamcommunity.com/profiles/76561197960287930');
    expect(result.steamid).toBe('76561197960287930');
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('strips a /profiles/ URL with trailing slash', async () => {
    const result = await normaliseSteamInput('https://steamcommunity.com/profiles/76561197960287930/');
    expect(result.steamid).toBe('76561197960287930');
  });

  it('resolves a vanity URL via the Steam API', async () => {
    axios.get.mockResolvedValueOnce({
      data: { response: { success: 1, steamid: '76561197960287930' } },
    });
    const result = await normaliseSteamInput('gabelogannewell');
    expect(result.steamid).toBe('76561197960287930');
    expect(result.vanity).toBe('gabelogannewell');
  });

  it('strips a /id/ URL and resolves the vanity part', async () => {
    axios.get.mockResolvedValueOnce({
      data: { response: { success: 1, steamid: '76561197960287930' } },
    });
    const result = await normaliseSteamInput('https://steamcommunity.com/id/gabelogannewell');
    expect(result.steamid).toBe('76561197960287930');
  });

  it('returns steamid null when the vanity URL cannot be resolved', async () => {
    axios.get.mockResolvedValueOnce({
      data: { response: { success: 42 } },
    });
    const result = await normaliseSteamInput('doesnotexist_xyz');
    expect(result.steamid).toBeNull();
    expect(result.error).toMatch(/Could not resolve/);
  });

  it('returns steamid null when the API call throws', async () => {
    axios.get.mockRejectedValueOnce(new Error('network error'));
    const result = await normaliseSteamInput('somevanity');
    expect(result.steamid).toBeNull();
  });

  it('trims whitespace from the input', async () => {
    const result = await normaliseSteamInput('  76561197960287930  ');
    expect(result.steamid).toBe('76561197960287930');
  });
});

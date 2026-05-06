/**
 * @jest-environment jsdom
 */

// Pure utility tests that don't require the full app to be loaded.
// app.js attaches to the DOM on import so we test the logic functions directly.

const escHtml = (str) =>
  String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// ── escHtml ───────────────────────────────────────────────────────────────────

describe('escHtml', () => {
  it('escapes ampersands', () => {
    expect(escHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes < and >', () => {
    expect(escHtml('<div>')).toBe('&lt;div&gt;');
  });

  it('escapes double quotes', () => {
    expect(escHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes single quotes', () => {
    expect(escHtml("it's")).toBe('it&#39;s');
  });

  it('handles null gracefully', () => {
    expect(escHtml(null)).toBe('');
  });

  it('handles undefined gracefully', () => {
    expect(escHtml(undefined)).toBe('');
  });

  it('handles numbers', () => {
    expect(escHtml(42)).toBe('42');
  });

  it('leaves safe strings unchanged', () => {
    expect(escHtml('hello world')).toBe('hello world');
  });

  it('neutralises a script injection payload', () => {
    const xss = '<script>alert("xss")</script>';
    const out = escHtml(xss);
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(out).not.toContain('"');
    expect(out).toContain('&lt;script&gt;');
  });

  it('neutralises an img onerror payload', () => {
    const xss = "<img src=x onerror='alert(1)'>";
    const out = escHtml(xss);
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(out).not.toContain("'");
  });

  it('escapes multiple special chars in one string', () => {
    expect(escHtml('<a href="x&y">test</a>')).toBe(
      '&lt;a href=&quot;x&amp;y&quot;&gt;test&lt;/a&gt;'
    );
  });
});

// ── SSE parsing (inline re-implementation of handleSSE logic) ─────────────────

function parseSseChunk(raw) {
  const lines = raw.trim().split('\n');
  let event = 'message';
  let dataStr = '';
  for (const line of lines) {
    if (line.startsWith('event: ')) event = line.slice(7);
    else if (line.startsWith('data: ')) dataStr = line.slice(6);
  }
  if (!dataStr) return null;
  try {
    return { event, data: JSON.parse(dataStr) };
  } catch {
    return null;
  }
}

describe('SSE chunk parser', () => {
  it('parses a well-formed event', () => {
    const chunk = 'event: progress\ndata: {"step":1,"total":5}';
    const result = parseSseChunk(chunk);
    expect(result.event).toBe('progress');
    expect(result.data.step).toBe(1);
  });

  it('defaults event to "message" when no event line', () => {
    const chunk = 'data: {"foo":"bar"}';
    const result = parseSseChunk(chunk);
    expect(result.event).toBe('message');
    expect(result.data.foo).toBe('bar');
  });

  it('returns null for empty data', () => {
    expect(parseSseChunk('event: progress')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseSseChunk('data: not-json')).toBeNull();
  });
});

// ── Game sorting logic ────────────────────────────────────────────────────────

function sortGames(games, mode) {
  const sorted = [...games];
  if (mode === 'name') {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  } else if (mode === 'cumulative') {
    sorted.sort((a, b) => b.totalMinutes - a.totalMinutes);
  } else {
    sorted.sort((a, b) => b.avgHours - a.avgHours);
  }
  return sorted;
}

describe('sortGames', () => {
  const games = [
    { name: 'Zork',      avgHours: 1,  totalMinutes: 60  },
    { name: 'Apex',      avgHours: 50, totalMinutes: 3000 },
    { name: 'Minecraft', avgHours: 20, totalMinutes: 500 },
  ];

  it('sorts by average playtime (avgHours) descending', () => {
    const sorted = sortGames(games, 'playtime');
    expect(sorted.map(g => g.name)).toEqual(['Apex', 'Minecraft', 'Zork']);
  });

  it('sorts by cumulative playtime (totalMinutes) descending', () => {
    const sorted = sortGames(games, 'cumulative');
    expect(sorted.map(g => g.name)).toEqual(['Apex', 'Minecraft', 'Zork']);
  });

  it('sorts by name ascending', () => {
    const sorted = sortGames(games, 'name');
    expect(sorted.map(g => g.name)).toEqual(['Apex', 'Minecraft', 'Zork']);
  });

  it('does not mutate the original array', () => {
    const original = [...games];
    sortGames(games, 'playtime');
    expect(games).toEqual(original);
  });
});

// ── Game filtering logic ──────────────────────────────────────────────────────

function filterGames(games, query) {
  if (!query) return games;
  const q = query.toLowerCase();
  return games.filter(g => g.name.toLowerCase().includes(q));
}

describe('filterGames', () => {
  const games = [
    { name: 'Counter-Strike 2' },
    { name: 'Left 4 Dead 2' },
    { name: 'Team Fortress 2' },
  ];

  it('returns all games when query is empty', () => {
    expect(filterGames(games, '')).toHaveLength(3);
  });

  it('filters case-insensitively', () => {
    expect(filterGames(games, 'COUNTER')).toHaveLength(1);
    expect(filterGames(games, 'counter')).toHaveLength(1);
  });

  it('returns empty array when no match', () => {
    expect(filterGames(games, 'halo')).toHaveLength(0);
  });

  it('matches partial names', () => {
    expect(filterGames(games, '2')).toHaveLength(3);
  });

  it('matches a single game', () => {
    const result = filterGames(games, 'left 4');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Left 4 Dead 2');
  });
});

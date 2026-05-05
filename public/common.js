/* Shared utilities included by both app.js (main page) and party.js (party page) */

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function makeAccountChip(acc) {
  const chip = document.createElement('div');
  chip.className = 'account-chip';
  const avatarEl = acc.avatar
    ? `<img src="${escHtml(acc.avatar)}" alt="${escHtml(acc.name)}" />`
    : `<div class="avatar-placeholder">${escHtml((acc.name || '?')[0].toUpperCase())}</div>`;
  chip.innerHTML = `${avatarEl}<span>${escHtml(acc.name || acc.steamid)}</span>`;
  return chip;
}

function makeGameCard(game) {
  const card = document.createElement('div');
  card.className = 'game-card';

  const cats = (game.categories || [])
    .map(c => `<span class="cat-tag">${escHtml(c)}</span>`)
    .join('');

  const playtimeRows = (game.playtimeInfo || []).map(p => {
    const avatarEl = p.avatar
      ? `<img src="${escHtml(p.avatar)}" alt="${escHtml(p.name)}" />`
      : `<div class="avatar-sm">${escHtml((p.name || '?')[0].toUpperCase())}</div>`;
    const hoursClass = p.hours === 0 ? 'zero' : '';
    const hoursLabel = p.hours === 0 ? 'Never played' : `${p.hours}h`;
    return `<div class="playtime-row">${avatarEl}<span>${escHtml(p.name)}</span><span class="playtime-hours ${hoursClass}">${hoursLabel}</span></div>`;
  }).join('');

  card.innerHTML = `
    <div class="game-img-wrap">
      <img class="loading" src="${escHtml(game.headerImage)}" alt="${escHtml(game.name)}" loading="lazy" />
    </div>
    <div class="game-body">
      <div class="game-name">${escHtml(game.name)}</div>
      <div class="game-categories">${cats}</div>
      <div class="playtime-list">${playtimeRows}</div>
    </div>
    <a class="store-link" href="${escHtml(game.storeUrl)}" target="_blank" rel="noopener">View on Steam Store &#8599;</a>
  `;

  const img = card.querySelector('img');
  img.addEventListener('load', () => img.classList.remove('loading'));
  img.addEventListener('error', () => { img.style.display = 'none'; });

  return card;
}

// Reads an SSE Response body and calls onChunk({ event, data }) for each complete event
function readSseStream(response, onChunk) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  function pump() {
    return reader.read().then(({ done, value }) => {
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop();
      for (const part of parts) {
        if (!part.trim() || part.startsWith(':')) continue;
        const lines = part.trim().split('\n');
        let event = 'message';
        let dataStr = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) event = line.slice(7);
          else if (line.startsWith('data: ')) dataStr = line.slice(6);
        }
        if (!dataStr) continue;
        try {
          onChunk({ event, data: JSON.parse(dataStr) });
        } catch {}
      }
      return pump();
    });
  }
  return pump();
}

const { runGameSearch } = require('./gameSearch');

// Wraps runGameSearch into a single Promise that resolves with the full result.
// Used by the REST API endpoint so callers don't need to consume SSE events.
async function runGameSearchSync(rawInputs, apiKey) {
  const result = {
    commonGames: [],
    publicAccounts: [],
    privateAccounts: [],
    resolutionErrors: [],
  };

  let settled = false;
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });

  const onEvent = (event, data) => {
    if (settled) return;
    switch (event) {
      case 'accounts':
        result.publicAccounts = data.publicAccounts || [];
        result.privateAccounts = [...(data.privateAccounts || [])];
        result.resolutionErrors = data.resolutionErrors || [];
        break;
      case 'accounts-update':
        result.privateAccounts.push(...(data.newPrivateAccounts || []));
        break;
      case 'done':
        settled = true;
        result.commonGames = data.commonGames || [];
        if (data.message) result.message = data.message;
        resolve(result);
        break;
      case 'error':
        settled = true;
        reject(new Error(data.message));
        break;
    }
  };

  runGameSearch(rawInputs, apiKey, onEvent).catch(err => {
    if (!settled) { settled = true; reject(err); }
  });

  return promise;
}

module.exports = { runGameSearchSync };

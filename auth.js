const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;

module.exports = function setupAuth(app, { apiKey, baseUrl }) {
  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((user, done) => done(null, user));

  passport.use(new SteamStrategy({
    returnURL: `${baseUrl}/auth/steam/return`,
    realm: `${baseUrl}/`,
    apiKey,
  }, (_identifier, profile, done) => {
    done(null, {
      steamid: profile.id,
      name: profile.displayName,
      avatar: profile.photos[2]?.value || profile.photos[1]?.value || null,
    });
  }));

  app.get('/auth/steam', (req, res, next) => {
    if (req.query.returnTo) {
      // Validate returnTo is a relative path to prevent open redirect
      const returnTo = req.query.returnTo;
      if (/^\/[^/\\]/.test(returnTo)) req.session.returnTo = returnTo;
    }
    passport.authenticate('steam')(req, res, next);
  });

  app.get('/auth/steam/return',
    passport.authenticate('steam', { failureRedirect: '/' }),
    (req, res) => {
      const returnTo = req.session.returnTo || '/';
      delete req.session.returnTo;
      res.redirect(returnTo);
    }
  );

  app.get('/auth/logout', (req, res, next) => {
    req.logout(err => {
      if (err) return next(err);
      res.redirect('/');
    });
  });
};

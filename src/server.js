require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, '../public')));

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 },
  })
);

// Obaveštenje o dostupnom ažuriranju — vidljivo samo administratorima
const updateChecker = require('./services/updateChecker');
updateChecker.pokreniPeriodicnuProveru();

app.use((req, res, next) => {
  const rezultat = updateChecker.poslednjiRezultat();
  res.locals.updateDostupan = Boolean(
    req.session.korisnik &&
    req.session.korisnik.uloga === 'administrator' &&
    rezultat &&
    rezultat.updateDostupan
  );
  res.locals.korisnik = req.session.korisnik || null;
  next();
});

// Rute (dodaju se postupno kako se moduli razvijaju)
app.use('/', require('./routes/auth'));
app.use('/komitenti', require('./routes/komitenti'));
app.use('/podesavanja', require('./routes/podesavanja'));
app.use('/korisnici', require('./routes/korisnici'));
app.use('/portal', require('./routes/portal')); // MORA pre '/' mountovanih ruta ispod (poslovi/ponude/radniNalozi/dashboard
                                                  // globalno presreću sve na '/' svojim zahtevajLogin middleware-om)
app.use('/', require('./routes/dashboard'));
app.use('/', require('./routes/poslovi'));
app.use('/', require('./routes/ponude'));
app.use('/', require('./routes/radniNalozi'));

// 404 — nijedna ruta iznad nije uhvatila zahtev
app.use((req, res) => {
  res.status(404).render('greska', { poruka: `Stranica nije pronađena: ${req.originalUrl}` });
});

// Opšta obrada grešaka — hvata sve neuhvaćene greške iz ruta iznad.
// Puna greška (poruka + stack) ide u server log (vidljivo preko journalctl),
// a korisnik dobija čitljivu stranicu umesto gole "Internal Server Error" poruke.
app.use((err, req, res, next) => {
  console.error('=== NEUHVAĆENA GREŠKA ===');
  console.error(`Ruta: ${req.method} ${req.originalUrl}`);
  console.error(err.stack || err.message || err);
  console.error('========================');

  if (res.headersSent) return next(err);

  res.status(500).render('greska', {
    poruka: 'Došlo je do neočekivane greške. Detalji su zabeleženi u serverskom logu (sudo journalctl -u gomteh -n 50).',
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`GOMTEH pokrenut na http://localhost:${PORT}`);
});

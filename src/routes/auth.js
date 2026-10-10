const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../db/db');
const Komitent = require('../models/komitent');
const Korisnik = require('../models/korisnik');
const oidc = require('../services/oidc');

// --- Interni korisnici ---

router.get('/prijava', (req, res) => {
  if (req.session.korisnik) return res.redirect('/');
  res.render('auth/prijava', { greska: null });
});

router.post('/prijava', (req, res) => {
  const { email, lozinka } = req.body;
  const korisnik = db.prepare('SELECT * FROM korisnik WHERE LOWER(email) = LOWER(?) AND aktivan = 1').get(email);

  if (!korisnik || !bcrypt.compareSync(lozinka, korisnik.lozinka_hash)) {
    return res.status(401).render('auth/prijava', { greska: 'Pogrešan email ili lozinka.' });
  }

  req.session.korisnik = {
    id: korisnik.id,
    ime: korisnik.ime,
    email: korisnik.email,
    uloga: korisnik.uloga,
  };

  if (korisnik.mora_promeniti_lozinku) {
    return res.redirect('/promeni-lozinku');
  }
  res.redirect('/');
});

router.get('/promeni-lozinku', (req, res) => {
  if (!req.session.korisnik) return res.redirect('/prijava');
  res.render('auth/promeni-lozinku', { greska: null });
});

router.post('/promeni-lozinku', (req, res) => {
  if (!req.session.korisnik) return res.redirect('/prijava');
  const { novaLozinka, potvrdaLozinke } = req.body;

  if (!novaLozinka || novaLozinka.length < 8) {
    return res.status(400).render('auth/promeni-lozinku', {
      greska: 'Lozinka mora imati najmanje 8 karaktera.',
    });
  }
  if (novaLozinka !== potvrdaLozinke) {
    return res.status(400).render('auth/promeni-lozinku', {
      greska: 'Lozinke se ne poklapaju.',
    });
  }

  const hash = bcrypt.hashSync(novaLozinka, 12);
  db.prepare('UPDATE korisnik SET lozinka_hash = ?, mora_promeniti_lozinku = 0 WHERE id = ?').run(
    hash,
    req.session.korisnik.id
  );
  res.redirect('/');
});

// --- Prijava preko Keycloak-a (OIDC) ---

function oidcGreska(res, status, greska) {
  return res.status(status).render('auth/prijava', { greska });
}

router.get('/auth/oidc/login', async (req, res, next) => {
  if (!oidc.ukljucen()) return res.redirect('/prijava');
  try {
    const adresa = await oidc.zapocniPrijavu(req);
    // Sesija (sa state/nonce/PKCE) mora biti snimljena pre nego što browser ode na Keycloak.
    req.session.save((err) => (err ? next(err) : res.redirect(adresa)));
  } catch (e) {
    console.error('OIDC: ne mogu da započnem prijavu:', e);
    oidcGreska(res, 502, 'Keycloak trenutno nije dostupan. Prijavi se emailom i lozinkom.');
  }
});

router.get('/auth/oidc/callback', async (req, res, next) => {
  if (!oidc.ukljucen()) return res.redirect('/prijava');
  // Callback bez parametara (npr. klik na "Back to Application" na Keycloak grešci)
  if (!req.query.code && !req.query.error) return res.redirect('/prijava');

  if (req.query.error) {
    console.error(`OIDC: Keycloak je vratio grešku: ${req.query.error} ${req.query.error_description || ''}`);
    return oidcGreska(res, 400, 'Prijava preko Keycloak-a nije završena.');
  }

  try {
    const { claims, idToken } = await oidc.zavrsiPrijavu(req);

    const uloga = oidc.izaberiUlogu(claims);
    if (!uloga) {
      return oidcGreska(res, 403, 'Tvoj Keycloak nalog nema dodeljenu ulogu za GomTeh. Javi se administratoru.');
    }

    const korisnik = Korisnik.prijaviIliKreirajOidc({
      sub: claims.sub,
      email: claims.email,
      emailPotvrdjen: claims.email_verified === true,
      ime: claims.name || claims.preferred_username,
      uloga,
    });

    if (!korisnik.aktivan) {
      return oidcGreska(res, 403, 'Nalog je deaktiviran u GomTeh-u.');
    }

    // Nova sesija posle prijave (zaštita od session fixation napada).
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.korisnik = {
        id: korisnik.id,
        ime: korisnik.ime,
        email: korisnik.email,
        uloga: korisnik.uloga,
      };
      req.session.oidcIdToken = idToken;
      req.session.save((err2) => (err2 ? next(err2) : res.redirect('/')));
    });
  } catch (e) {
    console.error('OIDC: prijava nije uspela:', e);
    oidcGreska(res, 400, e.javna ? e.message : 'Prijava preko Keycloak-a nije uspela. Detalji su u serverskom logu.');
  }
});

router.post('/odjava', async (req, res) => {
  let cilj = '/prijava';
  const idToken = req.session.oidcIdToken;
  if (idToken && oidc.ukljucen()) {
    try {
      cilj = await oidc.adresaOdjave(idToken);
    } catch (e) {
      console.error('OIDC: ne mogu da napravim adresu za odjavu iz Keycloak-a:', e.message);
    }
  }
  req.session.destroy(() => res.redirect(cilj));
});

// --- Portal komitenata ---

router.get('/portal/prijava', (req, res) => {
  if (req.session.komitent) return res.redirect('/portal');
  res.render('auth/portal-prijava', { greska: null });
});

router.post('/portal/prijava', (req, res) => {
  const { email, lozinka } = req.body;
  const komitent = Komitent.proveriLozinku(email, lozinka);

  if (!komitent) {
    return res.status(401).render('auth/portal-prijava', { greska: 'Pogrešan email ili lozinka.' });
  }

  req.session.komitent = { id: komitent.id, naziv: komitent.naziv, email: komitent.email };

  if (komitent.mora_promeniti_lozinku) {
    return res.redirect('/portal/promeni-lozinku');
  }
  res.redirect('/portal');
});

router.get('/portal/promeni-lozinku', (req, res) => {
  if (!req.session.komitent) return res.redirect('/portal/prijava');
  res.render('auth/portal-promeni-lozinku', { greska: null });
});

router.post('/portal/promeni-lozinku', (req, res) => {
  if (!req.session.komitent) return res.redirect('/portal/prijava');
  const { novaLozinka, potvrdaLozinke } = req.body;

  if (!novaLozinka || novaLozinka.length < 8) {
    return res.status(400).render('auth/portal-promeni-lozinku', {
      greska: 'Lozinka mora imati najmanje 8 karaktera.',
    });
  }
  if (novaLozinka !== potvrdaLozinke) {
    return res.status(400).render('auth/portal-promeni-lozinku', {
      greska: 'Lozinke se ne poklapaju.',
    });
  }

  Komitent.postaviLozinku(req.session.komitent.id, novaLozinka, false);
  res.redirect('/portal');
});

router.post('/portal/odjava', (req, res) => {
  req.session.destroy(() => res.redirect('/portal/prijava'));
});

module.exports = router;

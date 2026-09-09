const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../db/db');
const Komitent = require('../models/komitent');

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

router.post('/odjava', (req, res) => {
  req.session.destroy(() => res.redirect('/prijava'));
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

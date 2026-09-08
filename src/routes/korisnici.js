const express = require('express');
const router = express.Router();
const Korisnik = require('../models/korisnik');
const { SAMO_ADMIN } = require('../middleware/auth');

router.use(SAMO_ADMIN);

router.get('/', (req, res) => {
  res.render('korisnici/lista', { korisnici: Korisnik.svi() });
});

router.get('/novi', (req, res) => {
  res.render('korisnici/forma', { greska: null });
});

router.post('/novi', (req, res) => {
  const { ime, email, uloga } = req.body;
  if (!ime || !email || !uloga) {
    return res.status(400).render('korisnici/forma', { greska: 'Sva polja su obavezna.' });
  }

  try {
    const { korisnik, inicijalnaLozinka } = Korisnik.kreiraj({ ime, email, uloga });
    res.render('korisnici/kreiran', { korisnik, inicijalnaLozinka });
  } catch (e) {
    res.status(400).render('korisnici/forma', { greska: e.message });
  }
});

router.get('/:id', (req, res) => {
  const korisnik = Korisnik.poId(req.params.id);
  if (!korisnik) return res.status(404).render('greska', { poruka: 'Korisnik nije pronađen.' });
  res.render('korisnici/detalji', { korisnik, jaSam: req.session.korisnik.id === korisnik.id });
});

router.post('/:id/uloga', (req, res) => {
  const korisnik = Korisnik.poId(req.params.id);
  if (!korisnik) return res.status(404).render('greska', { poruka: 'Korisnik nije pronađen.' });

  // Zaštita: ne dozvoli da poslednji aktivni administrator izgubi tu ulogu
  if (korisnik.uloga === 'administrator' && req.body.uloga !== 'administrator' && Korisnik.brojAdmina() <= 1) {
    return res.status(400).render('greska', {
      poruka: 'Ne možeš oduzeti administratorsku ulogu poslednjem aktivnom administratoru.',
    });
  }

  Korisnik.azurirajUlogu(req.params.id, req.body.uloga);
  res.redirect(`/korisnici/${req.params.id}`);
});

router.post('/:id/aktivnost', (req, res) => {
  const korisnik = Korisnik.poId(req.params.id);
  if (!korisnik) return res.status(404).render('greska', { poruka: 'Korisnik nije pronađen.' });

  const nadolazecaAktivnost = req.body.aktivan === '1';

  if (korisnik.uloga === 'administrator' && !nadolazecaAktivnost && Korisnik.brojAdmina() <= 1) {
    return res.status(400).render('greska', {
      poruka: 'Ne možeš deaktivirati poslednjeg aktivnog administratora.',
    });
  }
  if (req.session.korisnik.id === korisnik.id && !nadolazecaAktivnost) {
    return res.status(400).render('greska', { poruka: 'Ne možeš deaktivirati sopstveni nalog.' });
  }

  Korisnik.postaviAktivnost(req.params.id, nadolazecaAktivnost);
  res.redirect(`/korisnici/${req.params.id}`);
});

router.post('/:id/reset-lozinka', (req, res) => {
  const korisnik = Korisnik.poId(req.params.id);
  if (!korisnik) return res.status(404).render('greska', { poruka: 'Korisnik nije pronađen.' });

  const novaLozinka = Korisnik.resetujLozinku(req.params.id);
  res.render('korisnici/kreiran', { korisnik, inicijalnaLozinka: novaLozinka, jeReset: true });
});

module.exports = router;

const express = require('express');
const router = express.Router();
const Komitent = require('../models/komitent');
const { zahtevajLogin, MOZE_MENJATI } = require('../middleware/auth');

router.use(zahtevajLogin);

// Lista + pretraga
router.get('/', (req, res) => {
  const { q } = req.query;
  const komitenti = q ? Komitent.pretraga(q) : Komitent.svi();
  res.render('komitenti/lista', { komitenti, q: q || '' });
});

// Forma za novi komitent
router.get('/novi', MOZE_MENJATI, (req, res) => {
  res.render('komitenti/forma', { komitent: null });
});

router.post('/novi', MOZE_MENJATI, (req, res) => {
  const { naziv, tip, adresa, mesto, kontaktOsoba, kontaktTelefon, pib, email, inicijalnaLozinka } = req.body;

  if (!naziv || !naziv.trim()) {
    return res.status(400).render('komitenti/forma', {
      komitent: req.body,
      greska: 'Naziv firme ili fizičkog lica je obavezno polje.',
    });
  }

  const komitent = Komitent.kreiraj({
    naziv: naziv.trim(),
    tip,
    adresa,
    mesto,
    kontaktOsoba: tip === 'firma' ? kontaktOsoba : null,
    kontaktTelefon,
    pib: tip === 'firma' ? pib : null,
    email,
    inicijalnaLozinka,
  });

  res.redirect(`/komitenti/${komitent.id}`);
});

// Detalji komitenta — pregled poslova, ponuda, naloga (spaja se sa modulom "posao" kad se doda)
router.get('/:id', (req, res) => {
  const komitent = Komitent.poId(req.params.id);
  if (!komitent) return res.status(404).render('greska', { poruka: 'Komitent nije pronađen.' });
  res.render('komitenti/detalji', { komitent });
});

router.get('/:id/izmeni', MOZE_MENJATI, (req, res) => {
  const komitent = Komitent.poId(req.params.id);
  if (!komitent) return res.status(404).render('greska', { poruka: 'Komitent nije pronađen.' });
  res.render('komitenti/forma', { komitent });
});

router.post('/:id/izmeni', MOZE_MENJATI, (req, res) => {
  Komitent.azuriraj(req.params.id, req.body);
  res.redirect(`/komitenti/${req.params.id}`);
});

router.post('/:id/reset-lozinka', MOZE_MENJATI, (req, res) => {
  const komitent = Komitent.poId(req.params.id);
  if (!komitent) return res.status(404).render('greska', { poruka: 'Komitent nije pronađen.' });
  if (!komitent.email) {
    return res.status(400).render('greska', {
      poruka: 'Komitent nema unet email — prvo dodaj email da bi mogao da pristupa portalu.',
    });
  }

  const rucnaLozinka = (req.body.novaLozinka || '').trim();

  if (rucnaLozinka) {
    if (rucnaLozinka.length < 4) {
      return res.status(400).render('greska', { poruka: 'Lozinka mora imati najmanje 4 karaktera.' });
    }
    Komitent.postaviLozinku(req.params.id, rucnaLozinka, true);
    return res.render('komitenti/lozinka-rezultat', { komitent, novaLozinka: rucnaLozinka });
  }

  const novaLozinka = Komitent.resetujLozinku(req.params.id);
  res.render('komitenti/lozinka-rezultat', { komitent, novaLozinka });
});

module.exports = router;

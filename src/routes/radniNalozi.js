const express = require('express');
const router = express.Router();

const RadniNalog = require('../models/radniNalog');
const Ponuda = require('../models/ponuda');
const Posao = require('../models/posao');
const db = require('../db/db');
const { generisiRadniNalogPdf } = require('../services/pdfGenerator');
const path = require('path');
const { zahtevajLogin, MOZE_NALOGE } = require('../middleware/auth');

router.use(zahtevajLogin);

// Forma za novi radni nalog — prikazuje delove iz prihvaćenih ponuda tog posla
// sa preostalom (nedodeljenom) količinom po delu
router.get('/poslovi/:posaoId/radni-nalozi/novi', MOZE_NALOGE, (req, res) => {
  const posao = Posao.poId(req.params.posaoId);
  if (!posao) return res.status(404).render('greska', { poruka: 'Posao nije pronađen.' });

  const delovi = RadniNalog.deloviDostupniZaPosao(posao.id).map((d) => ({
    ...d,
    vecDodeljeno: RadniNalog.vecDodeljenoZaDeo(d.id),
    preostalo: d.kolicina_plan - RadniNalog.vecDodeljenoZaDeo(d.id),
  }));

  if (!delovi.length) {
    return res.status(400).render('greska', {
      poruka: 'Ovaj posao nema nijednu prihvaćenu ponudu sa planom sečenja — nema delova za raspoređivanje.',
    });
  }

  res.render('radni-nalozi/forma', { posao, delovi });
});

router.post('/poslovi/:posaoId/radni-nalozi', MOZE_NALOGE, (req, res) => {
  const posao = Posao.poId(req.params.posaoId);
  const deoIzPlanaIds = [].concat(req.body.deoIzPlanaId || []);
  const kolicine = [].concat(req.body.kolicina || []);

  const stavkeZaNalog = [];
  const upozorenja = [];

  deoIzPlanaIds.forEach((deoId, i) => {
    const kolicina = parseInt(kolicine[i], 10);
    if (!kolicina || kolicina <= 0) return; // preskoči prazna polja

    const deo = db.prepare('SELECT * FROM deo_iz_plana WHERE id = ?').get(deoId);
    const provera = RadniNalog.proveriKolicinu(deoId, kolicina);

    stavkeZaNalog.push({ deoIzPlanaId: deoId, partName: deo.part_name, kolicina });

    if (provera.prekoracenje) {
      upozorenja.push({ partName: deo.part_name, visak: provera.visak });
    }
  });

  if (!stavkeZaNalog.length) {
    return res.status(400).render('greska', { poruka: 'Nije uneta nijedna količina.' });
  }

  // Nalazimo prihvaćenu ponudu tog posla (radni nalog se vezuje za nju)
  const prihvacenaPonuda = db
    .prepare("SELECT * FROM ponuda WHERE posao_id = ? AND status = 'prihvacena' ORDER BY kreiran_at DESC LIMIT 1")
    .get(posao.id);

  const nalog = RadniNalog.kreiraj({
    posaoId: posao.id,
    ponudaId: prihvacenaPonuda.id,
    kreiraoKorisnikId: req.session.korisnik.id,
    stavkeInput: stavkeZaNalog,
  });

  // Za svaki deo koji je prekoračio plan — generiši automatsku dodatnu ponudu (samo metod 1).
  // NAPOMENA: plan sečenja čuva samo UKUPNU težinu za sve komade te vrste dela, ne težinu
  // po jednom komadu, pa sistem ne može sam da izračuna tačan iznos za višak — referent ga
  // dopunjava ručno na osnovu poznate jedinične težine dela.
  if (upozorenja.length) {
    const opisStavki = upozorenja.map((u) => `${u.partName} (višak ${u.visak} kom.)`).join(', ');
    const dodatnaPonuda = Ponuda.kreiraj(
      {
        posaoId: posao.id,
        sastavioKorisnikId: req.session.korisnik.id,
        naslovPosla: `Dodatna ponuda za višak količine — ${opisStavki}`,
      },
      true // je_automatska_za_visak
    );

    Ponuda.dodajStavku(dodatnaPonuda.id, {
      opis: `Materijal za višak: ${opisStavki} — uneti ručno iznos po metodu 1 (težina × cena/kg + rad)`,
      iznos: 0,
      jeIzPlanaSecenja: true,
    });

    return res.render('radni-nalozi/upozorenje', { nalog, posao, upozorenja, dodatnaPonuda });
  }

  res.redirect(`/poslovi/${posao.id}`);
});

router.get('/radni-nalozi/:id', (req, res) => {
  const nalog = RadniNalog.poId(req.params.id);
  if (!nalog) return res.status(404).render('greska', { poruka: 'Radni nalog nije pronađen.' });

  const posao = Posao.poId(nalog.posao_id);
  const stavke = RadniNalog.stavke(nalog.id);

  res.render('radni-nalozi/detalji', { nalog, posao, stavke });
});

router.post('/radni-nalozi/:id/status', MOZE_NALOGE, (req, res) => {
  RadniNalog.azurirajStatus(req.params.id, req.body.status);
  res.redirect(`/radni-nalozi/${req.params.id}`);
});

router.post('/radni-nalozi/:id/stavke/:stavkaId/realizacija', MOZE_NALOGE, (req, res) => {
  RadniNalog.azurirajRealizovanuKolicinu(req.params.stavkaId, parseInt(req.body.kolicinaZavrsena, 10));
  res.redirect(`/radni-nalozi/${req.params.id}`);
});

router.get('/radni-nalozi/:id/pdf', async (req, res) => {
  try {
    const putanja = await generisiRadniNalogPdf(req.params.id);
    res.download(putanja, path.basename(putanja));
  } catch (greska) {
    res.status(500).render('greska', { poruka: `Greška pri generisanju PDF-a: ${greska.message}` });
  }
});

module.exports = router;

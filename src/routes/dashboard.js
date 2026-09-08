const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { zahtevajLogin } = require('../middleware/auth');

router.use(zahtevajLogin);

router.get('/', (req, res) => {
  const ponude = db.prepare(`
    SELECT ponuda.id, ponuda.broj, ponuda.ukupno, ponuda.naslov_posla,
           komitent.id as komitent_id, komitent.naziv as komitent_naziv,
           posao.id as posao_id, posao.naziv as posao_naziv
    FROM ponuda
    JOIN posao ON posao.id = ponuda.posao_id
    JOIN komitent ON komitent.id = posao.komitent_id
    WHERE ponuda.status = 'prihvacena'
  `).all();

  const uplateSume = db.prepare(`
    SELECT ponuda_id, COALESCE(SUM(iznos), 0) as suma FROM uplata GROUP BY ponuda_id
  `).all();
  const placenoMap = {};
  uplateSume.forEach((u) => { placenoMap[u.ponuda_id] = u.suma; });

  let ukupnoNaplativo = 0;
  let ukupnoPlaceno = 0;
  const poKomitentu = {};
  const ponudeSaDugom = [];

  ponude.forEach((p) => {
    const placeno = placenoMap[p.id] || 0;
    const ukupno = p.ukupno || 0;
    const preostalo = ukupno - placeno;

    ukupnoNaplativo += ukupno;
    ukupnoPlaceno += placeno;

    if (!poKomitentu[p.komitent_id]) {
      poKomitentu[p.komitent_id] = { id: p.komitent_id, naziv: p.komitent_naziv, ukupno: 0, placeno: 0 };
    }
    poKomitentu[p.komitent_id].ukupno += ukupno;
    poKomitentu[p.komitent_id].placeno += placeno;

    if (preostalo > 0.01) {
      ponudeSaDugom.push({ ...p, placeno, preostalo });
    }
  });

  const komitentiLista = Object.values(poKomitentu)
    .map((k) => ({ ...k, preostalo: k.ukupno - k.placeno }))
    .sort((a, b) => b.preostalo - a.preostalo);

  ponudeSaDugom.sort((a, b) => b.preostalo - a.preostalo);

  res.render('dashboard/index', {
    ukupnoNaplativo,
    ukupnoPlaceno,
    ukupnoDug: ukupnoNaplativo - ukupnoPlaceno,
    komitentiLista,
    ponudeSaDugom,
  });
});

module.exports = router;

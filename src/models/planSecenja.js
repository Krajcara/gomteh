const db = require('../db/db');

function poId(id) {
  return db.prepare('SELECT * FROM plan_secenja WHERE id = ?').get(id);
}

function poPosaoId(posaoId) {
  return db.prepare('SELECT * FROM plan_secenja WHERE posao_id = ? ORDER BY kreiran_at DESC').all(posaoId);
}

// Planovi ovog posla koji još nisu povezani ni sa jednom ponudom — dostupni za izbor
function dostupniZaPosao(posaoId) {
  return db
    .prepare('SELECT * FROM plan_secenja WHERE posao_id = ? AND ponuda_id IS NULL ORDER BY kreiran_at DESC')
    .all(posaoId);
}

function poPonudi(ponudaId) {
  return db.prepare('SELECT * FROM plan_secenja WHERE ponuda_id = ? ORDER BY kreiran_at DESC').all(ponudaId);
}

function delovi(planSecenjaId) {
  return db.prepare('SELECT * FROM deo_iz_plana WHERE plan_secenja_id = ?').all(planSecenjaId);
}

function sacuvaj(posaoId, podaci) {
  const rezultat = db
    .prepare(
      `INSERT INTO plan_secenja
        (posao_id, originalni_fajl_putanja, preveden_fajl_putanja, naziv_fajla, materijal,
         debljina_mm, tezina_delova_kg, duzina_reza_mm, metod_1_iznos, metod_2_iznos)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      posaoId, podaci.originalnaPutanja, podaci.prevedenaPutanja, podaci.nazivFajla,
      podaci.materijal, podaci.debljinaMm, podaci.tezinaDelovaKg, podaci.duzinaRezaMm,
      podaci.metod1Iznos, podaci.metod2Iznos
    );

  const planId = rezultat.lastInsertRowid;

  const insertDeo = db.prepare(
    'INSERT INTO deo_iz_plana (plan_secenja_id, part_name, part_size, kolicina_plan) VALUES (?, ?, ?, ?)'
  );
  for (const deo of podaci.delovi || []) {
    insertDeo.run(planId, deo.partName, deo.partSize || null, deo.kolicina);
  }

  return poId(planId);
}

// Povezuje jedan ili više već uploadovanih (nepovezanih) planova sa ponudom
function povezisaPonudom(planIds, ponudaId) {
  const stmt = db.prepare('UPDATE plan_secenja SET ponuda_id = ? WHERE id = ? AND ponuda_id IS NULL');
  const transakcija = db.transaction((ids) => {
    for (const id of ids) stmt.run(ponudaId, id);
  });
  transakcija(planIds);
}

function otkaciOdPonude(planId) {
  db.prepare('UPDATE plan_secenja SET ponuda_id = NULL WHERE id = ?').run(planId);
}

function ponovoIzracunajMetode(planSecenjaId) {
  const plan = poId(planSecenjaId);
  if (!plan) throw new Error('Plan sečenja nije pronađen.');

  const { izracunajMetode } = require('../services/obracun');
  const { metod1, metod2 } = izracunajMetode({
    tezinaDelovaKg: plan.tezina_delova_kg,
    duzinaRezaMm: plan.duzina_reza_mm,
    debljinaMm: plan.debljina_mm,
  });

  db.prepare('UPDATE plan_secenja SET metod_1_iznos = ?, metod_2_iznos = ? WHERE id = ?').run(
    metod1, metod2, planSecenjaId
  );

  return poId(planSecenjaId);
}

module.exports = {
  poId, poPosaoId, dostupniZaPosao, poPonudi, delovi,
  sacuvaj, povezisaPonudom, otkaciOdPonude, ponovoIzracunajMetode,
};

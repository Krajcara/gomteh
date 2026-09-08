// Generisanje jedinstvenih brojeva u formatu "broj/godina", npr. "09/2026".
// Odvojeni brojači za ponude i radne naloge, resetuju se svake nove godine.

const db = require('../db/db');

function sledeciBroj(tip) {
  const godina = new Date().getFullYear();

  const transakcija = db.transaction(() => {
    const postojeci = db
      .prepare('SELECT poslednji_broj FROM brojac WHERE tip = ? AND godina = ?')
      .get(tip, godina);

    let noviBroj;
    if (postojeci) {
      noviBroj = postojeci.poslednji_broj + 1;
      db.prepare('UPDATE brojac SET poslednji_broj = ? WHERE tip = ? AND godina = ?').run(
        noviBroj,
        tip,
        godina
      );
    } else {
      noviBroj = 1;
      db.prepare('INSERT INTO brojac (tip, godina, poslednji_broj) VALUES (?, ?, ?)').run(
        tip,
        godina,
        noviBroj
      );
    }
    return noviBroj;
  });

  const broj = transakcija();
  return `${String(broj).padStart(2, '0')}/${godina}`;
}

module.exports = {
  sledeciBrojPonude: () => sledeciBroj('ponuda'),
  sledeciBrojNaloga: () => sledeciBroj('radni_nalog'),
};

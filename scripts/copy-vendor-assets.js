// Pokreće se automatski posle svakog "npm install" (vidi "postinstall" u package.json).
// Kopira statičke fajlove biblioteka koje se serviraju direktno korisniku (bez CDN-a,
// da aplikacija ne zavisi od spoljnog interneta za osnovne funkcije).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VENDOR_DIR = path.join(ROOT, 'public', 'vendor');

function kopiraj(izvor, odrediste) {
  fs.mkdirSync(path.dirname(odrediste), { recursive: true });
  fs.copyFileSync(izvor, odrediste);
}

const paketi = [
  {
    naziv: 'flatpickr',
    fajlovi: [
      ['node_modules/flatpickr/dist/flatpickr.min.css', 'vendor/flatpickr/flatpickr.min.css'],
      ['node_modules/flatpickr/dist/flatpickr.min.js', 'vendor/flatpickr/flatpickr.min.js'],
      ['node_modules/flatpickr/dist/l10n/sr.js', 'vendor/flatpickr/l10n-sr.js'],
    ],
  },
];

for (const paket of paketi) {
  for (const [izvorRel, odredisteRel] of paket.fajlovi) {
    const izvor = path.join(ROOT, izvorRel);
    const odrediste = path.join(ROOT, 'public', odredisteRel.replace(/^vendor\//, 'vendor/'));
    if (fs.existsSync(izvor)) {
      kopiraj(izvor, path.join(ROOT, 'public', odredisteRel));
    } else {
      console.warn(`Upozorenje: ${izvorRel} nije pronađen — da li je "${paket.naziv}" instaliran?`);
    }
  }
}

console.log('Vendor fajlovi (flatpickr) kopirani u public/vendor/.');

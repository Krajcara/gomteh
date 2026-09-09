// Korisnici često kucaju decimalni broj sa zarezom (srpski format, npr. "1228,68")
// umesto tačkom. HTML input polja se ponašaju nedosledno po pitanju ovoga (zavisi
// od brauzera/OS lokalizacije), pa ovde uvek prihvatamo oba zapisa na serverskoj strani.
function brojIzForme(vrednost) {
  if (vrednost === undefined || vrednost === null || vrednost === '') return NaN;
  return parseFloat(String(vrednost).trim().replace(',', '.'));
}

module.exports = { brojIzForme };

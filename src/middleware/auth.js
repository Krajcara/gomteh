// Middleware za autentifikaciju i proveru uloga.
// Dve odvojene sesije: interni korisnik (session.korisnik) i komitent-portal (session.komitent).

function zahtevajLogin(req, res, next) {
  if (!req.session.korisnik) {
    return res.redirect('/prijava');
  }
  next();
}

function zahtevajUlogu(...dozvoljeneUloge) {
  return (req, res, next) => {
    if (!req.session.korisnik) {
      return res.redirect('/prijava');
    }
    if (!dozvoljeneUloge.includes(req.session.korisnik.uloga)) {
      return res.status(403).render('greska', {
        poruka: 'Nemate ovlašćenje za ovu akciju.',
      });
    }
    next();
  };
}

function zahtevajKomitentLogin(req, res, next) {
  if (!req.session.komitent) {
    return res.redirect('/portal/prijava');
  }
  next();
}

// Uloge sa pravom izmene (sve osim "pregled")
const MOZE_MENJATI = zahtevajUlogu('administrator', 'referent_ponude', 'referent_proizvodnja');
const SAMO_ADMIN = zahtevajUlogu('administrator');
const MOZE_PONUDE = zahtevajUlogu('administrator', 'referent_ponude');
const MOZE_NALOGE = zahtevajUlogu('administrator', 'referent_proizvodnja');

module.exports = {
  zahtevajLogin,
  zahtevajUlogu,
  zahtevajKomitentLogin,
  MOZE_MENJATI,
  SAMO_ADMIN,
  MOZE_PONUDE,
  MOZE_NALOGE,
};

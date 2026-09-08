require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, '../public')));

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 },
  })
);

// Rute (dodaju se postupno kako se moduli razvijaju)
app.use('/', require('./routes/auth'));
app.use('/komitenti', require('./routes/komitenti'));
app.use('/podesavanja', require('./routes/podesavanja'));
// app.use('/poslovi', require('./routes/poslovi'));
// app.use('/ponude', require('./routes/ponude'));
// app.use('/radni-nalozi', require('./routes/radniNalozi'));
// app.use('/portal', require('./routes/portal'));

app.get('/', (req, res) => res.redirect('/komitenti'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`GOMTEH pokrenut na http://localhost:${PORT}`);
});

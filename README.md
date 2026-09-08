# GOMTEH — uputstvo za instalaciju na novom serveru

Aplikacija za ponude i radne naloge. Ovo uputstvo pokriva instalaciju od nule na praznom Linux (Ubuntu/Debian) serveru, uključujući automatsko pokretanje pri restartu servera.

---

## 1. Preduslovi

- Ubuntu ili Debian server (ostale distribucije nisu automatski podržane)
- Korisnik sa `sudo` pravima (ne radi se ništa kao `root` direktno)
- Instaliran `git`

Proveri da li `git` postoji:
```bash
git --version
```
Ako ne postoji: `sudo apt-get update && sudo apt-get install -y git`

---

## 2. Preuzimanje koda

```bash
cd ~
git clone https://github.com/Krajcara/gomteh.git
cd gomteh
```

---

## 3. Instalacija

```bash
bash install.sh
```

**Ne pokrećaj sa `sudo`.** Skripta sama, interno, poziva `sudo` samo za instalaciju Node.js-a na sistem — ako pokreneš celu skriptu kao root, baza i `.env` fajl će pripadati root korisniku i praviće probleme kasnije.

Šta skripta radi:
1. Proverava da li postoji Node.js — ako ne, instalira Node.js 20 (LTS) preko NodeSource-a, plus `build-essential`/`python3` (potrebni ako neki paket mora da se kompajlira lokalno)
2. `npm install` — instalira sve zavisnosti aplikacije
3. Generiše `.env` fajl sa nasumičnim ključem za enkripciju baze i tajnim ključem za sesije
4. Kreira bazu i **admin nalog** sa nasumičnom lozinkom

**Na kraju ćeš videti nešto ovako — zapiši lozinku odmah, prikazuje se samo jednom:**
```
Admin korisničko ime: admin@gomteh.local
Admin lozinka: xxxxxxxxxxxx
```

---

## 4. Ručno pokretanje (test)

```bash
npm start
```

Otvori `http://IP-ADRESA-SERVERA:3000` u browseru, uloguj se, i po prijavi ćeš morati da postaviš novu lozinku umesto generisane.

Prekini sa `Ctrl+C` kad završiš test — sledeći korak je pravo, trajno pokretanje.

---

## 5. Automatsko pokretanje (systemd)

Ovo je **obavezan korak** da bi aplikacija:
- radila u pozadini (ne u terminalu koji možeš zatvoriti)
- sama se pokrenula posle restarta servera
- sama se ponovo pokrenula ako se sruši
- mogla da se ažurira jednim klikom iz same aplikacije (vidi tačku 7)

```bash
sudo cp ~/gomteh/deploy/gomteh.service /etc/systemd/system/gomteh.service
```

Otvori kopirani fajl i proveri da `User=` i `WorkingDirectory=` odgovaraju tvom korisniku:
```bash
sudo nano /etc/systemd/system/gomteh.service
```
Treba da piše (zameni `TVOJ_USER` stvarnim korisničkim imenom, npr. `krajcara`):
```
User=TVOJ_USER
WorkingDirectory=/home/TVOJ_USER/gomteh
```

Zatim:
```bash
sudo systemctl daemon-reload
sudo systemctl enable gomteh
sudo systemctl start gomteh
```

Proveri da radi:
```bash
sudo systemctl status gomteh
```
Treba da piše `active (running)`.

**Test da auto-pokretanje stvarno radi:**
```bash
sudo reboot
```
Sačekaj da se server podigne, pa:
```bash
curl http://localhost:3000/prijava
```
Ako dobiješ odgovor (HTML stranicu), sve radi.

---

## 6. Praćenje logova

```bash
sudo journalctl -u gomteh -f
```
Korisno za dijagnostiku ako nešto ne radi kako treba.

---

## 7. Kako radi ažuriranje

Kad izađe nova verzija na GitHub-u, aplikacija sama proverava (na svakih 6h) i prikazuje obaveštenje u meniju ("● Update dostupan") i na stranici **Podešavanja → Proveri ažuriranja**.

Klikom na **"Ažuriraj sada"**, aplikacija sama:
1. Povuče najnoviji kod (`git pull`)
2. Instalira eventualne nove zavisnosti (`npm install`)
3. Ugasi se — **systemd je odmah podiže nazad** sa novim kodom (zato je bitan korak 5 iznad)

U toku restarta (par sekundi) aplikacija neće biti dostupna. Ako nešto pođe po zlu (npr. konflikt u kodu), aplikacija ostaje na staroj verziji i prikazuje grešku umesto da se ugasi.

Ako iz nekog razloga želiš ručno da ažuriraš:
```bash
cd ~/gomteh
sudo systemctl stop gomteh
git pull
npm install
sudo systemctl start gomteh
```

---

## 8. Gde se čuvaju podaci

- `~/gomteh/data/gomteh.db` — baza podataka (enkriptovana)
- `~/gomteh/.env` — ključevi (enkripcija baze, sesije)
- `~/gomteh/data/uploads/` — uploadovani planovi sečenja, logo, dokumenti uz odbijene ponude
- `~/gomteh/data/generated/` — generisani PDF-ovi (ponude, prevedeni planovi, radni nalozi)

**Ovi fajlovi/folderi NIKAD ne idu na GitHub** (u `.gitignore` su) — `git pull` ih ne dodiruje. Ažuriranje menja samo kod aplikacije, ne i tvoje podatke.

**Preporuka za bekap:** povremeno kopiraj ceo `data/` folder i `.env` fajl na bezbedno mesto (spoljni disk, drugi server). Bez `.env` fajla (ključa za enkripciju), baza se ne može pročitati čak ni sa tim istim fajlom baze.

---

## 9. Uobičajeni problemi

| Problem | Rešenje |
|---|---|
| `npm: command not found` | Node.js nije instaliran — `install.sh` bi trebalo sam da ga instalira; ako ne uspe, instaliraj ručno preko NodeSource-a |
| `Failed to start gomteh.service: Unit gomteh.service not found` | Preskočen je korak kopiranja fajla u `/etc/systemd/system/` — vidi tačku 5 |
| Greška o kompajliranju (`node-gyp`, `bcrypt`) | `sudo apt-get install -y build-essential python3`, pa `npm install` ponovo |
| Update dugme ne radi (aplikacija ostane ugašena) | Servis nema `Restart=always` — proveri `sudo systemctl cat gomteh \| grep Restart` |
| Zaboravljena admin lozinka | Iz baze se ne može pročitati (heširana je) — javi se za uputstvo kako da se ručno resetuje preko konzole na serveru |

---

## 10. Prvi koraci u aplikaciji

1. Uloguj se, promeni početnu lozinku
2. **Podešavanja** → unesi podatke firme, uploaduj logo, podesi cenu materijala/kg, % rada, cene po debljini
3. **Korisnici** → dodaj referente sa odgovarajućim ulogama
4. **Komitenti** → dodaj prvog klijenta
5. **Poslovi** → otvori prvi posao i kreni sa ponudom

# Poslovi od kuće — scraper remote / part-time oglasa

Lokalna aplikacija koja svakih 15 minuta pročita sajtove za posao, oceni oglase po pravilima iz `rules.json`
(korisnička podrška, administracija, nekretnine, booking, e-commerce, unos podataka… — remote, part-time, srpski jezik, bez naprednog engleskog)
i prikaže ih kao kartice na **http://localhost:3003** sa dugmadima ★ Favorit · ✔ Aplicirano · ✕ Odbaci.

Isti model kao scraperi za stanove i QA poslove: TypeScript, Node ≥ 22.6 (type-stripping), **0 npm zavisnosti**, `data/db.json` kao baza,
dva Windows Scheduled Task-a bez prozora. Zahtev i pravila: [docs/brief.md](docs/brief.md). Provera sajtova: [docs/sources.md](docs/sources.md).

## Instalacija na drugom računaru (npr. mamin laptop)

Potrebno: **Windows 10/11**, internet, **Node.js ≥ 22.6** (preporučeno LTS sa https://nodejs.org). Git nije obavezan.

1. Prebaci folder na računar — ili `git clone https://github.com/AleksaSRB/job-scrapper.git`, ili skini ZIP sa GitHub-a (Code → Download ZIP) i raspakuj.
2. Dupli klik na **`setup.cmd`**. Skripta:
   - proveri Node.js (ako ga nema, a postoji `winget`, sama instalira Node.js LTS),
   - registruje zadatke `MamaPosloviScraper` (svakih 15 min) i `MamaPosloviServer` (pri logovanju + odmah),
   - odradi **prvi prolaz odmah** — uzima oglase iz **poslednjih 10 dana** (`lookbackDays` u `config.json`) — i otvori http://localhost:3003.
3. Posle toga sve ide samo: server se diže pri logovanju, scraper radi svakih 15 min. Ako je laptop bio ugašen, zadatak se pokrene čim se upali.

Ostalo:
- **`start.cmd`** — ako se stranica ne otvara: upali server i otvori http://localhost:3003. Na Desktop-u postoji i prečica „Poslovi od kuće“.
- **`update.cmd`** — povuče novu verziju sa GitHub-a (`git pull`) i restartuje server; podaci ostaju. Bez git-a: skini ZIP i prekopiraj fajlove preko postojećih (folder `data\` ne dirati), pa opet `setup.cmd`.
- **`uninstall.cmd`** — ukloni zadatke i ugasi server; `data/` (favoriti, statusi) ostaje.

Šta `setup.cmd` obezbeđuje (provereno na Windows 11, 23.09.2026):
- **Restart / gašenje laptopa**: server se diže sam pri logovanju (task `MamaPosloviServer`, uz automatski restart ako padne), scraper nastavlja svakih 15 min čim se računar probudi (`StartWhenAvailable`). Radi i na bateriji.
- **Uvek isti port**: `config.json → port` (3003). Ako ga drži drugi program, instalacija stane sa jasnom porukom umesto da tiho ne radi; server u tom slučaju upiše `STOP: port 3003 je zauzet` u `data/server.out`.
- **Baza ne može tiho da nestane**: `db.json`/`seen.json` se pišu sa fsync + `.bak` kopijom; oštećen fajl (npr. nestanak struje usred upisa) se čita iz `.bak`, a ako ni to ne valja scraper stane i ne piše preko njega (poruka `STOP:` u `data/scraper.log`).
- **Logovi se ne gomilaju**: `scraper.log` i `filtered.log` se rotiraju na 5 MB.
- **ZIP sa interneta**: skida se „Mark of the Web“ sa svih fajlova, pa Windows ne blokira skripte.
- **Nema Node-a**: winget → ako ne ide, zvanični MSI sa nodejs.org (UAC potvrda).

## Šta se prikazuje

Oglas dobija skor (vidi „Zašto ova ocena“ na kartici) i prikazuje se ako je skor ≥ `minScore` (50) i nije tvrdo odbijen:

| Nivo | Skor |
|------|-----:|
| Odličan match | ≥ 90 |
| Dobar match | ≥ 70 |
| Moguć match | ≥ 50 |
| (sakriven, u `data/filtered.log`) | < 50 |

**Tvrdo odbijanje** (nikad se ne prikazuje): napredni engleski (B2/C1/C2, fluent, advanced, professional, „aktivno znanje engleskog“…) osim kad je „plus/poželjno“;
strani jezik u naslovu ili obavezan u opisu (nemački, francuski, italijanski…) a srpski se ne traži; lokacija koja isključuje Srbiju (US only, EU citizenship…);
developer/inženjer/IT, lekar/advokat/računovođa sa licencom, fizički i proizvodni poslovi; oglas bez ijedne ciljane kategorije.

**Glavni bodovi** (sve u `rules.json`): +40 srpski/BHS se traži · +30 oglas na srpskom · +30 part-time / honorarno / fleksibilno · +30 remote · +25 kategorija u naslovu
(podrška, admin, nekretnine, booking, e-commerce; 20 za unos podataka, porudžbine; manje za telemarketing, AI rating, CAD) · +15 bez iskustva · +15 obuka · +10 osnovni engleski ·
**full-time = −100000 (sakriven; polje sajta ili „puno radno vreme“/„full-time“ u tekstu)** · **hibrid: prolazi (0) samo u Beogradu i samo ako je part-time, inače −100000** (`employment.hybridCities`) ·
−80 iz firme · −60 senior/manager/director (osim „asistent direktora“) ·
−40 nevezana oblast (klinički, logistika, finansije, marketing…) · −50 samo provizija · −40 noćna/US smena · −40 hladni pozivi.
Da se full-time oglasi opet vide kao „Moguć match“, vrati `rules.json → employment.fullTimeScore` na −40 i pokreni `npm run score -- --rescore`.

Čipovi na kartici: plata (zeleno), radno vreme (Part-time / Honorarno / Full-time), Remote / Hibrid / Iz firme, jezik (Srpski / BHS / Osnovni engleski / Oglas na srpskom — žuto),
kategorije (zeleno), Bez iskustva, Obuka. Traka „novo“ = pronađen posle tvoje poslednje posete stranici.

## Izvori

| Izvor | Kako | Ritam |
|-------|------|------:|
| Poslovi Infostud | `__NEXT_DATA__` JSON, upiti iz `config.json` + svi remote oglasi; detalj za neviđene | 15 min |
| Startuj Infostud | liste honorarnih poslova i poslova za mlade; isti id kao Infostud | 30 min |
| Poslovi.rs | AJAX lista cele ponude (~240), sticker RDK = rad od kuće; detalj samo za relevantne | 30 min |
| Halooglasi (Posao) | `posao-pretraga?u_poslednjih_h=…` cela lista za period (Cloudflare → curl); detalj daje datum, puno/nepuno, platu, grad | 30 min |
| JobRack | kategorije support / executive-assistant / sales-marketing + glavna lista | 30 min |
| LinkedIn | javni guest API, `location=Serbia`, remote, poslednjih N dana; pauze zbog rate limita | 60 min |
| We Work Remotely | RSS customer-support, sales, all-other, management | 30 min |
| Himalayas | JSON API, `country=RS` | 30 min |
| Jooble | ❌ sajt i API endpoint su iza Cloudflare challenge-a (24.09.2026) — adapter postoji, isključen | – |

Task se pali na 15 min, a svaki izvor se čita kad mu istekne `everyMin`. „Skeniraj sad“ u UI-ju i `npm run scrape:force` čitaju sve odmah.
HelloWorld (ista baza kao Infostud), Joberty (SPA, samo IT) i Upwork (Cloudflare) nisu podržani — detalji u [docs/sources.md](docs/sources.md).

## Duplikati, statusi, novi oglasi

- Isti oglas sa više sajtova (ista firma + isti naslov posle čišćenja, ili sličan naslov ≥ 60 %) je jedna kartica sa linkom „Isti oglas i na: …“. Duplikat odbačenog oglasa se ne prikazuje.
- Favorit / Aplicirano / Odbačeno se čuvaju u `data/db.json` i preživljavaju rescan, refresh i restart. Tab „Odbačeno“ ima ↩ Vrati.
- „Sakrij firmu“ odbacuje sve nove oglase te firme i buduće ne prikazuje (`db.json → blockedCompanies`; trajno i u `config.json → blockedCompanies`).
- Novi oglas = nije viđen ranije (`data/seen.json`) + objavljen posle baseline-a (prvi prolaz: sada − `lookbackDays`; pamti se u `db.json → baselineAt`). Oglasi bez datuma (Poslovi.rs) prolaze.
- ntfy notifikacije: upiši topic u `config.json → ntfyTopic` i pretplati se u ntfy aplikaciji; šalje se samo kad ima novih (ne na prvom prolazu).

## Tunovanje

- `data/filtered.log` — svaki odbijen oglas sa razlogom i celim obračunom skora. Prvo mesto za gledanje kad nešto fali ili ima šuma.
- `rules.json` — sve kategorije, jezička pravila, bodovi, pragovi. Posle izmene: `npm run score -- --rescore` ponovo oceni oglase u bazi:
  novi koji sad padnu idu u „Odbačeno“ sa čipom „Sakriveno pravilima“, a takvi se automatski vraćaju u nove kad pravila opet propuste oglas
  (ono što si sam odbacio/favorizovao se ne dira). Oglasi koje je filter odbio još pri skeniranju nisu u bazi — obriši `data/seen.json` da se sve proceni iznova.
- `npm run score -- <deo naslova>` ispisuje pun obračun za oglas iz baze; `npm run score -- --all` tabelu svih.
- `config.json` — port, `lookbackDays`, `minScore`, upiti po sajtu, `maxDetails` (koliko detalj-stranica po prolazu), `blockedCompanies`, kursevi `fx`.

## Komande

```
npm run scrape         # jedan prolaz, poštuje everyMin
npm run scrape:force   # svi izvori odmah
npm run scrape -- --only infostud,linkedin
npm run serve          # UI na :3003
npm run score -- --all | --rescore | <naslov>
```

Logovi: `data/scraper.log`, `data/new_jobs.log`, `data/filtered.log`, `data/server.out`. Privremena baza za probu: `MOM_JOBS_DATA_DIR=... npm run scrape`.

## Struktura

```
config.json          port, ritam, upiti po sajtu, limiti
rules.json           kategorije, jezik, bodovi, pragovi
src/scrape.ts        prolaz kroz izvore: seen → baseline → ocena → dedup → db.json (+ ntfy)
src/server.ts        UI + API (GET /api/jobs, POST /api/jobs/:id/status, /api/companies/block, /api/scrape)
src/score.ts         ocena oglasa po rules.json (skor, nivo, razlozi, čipovi, tvrdo odbijanje)
src/dedup.ts         ključ firma|naslov + fuzzy (Jaccard) + blokirane firme
src/salary.ts        parsiranje plate (RSD/EUR/USD, satnica/mesečno/godišnje) i preračun u €/mes
src/http.ts          fetch + curl fallback (Cloudflare), kolačići, HTML→tekst, RSS, datumi
src/sources/*.ts     jedan adapter po sajtu — kad sajt promeni HTML, menja se samo taj fajl
public/index.html    UI (bez build-a)
setup.cmd / install.ps1 / uninstall.cmd / update.cmd / run-*.vbs   Windows instalacija
```

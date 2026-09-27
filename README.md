# Poslovi od kuće — scraper remote / part-time oglasa

Lokalna aplikacija koja svakih 15 minuta pročita sajtove za posao, oceni oglase po pravilima iz `rules.json`
(korisnička podrška, administracija, nekretnine, booking, e-commerce, unos podataka… — remote, part-time, srpski jezik, bez naprednog engleskog)
i prikaže ih kao kartice na **http://localhost:3003** sa dugmadima ★ Favorit · ✔ Aplicirano · ✕ Odbaci.

Isti model kao scraperi za stanove i QA poslove: TypeScript, Node ≥ 22.6 (type-stripping), **0 npm zavisnosti**, `data/db.json` kao baza,
dva Windows Scheduled Task-a bez prozora. Zahtev i pravila: [docs/brief.md](docs/brief.md). **Spisak svega što se čita: [SOURCE.md](SOURCE.md)**;
provera sajtova i odbačeni sajtovi: [docs/sources.md](docs/sources.md).

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

**Tri tvrda uslova** (od 27.09.2026, `rules.json → hardGates` + `language.requireSerbianAd`) — oglas se prikazuje SAMO ako je:
1. **part-time / honorarno / fleksibilno** (polje sajta ili tekst: „nepuno radno vreme“, „4h ili 6h dnevno“, „20 sati nedeljno“, „honorarno“…; oglas bez ikakve oznake radnog vremena ne prolazi),
2. **rad od kuće** (polje sajta ili tekst; izuzetak `hybridBelgradePartTime`: hibrid u Beogradu + part-time — `false` = samo čist remote),
3. **napisan na srpskom/BHS** (ćirilica se latinizuje; engleski oglas ne prolazi ni kad traži „Serbian speaker“).

Posle toga oglas dobija skor (vidi „Zašto ova ocena“ na kartici) i prikazuje se ako je skor ≥ `minScore` (50) i nije tvrdo odbijen:

| Nivo | Skor |
|------|-----:|
| Odličan match | ≥ 90 |
| Dobar match | ≥ 70 |
| Moguć match | ≥ 50 |
| (sakriven, u `data/filtered.log`) | < 50 |

**Tvrdo odbijanje** (nikad se ne prikazuje): **oglas nije napisan na srpskom/BHS** (od 26.09.2026, `language.requireSerbianAd`: broj srpskih reči mora biti ≥ 3 i ≥ broja engleskih; za kratak tekst dovoljna 1 srpska reč; ćirilica se latinizuje); napredni engleski (B2/C1/C2, fluent, advanced, professional, „aktivno znanje engleskog“…) osim kad je „plus/poželjno“;
strani jezik u naslovu ili obavezan u opisu (nemački, francuski, italijanski…) a srpski se ne traži; lokacija koja isključuje Srbiju (US only, EU citizenship…);
developer/inženjer/IT, lekar/advokat/računovođa sa licencom, fizički i proizvodni poslovi; oglas osobe koja traži posao („Tražim posao od kuće“).
Oglas bez ijedne ciljane kategorije više nije tvrdo odbijen (27.09.2026, `categoryRequired: false`) nego dobija −20.

**Glavni bodovi** (sve u `rules.json`): +40 srpski/BHS se traži · +30 oglas na srpskom · +30 part-time / honorarno / fleksibilno · +30 remote · +25 kategorija u naslovu
(podrška, admin, nekretnine, booking, e-commerce; 20 za unos podataka, porudžbine; manje za telemarketing, AI rating, CAD) · +15 bez iskustva · +15 obuka · +10 osnovni engleski ·
**full-time = −100000 (sakriven; polje sajta ili „puno radno vreme“/„full-time“ u tekstu)** · **hibrid: prolazi (0) samo u Beogradu i samo ako je part-time, inače −100000** (`employment.hybridCities`) ·
−80 iz firme · −60 senior/manager/director (osim „asistent direktora“) ·
−40 nevezana oblast (klinički, logistika, finansije, marketing…) · −50 samo provizija · −40 noćna/US smena · −40 hladni pozivi ·
**−100 MLM / piramida / sumnjiv oglas** (Limes, Farmasi, Avon, forex, video chat 18+, „napiši DA u komentar“…) · −40 samo Telegram / dropshipping ·
**−80 starosna granica / omladinska zadruga** („Uzrast 18–29“, „do 30 godina“) · −30 „poslovi za mlade“ · −80 volontiranje.
Kategorija „Anketiranje / istraživanje“ (+25) pokriva telefonske anketare od kuće (Ipsos, Open Source).
Da se full-time oglasi opet vide kao „Moguć match“, vrati `rules.json → employment.fullTimeScore` na −40 i pokreni `npm run score -- --rescore`.

Čipovi na kartici: plata (zeleno), radno vreme (Part-time / Honorarno / Full-time), Remote / Hibrid / Iz firme, jezik (Srpski / BHS / Osnovni engleski / Oglas na srpskom — žuto),
kategorije (zeleno), Bez iskustva, Obuka. Traka „novo“ = pronađen posle tvoje poslednje posete stranici.

## Izvori

Ceo spisak sa načinom čitanja, filterima i brojem zahteva: **[SOURCE.md](SOURCE.md)**. Ukratko:

| Izvor | Kako | Ritam |
|-------|------|------:|
| Poslovi Infostud | `__NEXT_DATA__`, 5 „sweep“-ova po filterima sajta (remote × nepuno / honorarno, svi remote, hibrid × nepuno / honorarno) | 15 min |
| Poslovi.rs | AJAX lista cele ponude (~246), sticker RDK = rad od kuće | 30 min |
| Halooglasi (Posao) | cela lista za period (Cloudflare → curl); „Rad od kuće“ kao vrsta zaposlenja | 30 min |
| NSZ | lista od najnovijeg do već viđenih + red za detalje (radno vreme, mesto, jezik) | 30 min |
| KupujemProdajem (Poslovi) | lista od najnovijeg + detalj (≤ 25 po prolazu zbog anti-bota) | 60 min |
| Sajtovi firmi (pagewatch) | stalni pozivi za telefonske anketare od kuće: Ipsos, Open Source, Faktor Plus, MASMI | 12 h |
| KlikDoPosla | javni JSON feed `/ai/jobs.json` | 2 h |
| Lalafo, OLX.ba | JSON API kategorije poslova (OLX.ba = BiH, BHS) | 2 h / 3 h |
| Šljaka, OglasZaPosao (Jooble ogledalo) | WordPress RSS / REST pretraga | 6 h |
| LinkedIn | guest API, `location=Serbia`; remote samo kad tekst kaže | 60 min |
| Startuj | ❌ isključen 27.09.2026: ista baza kao Infostud | – |
| JobRack, WWR, Himalayas, Jooble | ❌ isključeni (samo engleski / Cloudflare) | – |

Task se pali na 15 min, a svaki izvor se čita kad mu istekne `everyMin`. „Skeniraj sad“ u UI-ju i `npm run scrape:force` čitaju sve odmah.
Adapter se učitava tek kad je na redu, pa pokvaren sajt obori samo svoj red u izveštaju. Podešavanja izvora su u `DEFAULTS` na vrhu
`src/sources/<izvor>.ts` i mogu se pregaziti u `config.json` pod istim imenom (npr. `"kp": { "maxDetails": 20 }`).

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
- `npm run try -- <izvor> [--days 30] [--show 20]` — proba jednog izvora bez diranja baze: koliko je palo na kom tvrdom uslovu i koji oglasi prolaze.
- `config.json` — port, `lookbackDays`, `minScore`, upiti po sajtu, `maxDetails` (koliko detalj-stranica po prolazu), `blockedCompanies`, kursevi `fx`.

## Komande

```
npm run scrape         # jedan prolaz, poštuje everyMin
npm run scrape:force   # svi izvori odmah
npm run scrape -- --only infostud,linkedin
npm run serve          # UI na :3003
npm run score -- --all | --rescore | <naslov>
npm run try -- kp --days 30   # proba izvora bez baze
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
src/try-source.ts    `npm run try -- <izvor>`: proba adaptera + brojanje po tvrdim uslovima, bez baze
SOURCE.md            spisak svih izvora koji se čitaju i onih koji su provereni i odbačeni
public/index.html    UI (bez build-a)
setup.cmd / install.ps1 / uninstall.cmd / update.cmd / run-*.vbs   Windows instalacija
```

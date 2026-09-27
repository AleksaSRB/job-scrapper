# Izvori — šta se čita i kako (stanje 27.09.2026)

Scraper traži oglase koji prolaze **tri tvrda uslova** (`rules.json → hardGates` + `language.requireSerbianAd`):

1. **part-time / honorarno / fleksibilno** — polje sajta ili tekst („nepuno radno vreme“, „4h ili 6h dnevno“, „20 sati nedeljno“, „honorarno“…);
2. **rad od kuće** — polje sajta ili tekst (izuzetak `hybridBelgradePartTime`: hibrid u Beogradu + part-time);
3. **oglas napisan na srpskom / BHS** — ćirilica se latinizuje; engleski oglas ne prolazi ni kad traži „Serbian speaker“.

Sve ostalo (kategorija posla, engleski, MLM, starosne granice…) je skor u `rules.json`. Svaki izvor je jedan fajl `src/sources/<id>.ts`;
podešavanja su u `DEFAULTS` na vrhu fajla i mogu se pregaziti u `config.json` pod istim imenom. Proba bez baze: `npm run try -- <id> --days 30`.

## Aktivni izvori

| # | Izvor (`id`) | Šta se čita | Filteri / logika | Zahteva po prolazu | Ritam |
|---|---|---|---|---|---:|
| 1 | **Poslovi Infostud** (`infostud`) | `poslovi.infostud.com/oglasi-za-posao?<filteri>&onlineAfterDate=…` → `__NEXT_DATA__`; detalj `/posao/x/y/<id>` | 5 „sweep“-ova po filterima sajta: `workPlaceTypes=remote` × `workingHours=5` (nepuno), × `employmentTypes=9` (honorarno), svi remote, `hybrid` × nepuno / honorarno. Radno vreme iz filtera se upisuje u oglas. | ~7 + detalj za neviđene (≤ 60) | 15 min |
| 2 | **Poslovi.rs** (`poslovirs`) | `GET /jobs` (kolačić) → `/jobs/jobs_ajax/<offset>` — cela ponuda (~246) | sticker **RDK** = rad od kuće; detalj za remote i ciljane naslove | ~9 + ≤ 30 detalja | 30 min |
| 3 | **Halooglasi — Posao** (`halooglasi`) | `posao-pretraga?u_poslednjih_h=<h>&page=N` → `serverListData` (Cloudflare → curl.exe); detalj `CurrentClassified` | cela lista za period; **„Rad od kuće“ kao vrsta zaposlenja** (`vrsta_zaposlenja_s`) = remote, `radno_vreme_s` = puno/nepuno | ~11 + ≤ 40 detalja | 30 min |
| 4 | **NSZ** (`nsz`) | `nsz.gov.rs/employee/jobs/search?page=N` (najnoviji prvi); detalj `/employee/jobs/preview/<id>` | nema filtera za remote/radno vreme (`search_term` sajt ignoriše) → čita se od najnovijeg dok ne naiđe strana bez neviđenih; naslovi koje ocena ionako obara (IT, medicina, fizički) bez detalja; ostali u red za detalje (≤ 40 po prolazu, ostatak sledeći put) | 1–35 + ≤ 40 | 30 min |
| 5 | **KupujemProdajem — Poslovi** (`kp`) | `pretraga?categoryId=2546&order=posted desc&page=N` → `initialReduxState.search`; detalj `adUrl` → `ad.byId[id].description` | lista od najnovijeg; pri zaostatku i pretraga opisa po rečima (od kuće, online, honorarno, fleksibilno, pola radnog…) za prioritet; grupe fizičkih poslova bez detalja; **≤ 25 detalja** jer sajt posle ~33 uključi „areYouHuman“ (tada izvor staje za taj prolaz) | 1–2 (+ ≤ 25) | 60 min |
| 6 | **Sajtovi firmi** (`pagewatch`) | stalne stranice bez datuma: **Ipsos** CATI anketar rad od kuće + spisak `/sr-rs/radna-mesta`, **Open Source** `ponuda-poslova-sr.php`, **Faktor Plus** `zaposlenje-2`, **MASMI** `/karijera/` | jedna stranica = jedan oglas (`pagewatch:<key>`); novi linkovi sa spiskova postaju oglasi; remote/honorarno u konfiguraciji samo kad to piše na stranici (`mustMatch`) | ≤ 10 | 12 h |
| 7 | **KlikDoPosla** (`klikdoposla`) | javni feed `klikdoposla.com/ai/jobs.json?page=N` (75/strani, ~230 oglasa) | `employment_type` (Honorarni/Dopunski/…) i `working_model` iz feeda; pun tekst sa stranice oglasa samo za kandidate | 1–4 + ≤ 25 | 2 h |
| 8 | **Lalafo** (`lalafo`) | `lalafo.rs/api/search/v3/feed/search?category_id=2109` (zaglavlja `country-id: 11`, `device: pc`, `language: sr_RS`) | cela kategorija (~174), pun opis u listi; detalj (params: radno vreme, uzrast) samo za „od kuće / online“ kandidate | ~4 | 2 h |
| 9 | **OLX.ba — Poslovi** (`olxba`) | `olx.ba/api/search?category_id=2286&page=N`; detalj `/api/listings/<id>` | BiH oglasi na BHS; atributi `vrsta-zaposlenja` (Honorarni posao), `radno-vrijeme` (Pola radnog vremena / Fleksibilno), plata u KM; rad od kuće iz teksta; ≤ 40 detalja (ostatak sledeći put) | ~5–45 | 3 h |
| 10 | **Šljaka** (`sljaka`) | WordPress RSS `sljaka.com/poslovi/feed/?paged=N` (pun tekst u `content:encoded`) | `job:type`: Pola radnog vremena → part-time, Freelance / Ugovor o delu → honorarno, Rad od kuće (remote) → remote | 1–10 | 6 h |
| 11 | **OglasZaPosao** (`oglaszaposao`) | WP REST `oglaszaposao.rs/wp-json/wp/v2/oglas?search=<reč>&after=<datum>` — ogledalo **Jooble**-a bez Cloudflare-a | 9 reči (od kuće, na daljinu, remote, online, honorar, nepuno, part time, pola radnog, fleksibiln), poslednje ~3 nedelje; tekst je samo Jooble isečak (~300 znakova) | ~9 + ≤ 15 | 6 h |
| 12 | **LinkedIn** (`linkedin`) | guest API `jobs-guest/jobs/api/seeMoreJobPostings/search?location=Serbia&f_WT=2&f_TPR=…`; detalj `jobPosting/<id>` | `f_WT=2` „curi“ (vraća i rad iz radnje), pa je remote samo kad tekst kaže; pauze 1,2–1,5 s, 429 prekida izvor | ~20–40 + ≤ 60 | 60 min |

### Šta je proba pokazala (dry-run 27.09.2026, `npm run try`)

| Izvor | Pročitano | Prolazi sva 3 uslova | Prikazano (posle skora) | Napomena |
|---|--:|--:|--:|---|
| Infostud | 44 remote (10 dana) | 2 | 1 | Marketing Strategist (WhiteCitySoft). Ceo aktivni Infostud (3235) ima samo 13 remote ∩ nepuno/honorarno. |
| Poslovi.rs | 246 | 4 | 0 | sve Transcom (traži italijanski/nemački/francuski) |
| Halooglasi | 210 | 0 | 0 | skoro sve fizički poslovi |
| NSZ | 560 | 0 | 0 | 0 remote u 10 dana |
| KupujemProdajem | 515 aktivnih (30 dana) | 3 | 2 | „Call operater – rad od kuće“ (fleksibilno, godine nisu bitne), „Saradnik za javne nabavke (part-time)“ |
| Sajtovi firmi | 4 stranice | 2 | 2 | **Ipsos CATI anketar od kuće** (penzioneri dobrodošli, bez gornje granice godina), **Open Source** CATI |
| KlikDoPosla | 230 | 0 | 0 | |
| Lalafo | 174 | 0 u 30 dana | 0 | remote oglasi su skoro svi MLM |
| OLX.ba | 306 | 7 (30 dana) | ≤ 5 | većinom MLM — nova MLM pravila ih obaraju |
| Šljaka | 100 | 0 | 0 | |
| OglasZaPosao | 24 (3 ned.) | 0 | 0 | |
| LinkedIn | ~160 | 0 stvarnih | 0 | 42 srpska oglasa za 8 dana — svi iz radnje/kancelarije |

Zaključak istraživanja: **ponuda je stvarno mala** — ~1–3 oglasa nedeljno na celom tržištu prolaze sva tri uslova. Najbolji pogoci nisu na
velikim oglasnicima nego na **KupujemProdajem** (mali poslodavci) i na **stalnim stranicama agencija za istraživanje tržišta** (telefonski anketar od kuće).

## Isključeni izvori (adapter postoji, `enabled: false`)

| Izvor | Zašto |
|---|---|
| Startuj Infostud | ista baza i isti id-jevi kao Infostud; sweep „remote + honorarno“ je nadskup (27.09.2026) |
| JobRack, We Work Remotely | samo engleski oglasi (26.09.2026) |
| Himalayas | i „Serbian“ oglasi traže engleski (24.09.2026) |
| Jooble | Cloudflare i na sajtu i na API-ju — sadržaj dolazi preko OglasZaPosao ogledala |

## Provereno i odbačeno (27.09.2026)

| Sajt / platforma | Nalaz |
|---|---|
| Workable (globalna pretraga), SmartRecruiters, Teamtailor, Recruitee, Greenhouse (Wolt), Lever, Personio | stotine remote poslova za Srbiju, ali 100 % na engleskom (IT, strani jezici) |
| TalentLyft (M Plus, DEKRA, Uniqa, Pepco…) | srpski oglasi postoje, ali remote traže strani jezik, ostali su iz firme |
| Manpower, Adecco, Trenkwalder, Prohuman, Grafton, Lugera, Randstad, Kelly | 0 remote + part-time |
| Karijere Mozzart, MaxBet, Gigatron, City Expert, Yettel, dm, Foundever | 0 remote + part-time |
| Careerjet | uglavnom preneti Infostud/HelloWorld oglasi |
| moj-posao.net, posao.hr (HR), posao.ba (SPA), zaposlime.me (ne postoji) | skoro bez remote oglasa; hrvatski poslovi traže boravak u HR |
| Njuškalo | ShieldSquare captcha |
| Mojtrg.rs, Pazar3.me, Oglasi.me | kategorija „rad od kuće“ puna traženja posla i MLM-a; datumi bez godine |
| oglasi.rs, malioglasi, bgoglasi, besplatnioglasi, nefertiti, sasomange (ugašen), oglasiposao.in.rs, brzodoposla | mali, zastareli ili samo fizički poslovi |
| honorarci.rs, dodatniposao.com, freelanceposlovi.com, onlineposao.rs | ljudi nude usluge, nema ponuda posla |
| studentskiposlovi.rs, omladinske zadruge | starosna granica (~15–30 godina) |
| ovdejobs.com | ruski/engleski oglasi za relokante |
| Telegram kanali (t.me/s/…) | nijedan živ srpski kanal sa poslovima nije nađen |
| lakodoposla.com, HelloWorld | već u NSZ / Infostud bazi |
| Joberty, Upwork, rs.indeed.com, jobs.rs, posao.rs, mojposao.rs, bestjobs.rs, zaposlenje.org | SPA / Cloudflare / ne postoje |

Kandidati za ručno praćenje (nema oglasa za automatsko čitanje): **MASMI** prijava anketara (`masmi.rs/prijava-anketara/`),
**Faktor Plus** anketari (pitati telefonom da li ima CATI od kuće), **Adverto Metrics** tajni kupac (honorarno, ali na terenu).

## Kako dodati nov izvor

1. `src/sources/<id>.ts` sa `export async function search(ctx: SearchCtx): Promise<Job[]>` (uzor: `nsz.ts`, `kp.ts`, `klikdoposla.ts`).
2. `npm run try -- <id> --days 30` dok brojke ne izgledaju razumno.
3. Dodati `<id>` u `SOURCES` u `src/scrape.ts`, u `Source` u `src/types.ts`, u `SRC` u `public/index.html` i `"<id>": { "enabled": true, "everyMin": … }` u `config.json → sources`.
4. Red u ovu tabelu.

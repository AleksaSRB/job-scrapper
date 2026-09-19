# Izvori — provera izvodljivosti (19.09.2026, IP iz Srbije, bez browsera)

Sve provere rađene sa `curl.exe` / Node `fetch` sa običnim Chrome User-Agentom. Legenda: ✅ radi, ⚠️ radi uz ograničenje, ❌ ne radi bez browsera/naloga.

| # | Sajt | Status | Kako se čita | Napomena |
|---|------|:-----:|--------------|----------|
| 1 | **Poslovi Infostud** | ✅ | Next.js SSR, `__NEXT_DATA__` JSON na `/oglasi-za-posao?q=…&page=N` (30/strani) + detalj `/posao/x/y/<id>` | Glavni srpski izvor. Filteri: `workPlaceTypes=remote`, `workingHours=5` (nepuno), `employmentTypes=9` (honorarno), `onlineAfterDate=YYYY-MM-DD`. `sort` se ignoriše (Premium prvo). |
| 2 | **Startuj Infostud** | ✅ | SSR HTML liste `/honorarni-poslovi`, `/poslovi-za-mlade?page=N`; detalj sa Infostud-a (isti id) | Ista baza kao Infostud → id `infostud:<id>`, nema duplikata. |
| 3 | **Poslovi.rs** | ✅ | `GET /jobs` (kolačić) pa AJAX `GET /jobs/jobs_ajax/<offset>` (0, 30, 60…; `X-Requested-With`) | Filter po reči ne utiče na AJAX listu → čita se cela ponuda (~240 oglasa) i ocenjuje lokalno. Nema datuma objave (samo rok). „RDK“ sticker = rad od kuće. |
| 4 | **JobRack** | ✅ | SSR HTML `/jobs?page=N`, `/jobs/category/<support\|executive-assistant\|sales-marketing>?page=N`; detalj `.job-description` | Remote poslovi za Istočnu Evropu, sortirano od najnovijeg. Datum samo relativan („3 days ago“). Plata u tagu („2000.00 - 3000.00 USD / Monthly“). Skoro svi traže odličan engleski. |
| 5 | **LinkedIn Jobs** | ✅ | Javni guest API `jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=…&location=Serbia&f_WT=2&f_TPR=r<sec>&start=N` (10/strani) + detalj `jobs-guest/jobs/api/jobPosting/<id>` | Bez logovanja. `f_WT=2` remote, `f_JT=P` part-time. Rizik: HTTP 429 posle većeg broja zahteva → mali broj upita, pauze 1,2–1,5 s, detalj samo za neviđene, 429 prekida izvor. |
| 6 | **We Work Remotely** | ✅ | RSS `categories/<remote-customer-support-jobs\|…>.rss` | Pun opis u feed-u; region („Anywhere in the World“, „USA Only“); bez plate kao polja. |
| 7 | **Himalayas** (bonus) | ✅ | JSON `jobs/api/search?q=…&country=RS&sort=recent` | Adapter preuzet iz QA scrapera; `country=RS` = može se konkurisati iz Srbije. Ima strukturisanu platu i tip zaposlenja. |
| 8 | **Jooble** | ❌ / ⚠️ | Sajt `rs.jooble.org` je iza Cloudflare challenge-a (curl i Node 403 „Just a moment“), i `jooble.org/api/about` isto | Adapter postoji za zvaničan API sa ključem (`config.json → jooble.apiKey`); dok ključa nema, izvor je isključen. Nije testirano uživo. |
| 9 | **HelloWorld.rs** | — | SSR HTML radi (`?keywords=` se ignoriše) | **Nije poseban adapter**: ista baza i isti id-jevi kao Infostud (IT kategorija je u Infostud pretrazi), pa bi samo pravio duplikate. |
| 10 | **Joberty** | ❌ | SPA (`backend.joberty.com`), sadržaj samo kroz JS, „limited access for non-contributors“ | Isključivo IT; preskočeno. |
| — | **Upwork** | ❌ | Cloudflare challenge (i curl pada) | Isto kao u QA scraperu; jedini put je zvaničan GraphQL API uz nalog/ključ. Preskočeno. |

## Šta koji sajt daje

| Polje | Infostud | Startuj | Poslovi.rs | JobRack | LinkedIn | WWR | Himalayas |
|-------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| datum objave | ✅ (dan) | ✅ (dan) | ❌ | ⚠️ relativan | ✅ (dan) | ✅ | ✅ |
| remote flag | ✅ `workFromHome`/`hybridWork` | ✅ (Infostud) | ✅ RDK sticker | uvek remote | filter `f_WT=2` | uvek remote | uvek remote |
| radno vreme | ✅ puno/nepuno, honorarno | ✅ | ❌ (tekst) | ✅ tag | ✅ detalj | ✅ `<type>` | ✅ |
| plata | ⚠️ `salary` tekst (retko) | ⚠️ | ❌ (tekst) | ✅ tag | ⚠️ retko | ❌ (tekst) | ✅ |
| pun opis | detalj (`textAd`) | detalj | detalj | detalj | detalj | RSS | API |
| logo | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| lokacija | grad | grad | grad / „Svi gradovi“ | „Eastern Europe“ | grad, Serbia | region | zemlje |

Detalj stranice se skidaju samo za oglase koji nisu viđeni ranije (`data/seen.json`) i uz limit po prolazu (`maxDetails` u `config.json`), pa je ritam zahteva mali.

## Rezultati prvog prolaza (19.09.2026, baseline 5 dana)

| Izvor | Pročitano | Novih | Ispod kriterijuma | Pre baseline-a | Trajanje |
|-------|--:|--:|--:|--:|--:|
| Infostud | 666 | 4 | 184 | 478 | ~2 min |
| Startuj | 30 | 0 | 12 | 18 | 23 s |
| Poslovi.rs | 236 | 1 | 235 | – | 14 s |
| JobRack | 50 | 0 | 4 | 46 | 10 s |
| LinkedIn | 157 | 17 → 12 posle tunovanja | 113 | 27 | ~2 min |
| WWR | 163 | 0 | 41 | 122 | 4 s |
| Himalayas | 88 | 11 → 9 | 24 | 53 | 5 s |

Većina odbijenih sa „ciljanom“ kategorijom pada na: napredni engleski (C1/fluent/„aktivno znanje“), strani jezik u naslovu (nemački/francuski/italijanski – Transcom, TaskUs, NCR), rad iz firme, senior/manager. Razlozi su u `data/filtered.log`.

# Remote Part-Time Job Scraper for Serbian Candidate — Claude Implementation Brief

## 1. Goal

Build a **third local scraper app** inside the same parent folder as my existing projects:

- one scraper for **QA jobs**
- one scraper for **apartments**
- this new scraper for **remote / part-time jobs suitable for my mother**

Before implementing anything, inspect the existing two scraper projects and **reuse their architecture, conventions, UI patterns, persistence logic, and styling wherever possible**.

The new app should follow the same basic experience as the QA job scraper shown in the screenshot:

- run locally on `localhost`
- scan supported job sites
- normalize results
- show each job as a card
- show short job description / summary
- show useful badges
- show salary if available
- show source site
- show direct link to the original listing
- support Favorite / Applied / Reject states
- hide/reveal rejected or hidden companies if existing apps already support this
- deduplicate the same job found on multiple sources
- preserve status across rescans
- allow manual rescans
- preferably show “new since last scan”

Do **not** invent a completely different stack if the existing scraper projects already solve these problems well.

---

# 2. Target Candidate

The candidate is a woman in Serbia, age 64, looking for a **remote, preferably part-time or flexible-hours job from home**.

Age should **not** be used as a filtering criterion.

## Relevant background

She has practical experience with:

- running small businesses
- customer interaction
- sales
- operating a PC / internet cafe
- running a bakery / food business
- importing and selling clothing
- working as a real-estate agent
- basic administration
- dealing with customers, suppliers, orders, money and day-to-day business operations
- completed architectural / technical education
- solid general computer literacy
- uses ChatGPT and can work with common computer tools

## Language

Primary language:
- Serbian

Useful / acceptable:
- Serbian
- Bosnian
- Croatian
- BCS / BHS / Serbo-Croatian

English:
- approximately A1/A2
- basic conversational understanding only
- **jobs requiring B2, C1, C2, fluent, advanced, professional or business English should normally be rejected**

The scraper should therefore heavily prioritize jobs that:
- are in Serbian
- serve Serbian-speaking customers
- explicitly require Serbian / BCS / BHS
- say English is only a plus
- require only basic English

---

# 3. Main Job Categories to Target

The scraper should **not** search only for “customer support”.

These categories are all valid.

---

## A. Customer Support — VERY HIGH PRIORITY

Keywords / titles:

- customer support
- customer support agent
- customer support representative
- customer service
- customer service representative
- customer service assistant
- customer care
- customer care agent
- support associate
- support assistant
- client support
- client support representative
- customer experience
- customer experience representative
- inbound support
- customer operations
- customer operations assistant

Serbian equivalents:

- korisnička podrška
- agent korisničke podrške
- operater korisničke podrške
- predstavnik korisničkog iskustva
- agent kontakt centra
- operater kontakt centra
- operater call centra
- call centar
- korisnički servis

---

## B. Chat / Email Support — VERY HIGH PRIORITY

Especially useful if the role avoids heavy phone work.

Keywords:

- chat support
- chat support agent
- chat support specialist
- email support
- email support agent
- online support
- online support assistant
- messaging support
- live chat support
- non-voice support
- non voice support
- ticket support
- customer service chat
- customer support chat

---

## C. Real Estate / Property / Rentals — VERY HIGH PRIORITY

Her previous real-estate experience is directly relevant.

Keywords:

- real estate assistant
- real estate virtual assistant
- real estate admin assistant
- property assistant
- property management assistant
- property management virtual assistant
- property management VA
- property coordinator
- tenant coordinator
- leasing assistant
- leasing coordinator
- listing coordinator
- listing assistant
- transaction coordinator
- real estate coordinator
- property administrator
- rental coordinator
- rental assistant

Serbian equivalents / related terms:

- nekretnine
- agent za nekretnine
- administracija nekretnina
- asistent za nekretnine
- izdavanje stanova
- upravljanje nekretninama

---

## D. Airbnb / Booking / Hospitality Support — VERY HIGH PRIORITY

Keywords:

- Airbnb assistant
- Airbnb virtual assistant
- booking assistant
- reservation agent
- reservations agent
- reservations assistant
- reservation coordinator
- booking coordinator
- guest support
- guest support agent
- guest experience coordinator
- guest relations
- guest relations assistant
- vacation rental assistant
- short term rental assistant
- property booking assistant

These can be excellent matches if:
- Serbian is accepted
- communication is chat/email based
- no advanced English requirement exists

---

## E. Virtual Assistant / Administrative Work — VERY HIGH PRIORITY

Keywords:

- virtual assistant
- remote assistant
- administrative assistant
- admin assistant
- remote administrator
- administrator
- office assistant
- business support assistant
- business support
- back office assistant
- back office clerk
- back office support
- administrative support
- operations assistant
- business operations assistant
- operations support assistant

Serbian equivalents:

- administrativni asistent
- administrativni radnik
- administracija
- poslovni asistent
- virtuelni asistent
- back office
- operativni asistent

---

## F. E-commerce / Web Shop / Online Sales Support — VERY HIGH PRIORITY

Her retail and small-business background makes this relevant.

Keywords:

- ecommerce assistant
- e-commerce assistant
- ecommerce customer support
- e-commerce customer support
- ecommerce support
- webshop administrator
- web shop administrator
- web shop assistant
- online shop administrator
- online shop assistant
- marketplace assistant
- online sales assistant
- internet sales operator
- order support
- customer order support

Serbian:

- internet prodaja
- online prodaja
- web shop administracija
- webshop administracija
- internet prodavnica
- administrator internet prodavnice
- operater internet prodaje

---

## G. Order Processing / Sales Administration — HIGH PRIORITY

Keywords:

- order processing
- order processing assistant
- order processing administrator
- order entry
- order entry clerk
- order management assistant
- order management
- customer order assistant
- sales administration
- sales administrator
- sales assistant
- sales support
- sales support assistant
- sales support associate
- commercial assistant

Serbian:

- obrada porudžbina
- unos porudžbina
- administracija prodaje
- podrška prodaji
- asistent prodaje
- komercijalni asistent

---

## H. Client / Customer Relations — HIGH PRIORITY

Keywords:

- client relations assistant
- customer relations assistant
- client relations coordinator
- customer relations
- client service assistant
- customer success assistant

Be careful with `customer success manager` because those are often senior / English-heavy.

---

## I. Appointment Setting / Light Lead Generation — MEDIUM PRIORITY

Potentially valid if:
- Serbian speaking
- no aggressive cold calling
- not commission-only
- no advanced English required

Keywords:

- appointment setter
- appointment setting
- lead generation assistant
- lead generation
- client outreach assistant
- outreach assistant
- sales appointment setter

Serbian:

- zakazivanje termina
- telefonsko zakazivanje
- kontaktiranje klijenata

---

## J. Telemarketing / Telesales — MEDIUM PRIORITY

Only show if conditions are reasonable.

Keywords:

- telemarketing agent
- telesales agent
- sales agent
- inbound sales agent
- call center sales agent
- telephone sales
- telefonska prodaja
- prodajni agent

Down-rank heavily if:
- pure cold calling
- commission only
- aggressive quotas
- US night shifts

---

## K. Data Entry / Simple Computer Work — HIGH PRIORITY

Keywords:

- data entry
- data entry clerk
- data entry operator
- data entry assistant
- data processing
- data processing clerk
- database assistant
- CRM data entry
- CRM assistant
- records assistant
- documentation assistant
- document processing
- document processing assistant
- data administrator
- data admin

Serbian:

- unos podataka
- obrada podataka
- administracija podataka
- rad sa bazom podataka
- dokumentacija

---

## L. Product Listings / Catalog / Marketplace Work — HIGH PRIORITY

Keywords:

- product listing assistant
- product listing
- listing specialist
- marketplace assistant
- catalog assistant
- catalogue assistant
- product data assistant
- product content assistant
- content upload assistant
- ecommerce listing
- marketplace listing

Serbian:

- unos proizvoda
- postavljanje proizvoda
- administracija proizvoda
- uređivanje kataloga
- unos artikala

---

## M. Community / Content Moderation — MEDIUM PRIORITY

Keywords:

- community support
- community moderator
- content moderator
- content reviewer
- user support moderator
- forum moderator

Down-rank if:
- English-heavy
- stressful / sensitive content
- full-time only

---

## N. AI / Rating / Annotation / Microtask Work — MEDIUM PRIORITY

Can be good because these are often flexible and remote.

Keywords:

- internet assessor
- personalized internet assessor
- search quality rater
- search evaluator
- online rater
- AI rater
- data annotator
- data annotation
- data labeler
- data labeling
- ads assessor
- content rater
- AI data specialist
- AI evaluator

Important:
- many of these still require English for instructions
- do not reject automatically unless the job explicitly requires B2/C1/C2/fluent/advanced English
- otherwise rank below Serbian-language support/admin jobs

---

## O. Architecture / CAD — OPTIONAL / LOW-MEDIUM PRIORITY

Only useful if the listing is beginner-friendly and software expectations fit her skills.

Keywords:

- CAD assistant
- AutoCAD assistant
- AutoCAD drafter
- architectural drafter
- architectural assistant
- drafting assistant
- technical drawing assistant

Do not rank high unless skills match.

---

# 4. Language Rules

## Hard Reject — English

Reject or strongly suppress jobs where the listing explicitly requires any of these:

- English B2
- B2 English
- English C1
- C1 English
- English C2
- C2 English
- fluent English
- fluent in English
- advanced English
- excellent English
- professional English
- professional working proficiency
- business English
- business proficiency in English
- native English
- native-level English
- near-native English
- full professional proficiency in English

Also reject when the title itself says for example:

- English-speaking support
- English customer support
- Customer Support — English C1
- English Sales Agent

Exception:
If a listing says something ambiguous like `English preferred`, `English is a plus`, or `basic English`, do not reject.

---

## Positive Language Signals

Boost jobs containing:

- Serbian
- Serbian speaking
- Serbian-speaking
- Serbian language
- srpski
- srpski jezik
- Bosnian
- Croatian
- Bosnian/Croatian/Serbian
- Serbian/Croatian/Bosnian
- BCS
- BHS
- Serbo-Croatian
- native Serbian
- basic English
- elementary English
- English is a plus
- English preferred
- basic knowledge of English
- basic English knowledge

These should be **visually prominent badges** in the UI where possible.

Examples:

- `Serbian`
- `BHS`
- `Basic English`
- `English optional`

---

# 5. Other Hard Reject / Strong Negative Rules

Reject jobs that clearly require:

- German mandatory
- French mandatory
- Italian mandatory
- Spanish mandatory
- Dutch mandatory
- Nordic languages mandatory
- any other foreign language as a hard requirement, unless Serbian is also an accepted alternative

Reject / strongly suppress:

- senior
- senior-level
- lead
- team lead
- manager
- head of
- director
- supervisor

unless the role title contains `assistant manager` in a way that is clearly junior/admin and not managerial.

Reject or strongly suppress:

- software engineering
- developer
- programming
- QA engineering
- accounting roles requiring certification
- legal roles
- medical roles
- technical engineering roles
- jobs requiring a university degree in a very specific unrelated field
- jobs requiring 3+ or 5+ years of niche professional experience

Reject or penalize:

- full-time only
- office only
- onsite only
- hybrid only if remote work from Serbia is not possible
- relocation required
- US-only
- EU citizenship mandatory if Serbian candidates are not eligible
- `must reside in the USA`
- `US work authorization required`
- `UK only`
- `EU only` where Serbia is excluded

Strong negative:

- commission-only
- unpaid
- internship
- cold calling only
- door-to-door
- night shift / US shift
- rotating overnight shifts

---

# 6. Positive Employment Signals

Boost:

- part-time
- part time
- flexible hours
- flexible schedule
- remote
- fully remote
- work from home
- home-based
- freelance
- contractor
- 10-20 hours
- 15-20 hours
- 20 hours per week
- 20-30 hours
- less than 30 hrs/week
- paid hourly
- fixed part-time schedule
- choose your hours
- Serbian candidates
- Serbia
- Eastern Europe
- Balkans
- EMEA if Serbia is explicitly supported
- entry level
- no experience required
- training provided
- basic computer skills
- MS Office
- Google Workspace
- email
- CRM
- ChatGPT / AI tools

---

# 7. Suggested Scoring Philosophy

Do not use only:

`title contains keyword => show`

Use a weighted relevance score based on the complete listing.

Suggested logic:

```text
+40 Serbian / BHS / BCS required or clearly Serbian-facing role
+30 part-time / freelance / flexible hours
+30 fully remote / work from home
+25 real estate / property / booking
+25 customer support / admin / ecommerce
+20 chat or email support / non-voice
+20 data entry / product listing / order processing
+15 entry-level / no experience required
+15 training provided
+10 basic computer skills / MS Office / Google Workspace
+10 basic English or English only "a plus"
+10 Serbia / Balkans / Eastern Europe explicitly eligible

-100 English B2/C1/C2/fluent/advanced mandatory
-100 foreign language mandatory and Serbian not accepted
-100 candidate location excludes Serbia
-80 onsite-only
-70 full-time-only
-60 senior / lead / manager / director
-50 commission-only
-40 US night shift / overnight shift
-40 cold calling only
-30 advanced domain-specific experience
-25 unclear remote eligibility
```

Suggested display categories:

```text
90+  Excellent Match
70+  Good Match
50+  Possible Match
<50  Hide by default
```

Do not blindly enforce these exact values if the current QA scraper already has a better ranking structure. The important part is the intent.

---

# 8. Job Sources to Test

Claude should **test each source for actual scraping capability** and document what works.

The goal is not necessarily to scrape all 10 directly if some have strong anti-bot protection or legal/technical restrictions.

Use the safest and most maintainable available method for each source.

| # | Site | Priority | Why |
|---|---|---:|---|
| 1 | LinkedIn Jobs | ⭐⭐⭐⭐⭐ | Very broad selection: support, admin, sales, remote international employers |
| 2 | Poslovi Infostud | ⭐⭐⭐⭐⭐ | Most important Serbian employment portal |
| 3 | Jooble Srbija | ⭐⭐⭐⭐⭐ | Aggregator; can expose jobs from many other sources |
| 4 | Upwork | ⭐⭐⭐⭐⭐ | Part-time, freelance, VA, admin, support, data entry |
| 5 | HelloWorld.rs | ⭐⭐⭐⭐ | Tech-heavy but also support/product/admin roles |
| 6 | JobRack | ⭐⭐⭐⭐ | Remote jobs often targeted at Eastern Europe / Balkans |
| 7 | We Work Remotely | ⭐⭐⭐⭐ | International remote jobs |
| 8 | Poslovi.rs | ⭐⭐⭐ | Serbian admin, sales, support and call-center jobs |
| 9 | Joberty | ⭐⭐⭐ | Mostly tech, but can still have remote/support listings |
| 10 | Startuj Infostud | ⭐⭐⭐ | Junior, entry-level, part-time and lower-experience jobs |

---

# 9. Scraping Capability Investigation

Before implementing each source, determine:

1. Does the site expose public HTML results?
2. Is content server-rendered or JS-rendered?
3. Is there a public API endpoint used by the frontend?
4. Does pagination exist?
5. Is infinite scroll used?
6. Does the site block automated requests?
7. Does it require authentication?
8. Are search parameters available in the URL?
9. Can remote / Serbia / part-time filters be expressed directly?
10. Is salary available in result cards or only detail pages?
11. Can listing descriptions be fetched reliably?
12. Does the same job have a stable unique ID?
13. What fields can be extracted consistently?

For each source, produce a short implementation note such as:

```text
LinkedIn
- Search results accessible: yes/no
- Authentication required: yes/no
- Reliable fields:
- Detail page required:
- Anti-bot risk:
- Recommended approach:
```

Prefer:
- public APIs or frontend JSON endpoints where available
- normal HTTP parsing when stable
- browser automation only if necessary

Do not build fragile CAPTCHA bypasses.

If a source cannot be scraped reliably, isolate it behind an adapter and leave it disabled rather than breaking the whole application.

---

# 10. Search Strategy

Do not execute a single huge generic query.

Use multiple search groups per source.

Examples:

## Serbian searches

```text
"korisnička podrška"
"agent korisničke podrške"
"administrativni asistent"
"administracija remote"
"rad od kuće"
"remote posao"
"part time"
"honorarni"
"nekretnine asistent"
"internet prodaja"
"web shop administracija"
"unos podataka"
"obrada porudžbina"
"podrška prodaji"
```

## English searches

```text
"Serbian customer support"
"Serbian support"
"Serbian speaking customer support"
"Serbian virtual assistant"
"virtual assistant Serbia"
"remote administrative assistant Serbia"
"real estate assistant remote"
"property management assistant remote"
"Airbnb assistant remote"
"reservation agent remote Serbia"
"ecommerce assistant remote"
"order processing remote"
"data entry remote Serbia"
"Serbian data entry"
"Serbian AI rater"
"Serbian search rater"
"Serbian content moderator"
```

When possible, combine with:

```text
remote
part-time
part time
freelance
Serbia
Serbian
```

Avoid overly narrow queries that cause potentially good listings to be missed.

---

# 11. Location Rules

Accepted locations:

- Serbia
- Remote — Serbia
- Serbia remote
- Belgrade + remote
- Novi Sad + remote
- Anywhere in Serbia
- Balkans
- Eastern Europe
- Europe, if Serbia is eligible
- EMEA, if Serbia is eligible
- Worldwide
- Anywhere in the World

Be careful:

`Europe` does not automatically mean Serbia is accepted.

If the description says EU citizenship / EU residence only, reject.

---

# 12. Remote Rules

Strong positive:

- fully remote
- remote
- work from home
- home office
- home-based

Possible but lower priority:

- mostly remote
- hybrid with rare office attendance, **only if realistically accessible**

Reject:

- office only
- onsite
- must attend office regularly
- remote only after probation if the job starts onsite and location is unrealistic

---

# 13. Part-Time Rules

Highest priority:

- part-time
- freelance
- contractor
- flexible
- hourly
- 10-30 hours/week

Full-time jobs should normally be suppressed unless:
- unusually strong match
- description explicitly mentions reduced schedule / flexible arrangement

UI should visibly show:

- Part-Time
- Freelance
- Full-Time
- Contract
- Flexible

---

# 14. Salary

If salary is available, normalize and display it prominently.

Possible formats:

- RSD / month
- EUR / month
- EUR / hour
- USD / hour
- annual salary

Store:
- original salary text
- parsed minimum
- parsed maximum
- currency
- period (`hour`, `month`, `year`)
- whether estimated or explicitly stated

Do not invent salary when missing.

UI:
- salary badge should appear near the top of the card, similar to the QA scraper screenshot

---

# 15. Data Model Per Job

Normalize each source into roughly:

```text
id
source
sourceJobId
url

title
company
location

remoteType
employmentType
hoursPerWeek

salaryText
salaryMin
salaryMax
salaryCurrency
salaryPeriod

description
shortDescription

postedAt
discoveredAt
lastSeenAt

languageRequirements
skills
tags

matchScore
matchReasons
negativeReasons

isNew

status:
  new
  favorite
  applied
  rejected

dedupKey
duplicateSources
```

Adapt naming to the existing project conventions rather than forcing this exact schema.

---

# 16. Job Card UI

The visual approach should closely match the existing QA scraper.

Each card should show:

### Header
- company name
- company logo if easily available
- source badge

### Main title
- job title

### Location
Examples:
- Serbia
- Remote — Serbia
- Anywhere in the World

### Important badges

Examples:

```text
Part-Time
Remote
Flexible
Serbian
BHS
Basic English
Customer Support
Real Estate
Admin
E-commerce
Data Entry
€8/hour
```

Positive language badges should be visible.

### Skills / category badges

Only show useful ones, not a huge noisy keyword list.

### Short summary

2-4 concise lines.

Prefer extracting:
- what the person actually does
- language requirement
- working hours
- schedule
- most important qualification

### Match explanation

Optional but useful:

```text
Excellent Match
✓ Serbian required
✓ Part-time
✓ Fully remote
✓ Customer support
```

or compact tooltip / expandable section.

### Footer

Show:
- how old the listing is
- when our scraper found it

Example:

```text
pre 13 h · pronađen 18.09. 23:18
```

### Actions

Same behavior as existing app:

- ⭐ Favorite
- ✓ Applied
- ✕ Reject
- Open ↗

`Open` must go directly to original job listing.

---

# 17. Filters / Top Navigation

Reuse the current QA app layout if possible.

Suggested filters:

### Status

- New
- Favorites
- Applied
- Rejected / hidden

### Source

- All sites
- LinkedIn
- Infostud
- Jooble
- Upwork
- etc.

### Sort

- Newest first
- Highest match
- Highest salary
- Recently discovered

### Optional useful filters

- Part-time only
- Serbian required
- No advanced English
- Customer Support
- Real Estate
- Admin / VA
- E-commerce
- Data Entry

Do not overcomplicate the UI in version 1.

---

# 18. Persistence

Favorite / Applied / Rejected must survive:

- page refresh
- rescans
- application restart

Reuse whatever mechanism the other scraper uses.

When a job disappears from a source:
- do not immediately delete user state
- preserve known listings locally
- mark stale / no longer seen if useful

---

# 19. Deduplication — VERY IMPORTANT

The same job may appear on:

- company website
- LinkedIn
- Jooble
- Infostud
- another aggregator

Do not show duplicates as separate cards.

## Preferred dedup signals

Use as many as possible:

1. canonical original URL
2. source job ID
3. normalized company
4. normalized title
5. location
6. similarity of description
7. salary
8. posted date

Example normalized key:

```text
normalize(company) +
normalize(title) +
normalize(location)
```

But do not rely exclusively on exact strings.

Examples that should dedup:

```text
Customer Support Agent - Serbian
Serbian Customer Support Agent
Customer Support Agent (Serbian Speaking)
```

when:
- same company
- similar location
- matching listing content

If duplicates are found:

- keep one primary card
- prefer direct employer source over aggregator
- otherwise prefer source with richer data
- store all alternate source URLs

Optional UI:

```text
Also found on: Jooble, LinkedIn
```

---

# 20. Company Hiding / Rejection Behavior

If existing QA scraper has `hide company`, reuse that feature.

Useful because:
- some staffing agencies may flood results
- irrelevant employers may post repeated jobs
- commission-only sellers may dominate results

A rejected individual job should not necessarily reject the whole company.

---

# 21. New Job Detection

On each scan:

- identify genuinely new listings
- do not re-mark an existing deduplicated listing as new
- show count in navigation

Example:

```text
Novi 13
Favoriti 0
Aplicirao 0
```

Exactly the same style/behavior as the existing QA scraper where practical.

---

# 22. Scan Behavior

Provide a manual button:

```text
Skeniraj sad
```

Display:

```text
poslednja provera HH:MM
```

The scanner should:

1. scan sources independently
2. tolerate one source failing
3. normalize results
4. apply hard rejects
5. score remaining listings
6. deduplicate
7. persist results
8. update UI

One broken site must not break the full scan.

---

# 23. Logging / Diagnostics

For every scraper adapter log:

- source
- query
- page
- HTTP status
- jobs discovered
- jobs rejected
- jobs accepted
- errors
- scraping duration

Example:

```text
[Infostud] query="korisnička podrška" results=27 accepted=11 rejected=16 duration=1.8s
```

Provide enough information to debug when sites change HTML.

---

# 24. Match Reasoning

For every accepted job, keep internal match reasons.

Example:

```text
+30 fully remote
+40 Serbian required
+30 part-time
+25 customer support
-0 English requirement
Score: 125
```

This will make it easy to tune ranking.

For rejected listings, store a rejection reason during development:

```text
Rejected: English C1 mandatory
Rejected: Germany-only
Rejected: full-time onsite
Rejected: Senior Manager role
```

No need to show all of this in the default UI, but make it inspectable.

---

# 25. Keywords Should Be Maintainable

Do not scatter raw keyword strings across scraper files.

Keep categories / positive terms / hard rejects / scoring rules centralized in config.

For example conceptually:

```text
config/
  jobCategories
  languageRules
  locationRules
  scoringRules
  sources
```

Use whatever structure best matches the existing projects.

---

# 26. Priority Order

When ranking candidate jobs, conceptually prioritize:

1. **Serbian Customer Support**
2. **Chat / Email Support**
3. **Real Estate / Property Assistant**
4. **Virtual / Administrative Assistant**
5. **Airbnb / Booking / Reservation Support**
6. **E-commerce / Web Shop / Order Processing**
7. **Data Entry / Product Listing / Online Admin**
8. **Sales Support / Client Relations**
9. **AI Rater / Data Annotation**
10. **Appointment Setting / Telemarketing**
11. **Architecture / CAD**

This should guide ranking, not function as an absolute restriction.

---

# 27. Candidate-Friendly Interpretation

A listing does **not** need to match her exact past job titles.

Her experience can reasonably map to:

```text
Small-business owner
→ administration
→ customer service
→ sales support
→ order processing
→ supplier/customer coordination
→ ecommerce
→ operations support
```

```text
Former real-estate agent
→ real estate assistant
→ listing coordinator
→ property assistant
→ rental support
→ appointment scheduling
→ client relations
```

```text
Retail / clothing sales
→ ecommerce support
→ webshop admin
→ product listings
→ customer support
→ order management
```

```text
PC/internet cafe experience + general computer literacy
→ data entry
→ online administration
→ CRM work
→ remote support
→ basic VA work
→ AI-assisted tasks
```

The scoring system should account for this rather than requiring an exact title match.

---

# 28. Do Not Filter on Age

Never add:
- age
- date of birth
- “young team”
- “under X years old”

as scraper eligibility logic.

If a listing itself contains obviously discriminatory language, optionally flag it for review, but do not use her age as a normal filter.

---

# 29. Implementation Instructions for Claude

Before coding:

1. Inspect the QA scraper project.
2. Inspect the apartment scraper project.
3. Identify:
   - framework
   - backend structure
   - frontend structure
   - storage mechanism
   - scraper adapter design
   - dedup implementation
   - status persistence
   - card components
   - filters
   - scan button logic
4. Reuse as much proven code as possible.
5. Create the new project cleanly without breaking the existing two.

Do not rewrite shared concepts from scratch unnecessarily.

---

# 30. Phase 1

First implement a working MVP with the sources that are easiest and most reliable.

Ideal first candidates:

- Poslovi Infostud
- Startuj Infostud
- Poslovi.rs
- JobRack
- We Work Remotely

Then add:

- LinkedIn
- Jooble
- Upwork
- HelloWorld
- Joberty

**But choose the order based on actual scraping feasibility discovered during investigation.**

---

# 31. Phase 2

After the MVP works:

- add additional sources
- improve salary parsing
- improve fuzzy dedup
- tune scoring
- add more Serbian synonyms
- add source health diagnostics
- optionally schedule automatic scans
- optionally add browser notifications for very high matches

---

# 32. Acceptance Criteria

The task is complete when:

- app runs locally
- visually resembles the existing QA scraper
- at least several sources are working
- failed sources do not crash scanning
- listings are normalized
- remote eligibility is visible
- employment type is visible
- Serbian / language requirement is visible
- salary is visible if provided
- direct original link exists
- Favorite works
- Applied works
- Reject works
- those states persist
- duplicates are merged
- new listings are detected correctly
- hard English requirements are filtered
- Serbian/BHS roles are strongly promoted
- part-time/flexible jobs are strongly promoted
- score can be tuned from config
- scraper-specific logic is isolated enough that source HTML changes can be fixed independently

---

# 33. Important Final Instruction

Do not just start coding based on assumptions.

First:
- inspect the two existing projects
- report briefly what architecture/patterns you found
- test scraping feasibility of the listed sites
- decide which sources can be supported reliably
- then implement the new scraper using the same conventions

The end result should feel like a **sibling app to the existing QA jobs scraper**, not an unrelated prototype.

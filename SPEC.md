# Muti — Specifica funzionale e tecnica

> Player desktop per musica classica: riproduce da Spotify e, accanto al brano, mostra struttura dell'opera, storia, compositore e opere correlate da fonti aperte.

| | |
|---|---|
| **Stato** | Bozza v0.1 — da revisionare |
| **Data** | 2026-09-25 |
| **Stack** | Electron (fork castLabs ECS) · React 19 · TypeScript · Vite |
| **Piattaforme** | macOS (primaria), Windows (secondaria), Linux (best-effort, vedi §2.2) |

---

## 0. TL;DR — decisioni chiave

1. **Electron con fork castLabs ECS**, non Electron standard: il Web Playback SDK di Spotify richiede EME/Widevine, che Electron stock non include.
2. **Due modalità di riproduzione, un solo codice di controllo.** *Integrata* (Web Playback SDK dentro l'app) e *Connect* (pilota l'app Spotify ufficiale o qualsiasi device). Entrambe usano gli stessi endpoint `/me/player/*`, cambia solo il `device_id`. La modalità Connect è il paracadute se il DRM in Electron si rivela instabile (problema documentato dalla community).
3. **Distribuzione "Bring Your Own Client ID".** Dopo le modifiche di febbraio 2026, un'app Spotify in Development Mode ha massimo 5 utenti, e l'Extended Quota è riservata ad aziende con almeno 250k MAU. Ogni utente registra quindi la propria app Spotify e incolla il Client ID al primo avvio.
4. **Il matching brano → opera è deterministico**, basato su parsing di titolo e numero di catalogo e sul riconoscimento del compositore tra gli artisti. L'ISRC non è più disponibile in Dev Mode, e la policy Spotify vieta di far elaborare contenuti Spotify da modelli AI.
5. **Wikidata è l'hub dei dati.** Da un QID si raggiungono Wikipedia (it/en), MusicBrainz, IMSLP e le proprietà strutturate (tonalità, catalogo, prima esecuzione, dedica). Open Opus serve per "consigliate/popolari" ed epoche, MusicBrainz per movimenti e derivazioni, IMSLP per i campi mancanti e il link alla partitura.
6. **Tutte le chiamate alle fonti aperte partono dal main process**, per tre motivi: User-Agent identificativo obbligatorio per Wikimedia e MusicBrainz (il renderer non può impostarlo), assenza di CORS su IMSLP, cache su disco centralizzata.

---

## 1. Obiettivi e non-obiettivi

### 1.1 Obiettivi
- Riprodurre tracce Spotify (utenti Premium) con controlli completi: play/pausa, seek, next/prev, volume, coda.
- Per il brano in ascolto, mostrare nel **pannello destro**:
  - **L'opera**: titolo canonico, catalogo, tonalità, anno di composizione, organico, durata media, genere.
  - **Struttura**: elenco dei movimenti con quello corrente evidenziato.
  - **Storia dell'opera**: genesi, prima esecuzione, dedica, ricezione (da Wikipedia).
  - **Il compositore**: ritratto, date, epoca, biografia sintetica ed estesa.
  - **Opere correlate**: stesso ciclo, stesso genere dello stesso autore, arrangiamenti/derivazioni, contemporanei.
  - **Partitura**: link IMSLP quando disponibile.
- Italiano come lingua predefinita, con fallback all'inglese segnalato visivamente.
- Correzione manuale dell'abbinamento quando il matching automatico sbaglia.

### 1.2 Non-obiettivi (v1)
- Download o riproduzione offline (vietato dalla policy Spotify).
- Gestione avanzata della libreria Spotify: solo playlist e brani salvati in lettura, più "salva brano".
- App mobile, sincronizzazione cloud, account propri.
- Contenuti generati da LLM (vedi §12, rischio policy).
- Uso commerciale di qualsiasi tipo (la policy Spotify lo vieta per le app di streaming).

---

## 2. Vincoli esterni verificati (settembre 2026)

### 2.1 Spotify Web API — Development Mode (in vigore dal 9 marzo 2026 per tutte le app)
| Vincolo | Impatto su Muti |
|---|---|
| Il proprietario dell'app deve avere Premium; 1 Client ID per sviluppatore; **max 5 utenti** in allowlist | Modello BYO Client ID (§9.1). Onboarding guidato. |
| Extended Quota solo per organizzazioni registrate con ≥250k MAU | Una distribuzione pubblica con un Client ID condiviso non è praticabile. |
| **Rimossi dal Track:** `external_ids` (ISRC), `popularity`, `available_markets`, `linked_from` | Nessun matching ISRC. Matching su titolo e catalogo (§6). |
| **Rimossi dall'Album:** `external_ids`, `label`, `popularity` | Non si può mostrare l'etichetta discografica. |
| Rimossi: batch fetch (`GET /tracks?ids=`), browse, artist top-tracks, profili altrui | Fetch singoli. Nessuna sezione "scopri" basata su Spotify. |
| `GET /search`: **limit max 10** (default 5) | Paginazione esplicita nella ricerca. |
| Endpoint Player **tutti mantenuti** (play, pause, seek, transfer, queue, devices, currently-playing) | Il controllo di riproduzione non subisce limitazioni. |
| Endpoint playlist rinominati `/playlists/{id}/items`; libreria unificata `PUT/DELETE /me/library` | Usare solo i nuovi path. |
| Redirect URI: vietato `localhost`; ammesso loopback `http://127.0.0.1` (porta dinamica consentita se registrato senza porta) | Server di callback loopback nel main process (§9.2). |
| Implicit grant deprecato → **Authorization Code + PKCE** | Nessun client secret nell'app. |

### 2.2 Riproduzione in Electron
- Il Web Playback SDK richiede **EME + Widevine** e un account Premium.
- **castLabs ECS** (ultima release: v44.x `+wvcus`) installa la CDM Widevine via Component Updater. Bisogna attendere `components.whenReady()` prima di aprire la finestra.
- I binari castLabs sono firmati VMP solo per sviluppo. **In produzione serve la firma VMP tramite castLabs EVS.** Costi e condizioni vanno verificati con castLabs.
- **Rischio noto:** diversi sviluppatori segnalano playback che si interrompe dopo 1–30 s oppure HTTP 500 sull'endpoint `widevine-license` di Spotify in app castLabs. Causa probabile: firma VMP di sviluppo o controlli di ambiente lato Spotify. → **La Fase 0 (spike) è bloccante** (§11).
- Linux: niente persistent license storage in ECS, supporto VMP limitato → solo modalità Connect.

### 2.3 Policy sviluppatori Spotify (punti vincolanti)
- Attribuzione obbligatoria con i marchi Spotify. Metadati e copertine devono avere un **link diretto** al contenuto su Spotify.
- Vietato mixare o sovrapporre l'audio Spotify ad altro audio.
- **Vietato "ingest Spotify Content into a machine learning or AI model"**: nessun LLM su titoli, artisti o copertine provenienti da Spotify.
- Vietato memorizzare contenuti Spotify oltre la sessione. Metadati e copertine Spotify vivono solo in memoria.
- Il nome dell'app non può iniziare con "Spot" né suggerire approvazione da parte di Spotify.

---

## 3. Fonti dati

### 3.1 Fonti adottate
Tutte verificate con chiamate reali il 2026-09-25.

| Fonte | Accesso | Cosa fornisce | Licenza | Limiti / note |
|---|---|---|---|---|
| **Wikidata** | SPARQL `query.wikidata.org/sparql`, `wbsearchentities`, `Special:EntityData/{Q}.json` | **Hub.** Compositore `P86`, data `P571`, tonalità `P826`, catalogo `P528` (+qualificatore `P972`), prima esecuzione `P1191` e luogo `P4647`, dedicatario `P825`, parti `P527`, parte di `P361`, organico `P870`, genere `P136`, MBID opera `P435`, IMSLP ID `P839`, sitelinks Wikipedia. Etichette in italiano. | CC0 | User-Agent identificativo obbligatorio. Timeout SPARQL 60 s. Throttling in caso di abuso. |
| **Wikipedia (it, en)** | REST `/{lang}.wikipedia.org/api/rest_v1/page/summary/{title}`; `action=query&prop=extracts&explaintext=1` per il testo a sezioni | Storia dell'opera, biografia del compositore (sezioni tipo "Biografia", "Lo stile", "Opere"), thumbnail | CC BY-SA 4.0 | Attribuzione e link alla voce obbligatori. Testo in plaintext → nessun HTML da sanificare. |
| **MusicBrainz** | `musicbrainz.org/ws/2/{work,recording,artist}` con `fmt=json`, `inc=work-rels+artist-rels+url-rels` | Gerarchia movimenti (rel. `parts`), attributo Key, compositore, dedicatari, **arrangiamenti e opere "based on"**, link Wikidata/IMSLP/VIAF | Dati core CC0 | **1 req/s** con User-Agent `App/versione (contatto)`. Il link recording→work spesso manca (verificato: registrazioni Kleiber senza work-rel) → usarlo come fonte di opere, non di registrazioni. |
| **Open Opus** | `api.openopus.org` (REST JSON, nessuna chiave), es. `/composer/list/search/{q}.json`, `/work/list/composer/{id}/genre/{Recommended|Popular|all}.json`, `/omnisearch/{q}/{offset}.json` | ~220 compositori con epoca, ritratto, date; opere categorizzate per genere con flag `popular`/`recommended` | Pubblico dominio | Progetto con poca attività ma API attiva (v1.20.6). Trattarla come **opzionale e sostituibile**: il pannello deve funzionare anche senza. |
| **IMSLP** | MediaWiki API `imslp.org/api.php?action=parse&page={P839}&prop=wikitext` | Campi strutturati del template: `Movements Header`, `Year/Date of Composition`, `First Performance`, `Dedication`, `Instrumentation`, `Average Duration`, `Piece Style`, più il link alla partitura | Testi wiki: da verificare; le partiture sono PD solo in alcuni paesi | Si leggono solo campi strutturati e si mostra un link, senza servire PDF. Nessun CORS → solo main process. |
| **Wikimedia Commons** | URL di thumbnail da Wikipedia/Wikidata `P18` | Ritratti dei compositori | Varia per file (prevalentemente PD) | Mostrare autore e licenza al passaggio del mouse. |

### 3.2 Fonti valutate e scartate
| Fonte | Motivo |
|---|---|
| Apple Music Classical / Idagio / Presto | Nessuna API pubblica. |
| AllMusic | Nessuna API. Si mostra solo il link, quando MusicBrainz lo fornisce. |
| Discogs | Buono per le edizioni discografiche, debole sulle opere. Non serve in v1. |
| Last.fm | Le biografie derivano da Wikipedia. Ridondante. |
| ISRC → MusicBrainz | ISRC non esposto da Spotify in Dev Mode (§2.1). |

---

## 4. Architettura

```
┌──────────────────────────── Electron (castLabs ECS) ────────────────────────────┐
│ MAIN PROCESS (Node)                                                             │
│  auth.ts        PKCE + server loopback 127.0.0.1:{porta} + refresh token        │
│                 token cifrati con safeStorage                                    │
│  metadata/                                                                       │
│    resolve.ts   pipeline brano → opera (§6)                                     │
│    parse.ts     parser titoli Spotify (funzione pura, testata)                  │
│    wikidata.ts · wikipedia.ts · musicbrainz.ts · openopus.ts · imslp.ts         │
│    http.ts      fetch con User-Agent, coda per host (MB 1 req/s), retry         │
│    cache.ts     cache su disco JSON in userData/cache, TTL                       │
│  ipc.ts         handler tipizzati                                                │
│                                                                                  │
│ PRELOAD  contextBridge → window.muti.{auth, metadata, settings}                 │
│                                                                                  │
│ RENDERER (React)                                                                 │
│  Web Playback SDK (sdk.scdn.co) → device "Muti"                                 │
│  spotify.ts     client Web API (fetch diretto con access token)                 │
│  Player · Library/Search · InfoPanel (sezioni §5.3)                              │
└──────────────────────────────────────────────────────────────────────────────────┘
       │ Web API + SDK                          │ fonti aperte (solo dal main)
       ▼                                        ▼
  api.spotify.com                wikidata · wikipedia · musicbrainz · openopus · imslp
```

### 4.1 Scelte e motivazioni
- **Chiamate Spotify dal renderer**: l'SDK vive comunque lì, l'API Spotify supporta CORS e il token è a vita breve. Il refresh resta nel main (`auth:getToken`).
- **Fonti aperte dal main**: User-Agent, niente CORS su IMSLP, rate limit centralizzato, cache condivisa.
- **Cache = file JSON in `userData/cache/<sha1(url)>.json`** con `fetchedAt`. TTL di 30 giorni per le fonti aperte, 7 giorni per i risultati di `resolve`. Niente database: si tratta di centinaia di voci. *(ponytail: file JSON, passare a `node:sqlite` se la cache supera ~10k voci o serve query.)*
- **Nessuno state manager**: stato di playback da eventi SDK o polling, pannello tramite un hook `useResolvedTrack(trackId)` con `AbortController`. La cache vive nel main.
- **Fuzzy matching**: coefficiente di Dice su token normalizzati, circa 20 righe. Nessuna libreria.

### 4.2 Sicurezza Electron
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, preload con API minima e tipizzata.
- CSP: `script-src 'self' https://sdk.scdn.co`; `connect-src https://api.spotify.com https://*.spotify.com`; `img-src https://i.scdn.co https://upload.wikimedia.org https://assets.openopus.org data:`.
- Login OAuth nel **browser di sistema** (`shell.openExternal`), non in una webview (RFC 8252).
- Nessun client secret. Il Client ID non è un segreto.
- I testi Wikipedia si usano solo in plaintext (`explaintext`) e si renderizzano come testo, mai con `dangerouslySetInnerHTML`.

---

## 5. UX

### 5.1 Layout principale (≥ 1280×800, minimo 1024×680)
```
┌──────────────┬───────────────────────────────┬──────────────────────────────┐
│ LIBRERIA     │           PLAYER              │  PANNELLO OPERA        [it▾] │
│ 🔍 Cerca…    │                               │ ┌──────┐ Sinfonia n. 5       │
│              │        [ copertina ]          │ │ritr. │ in do minore, op. 67 │
│ Playlist     │                               │ └──────┘ L. van Beethoven    │
│ Brani salvati│  Symphony No. 5 in C Minor,   │          1804–08 · Classico  │
│ Recenti      │  Op. 67: I. Allegro con brio  │ ──────────────────────────── │
│              │  Wiener Ph. · C. Kleiber      │ STRUTTURA                    │
│              │  [Apri in Spotify ↗]          │ ▶ I.  Allegro con brio       │
│              │                               │   II. Andante con moto       │
│              │  ⏮  ⏯  ⏭   ──●────── 2:31    │   III. Allegro               │
│              │  🔊 ─────●──                  │   IV. Allegro – Presto       │
│              │                               │ SCHEDA  ·  STORIA  ·         │
│              │  Coda ▾                       │ COMPOSITORE  ·  CORRELATE    │
│              │                               │ …                            │
│              │  Device: Muti (integrato) ▾   │ Fonti: Wikidata, Wikipedia…  │
└──────────────┴───────────────────────────────┴──────────────────────────────┘
```
- Il pannello destro è ridimensionabile (320–560 px) e comprimibile.
- Badge di confidenza del matching accanto al titolo dell'opera: nessun badge = certo; "probabile" = giallo, con il menu "Correggi abbinamento".

### 5.2 Onboarding (primo avvio)
1. Schermata "Collega Spotify" con guida passo-passo: creare l'app su developer.spotify.com, aggiungere il redirect URI `http://127.0.0.1/callback` (senza porta), aggiungere il proprio utente all'allowlist, incollare il Client ID.
2. Login PKCE nel browser di sistema → ritorno sull'app.
3. Verifica Premium tramite `GET /me` (senza campo `product` in Dev Mode → verifica indiretta: l'SDK emette `account_error` se l'utente non è Premium).
4. Verifica DRM: `components.whenReady()` e l'evento `ready` dell'SDK entro 15 s. In caso contrario si propone la modalità Connect.

### 5.3 Sezioni del pannello destro
| Sezione | Contenuto | Fonti (in ordine di priorità) |
|---|---|---|
| **Header** | Titolo canonico (etichetta Wikidata nella lingua dell'UI), catalogo, tonalità, compositore, anni di composizione, epoca | Wikidata → MusicBrainz → IMSLP → Open Opus |
| **Struttura** | Movimenti numerati; quello corrente evidenziato; click → play del brano corrispondente nell'album corrente, se presente | MusicBrainz `parts` → Wikidata `P527` → IMSLP `Movements Header` → tracce dell'album Spotify con lo stesso prefisso opera |
| **Scheda** | Prima esecuzione (data, luogo), dedicatario, organico, durata media, genere, parte di (ciclo) | Wikidata → IMSLP |
| **Storia dell'opera** | Riassunto più sezioni espandibili della voce Wikipedia | Wikipedia it → en (badge "EN") |
| **Il compositore** | Ritratto, date, luoghi, epoca, riassunto, "Leggi biografia completa" (sezione "Biografia") | Wikipedia + Wikidata + Open Opus (epoca, ritratto) |
| **Opere correlate** | Vedi §7 | Wikidata, Open Opus, MusicBrainz |
| **Partitura** | Link "Partitura su IMSLP ↗" | Wikidata `P839` / MusicBrainz url-rel |
| **Fonti** | Elenco delle fonti con link e licenza (CC BY-SA per Wikipedia) | — |

Degradazione: se l'opera non è riconosciuta, il pannello mostra solo il compositore (se riconosciuto) e il pulsante "Cerca opera…". Se nemmeno il compositore è riconosciuto, appare uno stato vuoto con "Non sembra musica classica — cerca manualmente".

### 5.4 Correzione abbinamento
- Il menu "Correggi abbinamento" mostra i top-5 candidati con punteggio e un campo di ricerca libera (Wikidata `wbsearchentities` filtrato sulle opere del compositore).
- La scelta viene salvata come override locale, con chiave `spotifyAlbumId + prefissoOpera` (vale per tutte le tracce di quell'opera nell'album). Si salvano solo **ID**, nessun metadato Spotify.

---

## 6. Pipeline di matching brano → opera (cuore del sistema)

### 6.1 Input (dal player state, solo in memoria)
```ts
type TrackCtx = {
  trackId: string; uri: string; name: string;
  artists: { id: string; name: string }[];
  albumId: string; albumName: string;
  durationMs: number; trackNumber?: number;
}
```

### 6.2 Fasi
1. **Parse del titolo** (`parse.ts`, funzione pura)
   - Split opera/movimento sul primo `": "` non racchiuso tra virgolette (convenzione del Classical Metadata Style Guide, usata anche da Open Opus). Varianti: `" - "`, `" – "`.
   - Estrazione di:
     - **catalogo**, con regex per `Op.` (+`No.`), `BWV`, `K.`/`KV`, `D.`, `Hob.`, `RV`, `HWV`, `S.`/`LW`, `WoO`, `TrV`, `Sz.`/`BB`, `L.`, `FWV`, `M.`, `JB`, `B.`, `TH`, `Wq`/`H`, `SWV`, `BuxWV`, `MWV`, `ZWV`
     - **numero** (`No. 5`, `n. 5`, `Nr. 5`)
     - **tonalità**, in EN/IT/DE (`in C Minor`, `in do minore`, `c-Moll`)
     - **genere** (Symphony/Sinfonia/Sinfonie, Concerto, Sonata, Quartet…)
     - **soprannome** tra virgolette (`"Moonlight"`)
     - **movimento**: numero romano o arabo iniziale più indicazione di tempo
   - Output: `{ workTitle, catalog[], number?, key?, genre?, nickname?, movement?: { index?, title } }`.
2. **Riconoscimento del compositore**
   - Per ogni artista del brano: lookup nella cache compositori. Prima nella lista Open Opus completa (≈220 nomi, caricata una volta), poi su Wikidata (`wbsearchentities` più il filtro `P106 = Q36834` compositore, ordinato per numero di sitelinks).
   - Vince il primo artista che risulta compositore. In caso di ambiguità (es. un direttore che è anche compositore, come Bernstein) si preferisce quello il cui corpus contiene il catalogo estratto.
   - Output: `composerQid` (+ `openOpusId?`, `mbid?`).
3. **Generazione dei candidati opera** (in parallelo, con timeout di 4 s per fonte)
   - Wikidata SPARQL: opere con `P86 = composerQid` e `P528` uguale al catalogo normalizzato. Se il catalogo manca: opere con genere e numero compatibili.
   - MusicBrainz: `work?query=work:"{workTitle}" AND arid:{mbid}`.
   - Open Opus: `/work/list/composer/{id}/genre/all.json`, confronto sul titolo.
4. **Scoring** (pesi iniziali, da calibrare sul corpus §10)
   | Segnale | Peso |
   |---|---|
   | Catalogo normalizzato identico | +0.60 |
   | Genere e numero compatibili ("Symphony No. 5" ↔ "Sinfonia n. 5") | +0.25 |
   | Tonalità compatibile | +0.10 |
   | Soprannome compatibile | +0.10 |
   | Dice(tokens titolo) | ×0.30 |
   | Conflitto di catalogo (stesso sistema, numero diverso) | −1.00 |
   - Soglie: **≥ 0.60** abbinamento automatico; **0.35–0.60** "probabile", mostrato con badge e candidati; **< 0.35** solo compositore.
5. **Risoluzione all'hub**: si normalizza il vincitore a un `workQid`. MusicBrainz porta con sé il QID tramite url-rel; Open Opus no, quindi si fa un secondo passaggio Wikidata con compositore e titolo.
6. **Movimento**: l'indice viene dal parse. Se manca, si usa il match del titolo di movimento sui `parts`. Se manca anche quello, la posizione della traccia tra le tracce consecutive dell'album con lo stesso prefisso opera.
7. **Arricchimento**: fetch parallelo di tutte le sezioni §5.3, ciascuna indipendente. Una fonte in errore non blocca le altre.

### 6.3 Ottimizzazioni
- **Cache per album**: in un album di classica molte tracce condividono lo stesso prefisso opera. Si risolve una sola volta la chiave `albumId + workTitle normalizzato`.
- **Prefetch**: alla partenza di una traccia si risolve anche la traccia successiva in coda.
- Il budget di latenza (§10) vale per il primo paint del pannello, cioè header più struttura. Le sezioni testuali arrivano in streaming.

### 6.4 Output
```ts
type ResolvedTrack = {
  confidence: 'certain' | 'probable' | 'composer-only' | 'none';
  composer?: Composer;
  work?: Work;
  movementIndex?: number;
  candidates?: WorkCandidate[];   // solo se 'probable'
  sources: SourceRef[];
}
type Composer = { qid: string; name: string; birth?: string; death?: string;
  epoch?: string; portraitUrl?: string; summary?: string; wikiUrl?: string };
type Work = { qid: string; title: string; catalog?: string; key?: string;
  composed?: string; genre?: string; instrumentation?: string;
  premiere?: { date?: string; place?: string }; dedicatee?: string[];
  avgDurationMin?: number; partOf?: { qid: string; title: string };
  movements: { index: number; title: string }[];
  historySummary?: string; historySections?: { heading: string; text: string }[];
  imslpUrl?: string; lang: 'it' | 'en' };
type SourceRef = { name: string; url: string; license: string };
```

---

## 7. Opere correlate

Quattro gruppi, ciascuno con al massimo 6 elementi e mostrato solo se non vuoto:
1. **Dello stesso ciclo**: fratelli via Wikidata `P361` "parte di" o `P179` "serie" (es. gli altri quartetti "Razumovsky").
2. **Dello stesso autore, stesso genere**: Open Opus `/work/list/composer/{id}/genre/{genre}.json`, prima i `recommended`, poi i `popular`. Fallback: Wikidata con `P86` e `P136`.
3. **Derivazioni e arrangiamenti**: MusicBrainz rel. `arrangement` / `based on` / `orchestration`, **filtrate** alle opere il cui compositore ha un item Wikidata (senza filtro escono mashup e trailer, verificato sulla Quinta di Beethoven).
4. **Contemporanei**: 3 compositori della stessa epoca Open Opus, ciascuno con la sua opera "popular" più rappresentativa.

Azione su un elemento: "Cerca su Spotify" → `GET /search?type=track&q={compositore} {titolo}&limit=10`. Si mostra la lista e l'utente sceglie. Nessun autoplay del primo risultato: in classica il primo risultato è spesso un movimento o un arrangiamento sbagliato.

---

## 8. Riproduzione

### 8.1 Modalità integrata (Web Playback SDK)
- Si carica `https://sdk.scdn.co/spotify-player.js` e si crea `new Spotify.Player({ name: 'Muti', getOAuthToken })`.
- Su `ready` si salva `device_id` e si chiama `PUT /me/player` con `{device_ids:[id], play:false}` per diventare il device attivo.
- Stato del brano: evento `player_state_changed` (in locale, senza polling).
- Errori SDK (`initialization_error`, `authentication_error`, `account_error`, `playback_error`) → toast più una proposta di passare a Connect.

### 8.2 Modalità Connect
- Selettore device (`GET /me/player/devices`): app Spotify desktop o mobile, smart speaker.
- Stato: polling di `GET /me/player/currently-playing`, ogni 5 s in play, ogni 15 s in pausa, sospeso a finestra nascosta. Backoff su `429` rispettando `Retry-After`.
- Progress bar interpolata in locale tra un poll e l'altro.

### 8.3 Comandi (identici nelle due modalità)
`PUT /me/player/play?device_id=` (con `context_uri` + `offset` per suonare "dal movimento II"), `/pause`, `/next`, `/previous`, `/seek`, `/volume`, `POST /me/player/queue`.

### 8.4 Gapless e movimenti
In classica le pause tra movimenti contano. Per suonare un'opera intera si usa sempre il **contesto album** con `offset`, così Spotify gestisce il crossfade e il gapless come da impostazioni dell'utente. Non si costruiscono code traccia per traccia.

---

## 9. Autenticazione

### 9.1 Modello BYO Client ID
- Il Client ID viene salvato nelle impostazioni ed è modificabile.
- La documentazione in-app spiega i limiti (5 utenti, Premium del proprietario).
- *Opzione futura*: se il progetto diventa un'organizzazione con i numeri richiesti, si passa a un Client ID unico. Nessun cambio di codice oltre al default.

### 9.2 Flusso PKCE
1. Il main genera `code_verifier` e `code_challenge` (S256) e apre un server HTTP sulla porta effimera `127.0.0.1:0`.
2. `shell.openExternal(https://accounts.spotify.com/authorize?...&redirect_uri=http://127.0.0.1:{porta}/callback&state=...)`.
3. Callback → verifica di `state` → scambio del code → chiusura del server.
4. Token cifrati con `safeStorage` in `userData/auth.bin`. Refresh automatico 60 s prima della scadenza. I refresh token possono ruotare: si salva sempre l'ultimo.
- **Scope**: `streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private user-library-read user-library-modify`.

---

## 10. Requisiti non funzionali e criteri di accettazione

| Requisito | Target |
|---|---|
| Primo paint del pannello (header + struttura), cache fredda | ≤ 2.5 s p75 |
| Primo paint del pannello, cache calda | ≤ 150 ms |
| Accuratezza a livello opera sul corpus di test | ≥ 85 % "certain" corretti, ≤ 3 % "certain" sbagliati |
| Accuratezza compositore | ≥ 97 % |
| Rate limit MusicBrainz | mai > 1 req/s (coda per host) |
| Memoria a riposo | < 400 MB RSS |
| Accessibilità | Navigazione da tastiera completa, spazio = play/pausa, contrasto AA, `aria-live` per il cambio brano |
| i18n | UI in it/en; contenuti in lingua UI → fallback en con badge |

**Corpus di test** (`test/fixtures/titles.json`): 60–80 titoli reali trascritti a mano da album classici Spotify, con l'esito atteso (`workQid`, `movementIndex`). Deve coprire Bach BWV, Mozart K., Schubert D., Vivaldi RV con soprannomi, Haydn Hob., opera lirica con arie, Lieder, titoli in italiano e tedesco, compilation "Best of", un direttore-compositore, e brani non classici (controllo negativo). Test con `node:test` su `parse.ts` e su `resolve.ts` con risposte HTTP registrate.

---

## 11. Piano di sviluppo

| Fase | Contenuto | Uscita / gate |
|---|---|---|
| **0 — Spike DRM** (2–3 gg) | castLabs ECS v44 + SDK minimale su macOS: play di 3 brani per 10 min ciascuno, seek, cambio traccia. Test con firma VMP di sviluppo **e** con firma EVS. | **Gate:** stabile → modalità integrata primaria. Instabile → Connect primaria e integrata "sperimentale". |
| **1 — MVP** (1–2 sett.) | Onboarding + PKCE, player (entrambe le modalità), libreria e ricerca, `parse.ts` + corpus, risoluzione compositore e opera via Wikidata, pannello Header/Scheda/Compositore | Corpus ≥ 70 %, playback end-to-end |
| **2 — Profondità** (2 sett.) | MusicBrainz (movimenti, derivazioni), IMSLP, Storia a sezioni, Correlate, correzione abbinamento, cache per album e prefetch | Corpus ≥ 85 %, tutte le sezioni §5.3 |
| **3 — Rifinitura** (1 sett.) | i18n, accessibilità, gestione errori e offline, packaging (electron-builder con ECS, firma EVS, codesign e notarizzazione macOS) | Build firmata installabile |

---

## 12. Rischi

| Rischio | Prob. | Impatto | Mitigazione |
|---|---|---|---|
| Playback SDK instabile in ECS (licenza 500, skip) | Alta | Alto | Spike in Fase 0; modalità Connect con lo stesso codice di controllo |
| Spotify restringe ancora la Dev Mode (già due strette: 2024, 2026) | Media | Alto | Dipendere solo da endpoint Player, `GET /tracks/{id}`, search e `/me`; isolare il client in `spotify.ts` |
| Costi e condizioni castLabs EVS per la firma di produzione | Media | Medio | Verificare prima della Fase 3; senza EVS si distribuisce solo in modalità Connect |
| Matching errato su titoli atipici (compilation, arie, trascrizioni) | Alta | Medio | Soglie conservative, badge "probabile", correzione manuale persistente |
| Open Opus non più mantenuto | Media | Basso | Opzionale; fallback Wikidata per epoche e correlate |
| Copertura Wikidata e Wikipedia it scarsa per opere minori | Media | Basso | Fallback en; IMSLP per i campi strutturati |
| Richiesta futura di funzioni LLM (es. guida all'ascolto) | — | Legale | La policy vieta di far elaborare contenuti Spotify dall'AI. Eventuale LLM solo su testi di fonti aperte già risolti, previa verifica legale |

---

## 13. Domande aperte

1. **Distribuzione**: uso personale (≤ 5 utenti) oppure open source con BYO Client ID per chiunque? Cambia quanto investire nell'onboarding.
2. **Modalità primaria**: si accetta di decidere dopo lo spike DRM, o si parte subito solo con Connect (zero rischio DRM, ma serve l'app Spotify aperta)?
3. **Piattaforme**: solo macOS in v1?
4. **Lingue dei contenuti**: solo it + en, o anche de/fr (molte voci sulle opere sono più ricche in tedesco)?
5. **Scrobbling/cronologia locale** delle opere ascoltate ("hai ascoltato 12 sinfonie di Haydn su 104"): utile per v2? Andrebbe salvato solo il `workQid` (dato aperto), mai i metadati Spotify.

---

## 14. Riferimenti

- Spotify — [Migration guide feb 2026](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide) · [Update on Developer Access](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security) · [Redirect URI](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri) · [Security requirements 2025](https://developer.spotify.com/blog/2025-02-12-increasing-the-security-requirements-for-integrating-with-spotify) · [Developer Policy](https://developer.spotify.com/policy) · [TechCrunch](https://techcrunch.com/2026/02/06/spotify-changes-developer-mode-api-to-require-premium-accounts-limits-test-users/)
- Electron DRM — [castLabs electron-releases](https://github.com/castlabs/electron-releases) · [Web Playback SDK feat. Electron](https://alexanderallen.medium.com/spotify-web-playback-sdk-feat-electron-50ff930d5c74) · [Songs skipping su SDK](https://alexanderallen.medium.com/songs-skipping-on-spotify-web-playback-sdk-55584541ff29) · [Thread DRM community](https://community.spotify.com/t5/Spotify-for-Developers/Need-a-solution-to-this-DRM-problem-in-Web-Playback-SDK/td-p/6487515)
- Dati — [Open Opus API](https://github.com/openopus-org/openopus_api) · [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API) · [IMSLP API](https://imslp.org/wiki/IMSLP:API) · Wikidata SPARQL `query.wikidata.org` · Wikipedia REST `/api/rest_v1`

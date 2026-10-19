// Tipi condivisi tra main, preload e renderer (SPEC §6.1, §6.4).

export type Lang = 'it' | 'en'

/** Contesto del brano. Vive solo in memoria: la policy Spotify vieta di conservarlo. */
export type TrackCtx = {
  trackId: string
  uri: string
  name: string
  artists: { id: string; name: string }[]
  albumId: string
  albumName: string
  durationMs: number
  trackNumber?: number
}

export type SourceRef = { name: string; url: string; license: string }

export type Composer = {
  qid: string
  name: string
  birth?: string
  death?: string
  epoch?: string
  portraitUrl?: string
  portraitCredit?: string
  wikiUrl?: string
  openOpusId?: string
  mbid?: string
}

export type Work = {
  qid?: string
  mbid?: string
  title: string
  catalog?: string
  key?: string
  composed?: string
  genre?: string
  instrumentation?: string
  premiere?: { date?: string; place?: string }
  dedicatee?: string[]
  avgDurationMin?: number
  partOf?: { qid: string; title: string }
  movements: { index: number; title: string }[]
  imslpUrl?: string
  lang: Lang
}

export type WorkCandidate = {
  qid?: string
  mbid?: string
  title: string
  catalog?: string
  score: number
  source: 'wikidata' | 'musicbrainz' | 'openopus'
}

export type ResolvedTrack = {
  confidence: 'certain' | 'probable' | 'composer-only' | 'none'
  composer?: Composer
  work?: Work
  movementIndex?: number
  candidates?: WorkCandidate[] // migliori alternative, per "Correggi abbinamento"
  overrideKey: string // chiave dell'override manuale (albumId + opera)
  sources: SourceRef[]
}

export type TextSection = { heading: string; text: string }
export type TextBlock = {
  summary?: string
  sections: TextSection[]
  wikiUrl?: string
  lang: Lang // lingua effettiva (può essere il ripiego 'en')
  thumbnail?: string
  sources: SourceRef[]
}

export type RelatedItem = { title: string; composer?: string; query: string }
export type RelatedGroup = { kind: 'cycle' | 'genre' | 'derived' | 'contemporary'; items: RelatedItem[] }

export type WorkRef = {
  qid?: string
  mbid?: string
  title: string
  genre?: string
  partOfQid?: string
  composerQid?: string
  composerName?: string
  openOpusId?: string
  epoch?: string
}

export type Settings = {
  clientId: string
  /** Email o URL per il User-Agent verso Wikimedia e MusicBrainz (richiesto dalle loro policy). */
  contact: string
  lang: Lang
  panelWidth: number
  panelCollapsed: boolean
  deviceId?: string
}

export type TimelineComposer = { id: string; name: string; fullName: string; birth?: number; death?: number; epoch: string }
export type TimelineWork = { title: string; year: number }

export type AuthStatus = { loggedIn: boolean; clientId: string }

export interface MutiApi {
  auth: {
    status(): Promise<AuthStatus>
    login(clientId: string): Promise<AuthStatus>
    logout(): Promise<void>
    getToken(): Promise<string>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
  }
  metadata: {
    resolve(track: TrackCtx, lang: Lang): Promise<ResolvedTrack>
    prefetch(track: TrackCtx, lang: Lang): Promise<void>
    workText(work: WorkRef, lang: Lang): Promise<TextBlock>
    composerText(qid: string, lang: Lang): Promise<TextBlock>
    related(work: WorkRef, lang: Lang): Promise<RelatedGroup[]>
    search(query: string, composerQid: string | undefined, lang: Lang): Promise<WorkCandidate[]>
    setOverride(overrideKey: string, qid: string | null): Promise<void>
    timeline(): Promise<TimelineComposer[]>
    composerWorks(fullName: string, birth: number | undefined, lang: Lang): Promise<TimelineWork[]>
  }
  app: {
    openExternal(url: string): Promise<void>
  }
}

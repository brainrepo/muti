// resolve.ts con risposte HTTP registrate: la cache su disco È la registrazione.
// Riregistrare: MUTI_RECORD=1 MUTI_CONTACT="tua@email" npm test  (usa la rete)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { setCacheDir } from '../src/main/metadata/cache.ts'
import { net } from '../src/main/metadata/http.ts'
import { resolveTrack } from '../src/main/metadata/resolve.ts'

setCacheDir(fileURLToPath(new URL('./fixtures/http', import.meta.url)))
if (!process.env.MUTI_RECORD) {
  net.ttlOverride = Infinity
  net.fetch = () => Promise.reject(new Error('rete non disponibile nei test: registrazione mancante'))
}

const T = (name: string, artists: string[]) => ({
  trackId: 't', uri: 'u', name, artists: artists.map((n, i) => ({ id: String(i), name: n })),
  albumId: 'alb', albumName: 'Album', durationMs: 1
})

const cases = [
  { title: 'Symphony No. 5 in C Minor, Op. 67: II. Andante con moto', artists: ['Ludwig van Beethoven', 'Wiener Philharmoniker', 'Carlos Kleiber'], qid: 'Q188709', mv: 2 },
  { title: 'Brandenburg Concerto No. 3 in G Major, BWV 1048: I. Allegro', artists: ['Johann Sebastian Bach', 'Academy of St Martin in the Fields'], qid: 'Q223147', mv: 1 },
  { title: 'Symphony No. 5 in C-Sharp Minor: IV. Adagietto. Sehr langsam', artists: ['Gustav Mahler', 'Leonard Bernstein', 'New York Philharmonic'], qid: 'Q240240', mv: 4 }
]
for (const c of cases) {
  test(`resolve: ${c.title}`, async () => {
    const r = await resolveTrack(T(c.title, c.artists), 'it')
    assert.equal(r.confidence, 'certain')
    assert.equal(r.work?.qid, c.qid)
    assert.equal(r.movementIndex, c.mv)
  })
}
test('resolve: brano non classico', async () => {
  const r = await resolveTrack(T('Bohemian Rhapsody - Remastered 2011', ['Queen']), 'it')
  assert.equal(r.work, undefined)
})

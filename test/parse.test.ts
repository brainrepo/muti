import { test } from 'node:test'
import assert from 'node:assert/strict'
import corpus from './fixtures/titles.json' with { type: 'json' }
import { catalogRelation, dice, keyCompat, normTokens, parseTitle, parseTrack } from '../src/main/metadata/parse.ts'

type Expect = {
  catalog?: string[]
  number?: number
  key?: string
  genre?: string
  nickname?: string
  movement?: { index?: number; title: string }
}

const catStr = (c: { system: string; number: string; sub?: string }) =>
  `${c.system} ${c.number}${c.sub ? '/' + c.sub : ''}`

for (const { title, parse: want } of corpus as { title: string; parse: Expect }[]) {
  test(`parse: ${title}`, () => {
    const p = parseTitle(title)
    if (want.catalog) assert.deepEqual(p.catalog.map(catStr), want.catalog)
    for (const k of ['number', 'key', 'genre', 'nickname'] as const)
      if (k in want) assert.equal(p[k], want[k], k)
    if (want.movement) assert.deepEqual(p.movement, want.movement)
  })
}

test('parseTrack: ripiego sul titolo album per tracce con solo il movimento', () => {
  const p = parseTrack('II. Andante con moto', 'Beethoven: Symphony No. 5 in C Minor, Op. 67')
  assert.deepEqual(p.catalog.map(catStr), ['Op 67'])
  assert.deepEqual(p.movement, { index: 2, title: 'Andante con moto' })
})

test('normTokens: stesse parole in lingue diverse', () => {
  assert.equal(dice(normTokens('Sinfonia n. 5'), normTokens('Symphony No. 5')), 1)
  assert.equal(dice(normTokens('Klavierkonzert Nr. 5'), normTokens('Piano Concerto No. 5')), 1)
  assert.ok(dice(normTokens('Symphony No. 5'), normTokens('Symphony No. 7')) < 1)
})

test('catalogRelation', () => {
  const op67 = [{ system: 'Op', number: '67' }]
  assert.equal(catalogRelation(op67, [{ system: 'Op', number: '67' }]), 'match')
  assert.equal(catalogRelation(op67, [{ system: 'Op', number: '125' }]), 'conflict')
  assert.equal(catalogRelation(op67, [{ system: 'BWV', number: '67' }]), 'none')
  assert.equal(catalogRelation([{ system: 'Op', number: '27', sub: '2' }], [{ system: 'Op', number: '27', sub: '1' }]), 'conflict')
})

test('keyCompat', () => {
  assert.ok(keyCompat('D minor', 'D minor'))
  assert.ok(keyCompat('D', 'D major'))
  assert.ok(!keyCompat('D minor', 'D major'))
  assert.ok(!keyCompat('C minor', undefined))
})

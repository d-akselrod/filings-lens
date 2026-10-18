import { expect, test, vi } from 'vitest';
import { DEFAULT_SETTINGS, type ChunkView, type SearchResponse, type SearchSettings } from '../../core/types';
import { ClientError, type embedQuestion, type streamAnswer } from '../api/client';
import type { BuiltinStatus, KeysState } from './keys';
import { createSession, type SessionDeps } from './session';

const CORPUS = 'v/corpus.1a2b3c4d.json';

const chunk = (id: number): ChunkView => ({
  id, key: `acc:1A:${id}`, filingId: 0, item: '1A', itemTitle: 'Risk Factors', ordinal: id, text: `Passage ${id} says revenue was $10.2 billion.`,
  tokenCount: 10, ticker: 'NVDA', companyName: 'NVIDIA', fiscalYear: 2025, form: '10-K', url: 'https://www.sec.gov/x', accession: 'acc',
});

const response = (ids: number[]): SearchResponse => ({
  results: ids.map((chunkId, i) => ({ chunkId, finalRank: i + 1, fused: { rank: i + 1, score: 1 / (60 + i + 1) } })),
  usedMode: 'hybrid', notes: [], timings: { vectorMs: 1, keywordMs: 1, fuseMs: 0, rerankMs: 0 },
});

function fakeKeys(builtin: BuiltinStatus = 'available', byokKey: string | null = null): KeysState {
  const keys: KeysState = {
    builtin, byokKey, remember: false,
    setByok: () => {}, clearByok: () => {},
    markBuiltin: s => { keys.builtin = s; },
  };
  return keys;
}

function setup(o: {
  ids?: number[]; keys?: KeysState; settings?: () => SearchSettings;
  embed?: typeof embedQuestion; stream?: typeof streamAnswer;
} = {}) {
  const keys = o.keys ?? fakeKeys();
  const search = vi.fn(async (_q: { text: string; vector: Float32Array | null }, _s: SearchSettings) => response(o.ids ?? Array.from({ length: 12 }, (_, i) => i)));
  const getChunks = vi.fn(async (ids: number[]) => ids.map(chunk));
  const embed = vi.fn(o.embed ?? (async () => new Float32Array(768).fill(0.5)));
  const stream = vi.fn(o.stream ?? (async function* () {
    yield 'Revenue was $10.2 billion [1]. ';
    yield 'It grew [2].';
  }));
  let t = 0;
  const deps: SessionDeps = {
    engine: { search, getChunks }, embed: embed as typeof embedQuestion, stream: stream as typeof streamAnswer,
    keys: () => keys, settings: o.settings ?? (() => DEFAULT_SETTINGS), corpus: () => CORPUS, now: () => (t += 100),
  };
  return { session: createSession(deps), search, getChunks, embed, stream, keys };
}

const last = (s: ReturnType<typeof setup>['session']) => s.getState().turns.at(-1)!;

test('ask embeds the question, searches with its vector, and streams a cited answer from the first 8 passages', async () => {
  const { session, embed, search, stream } = setup();
  await session.getState().ask('  Q  ');
  expect(embed).toHaveBeenCalledOnce();
  expect(embed.mock.calls[0]).toEqual(['Q', { kind: 'builtin' }]);
  expect(search.mock.calls[0]![0]).toEqual({ text: 'Q', vector: new Float32Array(768).fill(0.5) });
  const request = stream.mock.calls[0]![0];
  expect(request).toMatchObject({ question: 'Q', chunkIds: [0, 1, 2, 3, 4, 5, 6, 7], model: 'fast', corpus: CORPUS, src: { kind: 'builtin' } });
  expect(request.passages.map(p => p.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(request.passages[0]).toEqual({ n: 1, ticker: 'NVDA', fiscalYear: 2025, item: '1A', itemTitle: 'Risk Factors', text: chunk(0).text });

  const turn = last(session);
  expect(turn).toMatchObject({ question: 'Q', retrievalText: 'Q', vectorSource: 'api', embedMs: 100, stale: false });
  expect(turn.results).toHaveLength(12);
  expect(turn.passages.map(p => p.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect(turn.answer).toMatchObject({ status: 'done', text: 'Revenue was $10.2 billion [1]. It grew [2].', model: 'fast', passageIds: [0, 1, 2, 3, 4, 5, 6, 7] });
  expect(turn.answer.checks.map(c => [c.text, c.unsupportedNumbers])).toEqual([
    ['Revenue was $10.2 billion [1].', []], ['It grew [2].', []],
  ]);
  expect(turn.answer.ms).toBeGreaterThan(0);
  expect(session.getState().busy).toBe(false);
});

test('blank or oversized questions are ignored', async () => {
  const { session, embed } = setup();
  await session.getState().ask('   ');
  await session.getState().ask('x'.repeat(501));
  expect(session.getState().turns).toHaveLength(0);
  expect(embed).not.toHaveBeenCalled();
});

test('rerun searches again under new settings without calling embed or stream, and marks the answer stale (Review Focus #3)', async () => {
  let settings: SearchSettings = DEFAULT_SETTINGS;
  const { session, embed, search, stream } = setup({ settings: () => settings });
  await session.getState().ask('Q');
  settings = { ...DEFAULT_SETTINGS, mode: 'keyword', contextPassages: 3 };
  search.mockResolvedValueOnce(response([9, 8, 7, 6]));
  await session.getState().rerun();
  expect(search).toHaveBeenCalledTimes(2);
  expect(search.mock.calls[1]).toEqual([{ text: 'Q', vector: new Float32Array(768).fill(0.5) }, settings]);
  expect(embed).toHaveBeenCalledOnce();
  expect(stream).toHaveBeenCalledOnce();
  const turn = last(session);
  expect(turn).toMatchObject({ stale: true, settings });
  expect(turn.passages.map(p => p.id)).toEqual([9, 8, 7]);
  // the answer keeps the passages it was written from, so its [n] still point at the right sources
  expect(turn.answer.passageIds).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
});

test('regenerate re-streams the last turn from its current passages and clears stale', async () => {
  let settings: SearchSettings = DEFAULT_SETTINGS;
  const { session, stream, search } = setup({ settings: () => settings });
  await session.getState().ask('Q');
  settings = { ...DEFAULT_SETTINGS, contextPassages: 3 };
  search.mockResolvedValueOnce(response([9, 8, 7, 6]));
  await session.getState().rerun();
  session.getState().setModel('deep');
  await session.getState().regenerate();
  expect(stream).toHaveBeenCalledTimes(2);
  expect(stream.mock.calls[1]![0]).toMatchObject({ chunkIds: [9, 8, 7], model: 'deep' });
  expect(last(session)).toMatchObject({ stale: false, answer: { status: 'done', model: 'deep', passageIds: [9, 8, 7] } });
});

test('a follow-up searches with both questions and sends the previous question', async () => {
  const { session, embed, stream } = setup();
  await session.getState().ask('Q1');
  await session.getState().ask('Q2', { followUp: true });
  expect(embed.mock.calls[1]![0]).toBe('Q1 Q2');
  expect(last(session)).toMatchObject({ question: 'Q2', retrievalText: 'Q1 Q2', previousQuestion: 'Q1' });
  expect(stream.mock.calls[1]![0]).toMatchObject({ question: 'Q2', previousQuestion: 'Q1' });
  await session.getState().ask('Q3');
  expect(last(session).retrievalText).toBe('Q3');
  expect(last(session).previousQuestion).toBeUndefined();
});

test('a restricted region: the key becomes restricted, search runs without a vector, and the answer is skipped', async () => {
  const { session, search, stream, keys } = setup({
    embed: async () => { throw new ClientError('restricted_region', 'no'); },
  });
  await session.getState().ask('Q');
  expect(keys.builtin).toBe('restricted');
  expect(search.mock.calls[0]![0]).toEqual({ text: 'Q', vector: null });
  expect(last(session)).toMatchObject({ vectorSource: 'none', answer: { status: 'skipped', error: 'restricted_region' } });
  expect(stream).not.toHaveBeenCalled();
});

test('a used-up embedding quota only costs the vector: search runs keyword-only and the answer still streams', async () => {
  for (const code of ['upstream_quota', 'global_budget'] as const) {
    const { session, search, stream, keys } = setup({ embed: async () => { throw new ClientError(code, 'quota'); } });
    await session.getState().ask('Q');
    expect(keys.builtin).toBe('available');
    expect(search.mock.calls[0]![0].vector).toBeNull();
    expect(stream).toHaveBeenCalledOnce();
    expect(last(session)).toMatchObject({ vectorSource: 'none', answer: { status: 'done' } });
  }
  const capped = setup({ embed: async () => { throw new ClientError('visitor_cap', 'cap'); } });
  await capped.session.getState().ask('Q');
  expect(capped.keys.builtin).toBe('exhausted');
  expect(capped.stream).not.toHaveBeenCalled();
});

test('with no usable key, nothing is embedded and the answer is skipped as no_key', async () => {
  const { session, embed, stream } = setup({ keys: fakeKeys('missing') });
  await session.getState().ask('Q');
  expect(embed).not.toHaveBeenCalled();
  expect(stream).not.toHaveBeenCalled();
  expect(last(session)).toMatchObject({ vector: null, vectorSource: 'none', answer: { status: 'skipped', error: 'no_key' } });
});

test('your own key is used for both calls when set', async () => {
  const { session, embed, stream } = setup({ keys: fakeKeys('restricted', 'my-key-0123456789abcdef') });
  await session.getState().ask('Q');
  expect(embed.mock.calls[0]![1]).toEqual({ kind: 'byok', key: 'my-key-0123456789abcdef' });
  expect(stream.mock.calls[0]![0].src).toEqual({ kind: 'byok', key: 'my-key-0123456789abcdef' });
});

test('a sample question uses its precomputed vector and never calls embed', async () => {
  const sample = new Float32Array(768).fill(0.25);
  const { session, embed, search } = setup({ keys: fakeKeys('restricted') });
  await session.getState().ask('How does NVIDIA describe export controls?', { sampleVector: sample });
  expect(embed).not.toHaveBeenCalled();
  expect(search.mock.calls[0]![0].vector).toBe(sample);
  expect(last(session)).toMatchObject({ vectorSource: 'sample', answer: { status: 'skipped', error: 'restricted_region' } });
});

test('an interrupted stream keeps its text, checks only finished sentences, and marks the key exhausted (Review Focus #2)', async () => {
  const { session, keys } = setup({
    stream: async function* () {
      yield 'Revenue was $10.2 billion [1]. It gre';
      throw new ClientError('upstream_quota', 'quota');
    },
  });
  await session.getState().ask('Q');
  expect(last(session).answer).toMatchObject({ status: 'interrupted', error: 'upstream_quota', text: 'Revenue was $10.2 billion [1]. It gre' });
  expect(last(session).answer.checks).toHaveLength(1);
  expect(keys.builtin).toBe('exhausted');
});

test('an error before any text is an error; a busy free tier does not mark the key exhausted', async () => {
  const { session, keys } = setup({
    stream: async function* () {
      throw new ClientError('upstream_busy', 'busy');
    },
  });
  await session.getState().ask('Q');
  expect(last(session).answer).toMatchObject({ status: 'error', error: 'upstream_busy', text: '' });
  expect(keys.builtin).toBe('available');
});

test('no matching passages skips the answer (Review Focus #4)', async () => {
  const { session, stream } = setup({ ids: [] });
  await session.getState().ask('Q');
  expect(last(session)).toMatchObject({ results: [], passages: [], answer: { status: 'skipped' } });
  expect(last(session).answer.error).toBeUndefined();
  expect(stream).not.toHaveBeenCalled();
});

test('settings changed while a question is being searched are applied before answering', async () => {
  const changed = { ...DEFAULT_SETTINGS, contextPassages: 3 };
  let settings: SearchSettings = DEFAULT_SETTINGS;
  const { session, search, stream } = setup({ settings: () => settings });
  search.mockImplementationOnce(async () => {
    settings = changed;
    await session.getState().rerun();
    return response(Array.from({ length: 12 }, (_, i) => i));
  });
  await session.getState().ask('Q');
  expect(search).toHaveBeenCalledTimes(2);
  expect(last(session).settings).toBe(changed);
  expect(stream.mock.calls[0]![0].chunkIds).toEqual([0, 1, 2]);
});

test('clear removes every turn', async () => {
  const { session } = setup();
  await session.getState().ask('Q');
  session.getState().clear();
  expect(session.getState().turns).toEqual([]);
});

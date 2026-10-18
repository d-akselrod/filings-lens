import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { checkSentence, splitSentences, type SentenceCheck } from '../../core/citations';
import type { ModelChoice } from '../../core/gemini';
import { MAX_QUESTION_CHARS, type PromptPassage } from '../../core/prompt';
import type { ChunkView, SearchResponse, SearchSettings } from '../../core/types';
import type { WorkerApi } from '../../worker/protocol';
import { builtinStatusFor, ClientError, embedQuestion, streamAnswer, type ClientErrorCode, type KeySource } from '../api/client';
import { getEngine } from '../engine';
import { activeSource, useKeys, type KeysState } from './keys';
import { useSettings } from './settings';

export interface AnswerState {
  text: string;
  status: 'idle' | 'streaming' | 'done' | 'interrupted' | 'error' | 'skipped';
  error?: ClientErrorCode;
  checks: SentenceCheck[];
  model: ModelChoice;
  ms?: number;
  /** Chunk ids sent to the model: citation [n] is passageIds[n - 1], even after a re-search changes the turn's passages. */
  passageIds: number[];
}

export interface Turn {
  id: string;
  question: string;
  retrievalText: string;
  previousQuestion?: string;
  vector: Float32Array | null;
  vectorSource: 'api' | 'sample' | 'none';
  embedMs?: number;
  search: SearchResponse | null;
  results: ChunkView[];
  passages: ChunkView[];
  settings: SearchSettings;
  stale: boolean;
  answer: AnswerState;
}

export interface SessionState {
  turns: Turn[];
  model: ModelChoice;
  busy: boolean;
  ask(question: string, o?: { sampleVector?: Float32Array; followUp?: boolean }): Promise<void>;
  rerun(): Promise<void>;
  regenerate(): Promise<void>;
  setModel(m: ModelChoice): void;
  clear(): void;
}

export interface SessionDeps {
  engine: Pick<WorkerApi, 'search' | 'getChunks'>;
  embed: typeof embedQuestion;
  stream: typeof streamAnswer;
  keys: () => KeysState;
  settings: () => SearchSettings;
  /** The loaded manifest's corpus file; built-in answers are refused for any other data version. */
  corpus: () => string;
  now?: () => number;
}

/**
 * Embeddings (OpenRouter) and answers (Gemini) use different services, quotas and keys, so an embedding failure says
 * nothing about answers — except the two refusals the API applies to both: the region rule and the per-visitor cap.
 */
const SHARED_REFUSALS: ReadonlySet<ClientErrorCode> = new Set(['restricted_region', 'visitor_cap']);

export function createSession(d: SessionDeps): UseBoundStore<StoreApi<SessionState>> {
  const now = d.now ?? (() => performance.now());
  let lastId = 0;
  let searchSeq = 0;

  return create<SessionState>()((set, get) => {
    const turnById = (id: string) => get().turns.find(t => t.id === id);
    const patch = (id: string, p: Partial<Turn>) => set(s => ({ turns: s.turns.map(t => (t.id === id ? { ...t, ...p } : t)) }));
    const patchAnswer = (id: string, p: Partial<AnswerState>) =>
      set(s => ({ turns: s.turns.map(t => (t.id === id ? { ...t, answer: { ...t.answer, ...p } } : t)) }));

    const noteBuiltin = (code: ClientErrorCode) => {
      const status = builtinStatusFor(code);
      if (status) d.keys().markBuiltin(status);
    };

    const keySource = (): KeySource | null => {
      const keys = d.keys();
      const source = activeSource(keys);
      if (source === 'byok') return { kind: 'byok', key: keys.byokKey! };
      return source === 'builtin' ? { kind: 'builtin' } : null;
    };

    /** Applies the results unless a newer search started meanwhile; returns whether they were applied. */
    async function search(id: string, text: string, vector: Float32Array | null, settings: SearchSettings): Promise<boolean> {
      const seq = ++searchSeq;
      const response = await d.engine.search({ text, vector }, settings);
      const results = await d.engine.getChunks(response.results.map(r => r.chunkId));
      if (seq !== searchSeq) return false;
      patch(id, { search: response, results, passages: results.slice(0, settings.contextPassages), settings });
      return true;
    }

    async function answer(id: string): Promise<void> {
      const turn = turnById(id);
      if (!turn) return;
      const model = get().model;
      const reset = { text: '', checks: [], model, error: undefined, ms: undefined, passageIds: [] };
      if (turn.passages.length === 0) {
        patchAnswer(id, { ...reset, status: 'skipped' });
        return;
      }
      const src = keySource();
      if (!src) {
        patchAnswer(id, { ...reset, status: 'skipped', error: d.keys().builtin === 'restricted' ? 'restricted_region' : 'no_key' });
        return;
      }

      const passages: PromptPassage[] = turn.passages.map((p, i) => ({
        n: i + 1, ticker: p.ticker, fiscalYear: p.fiscalYear, item: p.item, itemTitle: p.itemTitle, text: p.text,
      }));
      const evidence = new Map(passages.map(p => [p.n, p.text]));
      const passageIds = turn.passages.map(p => p.id);
      patchAnswer(id, { ...reset, status: 'streaming', passageIds });

      const started = now();
      let text = '';
      const checks: SentenceCheck[] = [];
      const checkFinished = (final: boolean) => {
        for (const sentence of splitSentences(text, final).complete.slice(checks.length)) checks.push(checkSentence(sentence, evidence));
      };
      try {
        for await (const delta of d.stream({
          question: turn.question, chunkIds: passageIds, passages, model, corpus: d.corpus(), previousQuestion: turn.previousQuestion, src,
        })) {
          text += delta;
          checkFinished(false);
          patchAnswer(id, { text, checks: [...checks] });
        }
        checkFinished(true);
        patchAnswer(id, { status: 'done', checks: [...checks], ms: now() - started });
      } catch (e) {
        const code: ClientErrorCode = e instanceof ClientError ? e.code : 'upstream_error';
        if (src.kind === 'builtin') noteBuiltin(code);
        patchAnswer(id, { status: text ? 'interrupted' : 'error', error: code, checks: [...checks], ms: now() - started });
      }
    }

    return {
      turns: [],
      model: 'fast',
      busy: false,

      async ask(question, o = {}) {
        const q = question.trim();
        if (!q || q.length > MAX_QUESTION_CHARS || get().busy) return;
        const previous = get().turns.at(-1);
        const followUp = Boolean(o.followUp && previous);
        const id = `t${++lastId}`;
        const retrievalText = followUp ? `${previous!.question} ${q}` : q;
        set(s => ({
          busy: true,
          turns: [...s.turns, {
            id, question: q, retrievalText, previousQuestion: followUp ? previous!.question : undefined,
            vector: null, vectorSource: 'none', search: null, results: [], passages: [], settings: d.settings(), stale: false,
            answer: { text: '', status: 'idle', checks: [], model: get().model, passageIds: [] },
          }],
        }));
        try {
          let vector: Float32Array | null = null;
          let vectorSource: Turn['vectorSource'] = 'none';
          let embedMs: number | undefined;
          if (o.sampleVector) {
            vector = o.sampleVector;
            vectorSource = 'sample';
          } else if (d.keys().builtin !== 'restricted') {
            const started = now();
            try {
              vector = await d.embed(retrievalText);
              vectorSource = 'api';
              embedMs = now() - started;
            } catch (e) {
              // Search still runs, keyword-only.
              if (e instanceof ClientError && SHARED_REFUSALS.has(e.code)) noteBuiltin(e.code);
            }
          }
          patch(id, { vector, vectorSource, embedMs });

          // Settings changed during the search are picked up here, since rerun() leaves a turn mid-search alone.
          let settings: SearchSettings;
          do {
            settings = d.settings();
            await search(id, retrievalText, vector, settings);
          } while (d.settings() !== settings);
          await answer(id);
        } finally {
          set({ busy: false });
        }
      },

      async rerun() {
        const turn = get().turns.at(-1);
        if (!turn?.search) return;
        if (!(await search(turn.id, turn.retrievalText, turn.vector, d.settings()))) return;
        const status = turnById(turn.id)?.answer.status;
        patch(turn.id, { stale: status === 'done' || status === 'interrupted' || status === 'streaming' });
      },

      async regenerate() {
        const turn = get().turns.at(-1);
        if (!turn || get().busy) return;
        set({ busy: true });
        patch(turn.id, { stale: false });
        try {
          await answer(turn.id);
        } finally {
          set({ busy: false });
        }
      },

      setModel: model => set({ model }),
      clear: () => set({ turns: [] }),
    };
  });
}

let corpusVersion = '';

/** Called by the App once the worker has loaded the manifest. */
export function setCorpusVersion(version: string): void {
  corpusVersion = version;
}

export const useSession: UseBoundStore<StoreApi<SessionState>> = createSession({
  engine: { search: (q, s) => getEngine().search(q, s), getChunks: ids => getEngine().getChunks(ids) },
  embed: embedQuestion,
  stream: streamAnswer,
  keys: () => useKeys.getState(),
  settings: () => useSettings.getState().settings,
  corpus: () => corpusVersion,
});

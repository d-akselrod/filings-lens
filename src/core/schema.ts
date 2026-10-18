export const SCHEMA_SQL = `
CREATE TABLE companies (id smallint PRIMARY KEY, ticker text NOT NULL UNIQUE, name text NOT NULL, cik text NOT NULL);
CREATE TABLE filings (id smallint PRIMARY KEY, company_id smallint NOT NULL REFERENCES companies(id), form text NOT NULL,
  fiscal_year smallint NOT NULL, period_end date NOT NULL, filed_at date NOT NULL, accession text NOT NULL UNIQUE, url text NOT NULL);
CREATE TABLE chunks (id integer PRIMARY KEY, key text NOT NULL UNIQUE, filing_id smallint NOT NULL REFERENCES filings(id),
  item text NOT NULL, item_title text NOT NULL, ordinal smallint NOT NULL, text text NOT NULL,
  token_count smallint NOT NULL, bm25_len smallint NOT NULL, embedding bytea NOT NULL);
CREATE TABLE terms (id integer PRIMARY KEY, term text NOT NULL UNIQUE, df integer NOT NULL, chunk_ids integer[] NOT NULL, tfs smallint[] NOT NULL);
CREATE TABLE corpus_stats (n integer NOT NULL, avgdl double precision NOT NULL);
CREATE INDEX chunks_filing_idx ON chunks (filing_id);
`;

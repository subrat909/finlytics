/**
 * Reads an instrument search query (plan "REST": trigram with a prefix boost). Besides the raw text, which is matched
 * against symbol, trading symbol and name, a query such as `nifty 25000 ce` also yields structured option terms: the
 * words (`NIFTY`), a strike (`25000`) and an option type (`CE`; also `CALL`/`PUT`).
 */
import type { OptionType } from "@finlytics/shared";

export interface SearchTerms {
  /** The whole query, upper-cased, single-spaced. */
  readonly raw: string;
  /** `raw` with LIKE's wildcards escaped, for `ILIKE` patterns. */
  readonly rawPattern: string;
  /** Structured option terms, when the query has a word and a strike or an option type. */
  readonly option?: {
    readonly underlyingPattern: string;
    readonly strike?: string;
    readonly optionType?: OptionType;
  };
}

const OPTION_WORDS: Readonly<Record<string, OptionType>> = { CE: "CE", PE: "PE", CALL: "CE", PUT: "PE" };
const STRIKE = /^(0|[1-9]\d{0,13})(\.\d{1,4})?$/;

/** `%`, `_` and `\` escaped for a LIKE pattern (PostgreSQL's default escape character is `\`). */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export function parseSearchTerms(query: string): SearchTerms {
  const words = query
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .filter((word) => word !== "");
  const raw = words.join(" ");
  const optionType = words.map((word) => OPTION_WORDS[word]).find((type) => type !== undefined);
  const strike = words.find((word) => STRIKE.test(word));
  const rest = words.filter((word) => OPTION_WORDS[word] === undefined && word !== strike);
  const terms: SearchTerms = { raw, rawPattern: escapeLike(raw) };
  if (rest.length === 0 || (strike === undefined && optionType === undefined)) return terms;
  return {
    ...terms,
    option: {
      underlyingPattern: escapeLike(rest.join(" ")),
      ...(strike === undefined ? {} : { strike }),
      ...(optionType === undefined ? {} : { optionType }),
    },
  };
}

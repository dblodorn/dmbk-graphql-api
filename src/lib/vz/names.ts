import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity';

/*
 * Voice names are public (the listing is anonymous), so obscene names are
 * refused. obscenity's English set handles look-alike spellings (5H1T) and
 * leaves innocent words alone (SCUNTHORPE, CLASSIC). It doesn't join letters
 * spelled out one by one (F U C K), so a second pass checks the name with runs
 * of single letters run together, which never merges two real words.
 */

const matcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });

/** "F U C K PAD" → "FUCK PAD"; "A B" → "AB"; "AB CD" unchanged. */
export function joinSpelledOut(name: string): string {
  return name.replace(/\b[A-Za-z0-9](?:[\s._*-]+[A-Za-z0-9]\b)+/g, (run) => run.replace(/[\s._*-]+/g, ''));
}

export function isNameAllowed(name: string): boolean {
  return !matcher.hasMatch(name) && !matcher.hasMatch(joinSpelledOut(name));
}

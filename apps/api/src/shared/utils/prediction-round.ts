export function getPredictionRound(match: { readonly round_label: string; readonly match_number: number }): string {
  if (/^Week \d+$/.test(match.round_label)) return match.round_label;
  if (match.match_number <= 24) return 'Group stage - Round 1';
  if (match.match_number <= 48) return 'Group stage - Round 2';
  if (match.match_number <= 72) return 'Group stage - Round 3';
  return match.round_label;
}

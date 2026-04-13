const PAYWALL_MARKER = /^<!--\s*paywall\s*-->\s*$/m;

export interface SplitBody {
  free: string;
  paid: string | null;
}

export function splitPaywall(body: string): SplitBody {
  const match = body.match(PAYWALL_MARKER);
  if (!match || match.index === undefined) {
    return { free: body, paid: null };
  }
  const free = body.slice(0, match.index).trimEnd();
  const paid = body.slice(match.index + match[0].length).trimStart();
  return { free, paid };
}

// Yle links may be opened by readers, but Faraday does not collect material from this domain.
export function isYleUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/\.$/, "");
    return host === "yle.fi" || host.endsWith(".yle.fi");
  } catch {
    return false;
  }
}

/** The reported text can already carry its full unit and qualifiers such as "nearly". */
export function formatReportedMetric(value: string, unit: string | null) {
  const suffix = unit?.trim();
  if (!suffix) return value;

  const text = value.trim();
  if (suffix === "%") return text.includes("%") ? text : `${text}%`;
  const usd = /^USD(?:\s+(millions?|billions?|trillions?))?$/i.exec(suffix);
  if (usd) {
    if (/\$|\b(?:USD|dollars?)\b/i.test(text)) return text;
    if (/\b(?:millions?|billions?|trillions?)\b/i.test(text)) return `${text} USD`;
    return usd[1] ? `${text} ${usd[1].replace(/s$/i, "")} USD` : `${text} USD`;
  }
  return text.toLowerCase().endsWith(` ${suffix.toLowerCase()}`) ? text : `${text} ${suffix}`;
}

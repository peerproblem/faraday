// OWNER: F-LLM. Every decision threshold lives here.
export const THRESHOLDS = {
  /** triage: keep a source when P(on topic) >= this */
  onTopic: 0.4,
  /** coverage: a question counts as answered when P(answered) >= this */
  answered: 0.5,
  /** update: rewrite narrative and assessment when P(material) >= this */
  material: 0.5,
  /** edit routing: gather new data when P(needs new data) >= this */
  needsNewData: 0.5,
} as const;

import { generateText, Output } from "ai";
import { z } from "zod";
import { fastLlm } from "../llm";
import { crisisTypes, sectionTypes } from "../spec";

export const planSchema = z.object({
  title: z.string().describe("Short dashboard title, e.g. 'Valencia Floods'"),
  crisisType: z.enum(crisisTypes),
  location: z
    .object({ name: z.string(), lat: z.number(), lon: z.number(), zoom: z.number().describe("Leaflet zoom, 4 country to 12 city") })
    .nullable()
    .describe("Null when the crisis has no physical place, like most cyberattacks"),
  lookbackDays: z.number().int().min(1).max(30).describe("How far back news is relevant"),
  newsQueries: z.array(z.string()).describe("3 to 5 natural-language news queries, specific to this crisis"),
  webQueries: z
    .array(z.string())
    .describe("2 to 4 web queries for official advisories, emergency services, shelters, help and status pages"),
  monitor: z.object({
    query: z.string().describe("A web search query that will surface new developments"),
    instructions: z.string().describe("Which new results matter and which to ignore, written for a judge model"),
  }),
  sections: z
    .array(z.object({ type: z.enum(sectionTypes), title: z.string(), purpose: z.string() }))
    .describe("The sections this dashboard needs, in order. Use 'table' for crisis-specific lists."),
  questions: z.array(z.string()).describe("The 4 to 6 questions people affected by this crisis need answered now"),
});

export type Plan = z.infer<typeof planSchema>;

export async function makePlan(program: string, now = new Date()): Promise<Plan> {
  const { output } = await generateText({
    ...fastLlm(),
    output: Output.object({ schema: planSchema }),
    system: `You plan live crisis dashboards ("situation boards"). A user describes a crisis in a sentence or two.
You decide what the dashboard must show and how to find it on the live web with a news search API and a web search API.
Today is ${now.toISOString().slice(0, 10)}.
Section guidance:
- Always include summary, kpis, timeline, news, changes, sources.
- Include map only for crises with physical places.
- Include advisories when authorities issue warnings, help when people need shelters, hotlines or donations.
- Add 1 to 3 'table' sections for crisis-specific lists (affected services, road closures, evacuation zones, CVEs, outage regions...).
Queries must name the specific place, organisation or event so they do not drift to other crises.`,
    prompt: program,
  });
  return output;
}

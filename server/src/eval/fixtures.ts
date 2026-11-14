// Fixed prompts for the eval (guide P0-5). Ids are stable: results and cassettes are keyed by them.
export type Fixture = { id: string; prompt: string; expect: { location: boolean; language: string } };

export const fixtures: Fixture[] = [
  {
    id: "flood",
    prompt: "Flooding in Valencia, Spain: how many people are affected, which roads and rail lines are closed, and where are shelters?",
    expect: { location: true, language: "en" },
  },
  {
    id: "wildfire",
    prompt: "Wildfires near Athens, Greece this week: which areas are evacuating, how much has burned, and is the fire contained?",
    expect: { location: true, language: "en" },
  },
  {
    id: "earthquake",
    prompt: "The latest major earthquake in Japan: magnitude, casualties, tsunami warnings and damage to infrastructure.",
    expect: { location: true, language: "en" },
  },
  {
    id: "cyberattack",
    prompt: "Ransomware attack on a major hospital network: which systems are down, is patient data affected, and when will services be restored?",
    expect: { location: false, language: "en" },
  },
  {
    id: "outage",
    prompt: "Microsoft 365 global outage: Outlook, Teams and Copilot down. What is broken, since when, and is it fixed?",
    expect: { location: false, language: "en" },
  },
  {
    id: "blackout",
    prompt: "Kyiv blackouts after strikes on the power grid: outage schedules, heating and water status.",
    expect: { location: true, language: "en" },
  },
  {
    id: "korean",
    prompt: "서울 집중호우 피해 상황: 침수 지역, 통제된 도로, 대피소 위치와 기상 특보를 알려줘.",
    expect: { location: true, language: "ko" },
  },
  {
    id: "thin",
    prompt: "Small chemical plant fire reported in a rural town in Ohio overnight: is there a shelter-in-place order?",
    expect: { location: true, language: "en" },
  },
];

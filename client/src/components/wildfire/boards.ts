/** How a board with the wildfire design reads its incident: the zone its agencies report times in. */
export type WildfireBoard = { timeZone: string };

/** Boards drawn with the wildfire design, by board id. */
export const wildfireBoards: Record<string, WildfireBoard | undefined> = {
  // Norte Fire, Orange County, California
  "1egbu07xcl61": { timeZone: "America/Los_Angeles" },
};

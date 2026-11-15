// Registers Faraday's slash commands with Discord. Run once after creating the application, and again when
// COMMANDS changes: npm run discord:commands
import { COMMANDS, discordConfig, installUrl, registerCommands } from "../distribute/discord";

const cfg = discordConfig();
if (!cfg) {
  console.error("Set DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID and DISCORD_PUBLIC_KEY in the root .env first.");
  process.exit(1);
}
const n = await registerCommands(cfg);
console.log(`Registered ${n} commands: ${COMMANDS.map((c) => `/${c.name}`).join(" ")}`);
console.log(`Add the bot to a server: ${installUrl(cfg.applicationId)}`);

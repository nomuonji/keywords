import type { CommandContext } from '@keywords/domain';
import { autopilotCommands as rawAutopilotCommands } from './autopilot.js';
import { headlessCommands } from './headless.js';

// All externally-invoked Autopilot ticks share the same per-project SQL lease.
// headlessCommands.runAutopilotTick calls the raw module internally, so this
// wrapper does not recurse and manual/API ticks cannot bypass worker locking.
export const autopilotCommands = {
  ...rawAutopilotCommands,
  tick: async (ctx: CommandContext, projectId: string) => headlessCommands.runAutopilotTick(ctx, projectId, { force: true })
};

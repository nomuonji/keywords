const schedulerOwner = process.env.KEYWORDS_AUTOPILOT_SCHEDULER_OWNER?.trim() || 'worker';
process.env.KEYWORDS_AUTOPILOT_SCHEDULER_OWNER = schedulerOwner;

// Production ownership is worker-first. The legacy in-process API scheduler is
// available only when the operator explicitly selects owner=api.
if (schedulerOwner !== 'api') process.env.KEYWORDS_AUTOPILOT_SCHEDULER = '0';

await import('./index.js');

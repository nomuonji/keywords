#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { runScheduler } from './index';

void (async () => {
  const argv = await yargs(hideBin(process.argv))
    .scriptName('keywords-scheduler')
    .option('project', {
      alias: 'p',
      type: 'string',
      demandOption: true,
      description: 'Target projectId'
    })
    .option('themes', {
      alias: 't',
      type: 'string',
      description: 'Comma-separated list of themeIds'
    })
    .option('manual', {
      type: 'boolean',
      default: false,
      description: 'Flag manual trigger'
    })
    .parse();

  await runScheduler({
    projectId: argv.project,
    themeIds: argv.themes ? argv.themes.split(',').map((id) => id.trim()) : undefined,
    manual: argv.manual
  });
})();

import { readFileSync } from 'node:fs';
import { blogCommands } from '@keywords/commands/blog';
import { discoveryCommands } from '@keywords/commands/discovery';
import type { CommandContext } from '@keywords/domain';
export function registerBlogCli(program:any,base:CommandContext){
 program.command('blog').argument('<operation>','context | importContext | prepare | export | get | receipt | verifyPublished | capture | evaluate | expand | observations')
 .argument('<projectId>').option('--file <path>','JSON arguments, excluding projectId').option('--json <json>','Inline JSON arguments')
 .option('--actor <actor>','human | agent','human').option('--session <id>').option('--actor-id <id>','Agent identity','blog-bridge')
 .action(async(operation:string,projectId:string,opts:any)=>{
   if(!['human','agent'].includes(opts.actor))throw new Error('Invalid actor');
   const args=opts.file?JSON.parse(readFileSync(opts.file,'utf8').replace(/^\uFEFF/,'')):JSON.parse(opts.json||'{}');
   const ctx={...base,actor:opts.actor,actorId:opts.actorId,workSessionId:opts.session} as CommandContext;
   const command=operation==='observe'?discoveryCommands.observe:operation==='expand'?discoveryCommands.expand:operation==='observations'?discoveryCommands.observations:(blogCommands as any)[operation];
   if(typeof command!=='function'||!['contract','context','importContext','prepare','export','get','receipt','verifyPublished','capture','evaluate','expand','observations','observe'].includes(operation))throw new Error('Unknown Blog operation');
   const input=operation==='importContext'&&args.kind==='blog_site_context'?{snapshot:args}:operation==='receipt'&&args.handoff_id?{receipt:args}:args;
   console.log(JSON.stringify(await command(ctx,{...input,projectId}),null,2));
 });
}

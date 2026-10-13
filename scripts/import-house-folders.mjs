import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { initialMeetings } from '../shared/seed.js';

const [directory,firstNumber='1',slot='yiting']=process.argv.slice(2);
if(!directory||!Number.isInteger(Number(firstNumber))||Number(firstNumber)<1||Number(firstNumber)>14||!['yiting','haomiao'].includes(slot))throw new Error('Usage: node scripts/import-house-folders.mjs <folder-root> [first-meeting-number] [local-slot]');
const root=path.resolve(directory),folders=await readdir(root,{withFileTypes:true}),reports=[];
for(const meeting of initialMeetings.slice(Number(firstNumber)-1)) {
  const folder=folders.find(item=>item.isDirectory()&&item.name===`${meeting.title}照片`);
  if(!folder)continue;
  console.log(`Importing ${meeting.title}: ${meeting.start} to ${meeting.end}`);
  await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['scripts/import-meeting-photos.mjs',path.join(root,folder.name),meeting.start,meeting.end,slot],{stdio:'inherit',windowsHide:true});
    child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`${meeting.title} photo import failed with ${code}`)));
  });
  reports.push(JSON.parse(await readFile(`test-results/meeting-${meeting.start}-import.json`,'utf8')));
}
await mkdir('test-results',{recursive:true});
await writeFile('test-results/folder-photo-import.json',JSON.stringify({completedAt:new Date().toISOString(),environment:'local-preview-only',reports},null,2));
console.log(JSON.stringify({environment:'local-preview-only',imported:reports.map(report=>({meeting:report.meeting.title,photos:report.photos,duplicates:report.identicalCopiesSkipped})),photos:reports.reduce((n,report)=>n+report.photos,0)}));

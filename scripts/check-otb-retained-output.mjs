import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,readFile,rm,stat} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname,join,resolve,sep} from "node:path";
import {OtbImportService} from "./otb-import-service.mjs";

// Read original status/PGN bytes only. All reconstructed output is task-owned
// temporary data and is removed after its compact receipt has been printed.
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
for(const supplied of process.argv.slice(2)){
  const jobPath=resolve(supplied),jobBytes=await readFile(jobPath),original=JSON.parse(jobBytes);
  assert.match(original.id,/^otb-[a-z0-9-]{1,90}$/i);
  assert.equal(original.status,"failed");assert.ok(original.report);
  const outputPath=resolve(dirname(jobPath),"..","output",`${original.id}.pgn`);
  assert.equal(resolve(original.report.outputPath).toLowerCase(),outputPath.toLowerCase());
  assert.ok((await stat(outputPath)).size<10*1024*1024,"Use a separately budgeted replay for larger results");
  const pgnBytes=await readFile(outputPath);
  const root=await mkdtemp(join(tmpdir(),"en-otb-retained-replay-"));
  try{
    const service=new OtbImportService({root,binaryPath:join(root,"unavailable")});await service.initialize();
    const job={...original,status:"running",error:null,completedAt:null,cancellationRequested:false,artifactAvailable:false,artifactBytes:null};
    service.jobs.set(job.id,job);await service.finishCompleted(job,original.report,outputPath);
    assert.equal(job.status,"partial");assert.equal(job.report.coverageComplete,false);
    const artifact=JSON.parse(await readFile((await service.getJobArtifact(job.id)).path,"utf8"));
    assert.equal(artifact.games.length,original.report.gamesFound);
    assert.equal(artifact.prepDatabase.games.length,original.report.gamesFound);
    assert.equal(sha(await readFile(jobPath)),sha(jobBytes));assert.equal(sha(await readFile(outputPath)),sha(pgnBytes));
    console.log(JSON.stringify({jobId:job.id,status:job.status,games:artifact.games.length,preparedGames:artifact.prepDatabase.games.length,originalsUnchanged:true,jobSha256:sha(jobBytes),pgnSha256:sha(pgnBytes),pgnBytes:pgnBytes.length}));
  }finally{
    assert.ok(resolve(root).startsWith(`${resolve(tmpdir())}${sep}`));assert.ok(root.split(sep).at(-1).startsWith("en-otb-retained-replay-"));
    await rm(root,{recursive:true,force:true});
  }
}

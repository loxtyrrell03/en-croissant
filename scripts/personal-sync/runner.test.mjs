import assert from 'node:assert/strict';
import test from 'node:test';
import {syncLibraryPass} from './runner.mjs';

test('a Files error is reported and the phone catalogue still receives database updates', async () => {
  const phases=[];
  const databases={changed:2,errors:[],conflicts:[]};
  const result=await syncLibraryPass({
    runFiles:async()=>{throw Error('Directory is not empty');},
    runDatabases:async()=>{phases.push('sync databases');return databases;},
    refreshCatalog:async()=>{phases.push('publish catalogue');},
    setChecking:async phase=>{phases.push(phase);},
  });
  assert.deepEqual(phases,['databases','sync databases','catalog','publish catalogue']);
  assert.equal(result.fileFailure.error,'Directory is not empty');
  assert.equal(result.files,undefined);
  assert.equal(result.databases,databases);
});

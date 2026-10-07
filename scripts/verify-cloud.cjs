const assert=require('node:assert/strict');const ts=require('typescript');const fs=require('fs');const vm=require('vm');
let calls=[];let response={ok:true,json:async()=>({choices:[{message:{content:'verified'}}]})};
const env={OPENROUTER_API_KEY:'private-test-key',OPENROUTER_MODEL:'test/model',GOOGLE_API_KEY:'google-private-key',GEMINI_MODEL:'test-gemini'};
const context={exports:{},require:()=>({}),process:{env},AbortSignal,fetch:async(...args)=>{calls.push(args);return response;}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/ai/cloud.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);
(async()=>{const api=context.exports;assert.equal(await api.cloudComplete('openrouter',{prompt:'hello',json:true}),'verified');assert.equal(calls[0][1].headers.Authorization,'Bearer private-test-key');assert.equal(JSON.parse(calls[0][1].body).model,'test/model');assert.ok(!JSON.stringify(api.cloudConfiguration()).includes('private'));
response={ok:true,json:async()=>({candidates:[{content:{parts:[{text:'gemini'}]}}]})};assert.equal(await api.cloudComplete('google',{prompt:'hello'}),'gemini');assert.equal(calls[1][1].headers['x-goog-api-key'],'google-private-key');assert.ok(!calls[1][0].includes('private'));
response={ok:false,status:429};await assert.rejects(api.cloudComplete('google',{prompt:'hello'}),/HTTP 429/);assert.equal(calls.length,3);
delete env.GOOGLE_API_KEY;await assert.rejects(api.cloudComplete('google',{prompt:'hello'}),/must be configured/);assert.equal(calls.length,3);console.log('PASS: OpenRouter/Google contracts, secret redaction, missing credentials, 429 without retry');})().catch(e=>{console.error(e);process.exit(1)});

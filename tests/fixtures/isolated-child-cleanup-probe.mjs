// 합성 전용 비관리자·네트워크 차단 컨테이너에서 실행한다. 개인 HOME을 연결하지 않는다.
import fs from 'node:fs';
import crypto from 'node:crypto';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {collectTurnsFromChildV0166} from '../../dist/index.js';
const BASE_COMMIT='24e4f2f2c38bafa7ce651fc43c874f55ef54c91e';
const binary='/usr/local/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex';
const id='01900000-0000-7000-8000-000000000001';
const watchdog=setTimeout(()=>{console.error('WATCHDOG_TIMEOUT');process.exit(3)},40000);
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function createFixture(mode) {
 const home='/tmp/'+mode, base=home+'/.codex',dir=base+'/sessions/2026/11/10';
 fs.mkdirSync(dir,{recursive:true});
 const timestamp='2026-11-10T00:00:00.000Z';
 const rows=[{timestamp,type:'session_meta',payload:{id,timestamp,cwd:'/tmp/synthetic',originator:'codex_cli_rs',cli_version:'0.166.0',source:'cli',model_provider:'openai'}}];
 for(let i=0;i<101;i++){
  const turn='turn-'+i, add=payload=>rows.push({timestamp,type:'event_msg',payload});
  add({type:'task_started',turn_id:turn,started_at:1794268800+i,model_context_window:258400});
  for(let j=0;j<2;j++)add({type:'user_message',message:'PRIVATE_SYNTHETIC_'+i+'_'+j,images:null,local_images:[],text_elements:[]});
  add({type:'task_complete',turn_id:turn,last_agent_message:null,completed_at:1794269000+i,duration_ms:1000});
 }
 const path=dir+'/rollout-2026-11-10T00-00-00-'+id+'.jsonl';
 fs.writeFileSync(path,rows.map(x=>JSON.stringify(x)).join('\n')+'\n');
 return {home,base,path};
}
function reachable(path){try{fs.accessSync(path);return true}catch(e){assert.ok(['ENOENT','EACCES'].includes(e.code));return false}}
try {
 assert.equal(process.platform,'linux');assert.equal(process.getuid(),1000);
 assert.equal(process.env.HOME,'/tmp/empty-home');
 assert.equal(process.env.CODEX_HOME,'/tmp/empty-home/.codex');
 assert.equal(fs.existsSync(process.env.HOME),false);
 assert.deepEqual(Object.keys(process.env).filter(k=>/KEY|TOKEN|SECRET|AUTH|PROXY/i.test(k)),[]);
 const paths=['/mnt/c/Users/E','/host_mnt/c/Users/E','/run/desktop/mnt/host/c/Users/E','/var/run/docker.sock','/root/.codex/auth.json'];
 for(const p of paths)assert.equal(reachable(p),false,p);
 const status=fs.readFileSync('/proc/self/status','utf8');
 assert.match(status,/CapEff:\s+0000000000000000/);assert.match(status,/NoNewPrivs:\s+1/);
 const network=await new Promise(resolve=>{
  const socket=net.connect({host:'1.1.1.1',port:443});
  socket.setTimeout(2000);
  socket.once('error',e=>{socket.destroy();resolve(e.code)});
  socket.once('connect',()=>{socket.destroy();resolve('CONNECTED')});
  socket.once('timeout',()=>{socket.destroy();resolve('TIMEOUT')});
 });
 assert.equal(network,'ENETUNREACH');
 fs.mkdirSync('/tmp/version/.codex',{recursive:true});
 const version=execFileSync(binary,['--version'],{env:{PATH:process.env.PATH,HOME:'/tmp/version',CODEX_HOME:'/tmp/version/.codex'},encoding:'utf8'}).trim();
 assert.equal(version,'codex-cli 0.166.0');
 console.log(JSON.stringify({check:'preflight',base_commit:BASE_COMMIT,version,uid:process.getuid(),network,host_paths_accessible:false,credential_env:false,capabilities:'none',no_new_privileges:true}));
 for(const mode of ['complete','cancel','short']){
  const fixture=createFixture(mode),before=sha(fixture.path),controller=new AbortController();
  const child=spawn(binary,['app-server'],{env:{PATH:process.env.PATH,HOME:fixture.home,CODEX_HOME:fixture.base},stdio:['pipe','pipe','pipe']});
  const close=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}))});
  const methods=[],signals=[];let pageRequests=0,cancelAfterWrite=false;
  const kill=child.kill.bind(child);child.kill=function(signal){signals.push(signal??'SIGTERM');return kill(signal)};
  const write=child.stdin.write.bind(child.stdin);
  child.stdin.write=function(chunk,...args){
   const request=JSON.parse(Buffer.isBuffer(chunk)?chunk.toString('utf8'):chunk);
   methods.push(request.method);
   if(request.method==='thread/turns/list')pageRequests++;
   const sent=write(chunk,...args);
   if(mode==='cancel'&&request.method==='thread/turns/list'&&pageRequests===2){
    cancelAfterWrite=true;controller.abort();
   }
   return sent;
  };
  const started=performance.now();
  let result,exit;
  try {
   result=await collectTurnsFromChildV0166(child,id,'synthetic',{signal:controller.signal,...(mode==='short'?{cleanupTimeoutMs:100}:{})});
   console.log(JSON.stringify({check:mode+'_return',returned_ms:Math.round(performance.now()-started),cleanup_status:result.cleanup_status,exitCode:child.exitCode,signalCode:child.signalCode}));
   exit=await close;
  } finally {
   if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await close}
  }
  assert.equal(result.initialization_error,null);
  assert.equal(result.cleanup_status,mode==='short'?'unknown':'exit_observed');
  assert.equal(result.collection.verification_status,'unverified');
  assert.deepEqual(methods,['initialize','initialized','thread/read','thread/turns/list','thread/turns/list']);
  assert.equal(pageRequests,2);
  assert.deepEqual(signals,['SIGTERM']);
  assert.equal(result.collection.status,mode!=='cancel'?'last_page':'partial');
  assert.equal(result.collection.reason,mode!=='cancel'?'last_page':'cancelled');
  const counts=result.collection.pages.map(p=>p.turns.length);
  assert.deepEqual(counts,mode!=='cancel'?[100,1]:[100]);
  const turns=result.collection.pages.flatMap(p=>p.turns);
  assert.deepEqual(turns.map(t=>t.turn_id),Array.from({length:mode!=='cancel'?101:100},(_,i)=>'turn-'+i));
  assert.equal(turns.flatMap(t=>t.items).length,mode!=='cancel'?202:200);
  assert.ok(turns.every(t=>t.items.every(x=>x.kind==='user_message')));
  assert.ok(!JSON.stringify(result).includes('PRIVATE_'));
  assert.equal(sha(fixture.path),before);
  assert.ok(child.stdin.destroyed&&child.stdout.destroyed&&child.stderr.destroyed);
  let exists=true;try{process.kill(child.pid,0)}catch(e){assert.equal(e.code,'ESRCH');exists=false}
  assert.equal(exists,false);
  console.log(JSON.stringify({check:mode,base_commit:BASE_COMMIT,status:result.collection.status,reason:result.collection.reason,
   page_turn_counts:counts,messages:turns.flatMap(t=>t.items).length,initialization_error:result.initialization_error,
   cleanup_status:result.cleanup_status,exit,server_pid_exists:exists,streams_destroyed:true,source_unchanged:true,
   cancel_after_second_request_write:cancelAfterWrite,signals,methods,elapsed_ms:Math.round(performance.now()-started)}));
 }
 console.log('ALL_ASSERTIONS_PASSED');
}finally{clearTimeout(watchdog)}

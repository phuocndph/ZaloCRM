// Isolated Electron integration. No production login or customer messages.
const {_electron}=require('playwright');
const http=require('node:http'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
async function run(){
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'zalocrm-bubble-window-'));
 await fs.writeFile(path.join(profile,'desktop-preferences.json'),JSON.stringify({bubbleEnabled:true,position:{x:99999,y:99999}}));
 const server=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><title>Bubble fixture</title><h1>Kiểm tra bong bóng riêng</h1>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let desktop;
 const until=async(fn,message)=>{for(let i=0;i<200;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}assert.fail(message);};
 try{
  const origin=`http://127.0.0.1:${server.address().port}`;
  const executablePath=process.env.ZALOCRM_DESKTOP_TEST_EXE;
  desktop=await _electron.launch({...(executablePath?{executablePath}:{}),args:executablePath?[]:[path.resolve(__dirname,'..')],env:{...process.env,ZALOCRM_DESKTOP_URL:origin,ZALOCRM_DESKTOP_PROFILE:profile},timeout:60000});
  let main;await until(async()=>{main=desktop.windows().find(p=>p.url()===origin+'/');return !!main;},'main loaded');
  await main.evaluate(()=>window.zaloDesktop.setIdentity({userId:'fixture-user',orgId:'fixture-org'}));
  let bubble;await until(async()=>{bubble=desktop.windows().find(p=>p.url().endsWith('/bubble.html'));return !!bubble;},'bubble loaded');await bubble.waitForSelector('#bubble');
  const bounds=()=>desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='ZaloCRM Bubble').getBounds());
  const work=await desktop.evaluate(({screen,BrowserWindow})=>screen.getDisplayMatching(BrowserWindow.getAllWindows().find(w=>w.getTitle()==='ZaloCRM Bubble').getBounds()).workArea);
  const visible=()=>desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='ZaloCRM Bubble')?.isVisible());
  await until(visible,'bubble visible');let before=await bounds();
  assert.ok(before.x>=work.x&&before.x+76<=work.x+work.width&&before.y+76<=work.y+work.height,'saved offscreen position clamped: '+JSON.stringify({work,before}));
  await desktop.evaluate(({screen,BrowserWindow})=>{
   globalThis.bubbleFixtureCursor={x:screen.getPrimaryDisplay().workArea.x+220,y:screen.getPrimaryDisplay().workArea.y+220};
   screen.getCursorScreenPoint=()=>({...globalThis.bubbleFixtureCursor});
   BrowserWindow.getAllWindows().find(w=>w.getTitle()==='ZaloCRM Bubble').setPosition(globalThis.bubbleFixtureCursor.x-20,globalThis.bubbleFixtureCursor.y-20);
  });
  for(let i=1;i<=15;i++){
   before=await bounds();await desktop.evaluate((_e,b)=>{globalThis.bubbleFixtureCursor={x:b.x+20,y:b.y+20};},before);
   await bubble.evaluate(id=>window.bubble.beginDrag(id),i);const delta=i%2?{x:160,y:90}:{x:-160,y:-90};
   await desktop.evaluate((_e,d)=>{globalThis.bubbleFixtureCursor.x+=d.x;globalThis.bubbleFixtureCursor.y+=d.y;},delta);
   await bubble.evaluate(id=>window.bubble.drag(id),i);const result=await bubble.evaluate(id=>window.bubble.endDrag(id,false),i);
   assert.equal(result.moved,true);const after=await bounds();assert.equal(after.x,before.x+delta.x);assert.equal(after.y,before.y+delta.y);
  }
  const saved=JSON.parse(await fs.readFile(path.join(profile,'desktop-preferences.json'),'utf8'));assert.deepEqual(saved.position,await bounds(),'position saved at release');
  assert.equal(desktop.windows().some(p=>p.url().includes('/desktop/chat')),false,'drag never opens chat');
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='ZaloCRM Bubble').hide());await until(visible,'hidden bubble restored');
  const resultDir=path.resolve(__dirname,'../test-results');await fs.mkdir(resultDir,{recursive:true});await bubble.screenshot({path:path.join(resultDir,'bubble-stable.png')});
  const crashed=bubble.waitForEvent('crash');
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='ZaloCRM Bubble').webContents.forcefullyCrashRenderer());await crashed;
  await until(async()=>{try{return await desktop.evaluate(async({BrowserWindow})=>{
    const wc=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='ZaloCRM Bubble').webContents;
    if(wc.isCrashed()||wc.isLoading())return false;
    return wc.executeJavaScript('!!document.getElementById("bubble") && typeof window.bubble?.endDrag === "function"');
  });}catch{return false;}},'crashed renderer reloaded with working bridge');
  await until(visible,'crashed bubble restored');
  const open=()=>desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='ZaloCRM Bubble').webContents.executeJavaScript('window.bubble.open()'));
  await open();await until(()=>desktop.windows().some(p=>p.url().includes('/desktop/chat/')),'chat opened');
  const chatVisible=()=>desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/desktop/chat/'))?.isVisible());
  await until(chatVisible,'chat visible');await open();await until(async()=>!await chatVisible(),'second click hides chat');
  await main.evaluate(()=>window.zaloDesktop.setIdentity(null));await until(async()=>!await visible(),'logout hides bubble');
  console.log('Bubble window passed: 15 native-position drag cycles, persisted position, offscreen/hidden/crashed renderer recovery, open/close and logout. No customer messages.');
 }finally{if(desktop)await desktop.close();await new Promise(r=>server.close(r));}
}
run().catch(error=>{console.error(error);process.exitCode=1;});

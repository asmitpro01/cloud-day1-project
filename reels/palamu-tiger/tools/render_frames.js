// Parallel frame capture: node tools/render_frames.js <url> <outdir> <fps> <workers>
// Each worker opens its own headless Chromium page, seeks to every Nth frame and saves a JPEG.
const {chromium}=require('playwright');
const [url,out,fpsS,wS]=process.argv.slice(2); const fps=+fpsS||30, W=+wS||4;
(async()=>{
 const b=await chromium.launch();
 const probe=await b.newPage(); await probe.goto(url); await probe.evaluate('window.ready'); const dur=await probe.evaluate('window.DURATION'); await probe.close();
 const n=Math.round(dur*fps); let done=0;
 await Promise.all([...Array(W).keys()].map(async w=>{
  const p=await b.newPage({viewport:{width:1080,height:1920}}); await p.goto(url); await p.evaluate('window.ready');
  for(let i=w;i<n;i+=W){
   await p.evaluate(t=>Promise.resolve(seek(t)).then(()=>new Promise(r=>requestAnimationFrame(()=>r()))),i/fps);
   await p.screenshot({path:`${out}/f_${String(i).padStart(5,'0')}.jpg`,type:'jpeg',quality:94});
   if(++done%90===0)console.log(`frame ${done}/${n}`);
  }
 }));
 await b.close(); console.log('frames done',n);
})();

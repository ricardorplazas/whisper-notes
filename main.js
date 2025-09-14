
'use strict';
const obsidian = require('obsidian');

/** Utils **/
function dtStamp(){ const d=new Date(); const p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`; }
function sanitizeFilename(name){ return name.replace(/[\\/:*?"<>|]+/g,"-").trim(); }
async function ensureFolder(app, folder){ const ex = await app.vault.adapter.exists(folder); if(!ex) await app.vault.createFolder(folder); }
function humanTime(ms){ const s=Math.floor(ms/1000); const h=Math.floor(s/3600); const m=Math.floor((s%3600)/60); const sec=s%60; const p=n=>String(n).padStart(2,'0'); return h>0?`${h}:${p(m)}:${p(sec)}`:`${m}:${p(sec)}`; }

/** Settings **/
const DEFAULT_SETTINGS = {
  audioFolder:"Recordings",
  transcriptFolder:"Recordings",
  insertTranscriptInCurrentNote:true,
  transcriptHeading:"## Transcript",
  autoTranscribe:true,
  openAfterTranscribe:true,

  transcribeProvider:"openai-whisper",
  transcribeApiKey:"",
  transcribeBaseUrl:"https://api.openai.com/v1",
  transcribeModel:"whisper-1",
  language:"",

  llmBaseUrl:"https://api.openai.com/v1",
  llmApiKey:"",
  llmModel:"gpt-4o-mini",
  enablePostTasks:true,
  defaultTasks:["summary","todos","actions"],
  summaryPrompt:"Write a concise, executive-ready meeting summary with context, key points, owners, and timelines. Use tight bullet points and avoid fluff.",
  preferredMimeType:"audio/webm;codecs=opus",

  insertSummaryAfterTranscript:true,
  summaryHeading:"## Summary"
};

/** RecorderController **/
class RecorderController{
  constructor(plugin){ this.plugin=plugin; this.mediaStream=null; this.recorder=null; this.chunks=[]; this._isRecording=false; this._isPaused=false; this.levelInterval=null; this._levelCtx=null; this._levelSrc=null; this._levelAnalyser=null; this.audioCtx=null; this.processor=null; this.source=null; this.wavBuffers=[]; this.sampleRate=44100; this.usingWavFallback=false; }
  get isRecording(){ return this._isRecording }
  get isPaused(){ return this._isPaused }
  async start(){
    if(!navigator?.mediaDevices?.getUserMedia){ new obsidian.Notice("Microphone not available on this device/browser."); throw new Error("No mediaDevices"); }
    this.mediaStream = await navigator.mediaDevices.getUserMedia({audio:true});
    this._isRecording=true; this._isPaused=false; this.levelStart(this.mediaStream);
    if(typeof window!=='undefined' && window.MediaRecorder){
      const mime=this.plugin.settings.preferredMimeType; const options={};
      if(window.MediaRecorder.isTypeSupported?.(mime)) options.mimeType=mime;
      this.recorder=new window.MediaRecorder(this.mediaStream, options);
      this.chunks=[];
      this.recorder.addEventListener("dataavailable",(e)=>{ if(e.data&&e.data.size>0) this.chunks.push(e.data) });
      this.recorder.start(500);
      return {fallback:false, mimeType:this.recorder.mimeType};
    }else{
      // WAV fallback
      this.usingWavFallback=true;
      this.audioCtx=new (window.AudioContext||window.webkitAudioContext)({sampleRate:this.sampleRate});
      this.source=this.audioCtx.createMediaStreamSource(this.mediaStream);
      this.processor=this.audioCtx.createScriptProcessor(4096,1,1);
      this.wavBuffers=[];
      this.processor.onaudioprocess=(e)=>{ if(!this._isRecording||this._isPaused) return; const input=e.inputBuffer.getChannelData(0); this.wavBuffers.push(new Float32Array(input)); };
      this.source.connect(this.processor); this.processor.connect(this.audioCtx.destination);
      return {fallback:true, mimeType:"audio/wav"};
    }
  }
  pause(){ if(!this._isRecording) return; this._isPaused=true; if(this.recorder && this.recorder.state==="recording") this.recorder.pause(); }
  resume(){ if(!this._isRecording) return; this._isPaused=false; if(this.recorder && this.recorder.state==="paused") this.recorder.resume(); }
  async stop(){
    if(!this._isRecording) return null;
    this._isRecording=false; this._isPaused=false; this.levelStop();
    let blob;
    if(this.recorder){
      const finished=new Promise((resolve)=>{ this.recorder.addEventListener("stop",()=>resolve(), {once:true}); });
      if(this.recorder.state!=="inactive") this.recorder.stop();
      await finished;
      blob=new Blob(this.chunks,{type:this.recorder.mimeType||"audio/webm"}); this.chunks=[]; this.recorder=null;
    }else if(this.usingWavFallback){
      const wav=this.encodeWav(this.wavBuffers,this.sampleRate);
      blob=new Blob([wav],{type:"audio/wav"});
      try{ this.processor?.disconnect(); this.source?.disconnect(); await this.audioCtx?.close(); }catch{}
      this.processor=this.source=this.audioCtx=null; this.wavBuffers=[]; this.usingWavFallback=false;
    }else{ return null }
    try{ this.mediaStream?.getTracks()?.forEach(t=>t.stop()); }catch{}
    this.mediaStream=null;
    return blob;
  }
  levelStart(stream){
    try{
      this._levelCtx=new (window.AudioContext||window.webkitAudioContext)();
      this._levelSrc=this._levelCtx.createMediaStreamSource(stream);
      this._levelAnalyser=this._levelCtx.createAnalyser();
      this._levelAnalyser.fftSize=256; this._levelSrc.connect(this._levelAnalyser);
      const data=new Uint8Array(this._levelAnalyser.frequencyBinCount);
      this.levelInterval=window.setInterval(()=>{
        this._levelAnalyser.getByteTimeDomainData(data);
        let sum=0; for(let i=0;i<data.length;i++){ const v=(data[i]-128)/128; sum+=v*v; }
        const rms=Math.sqrt(sum/data.length);
        const level=Math.min(1, rms*4);
        this.plugin.dispatchLevel(level);
      },100);
    }catch{}
  }
  levelStop(){ if(this.levelInterval){ window.clearInterval(this.levelInterval); this.levelInterval=null; } try{ this._levelSrc?.disconnect(); this._levelCtx?.close(); }catch{} }
  encodeWav(buffers, sampleRate){
    let length=0; for(const b of buffers) length+=b.length;
    const pcm=new Float32Array(length); let offset=0; for(const b of buffers){ pcm.set(b,offset); offset+=b.length; }
    const buffer=new ArrayBuffer(44+pcm.length*2); const view=new DataView(buffer);
    const writeString=(v,o,s)=>{ for(let i=0;i<s.length;i++) v.setUint8(o+i, s.charCodeAt(i)) };
    const floatTo16BitPCM=(output,offset,input)=>{ for(let i=0;i<input.length;i++,offset+=2){ let s=Math.max(-1,Math.min(1,input[i])); s=s<0?s*0x8000:s*0x7FFF; output.setInt16(offset,s,true); } };
    writeString(view,0,'RIFF'); view.setUint32(4,36+pcm.length*2,true);
    writeString(view,8,'WAVE'); writeString(view,12,'fmt ');
    view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
    view.setUint32(24,sampleRate,true); view.setUint32(28,sampleRate*2,true);
    view.setUint16(32,2,true); view.setUint16(34,16,true);
    writeString(view,36,'data'); view.setUint32(40,pcm.length*2,true);
    floatTo16BitPCM(view,44,pcm); return view;
  }
}

/** API helpers **/
async function transcribeBlob(plugin, blob){
  const s=plugin.settings;
  if(s.transcribeProvider!=="openai-whisper") return {text:"",error:"Only OpenAI Whisper is implemented."};
  if(!s.transcribeApiKey) return {text:"",error:"Set your OpenAI API key in Settings."};
  const form=new FormData(); const fileName=`audio.${blob.type?.includes('wav')?'wav':'webm'}`;
  form.append("file",blob,fileName); form.append("model",s.transcribeModel||"whisper-1");
  if(s.language) form.append("language",s.language); form.append("response_format","json");
  try{
    const res=await fetch((s.transcribeBaseUrl||"https://api.openai.com/v1")+"/audio/transcriptions",{method:"POST",headers:{Authorization:`Bearer ${s.transcribeApiKey}`},body:form});
    if(!res.ok){ const t=await res.text(); console.error("Transcription error:",t); return {text:"",error:`Transcription failed (${res.status}).`}; }
    const out=await res.json(); return {text:out.text||out.result||"",error:null};
  }catch(e){ console.error(e); return {text:"",error:"Network error during transcription."}; }
}

async function runSummary(plugin, transcript){
  const s=plugin.settings;
  if(!s.insertSummaryAfterTranscript) return {ok:false, text:""};
  if(!s.llmApiKey) return {ok:false, text:""};
  const base=s.llmBaseUrl||"https://api.openai.com/v1";
  const model=s.llmModel||"gpt-4o-mini";
  const prompt=(s.summaryPrompt||"Write a concise, executive-ready meeting summary with context, key points, owners, and timelines. Use tight bullet points and avoid fluff.").trim();
  const messages=[
    {role:"system",content:"You are a world-class meeting analyst. Always return valid Markdown."},
    {role:"user",content:`Transcript:\n\n${transcript}\n\nTask: ${prompt}`}
  ];
  try{
    const res=await fetch(base+"/chat/completions",{method:"POST",headers:{"Authorization":`Bearer ${s.llmApiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model,messages,temperature:0.2})});
    if(!res.ok){ console.error("Summary LLM error", res.status); return {ok:false, text:""}; }
    const j=await res.json(); const text=j?.choices?.[0]?.message?.content??""; return {ok:!!text, text:text};
  }catch(e){ console.error(e); return {ok:false, text:""}; }
}

/** Inline recorder view **/
class InlineRecorderView{
  constructor(plugin, el, label, sectionCtx){ this.plugin=plugin; this.el=el; this.label=label; this.controller=new RecorderController(plugin); this.sectionCtx=sectionCtx; this.state='idle'; this.elapsed=0; this.elapsedTimer=null; this.render(); }
  render(){
    const root=this.el.createDiv({cls:"meeting-recorder-inline"});
    const header=root.createEl("div",{cls:"header"}); header.createSpan({text:"🎙️ "+this.label});
    const row=root.createDiv({cls:"row"}); this.lightEl=row.createDiv({cls:"meeting-recorder-light"}); this.timerEl=row.createDiv({cls:"meeting-recorder-timer", text:"0:00"});
    const wave=root.createDiv({cls:"meeting-recorder-wave"}); this.bars=[]; for(let i=0;i<48;i++) this.bars.push(wave.createDiv({cls:"bar"}));
    root.createDiv({cls:"meeting-divider"});
    const controls=root.createDiv({cls:"meeting-controls"});
    this.startBtn=controls.createEl("button",{text:"▶ Start",cls:"mr-btn mr-btn-primary"});
    this.pauseBtn=controls.createEl("button",{text:"⏸ Pause",cls:"mr-btn"});
    this.resumeBtn=controls.createEl("button",{text:"▶ Resume",cls:"mr-btn"});
    this.stopBtn=controls.createEl("button",{text:"⏹ Stop",cls:"mr-btn mr-btn-danger"});
    this.tsBtn=controls.createEl("button",{text:"⏱ Insert timestamp",cls:"mr-btn"});
    this.pauseBtn.setAttr("disabled","true"); this.resumeBtn.setAttr("disabled","true"); this.stopBtn.setAttr("disabled","true"); this.tsBtn.setAttr("disabled","true");
    this.statusEl=root.createDiv({cls:"meeting-status", text:""});
    this.bind();
  }
  setState(next){
    this.state=next; const on=(b,v)=> v?b.removeAttribute('disabled'):b.setAttr('disabled','true');
    if(next==='idle'){ on(this.startBtn,true); on(this.pauseBtn,false); on(this.resumeBtn,false); on(this.stopBtn,false); on(this.tsBtn,false); this.lightEl.removeClass('recording'); this.statusEl.setText(''); }
    else if(next==='recording'){ on(this.startBtn,false); on(this.pauseBtn,true); on(this.resumeBtn,false); on(this.stopBtn,true); on(this.tsBtn,true); this.lightEl.addClass('recording'); this.statusEl.setText('Recording…'); }
    else if(next==='paused'){ on(this.startBtn,false); on(this.pauseBtn,false); on(this.resumeBtn,true); on(this.stopBtn,true); on(this.tsBtn,true); this.lightEl.removeClass('recording'); this.statusEl.setText('Paused'); }
    else{ on(this.startBtn,false); on(this.pauseBtn,false); on(this.resumeBtn,false); on(this.stopBtn,false); on(this.tsBtn,false); this.lightEl.removeClass('recording'); this.statusEl.setText('Finalizing…'); }
  }
  startTimer(){ this.stopTimer(); this.startTs=Date.now()-this.elapsed; this.elapsedTimer=window.setInterval(()=>{ this.elapsed=Date.now()-this.startTs; this.timerEl.setText(humanTime(this.elapsed)); },250); }
  stopTimer(){ if(this.elapsedTimer){ window.clearInterval(this.elapsedTimer); this.elapsedTimer=null; } }
  resetTimer(){ this.stopTimer(); this.elapsed=0; this.timerEl.setText('0:00'); }
  bind(){
    this.startBtn.addEventListener("click", async()=>{
      if(this.state!=='idle') return;
      try{
        this.statusEl.setText("Requesting microphone…");
        const info=await this.controller.start();
        this.setState('recording'); this.startTimer();
        this.statusEl.setText(`Recording (${info.fallback?"WAV fallback":info.mimeType||"audio"})…`);
        this.levelConsumer=(l)=>this.updateLevel(l); this.plugin.addLevelConsumer(this.levelConsumer);
      }catch(e){ console.error(e); this.setState('idle'); this.statusEl.setText(""); new obsidian.Notice("Failed to start recording. Check microphone permissions."); }
    });
    this.pauseBtn.addEventListener("click", ()=>{ if(this.state!=='recording') return; try{ this.controller.pause(); }catch{}; this.stopTimer(); this.setState('paused'); });
    this.resumeBtn.addEventListener("click", ()=>{ if(this.state!=='paused') return; try{ this.controller.resume(); }catch{}; this.startTimer(); this.setState('recording'); });
    this.stopBtn.addEventListener("click", async()=>{
      if(this.state!=='recording'&&this.state!=='paused') return;
      this.setState('finalizing'); this.stopTimer();
      let blob=null; try{ blob=await this.controller.stop(); }catch(e){ console.error(e); }
      if(this.levelConsumer){ this.plugin.removeLevelConsumer(this.levelConsumer); this.levelConsumer=undefined; }
      try{
        if(!blob){ this.statusEl.setText("Nothing recorded."); this.setState('idle'); this.resetTimer(); return; }
        const baseName=(this.sectionCtx?.sourcePath?.split('/')?.pop()||'meeting').replace(/\.md$/i,'');
        const path=await this.plugin.saveAudioBlob(blob, baseName);
        this.statusEl.setText(`Saved: ${path}`);
        if(this.sectionCtx){ try{ await this.plugin.insertAudioBelow(this.sectionCtx, path); }catch(e){ console.error(e);} }
        if(this.plugin.settings.autoTranscribe){
          this.statusEl.setText("Transcribing…");
          const {text,error}=await transcribeBlob(this.plugin, blob);
          if(error){ new obsidian.Notice(error); this.statusEl.setText("Transcription failed."); }
          else{
            let sumText=""; if(this.plugin.settings.insertSummaryAfterTranscript){ this.statusEl.setText("Summarizing…"); const res=await runSummary(this.plugin, text); if(res.ok) sumText=res.text; }
            if(this.sectionCtx){ await this.plugin.insertTranscriptAndSummaryBelow(this.sectionCtx, text, path, sumText); } else { await this.plugin.insertTranscript(text, sumText); }
            this.statusEl.setText("Transcript (and summary) inserted.");
          }
        }
      }catch(e){ console.error(e); new obsidian.Notice("Failed to save or transcribe recording."); }
      finally{ this.setState('idle'); this.resetTimer(); }
    });
    this.tsBtn.addEventListener("click", ()=>{
      const view=this.plugin.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
      if(view?.editor){ const ts=humanTime(this.elapsed); view.editor.replaceSelection(`⏱ ${ts} — `); }
    });
  }
  updateLevel(level){
    const intensity=Math.max(0.05,level); const n=this.bars.length;
    for(let i=0;i<n;i++){ const factor=1+intensity*(0.6+1.4*(i/(n-1))); this.bars[i].style.transform=`scaleY(${factor.toFixed(3)})`; }
  }
}

/** Modal recorder **/
class RecorderModal extends obsidian.Modal{
  constructor(plugin, initialLabel="Record meeting"){ super(plugin.app); this.plugin=plugin; this.label=initialLabel; this.controller=new RecorderController(plugin); this.elapsed=0; this.elapsedTimer=null; this.state='idle'; }
  onOpen(){
    const {contentEl}=this; contentEl.empty(); contentEl.addClass("meeting-recorder-modal"); contentEl.createEl("h3",{text:this.label});
    const row=contentEl.createDiv({cls:"row"}); this.lightEl=row.createDiv({cls:"meeting-recorder-light"}); this.timerEl=row.createDiv({cls:"meeting-recorder-timer",text:"0:00"});
    const wave=contentEl.createDiv({cls:"meeting-recorder-wave"}); this.bars=[]; for(let i=0;i<48;i++) this.bars.push(wave.createDiv({cls:"bar"}));
    contentEl.createDiv({cls:"meeting-divider"});
    const controls=contentEl.createDiv({cls:"meeting-controls"});
    this.startBtn=controls.createEl("button",{text:"▶ Start",cls:"mr-btn mr-btn-primary"});
    this.pauseBtn=controls.createEl("button",{text:"⏸ Pause",cls:"mr-btn"});
    this.resumeBtn=controls.createEl("button",{text:"▶ Resume",cls:"mr-btn"});
    this.stopBtn=controls.createEl("button",{text:"⏹ Stop",cls:"mr-btn mr-btn-danger"});
    this.pauseBtn.setAttr("disabled","true"); this.resumeBtn.setAttr("disabled","true"); this.stopBtn.setAttr("disabled","true");
    this.statusEl=contentEl.createDiv({cls:"meeting-status", text:""});

    const startTimer=()=>{ if(this.elapsedTimer) window.clearInterval(this.elapsedTimer); this.startTs=Date.now()-this.elapsed; this.elapsedTimer=window.setInterval(()=>{ this.elapsed=Date.now()-this.startTs; this.timerEl.setText(humanTime(this.elapsed)); },250); };
    const stopTimer=()=>{ if(this.elapsedTimer){ window.clearInterval(this.elapsedTimer); this.elapsedTimer=null; } };
    const resetTimer=()=>{ stopTimer(); this.elapsed=0; this.timerEl.setText("0:00"); };

    const setState=(next)=>{
      this.state=next; const on=(b,v)=> v?b.removeAttribute('disabled'):b.setAttr('disabled','true');
      if(next==='idle'){ on(this.startBtn,true); on(this.pauseBtn,false); on(this.resumeBtn,false); on(this.stopBtn,false); this.lightEl.removeClass('recording'); this.statusEl.setText(''); }
      else if(next==='recording'){ on(this.startBtn,false); on(this.pauseBtn,true); on(this.resumeBtn,false); on(this.stopBtn,true); this.lightEl.addClass('recording'); this.statusEl.setText('Recording…'); }
      else if(next==='paused'){ on(this.startBtn,false); on(this.pauseBtn,false); on(this.resumeBtn,true); on(this.stopBtn,true); this.lightEl.removeClass('recording'); this.statusEl.setText('Paused'); }
      else{ on(this.startBtn,false); on(this.pauseBtn,false); on(this.resumeBtn,false); on(this.stopBtn,false); this.lightEl.removeClass('recording'); this.statusEl.setText('Finalizing…'); }
    };

    this.startBtn.addEventListener("click", async()=>{
      if(this.state!=='idle') return;
      try{ this.statusEl.setText("Requesting microphone…"); const info=await this.controller.start(); setState('recording'); startTimer(); this.statusEl.setText(`Recording (${info.fallback?"WAV fallback":info.mimeType||"audio"})…`); }
      catch(e){ console.error(e); setState('idle'); this.statusEl.setText(""); new obsidian.Notice("Failed to start recording. Check microphone permissions."); }
    });
    this.pauseBtn.addEventListener("click", ()=>{ if(this.state!=='recording') return; try{ this.controller.pause(); }catch{}; stopTimer(); setState('paused'); });
    this.resumeBtn.addEventListener("click", ()=>{ if(this.state!=='paused') return; try{ this.controller.resume(); }catch{}; startTimer(); setState('recording'); });
    this.stopBtn.addEventListener("click", async()=>{
      if(this.state!=='recording'&&this.state!=='paused') return;
      setState('finalizing'); stopTimer(); this.timerEl.setText(humanTime(this.elapsed));
      let blob=null; try{ blob=await this.controller.stop(); }catch(e){ console.error(e); }
      try{
        if(!blob){ this.statusEl.setText("Nothing recorded."); setState('idle'); resetTimer(); return; }
        const path=await this.plugin.saveAudioBlob(blob);
        this.statusEl.setText(`Saved: ${path}`);
        if(this.plugin.settings.autoTranscribe){
          this.statusEl.setText("Transcribing…");
          const {text,error}=await transcribeBlob(this.plugin, blob);
          if(error){ this.statusEl.setText("Transcription failed."); new obsidian.Notice(error); }
          else{
            let sumText=""; if(this.plugin.settings.insertSummaryAfterTranscript){ this.statusEl.setText("Summarizing…"); const res=await runSummary(this.plugin, text); if(res.ok) sumText=res.text; }
            await this.plugin.insertTranscript(text, sumText);
            this.statusEl.setText("Transcript (and summary) inserted.");
          }
        }
      }catch(e){ console.error(e); new obsidian.Notice("Failed to save or transcribe recording."); }
      finally{ setState('idle'); resetTimer(); }
    });
  }
  onClose(){ if(this.elapsedTimer) window.clearInterval(this.elapsedTimer); if(this.controller?.isRecording) this.controller.stop(); this.contentEl.empty(); }
  updateLevel(level){ const n=this.bars.length; const intensity=Math.max(0.05,level); for(let i=0;i<n;i++){ const factor=1+intensity*(0.6+1.4*(i/(n-1))); this.bars[i].style.transform=`scaleY(${factor.toFixed(3)})`; } }
}

/** Main plugin **/
class WhisperNotesPlugin extends obsidian.Plugin{
  async onload(){
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.levelConsumers = new Set();
    this.addCommand({ id:"open-recorder", name:"Whisper Notes: Open recorder", callback:()=>this.openRecorder() });
    this.addCommand({ id:"insert-recorder-block", name:"Whisper Notes: Insert recorder block", editorCallback:(editor)=>{ editor.replaceSelection("```whisper-notes\nlabel: Record meeting\n```\n"); }});
    const makeRenderer = (src, el, ctx) => {
      const lines = src.split("\\n").map(s=>s.trim()).filter(Boolean);
      let label="Record meeting"; for(const l of lines){ const m=l.match(/^label\\s*:\\s*(.+)$/i); if(m) label=m[1]; }
      const info = ctx.getSectionInfo(el); const sectionCtx = info ? { sourcePath: ctx.sourcePath, lineStart: info.lineStart, lineEnd: info.lineEnd } : undefined;
      new InlineRecorderView(this, el, label, sectionCtx);
    };
    this.registerMarkdownCodeBlockProcessor("whisper-notes", makeRenderer);
    this.registerMarkdownCodeBlockProcessor("meeting-recorder", makeRenderer);
    this.addSettingTab(new WhisperNotesSettingTab(this.app,this));
  }
  onunload(){}
  addLevelConsumer(c){ this.levelConsumers.add(c); }
  removeLevelConsumer(c){ this.levelConsumers.delete(c); }
  dispatchLevel(level){ for(const c of this.levelConsumers) try{ c(level); }catch{} }
  dtStamp(){ return dtStamp(); }
  humanTime(ms){ return humanTime(ms); }
  async ensureFolder(folder){ return ensureFolder(this.app, folder); }
  openRecorder(label="Record meeting"){
    const modal=new RecorderModal(this,label);
    const consumer=(l)=>modal.updateLevel(l);
    this.levelConsumers.add(consumer); modal.open();
    const origClose=modal.close.bind(modal); modal.close=()=>{ this.levelConsumers.delete(consumer); origClose(); };
  }
  async saveAudioBlob(blob, baseName){
    const ext = blob.type?.includes("wav") ? "wav" : (blob.type?.includes("ogg") ? "ogg" : "webm");
    const folder = this.settings.audioFolder || "Recordings"; await ensureFolder(this.app, folder);
    let name = baseName ? sanitizeFilename(baseName) : `meeting-${dtStamp()}`;
    let path = `${folder}/${name}.${ext}`;
    try{ if(await this.app.vault.adapter.exists(path)) path = `${folder}/${name} ${dtStamp()}.${ext}`; }catch{}
    const buf = await blob.arrayBuffer(); await this.app.vault.createBinary(path, buf); return path;
  }
  async insertTranscript(transcript, summary=""){
    const s=this.settings; const folder=s.transcriptFolder||"Recordings"; await ensureFolder(this.app, folder);
    const title=`Transcript ${dtStamp()}.md`; const path=`${folder}/${title}`;
    let body=`---
created: ${new Date().toISOString()}
---

# Transcript

${transcript}
`;
    if(s.insertSummaryAfterTranscript && summary){ body+=`\n${s.summaryHeading||"## Summary"}\n\n${summary}\n`; }
    await this.app.vault.create(path, body);
    if(s.insertTranscriptInCurrentNote){
      const view=this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
      if(view?.editor){
        const heading=(s.transcriptHeading||"## Transcript").trim();
        let toInsert=`\n\n${heading}\n\n${transcript}\n`;
        if(s.insertSummaryAfterTranscript && summary){ toInsert+=`\n${s.summaryHeading||"## Summary"}\n\n${summary}\n`; }
        const cursor=view.editor.getCursor(); view.editor.replaceRange(toInsert, cursor);
      }
    }
    if(s.openAfterTranscribe){ const leaf=this.app.workspace.getLeaf(true); const file=this.app.vault.getAbstractFileByPath(path); if(file) await leaf.openFile(file); }
  }
  async insertAudioBelow(sectionCtx, audioPath){
    const file=this.app.vault.getAbstractFileByPath(sectionCtx.sourcePath);
    let view=this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    if(!view || view.file?.path!==sectionCtx.sourcePath){ const leaf=this.app.workspace.getLeaf(true); if(file) await leaf.openFile(file); view=this.app.workspace.getActiveViewOfType(obsidian.MarkdownView); }
    if(!view?.editor) return;
    const headingLine=sectionCtx.lineEnd+1; const base=audioPath.split('/').pop(); if(!base) return;
    const embed=`![[${base}]]\n\n`; const value=view.editor.getValue(); if(value.includes(`![[${base}]]`)) return;
    view.editor.replaceRange(embed, {line:headingLine, ch:0});
  }
  async insertTranscriptAndSummaryBelow(sectionCtx, transcript, audioPath, summary=""){
    const file=this.app.vault.getAbstractFileByPath(sectionCtx.sourcePath);
    let view=this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    if(!view || view.file?.path!==sectionCtx.sourcePath){ const leaf=this.app.workspace.getLeaf(true); if(file) await leaf.openFile(file); view=this.app.workspace.getActiveViewOfType(obsidian.MarkdownView); }
    if(!view?.editor) return;
    const headingLine=sectionCtx.lineEnd+1; const base=audioPath?audioPath.split('/').pop():undefined;
    let out="";
    if(base){ const val=view.editor.getValue(); if(!val.includes(`![[${base}]]`)) out+=`![[${base}]]\n\n`; }
    out+=`${this.settings.transcriptHeading||"## Transcript"}\n\n${transcript}\n`;
    if(this.settings.insertSummaryAfterTranscript && summary){ out+=`\n${this.settings.summaryHeading||"## Summary"}\n\n${summary}\n`; }
    view.editor.replaceRange(out,{line:headingLine, ch:0});
    try{ view.editor.setCursor({line:headingLine, ch:0}); setTimeout(()=>{ this.app.commands.executeCommandById("editor:fold-heading"); },0); }catch{}
  }
}

/** Settings Tab **/
class WhisperNotesSettingTab extends obsidian.PluginSettingTab{
  constructor(app, plugin){ super(app,plugin); this.plugin=plugin; }
  display(){
    const {containerEl}=this; containerEl.empty();
    containerEl.createEl("h2",{text:"Whisper Notes"});
    new obsidian.Setting(containerEl).setName("Audio folder").setDesc("Where audio files are saved").addText(t=>t.setPlaceholder("Recordings").setValue(this.plugin.settings.audioFolder).onChange(async v=>{ this.plugin.settings.audioFolder=v||"Recordings"; await this.plugin.saveData(this.plugin.settings); }));
    new obsidian.Setting(containerEl).setName("Transcript folder").setDesc("Where transcript notes are saved").addText(t=>t.setPlaceholder("Recordings").setValue(this.plugin.settings.transcriptFolder).onChange(async v=>{ this.plugin.settings.transcriptFolder=v||"Recordings"; await this.plugin.saveData(this.plugin.settings); }));
    new obsidian.Setting(containerEl).setName("Insert transcript into current note").setDesc("Also insert under a heading where your cursor is").addToggle(t=>t.setValue(this.plugin.settings.insertTranscriptInCurrentNote).onChange(async v=>{ this.plugin.settings.insertTranscriptInCurrentNote=v; await this.plugin.saveData(this.plugin.settings); }));
    new obsidian.Setting(containerEl).setName("Transcript heading").setDesc("Heading used when inserting into the current note").addText(t=>t.setPlaceholder("## Transcript").setValue(this.plugin.settings.transcriptHeading).onChange(async v=>{ this.plugin.settings.transcriptHeading=v||"## Transcript"; await this.plugin.saveData(this.plugin.settings); }));
    containerEl.createEl("h3",{text:"Transcription"});
    new obsidian.Setting(containerEl).setName("Provider").setDesc("Currently supports OpenAI Whisper");
    new obsidian.Setting(containerEl).setName("OpenAI Base URL").addText(t=>t.setPlaceholder("https://api.openai.com/v1").setValue(this.plugin.settings.transcribeBaseUrl).onChange(async v=>{ this.plugin.settings.transcribeBaseUrl=v||"https://api.openai.com/v1"; await this.plugin.saveData(this.plugin.settings); }));
    new obsidian.Setting(containerEl).setName("OpenAI API Key").addText(t=>t.setPlaceholder("sk-...").setValue(this.plugin.settings.transcribeApiKey).onChange(async v=>{ this.plugin.settings.transcribeApiKey=v; await this.plugin.saveData(this.plugin.settings); }));
    new obsidian.Setting(containerEl).setName("Whisper model").addText(t=>t.setPlaceholder("whisper-1").setValue(this.plugin.settings.transcribeModel).onChange(async v=>{ this.plugin.settings.transcribeModel=v||"whisper-1"; await this.plugin.saveData(this.plugin.settings); }));
    new obsidian.Setting(containerEl).setName("Language hint (optional)").setDesc("e.g., en, es-ES").addText(t=>t.setValue(this.plugin.settings.language).onChange(async v=>{ this.plugin.settings.language=v; await this.plugin.saveData(this.plugin.settings); }));
    new obsidian.Setting(containerEl).setName("Auto-transcribe after recording").addToggle(t=>t.setValue(this.plugin.settings.autoTranscribe).onChange(async v=>{ this.plugin.settings.autoTranscribe=v; await this.plugin.saveData(this.plugin.settings); }));
    containerEl.createEl("h3",{text:"LLM (Summaries, To-dos, etc.)"});
    new obsidian.Setting(containerEl).setName("OpenAI-compatible Base URL").addText(t=>t.setPlaceholder("https://api.openai.com/v1").setValue(this.plugin.settings.llmBaseUrl).onChange(async v=>{ this.plugin.settings.llmBaseUrl=v||"https://api.openai.com/v1"; await this.plugin.saveData(this.plugin.settings); }));
    new obsidian.Setting(containerEl).setName("API Key").addText(t=>t.setPlaceholder("sk-...").setValue(this.plugin.settings.llmApiKey).onChange(async v=>{ this.plugin.settings.llmApiKey=v; await this.plugin.saveData(this.plugin.settings); }));
    new obsidian.Setting(containerEl).setName("Chat model").addText(t=>t.setPlaceholder("gpt-4o-mini").setValue(this.plugin.settings.llmModel).onChange(async v=>{ this.plugin.settings.llmModel=v||"gpt-4o-mini"; await this.plugin.saveData(this.plugin.settings); }));
    new obsidian.Setting(containerEl).setName("Custom summary prompt").setDesc("Override the default summary instructions sent to your LLM").addTextArea(t=>{ t.setPlaceholder("Write an executive summary focusing on outcomes, owners, and deadlines…").setValue(this.plugin.settings.summaryPrompt).onChange(async v=>{ this.plugin.settings.summaryPrompt=v; await this.plugin.saveData(this.plugin.settings); }); });
    new obsidian.Setting(containerEl).setName("Insert summary after transcript").setDesc("If enabled and an LLM key is set, the plugin inserts a “Summary” section after the Transcript.").addToggle(t=>t.setValue(this.plugin.settings.insertSummaryAfterTranscript).onChange(async v=>{ this.plugin.settings.insertSummaryAfterTranscript=v; await this.plugin.saveData(this.plugin.settings); }));
    new obsidian.Setting(containerEl).setName("Summary heading").addText(t=>t.setPlaceholder("## Summary").setValue(this.plugin.settings.summaryHeading).onChange(async v=>{ this.plugin.settings.summaryHeading=v||"## Summary"; await this.plugin.saveData(this.plugin.settings); }));
  }
}

module.exports = { default: WhisperNotesPlugin };

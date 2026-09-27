const jobs=new Map<string,()=>void>();
export function registerJob({id,intervalMs,run}:{id:string;intervalMs:number;run:()=>Promise<void>}) {
  jobs.get(id)?.();let stopped=false;let timer:ReturnType<typeof setTimeout>;
  const tick=async()=>{try{await run();}catch(error){console.warn("Tournament update failed",error);}finally{if(!stopped)timer=setTimeout(tick,intervalMs);}};
  timer=setTimeout(tick,intervalMs);
  const stop=()=>{stopped=true;clearTimeout(timer);};jobs.set(id,stop);return stop;
}

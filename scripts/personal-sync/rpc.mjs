import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

export class JsonLineProcess {
  constructor(executable) {
    this.child=spawn(executable,[],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    this.pending=[];this.failure=null;this.stderr='';
    this.child.stderr.on('data',b=>{this.stderr=(this.stderr+b).slice(-4000);});
    createInterface({input:this.child.stdout}).on('line',line=>{
      const request=this.pending.shift();if(!request)return this.fail(Error('Unexpected helper reply'));
      clearTimeout(request.timer);
      try{const response=JSON.parse(line);response.ok?request.resolve(response.value):request.reject(Error(response.error));}catch(error){request.reject(error);}
    });
    this.child.on('error',e=>this.fail(e));
    this.child.on('exit',code=>this.fail(Error(`Sync helper exited (${code}): ${this.stderr}`)));
  }
  fail(error){this.failure=error;for(const p of this.pending){clearTimeout(p.timer);p.reject(error);}this.pending=[];}
  request(value){
    if(this.failure)return Promise.reject(this.failure);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.fail(Error('Sync helper timed out'));this.child.kill();},30000);
      this.pending.push({resolve,reject,timer});
      this.child.stdin.write(JSON.stringify(value)+'\n',error=>{if(error)this.fail(error);});
    });
  }
  close(){this.child.stdin.end();}
}

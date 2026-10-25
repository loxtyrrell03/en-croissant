import {Button,Group,Stack,Text} from "@mantine/core";
import {useEffect,useRef,useState} from "react";
import {PerformanceHelp} from "@/shared/PerformanceHelp";
import {createPersonalSync,type PersonalSyncStatus} from "./personalSync";
import {webStateSession} from "./webStateSession";

export default function PhonePersonalSync(){
    const [status,setStatus]=useState<PersonalSyncStatus>({enabled:false});
    const sync=useRef<ReturnType<typeof createPersonalSync>|null>(null);
    useEffect(()=>{
        const controller=createPersonalSync({publish:setStatus});sync.current=controller;
        const tick=()=>{if(!document.hidden)void controller.tick();};
        const timer=setInterval(tick,10_000);let scheduled:ReturnType<typeof setTimeout>|null=null;
        const unsubscribe=webStateSession.subscribe(()=>{if(scheduled)clearTimeout(scheduled);scheduled=setTimeout(tick,750);});
        window.addEventListener("online",tick);document.addEventListener("visibilitychange",tick);tick();
        return()=>{controller.stop();sync.current=null;clearInterval(timer);if(scheduled)clearTimeout(scheduled);unsubscribe();window.removeEventListener("online",tick);document.removeEventListener("visibilitychange",tick);};
    },[]);
    if(!status.enabled)return null;
    const failure=status.message??status.errors?.[0]?.error??status.conflicts?.[0]?.reason;
    return <Stack gap={3} px="sm" py={6} aria-label="Personal library sync">
        <Group gap="xs" wrap="wrap">
            <Text size="xs" c={failure?"orange":"dimmed"}>{failure?"Library sync needs attention":status.phase==="syncing"?"Syncing shared library…":"Shared library connected"}</Text>
            <PerformanceHelp label="About library sync">Saved games, annotations and personal files sync with Novelty Dev and En Croissant on your PC. Downloaded references stay read-only. Previous phone databases remain under Archived sources.</PerformanceHelp>
            {failure?<Button size="compact-xs" variant="subtle" onClick={()=>void sync.current?.tick()}>Retry sync</Button>:null}
        </Group>
        {failure?<Text size="xs" c="orange" role="alert">{failure}</Text>:null}
        {status.updateAvailable?<Text size="xs" c="dimmed">The saved game changed on the PC. Reopen it from Files to load that version; your current board stays open.</Text>:null}
    </Stack>;
}

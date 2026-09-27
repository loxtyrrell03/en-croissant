"""Editable SVG workflow prototypes. Standard library only; no user/app data."""
from pathlib import Path
import html
import json
import textwrap

ROOT = Path(__file__).resolve().parent
C = dict(bg="#111315", panel="#1b1e22", field="#25272d", line="#34383f", text="#f1f3f5", muted="#a7acb4", blue="#74c0fc", button="#1971c2", good="#8ce99a", warn="#ffd43b", bad="#ffa8a8")
DESIGNS = {
    "A": ("Tournament hub", "An event workspace with the next round first.", "Recommended: the most direct path from a prediction to Prep."),
    "B": ("Round timeline", "Track the event round by round.", "Best when you usually think in rounds, results and progress."),
    "C": ("Prep workspace", "Keep pairing choices beside your preparation.", "Best when you spend most of your time on the board."),
}
STATES = [
    ("main", "Next round"), ("discover", "Find a tournament"), ("setup", "Section and your entry"),
    ("published", "Published pairing"), ("players", "Players and new entrants"), ("player", "Opponent details"),
    ("standings", "Standings"), ("results", "Results by round"), ("import", "Import settings"),
    ("importing", "Searching and progress"), ("saving", "Saving and recovery"), ("ready", "Games ready"),
    ("prep", "Prepare against opponent"), ("tracking", "Tracking settings"), ("bulk", "Import players"),
    ("downloads", "Local games and dates"), ("download-progress", "Download / local preparation"),
    ("help", "Pairing help"), ("loading", "Loading / calculating"), ("empty", "No tournaments"),
    ("no-games", "No public games"), ("error", "Refresh or source failure"), ("offline", "PC unavailable"),
    ("cancellation", "Stopped import"), ("identity", "Missing FIDE identity"), ("partial", "Partial source coverage"),
    ("remove", "Stop following / remove"), ("archive-remove", "Remove local archive"),
]

def esc(s): return html.escape(str(s), quote=True)

class SVG:
    def __init__(self, width=360, height=820, design="A", title=""):
        self.w, self.h, self.design = width, height, design
        self.items = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="{esc(title)}">',
            f'<title>{esc(title)} — invented example data</title>',
            '<style>text{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{cursor:pointer}a:hover rect,a:focus rect{stroke:#74c0fc;stroke-width:2}a:focus{outline:none}</style>']
        self.rect(0,0,width,height,C["bg"],0)
    def rect(self,x,y,w,h,fill=None,r=8,stroke=None):
        self.items.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill or C["panel"]}"{f" stroke={esc(chr(34)+stroke+chr(34))}" if False else (f" stroke=\"{stroke}\"" if stroke else "")}/>')
    def line(self,x,y,x2,y2): self.items.append(f'<path d="M{x} {y}H{x2}" stroke="{C["line"]}"/>')
    def text(self,x,y,s,size=14,color=None,bold=False):
        self.items.append(f'<text x="{x}" y="{y}" font-size="{size}" fill="{color or C["text"]}" font-weight="{650 if bold else 400}">{esc(s)}</text>')
    def wrap(self,x,y,s,width=40,size=14,color=None):
        for i,line in enumerate(textwrap.wrap(s,width=width)): self.text(x,y+i*(size+6),line,size,color)
    def link(self,x,y,w,h,label,state,primary=False,color=None):
        self.items.append(f'<a href="index.html?design={self.design}&amp;state={state}" target="_top" tabindex="0" aria-label="{esc(label)}">')
        self.rect(x,y,w,h,C["button"] if primary else C["field"],7,C["line"] if not primary else None)
        self.text(x+12,y+h/2+5,label,14,color or C["text"],primary)
        self.items.append('</a>')
    def chip(self,x,y,w,label,color=None):
        self.rect(x,y,w,25,"#183249" if not color else C["panel"],6)
        self.text(x+8,y+17,label,11,color or C["blue"],True)
    def field(self,y,label,value,action=None):
        self.text(20,y,label,13,C["muted"])
        if action:self.link(20,y+12,320,44,value,action)
        else:
            self.rect(20,y+12,320,44,C["field"],7,C["line"])
            self.text(32,y+40,value,15)
    def board(self,x,y,size=320):
        step=size/8
        for r in range(8):
            for c in range(8):self.rect(x+c*step,y+r*step,step,step,"#eeeed2" if (r+c)%2==0 else "#769656",0)
        # A simple, labelled opening position; decorative study board only.
        pieces=[(0,0,"♜"),(1,0,"♞"),(2,0,"♝"),(3,0,"♛"),(4,0,"♚"),(5,0,"♝"),(6,0,"♞"),(7,0,"♜"),
                (0,7,"♖"),(1,7,"♘"),(2,7,"♗"),(3,7,"♕"),(4,7,"♔"),(5,7,"♗"),(6,7,"♘"),(7,7,"♖")]
        pieces += [(c,3 if c==4 else 1,"♟") for c in range(8)] + [(c,4 if c==4 else 6,"♙") for c in range(8)]
        for c,r,p in pieces:self.text(x+c*step+step*.14,y+r*step+step*.8,p,int(step*.8),"#161616")
    def finish(self): return "\n".join(self.items+['</svg>'])

def chrome(s,state):
    s.text(20,30,"♙  En Croissant",17,bold=True)
    s.text(274,29,"PC ready",12,C["good"])
    nav=[("Board","prep"),("Import","import"),("Events","main"),("Files","ready")]
    if s.design=="B":nav=[("Today","main"),("Rounds","results"),("Import","import"),("Files","ready")]
    if s.design=="C":nav=[("Board","prep"),("Pairings","main"),("Import","import"),("Files","ready")]
    for i,(label,target) in enumerate(nav):
        s.link(16+i*84,46,78,38,label,target,primary=(state==target or (target=="main" and state not in ("prep","import","ready"))))
    s.line(0,96,360,96)
    s.text(20,802,"DESIGN "+s.design+" · INVENTED EXAMPLE DATA",10,C["muted"])

def section(s,title,subtitle=None):
    s.text(20,128,title,21,bold=True)
    if subtitle:s.wrap(20,151,subtitle,43,13,C["muted"])

def row(s,y,name,detail,chance,action="Import & prep",target="import"):
    s.text(20,y,name,17,bold=True)
    s.text(20,y+24,detail,12,C["muted"])
    s.text(20,y+54,chance,13,C["blue"])
    s.link(195,y+35,145,42,action,target,True)
    s.line(20,y+94,340,y+94)

def main(s,published=False):
    section(s,"Harbour Open", "Open section · 9 rounds · Following")
    s.link(20,172,153,38,"Change event","discover")
    s.link(183,172,157,38,"Tracking settings","tracking")
    if s.design=="A":
        s.text(20,246,"Next round · Round 5",19,bold=True)
        s.text(20,270,"Round 4: 36 of 48 results reported",12,C["muted"])
        s.link(310,229,30,32,"?","help")
        s.chip(20,288,153,"Published pairing" if published else "Pairing estimates")
        row(s,344,"Alex Morgan","FIDE 00000001 · Event rating 2140","You play Black" if published else "42% pairing chance · Black expected")
        if not published:
            row(s,465,"Jamie Reed","FIDE 00000002 · Event rating 2090","26% pairing chance · Colour unknown","Open Prep","prep")
            s.text(20,576,"Other opponents: 32% combined",12,C["muted"])
        else:
            s.text(20,466,"Board 12 · Pairing published by organiser",13,C["muted"])
            s.wrap(20,500,"Your previous preparation is saved. Confirmed colours will be used when opening Prep.",42,14)
        s.link(20,614,153,44,"All players","players")
        s.link(183,614,157,44,"Standings","standings")
        s.link(20,671,153,44,"Round results","results")
        s.link(183,671,157,44,"Check now","loading")
    elif s.design=="B":
        s.text(20,243,"Your tournament",19,bold=True)
        s.text(20,268,"You · 3 points from 4 rounds",14,C["muted"])
        for i,(label,target) in enumerate([("R1 ✓","results"),("R2 ✓","results"),("R3 ✓","results"),("R4 …","results"),("R5","main")]):
            s.link(20+i*65,289,59,42,label,target,primary=i==4)
        s.text(20,366,"Round 5",22,bold=True)
        s.chip(20,383,153,"Published pairing" if published else "Pairing estimates")
        row(s,442,"Alex Morgan","Event rating 2140 · 3 points","Black confirmed" if published else "42% pairing chance · Black expected")
        s.link(20,554,320,44,"Compare likely opponents","players")
        s.text(20,633,"Round 4 is still in progress",16,bold=True)
        s.text(20,658,"36 of 48 results reported",13,C["muted"])
        s.link(20,685,153,44,"Live results","results")
        s.link(183,685,157,44,"Standings","standings")
    else:
        s.text(20,245,"Your next opponent",20,bold=True)
        s.chip(20,265,153,"Published pairing" if published else "Round 5 estimates")
        row(s,322,"Alex Morgan","Event rating 2140 · FIDE 00000001","You play Black" if published else "42% pairing chance · Black expected")
        s.text(20,442,"Preparation queue",17,bold=True)
        s.rect(20,461,320,82)
        s.text(33,488,"Jamie Reed",15,bold=True)
        s.text(33,514,"128 games ready · 26% pairing chance",12,C["muted"])
        s.link(20,555,320,44,"Open saved preparation","prep",True)
        s.link(20,614,153,44,"More opponents","players")
        s.link(183,614,157,44,"Event details","standings")
        s.text(20,690,"Board and saved lines stay in place",13,C["muted"])
        s.link(20,712,320,44,"Check pairings now","loading")

def mobile(design,state):
    s=SVG(design=design,title=f"{DESIGNS[design][0]}: {dict(STATES)[state]}")
    chrome(s,state)
    if state in ("main","published"):main(s,state=="published")
    elif state=="discover":
        section(s,"Find a tournament","Search by name, country, place or link.")
        s.field(187,"Event name or Chess-Results link","Harbour Open")
        s.field(272,"When","Upcoming ▾")
        s.field(357,"Country / time control","United Kingdom · Classical ▾")
        s.link(20,429,320,44,"Search tournaments","loading",True)
        s.text(20,511,"Harbour Chess Festival",18,bold=True)
        s.text(20,537,"2–4 October · Cardiff · Classical",13,C["muted"])
        s.text(20,562,"Open · Major · Minor sections",13)
        s.link(20,584,320,44,"Choose section","setup",True)
        s.link(20,681,320,44,"Following events","main")
    elif state=="setup":
        section(s,"Follow Harbour Open","Confirm the event and your entry.")
        s.field(187,"Section","Open · 96 players ▾","players")
        s.field(277,"Your entry","Sam Taylor · Event rating 2075 ▾","players")
        s.text(20,354,"FIDE 00000009 · Example identity",13,C["muted"])
        s.field(406,"Import games since","2023")
        s.wrap(20,488,"Your entry determines your next-round predictions and preparation colour.",39)
        s.link(20,574,320,44,"Follow tournament","main",True)
        s.link(20,632,320,44,"Follow without choosing my entry","players")
        s.link(20,696,320,44,"Back to search","discover")
    elif state=="players":
        section(s,"Players","Harbour Open · 96 entries · 3 new")
        s.field(185,"Search players or FIDE ID","Search name or FIDE ID")
        s.link(20,258,153,40,"All players","players",True)
        s.link(183,258,157,40,"New players (3)","players")
        row(s,337,"Alex Morgan","Event rating 2140 · FIDE 00000001","3 points · Predicted next opponent","Details","player")
        row(s,461,"Jamie Reed","Event rating 2090 · FIDE 00000002","128 games ready","Open Prep","prep")
        row(s,585,"Chris Lane","Event rating unavailable · No FIDE ID","Exact OTB import unavailable","Details","identity")
        s.link(20,710,320,44,"Import players…","bulk")
    elif state=="player":
        section(s,"Alex Morgan","Event rating 2140 · FIDE 00000001")
        s.chip(20,181,174,"42% pairing chance")
        s.text(20,237,"3 points from 4 rounds",19,bold=True)
        s.text(20,266,"Results: Win · Draw · Win · Draw",13,C["muted"])
        s.field(319,"Your preparation colour","I'm Black ▾","import")
        s.text(20,407,"Public games",17,bold=True)
        s.text(20,433,"Not imported",14,C["muted"])
        s.link(20,466,320,44,"Import & prep","import",True)
        s.link(20,524,320,44,"Import games only","import")
        s.link(20,609,153,44,"Round history","results")
        s.link(183,609,157,44,"Back to players","players")
    elif state=="standings":
        section(s,"Standings","Harbour Open · Organiser's standings")
        s.field(183,"After round","Round 4 ▾","results")
        s.text(20,282,"Rank / player",12,C["muted"]);s.text(265,282,"Points",12,C["muted"])
        for i,(name,score) in enumerate([("Alex Morgan","3"),("Sam Taylor (you)","3"),("Jamie Reed","2½"),("Chris Lane","2")]):
            y=320+i*74
            if i==1:s.rect(16,y-27,328,60,"#183249",6)
            s.text(25,y,f"{i+1}   {name}",15,bold=i==1);s.text(290,y,score,16,bold=True)
            s.text(48,y+23,"Event rating "+["2140","2075","2090","unavailable"][i],12,C["muted"])
        s.link(20,644,153,44,"Player details","player")
        s.link(183,644,157,44,"Next round","main")
    elif state=="results":
        section(s,"Round results","Harbour Open")
        s.field(182,"Round","Round 4 · in progress ▾")
        s.text(20,287,"36 of 48 results reported",17,bold=True)
        for i,(board,names,result) in enumerate([(1,"Alex Morgan / Jamie Reed","½–½"),(2,"Sam Taylor / Pat Ellis","1–0"),(3,"Casey Lee / Chris Lane","Awaiting result")]):
            y=336+i*104;s.text(20,y,f"Board {board}",12,C["muted"]);s.text(20,y+26,names,14,bold=True);s.text(20,y+52,result,14,C["blue"]);s.line(20,y+69,340,y+69)
        s.link(20,685,153,44,"Check results","loading")
        s.link(183,685,157,44,"Next round","main",True)
    elif state=="import":
        section(s,"Import Alex Morgan","FIDE 00000001 · Identity locked")
        s.field(186,"Games since","2023")
        s.field(274,"Your preparation colour","I'm Black ▾")
        s.field(362,"Sources","All 7 source groups on ▾","downloads")
        s.text(20,450,"Destination",13,C["muted"])
        s.wrap(20,477,"Harbour Open / Alex Morgan",37,16)
        s.text(20,517,"Ready games: none yet",13,C["muted"])
        s.link(20,555,320,44,"Local games & download settings","downloads")
        s.link(20,638,320,48,"Import & prep","importing",True)
        s.link(20,700,320,44,"Back to predictions","main")
    elif state=="importing":
        section(s,"Importing Alex Morgan","Games since 2023 · FIDE 00000001")
        s.text(20,206,"Searching sources",21,bold=True)
        s.text(20,239,"4 of 7 source groups finished",14,C["muted"])
        s.rect(20,263,320,7,C["field"],3);s.rect(20,263,183,7,C["button"],3)
        for i,(label,value) in enumerate([("Lichess archive","Complete"),("Targeted broadcasts","Searching…"),("Chess-Results","Complete"),("TWIC","Downloading…"),("Other source groups","2 of 3 complete")]):
            y=318+i*52;s.text(20,y,label,14);s.text(214,y,value,12,C["muted"]);s.line(20,y+19,340,y+19)
        s.text(20,612,"128 matching games found so far",14,bold=True)
        s.text(20,638,"Saving and validation follow the search.",12,C["muted"])
        s.link(20,671,153,44,"Stop search","cancellation")
        s.link(183,671,157,44,"Keep tracking","main")
        s.link(20,732,320,40,"Preview next state: save","saving")
    elif state=="saving":
        section(s,"Save imported games","Alex Morgan · Search finished")
        s.text(20,214,"128 games collected",21,bold=True)
        s.text(20,247,"Could not finish saving",16,C["warn"])
        s.wrap(20,286,"The collected games are retained. Retry saving to finish this import.",40)
        s.text(20,378,"Search sources                 Complete",14)
        s.text(20,414,"Save games                      Needs retry",14,C["warn"])
        s.text(20,450,"Open Prep                       Waiting",14,C["muted"])
        s.link(20,525,320,48,"Retry saving games","ready",True)
        s.link(20,588,320,44,"Back to tournament","main")
    elif state=="ready":
        section(s,"Games ready","Alex Morgan · FIDE 00000001")
        s.text(20,218,"128 games saved",24,C["good"],True)
        s.text(20,251,"Games since 2023 · All sources finished",13,C["muted"])
        s.field(311,"Your preparation colour","I'm Black ▾","prep")
        s.link(20,399,320,48,"Open Prep","prep",True)
        s.link(20,461,320,44,"Browse games","player")
        s.link(20,523,320,44,"Check for new games","import")
        s.link(20,682,320,44,"Back to next round","main")
    elif state=="prep":
        section(s,"Prep · Alex Morgan","Harbour Open · Round 5 · I'm Black")
        s.board(20,185,320)
        s.link(20,523,153,40,"I'm White","prep")
        s.link(183,523,157,40,"I'm Black","prep",True)
        s.text(20,599,"Opponent's White games",16,bold=True)
        s.text(20,627,"1. e4       64 games       1. d4       32 games",12,C["muted"])
        s.link(20,652,153,44,"Build prep","prep",True)
        s.link(183,652,157,44,"Saved lines","prep")
        s.link(20,714,320,44,"Back to pairing predictions","main")
    elif state=="tracking":
        section(s,"Tracking settings","Harbour Open · Open section")
        s.field(184,"Your entry","Sam Taylor · FIDE 00000009 ▾","setup")
        s.field(269,"Import games since","2023")
        s.field(354,"Check for tournament updates","On ▾")
        s.field(439,"Update imported opponents' games","On ▾")
        s.text(20,521,"Last roster check: today, 14:32",13,C["muted"])
        s.link(20,547,320,44,"Check now","loading")
        s.link(20,607,320,44,"Local games & downloads","downloads")
        s.link(20,682,320,44,"Stop following…","remove",color=C["bad"])
    elif state=="bulk":
        section(s,"Import tournament players","Harbour Open · Open section")
        s.field(186,"Which players?","Likely next opponents (3) ▾")
        s.text(20,277,"Alex Morgan · FIDE 00000001",14)
        s.text(20,313,"Jamie Reed · 128 games ready",14)
        s.text(20,349,"Pat Ellis · FIDE 00000003",14)
        s.wrap(20,415,"Already saved games are reused. Each opponent keeps their own progress and retry action.",39)
        s.text(20,515,"Also available: all players / new entrants",12,C["muted"])
        s.link(20,569,320,48,"Import 2 players","importing",True)
        s.link(20,632,320,44,"Back to players","players")
    elif state=="downloads":
        section(s,"Local games for OTB imports","Saved on your PC · Shared by your imports")
        s.chip(20,186,201,"Local search enabled")
        s.text(20,245,"Saved months",17,bold=True)
        s.text(20,274,"Jan 2023–Jul 2026 · 43 months",13)
        s.text(20,316,"Missing: Aug 2026 · 1 month",14,C["warn"])
        s.field(359,"Keep local games from","Last 3 years ▾","archive-remove")
        s.field(447,"Download new months automatically","On ▾")
        s.text(20,531,"Update download: 120 MB",14)
        s.text(20,555,"Required setup space: 480 MB",13,C["muted"])
        s.link(20,583,320,48,"Download missing month","download-progress",True)
        s.link(20,645,320,44,"Remove local downloads…","archive-remove")
        s.link(20,707,320,44,"Back to import","import")
    elif state=="download-progress":
        section(s,"Updating local games","August 2026 · Lichess broadcasts")
        s.text(20,219,"Downloading archive",20,bold=True)
        s.text(20,251,"72 MB of 120 MB · 60%",14,C["blue"])
        s.rect(20,275,320,7,C["field"],3);s.rect(20,275,192,7,C["button"],3)
        s.wrap(20,325,"Adding August 2026. The archive may also contain months already saved.",39,14,C["muted"])
        s.link(20,400,320,44,"Cancel download","cancellation")
        s.line(20,485,340,485)
        s.text(20,525,"Next: preparing local search",18,bold=True)
        s.wrap(20,559,"When download finishes, show local preparation separately without a made-up percentage.",37,13,C["muted"])
        s.link(20,677,320,44,"Back to local games","downloads")
    elif state=="help":
        main(s)
        s.rect(34,302,292,130,C["field"],8,C["blue"])
        s.text(49,329,"Pairing chance",15,bold=True)
        s.wrap(49,355,"An estimate of who you will face next round, not your chance of winning. Only published pairings confirm an opponent.",34,13)
        s.link(261,394,52,28,"Close","main")
    elif state=="loading":
        section(s,"Checking Harbour Open","Your last saved tournament stays available.")
        s.text(20,224,"Getting the latest results…",20,bold=True)
        s.wrap(20,267,"Saved update: today, 14:32. New predictions appear when the result check finishes.",40,14,C["muted"])
        for y in (351,404,457):s.rect(20,y,320,32,C["panel"],6)
        s.link(20,554,320,44,"Cancel check","main")
        s.link(20,682,320,44,"Preview updated predictions","main",True)
    elif state=="empty":
        section(s,"Your tournaments")
        s.text(20,227,"Follow your next event",21,bold=True)
        s.wrap(20,274,"See results, likely opponents and their games together.",37,16,C["muted"])
        s.link(20,365,320,48,"Find a tournament","discover",True)
        s.link(20,429,320,44,"Add Chess-Results link","discover")
        s.link(20,684,320,44,"Import a player directly","import")
    elif state=="no-games":
        section(s,"Alex Morgan","FIDE 00000001 · Games since 2023")
        s.text(20,224,"No public games found",21,bold=True)
        s.wrap(20,268,"All selected sources finished. Try an earlier date or add your own PGN games.",38,15,C["muted"])
        s.link(20,378,320,48,"Change dates or sources","import",True)
        s.link(20,440,320,44,"Add PGN games","import")
        s.link(20,684,320,44,"Back to predictions","main")
    elif state=="error":
        section(s,"Could not update tournament","Saved update: today, 14:32")
        s.wrap(20,224,"The results website did not respond. Your saved standings and imported games are still available.",36,16,C["warn"])
        s.link(20,359,320,48,"Retry update","loading",True)
        s.link(20,424,320,44,"View saved tournament","main")
        s.link(20,488,320,44,"Open saved Prep","prep")
    elif state=="offline":
        section(s,"PC is unavailable","Last tournament update: today, 14:32")
        s.wrap(20,224,"Showing saved tournament details. Connect to your PC to refresh pairings or import games.",36,16,C["warn"])
        s.link(20,359,320,48,"Retry connection","loading",True)
        s.link(20,424,320,44,"View saved tournament","main")
        s.wrap(20,519,"Preparation can use games already available on this device. PC-only games wait for reconnection.",38,14,C["muted"])
        s.link(20,619,320,44,"Open available Prep","prep")
    elif state=="cancellation":
        section(s,"Search stopped","Alex Morgan · Original search retained")
        s.wrap(20,226,"Your previously saved games are kept. This PC job stopped before a complete new result was saved.",36,16)
        s.link(20,361,320,48,"Start a new search","import",True)
        s.link(20,424,320,44,"Open previously saved Prep","prep")
        s.link(20,489,320,44,"Back to tournament","main")
        s.wrap(20,593,"If completion wins the Stop race, show Games ready and use that saved result instead.",38,13,C["muted"])
    elif state=="identity":
        section(s,"Chris Lane","Event rating unavailable")
        s.text(20,227,"No FIDE ID published",21,C["warn"],True)
        s.wrap(20,272,"Exact OTB import is unavailable for this entry. Choose a verified FIDE profile before importing.",36,15)
        s.link(20,391,320,48,"Find FIDE profile","import",True)
        s.link(20,455,320,44,"Back to players","players")
        s.text(20,548,"Profile selection must confirm the identity.",12,C["muted"])
    elif state=="partial":
        section(s,"128 games saved","Alex Morgan · Games since 2023")
        s.chip(20,185,178,"Partial source coverage",C["warn"])
        s.wrap(20,252,"TWIC did not respond. Games found in the other selected sources are ready.",37,16)
        s.link(20,365,320,48,"Open Prep with saved games","prep",True)
        s.link(20,429,320,44,"Retry search","import")
        s.link(20,493,320,44,"View source details","importing")
    elif state=="remove":
        section(s,"Stop following Harbour Open?")
        s.wrap(20,213,"Automatic tournament checks will stop. Choose whether to keep the imported opponent games.",36,16)
        s.text(20,328,"3 opponent databases · 392 saved games",14,C["muted"])
        s.link(20,373,320,48,"Stop following; keep games","empty",True)
        s.wrap(20,465,"Deleting the databases permanently removes their saved games. This cannot be undone.",38,14,C["bad"])
        s.link(20,548,320,44,"Stop and delete 3 databases","empty",color=C["bad"])
        s.link(20,682,320,44,"Keep following","main")
    elif state=="archive-remove":
        section(s,"Remove local archive months?")
        s.text(20,214,"Jan–Dec 2023 · 12 months",19,bold=True)
        s.wrap(20,259,"This removes local search data for those months. Imported opponent games and saved preparation stay.",36,15)
        s.text(20,375,"Keeping: Jan 2024–Jul 2026",14,C["muted"])
        s.wrap(20,423,"Imports for removed dates may need downloads again.",39,14,C["warn"])
        s.link(20,528,320,48,"Remove these 12 months","downloads",color=C["bad"])
        s.link(20,590,320,44,"Keep current date range","downloads")
    return s

def desktop(design):
    s=SVG(1180,790,design,DESIGNS[design][0]+" desktop")
    s.rect(0,0,164,790,"#171a1e",0)
    s.text(18,35,"En Croissant",18,bold=True)
    for i,label in enumerate(["Home","Files","Databases","Accounts","Settings"]):s.text(20,96+i*49,label,14,C["blue"] if i==0 else C["muted"])
    s.text(190,35,"Home  /  Tournaments",14,C["muted"])
    s.text(190,84,"Harbour Open",27,bold=True)
    s.text(190,113,"Open section · Sam Taylor · 3 points from 4 rounds",14,C["muted"])
    s.link(848,58,130,42,"Change event","discover")
    s.link(989,58,164,42,"Tracking settings","tracking")
    if design=="C":
        s.board(192,161,440)
        s.text(194,641,"Prep · Alex Morgan · I'm Black",19,bold=True)
        s.text(194,671,"Opponent's White games · Saved lines remain available",13,C["muted"])
        s.text(666,175,"Round 5 · pairing estimates",22,bold=True)
        s.text(666,205,"Round 4: 36 of 48 results reported",13,C["muted"])
        for i,(name,pct,action,go) in enumerate([("Alex Morgan","42%","Import & prep","import"),("Jamie Reed","26%","Open Prep","prep"),("Pat Ellis","18%","Import & prep","import")]):
            y=259+i*132;s.text(666,y,name,20,bold=True);s.text(666,y+29,pct+" pairing chance · Black expected",14,C["blue"]);s.link(960,y-16,174,44,action,go,True);s.line(666,y+66,1150,y+66)
        s.link(666,682,224,44,"All players","players")
        s.link(908,682,224,44,"Results & standings","standings")
    else:
        if design=="A":
            for i,(label,go) in enumerate([("Next round","main"),("Players","players"),("Standings","standings"),("Results","results"),("Tracking","tracking")]):s.link(190+i*192,147,175,42,label,go,primary=i==0)
        else:
            for i in range(1,10):s.link(190+(i-1)*107,147,92,42,f"Round {i}","main" if i==5 else "results",primary=i==5)
        s.text(190,236,"Round 5 · pairing estimates",23,bold=True)
        s.text(190,265,"Round 4: 36 of 48 results reported · Last checked 14:32",14,C["muted"])
        for x,label in [(190,"Opponent"),(524,"Pairing chance  ?"),(700,"Expected colour"),(894,"Saved games")]:s.text(x,322,label,13,C["muted"])
        for i,(name,rating,pct,games,action,go) in enumerate([("Alex Morgan","2140","42%","Not imported","Import & prep","import"),("Jamie Reed","2090","26%","128 ready","Open Prep","prep"),("Pat Ellis","2125","18%","Not imported","Import & prep","import")]):
            y=369+i*91;s.text(190,y,name,19,bold=True);s.text(190,y+26,"Event rating "+rating+" · Verified FIDE entry",12,C["muted"]);s.text(524,y,pct,19,C["blue"],True);s.text(700,y,"Black" if i!=1 else "Unknown",14);s.text(894,y,games,12,C["muted"]);s.link(1000,y-23,153,43,action,go,True);s.line(190,y+50,1153,y+50)
        s.text(190,650,"Other opponents: 14% combined",13,C["muted"])
        s.link(190,683,208,44,"Check results now","loading")
        s.link(412,683,236,44,"Import likely opponents…","bulk")
        s.link(870,683,283,44,"Local games & downloads","downloads")
    s.text(190,770,"DESIGN "+design+" · INVENTED EXAMPLE DATA · Desktop and phone use the same predictor",11,C["muted"])
    return s.finish()

for design in DESIGNS:
    for state,_ in STATES:(ROOT/f"{design}-{state}.svg").write_text(mobile(design,state).finish(),encoding="utf8")
    (ROOT/f"{design}-desktop.svg").write_text(desktop(design),encoding="utf8")
    # Four full-size screens per row; every edge state remains editable text.
    sheet=SVG(1544,((len(STATES)+3)//4)*880+85,design,DESIGNS[design][0]+" complete state map")
    sheet.text(24,36,design+" · "+DESIGNS[design][0],26,bold=True)
    sheet.text(24,63,"Workflow and edge states · All values and identities are invented examples",14,C["muted"])
    for i,(state,label) in enumerate(STATES):
        x=24+(i%4)*384;y=94+(i//4)*880
        sheet.text(x,y,label,16,bold=True)
        body=mobile(design,state).finish()
        sheet.items.append(f'<g transform="translate({x},{y+17})">'+body+'</g>')
    (ROOT/f"{design}-all-states.svg").write_text(sheet.finish(),encoding="utf8")

overview=SVG(1200,1010,title="Three tournament workflow choices")
overview.text(26,40,"Tournament tracking → opponent games → Prep",27,bold=True)
overview.text(26,71,"En Croissant desktop + phone · Three editable directions · Invented example data",15,C["muted"])
for i,(design,(title,description,_)) in enumerate(DESIGNS.items()):
    x=26+i*395
    overview.text(x,114,design+" · "+title,21,bold=True)
    overview.text(x,140,description[:51],13,C["muted"])
    overview.items.append(f'<g transform="translate({x},164)">'+mobile(design,"main").finish()+'</g>')
(ROOT/"overview.svg").write_text(overview.finish(),encoding="utf8")

state_options="".join(f'<option value="{key}">{label}</option>' for key,label in STATES)+ '<option value="desktop">Desktop</option><option value="all-states">Complete state map</option>'
page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>En Croissant tournament designs</title>
<style>*{box-sizing:border-box}body{margin:0;background:#111315;color:#f1f3f5;font:15px/1.5 system-ui}header,main{max-width:1260px;margin:auto;padding:20px}h1{font-size:24px;margin:0 0 6px}p{color:#a7acb4;margin:8px 0}nav{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}button,select,a.control{font:inherit;min-height:44px;padding:8px 14px;border-radius:7px;background:#25272d;color:#f1f3f5;border:1px solid #34383f;text-decoration:none;cursor:pointer}button[aria-pressed=true]{background:#1971c2;border-color:#74c0fc}button:focus-visible,select:focus-visible,a:focus-visible{outline:2px solid #74c0fc;outline-offset:3px}label{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.bar{display:flex;gap:12px;flex-wrap:wrap;align-items:center}object{display:block;width:360px;max-width:100%;height:820px;border:1px solid #34383f;border-radius:8px;margin:20px auto;background:#111315}object.wide{width:100%;height:auto;aspect-ratio:1180/790}object.map{width:100%;height:auto;aspect-ratio:1544/6245}aside{border-left:2px solid #34383f;padding:0 14px;margin:18px 0}a{color:#74c0fc}small{color:#a7acb4}footer{padding:20px;text-align:center}#status{min-height:24px}</style>
<header><h1>Choose the tournament workflow</h1><p>Same features, predictor and En Croissant colours. The three options organise the work differently.</p><small>Reviewable prototype only. All names, IDs, games, dates and percentages are invented. No imports, tracking changes or deletion happen here.</small><nav aria-label="Design direction"><button data-design="A">A · Tournament hub</button><button data-design="B">B · Round timeline</button><button data-design="C">C · Prep workspace</button></nav><p id="description"></p><div class="bar"><label>View <select id="state">STATE_OPTIONS</select></label><button id="prev">Previous</button><button id="next">Next</button><a id="svg" class="control" href="A-main.svg">Open editable SVG</a><a class="control" href="overview.svg">Compare all three</a></div><aside><strong>Try the main path</strong><p>Next round → Import &amp; prep → progress → save / ready → Open Prep. Use the View menu for setup, standings, settings and recovery states.</p></aside><p id="status" role="status" aria-live="polite"></p></header><main><object id="screen" type="image/svg+xml" data="A-main.svg" aria-label="Tournament workflow prototype"></object></main><footer><a href="README.md">Feature audit and implementation acceptance plan</a></footer>
<script>const designs=DESIGN_JSON;const options=[...document.querySelector('#state').options].map(o=>o.value);const params=new URLSearchParams(location.search);let design=params.get('design')||'A';if(!designs[design])design='A';let state=params.get('state')||'main';if(!options.includes(state))state='main';function show(){document.querySelectorAll('[data-design]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.design===design));document.querySelector('#description').textContent=designs[design][2];document.querySelector('#state').value=state;const path=design+'-'+state+'.svg';const screen=document.querySelector('#screen');screen.data=path;screen.className=state==='desktop'?'wide':state==='all-states'?'map':'';document.querySelector('#svg').href=path;document.querySelector('#status').textContent=design+' · '+document.querySelector('#state').selectedOptions[0].textContent;history.replaceState(null,'','?design='+design+'&state='+state);}document.querySelectorAll('[data-design]').forEach(b=>b.onclick=()=>{design=b.dataset.design;show()});document.querySelector('#state').onchange=e=>{state=e.target.value;show()};document.querySelector('#prev').onclick=()=>{state=options[(options.indexOf(state)+options.length-1)%options.length];show()};document.querySelector('#next').onclick=()=>{state=options[(options.indexOf(state)+1)%options.length];show()};show();</script></html>'''
page=page.replace("STATE_OPTIONS",state_options).replace("DESIGN_JSON",json.dumps(DESIGNS))
(ROOT/"index.html").write_text(page,encoding="utf8")
print(f"Generated {len(STATES)*3} mobile states, 3 desktop views, 3 state maps and overview.")

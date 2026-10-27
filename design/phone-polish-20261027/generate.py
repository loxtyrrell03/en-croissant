"""Editable SVG proposals in the existing phone visual language. No app data."""
from pathlib import Path
from html import escape
import xml.etree.ElementTree as ET
import pymupdf
from PIL import ImageFont

OUT = Path(__file__).parent
BG, PANEL, INPUT, BORDER = '#111315', '#1b1d20', '#25272d', '#34383f'
TEXT, MUTED, BLUE, ACTIVE, RED, GREEN = '#f1f3f5', '#a7acb4', '#74c0fc', '#1971c2', '#ffa8a8', '#8ce99a'
font = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 14)

class SVG:
    def __init__(self, title, subtitle, w=1264, h=2610):
        self.parts=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-label="{escape(title)}">',f'<title>{escape(title)}</title>', f'<rect width="{w}" height="{h}" fill="#0b0d0f"/>','<g font-family="Segoe UI, sans-serif">']
        self.text(24,36,title,26,weight=700);self.text(24,65,subtitle,14,MUTED)
    def rect(self,x,y,w,h,fill=PANEL,stroke=BORDER,r=8):
        self.parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke}"/>')
    def text(self,x,y,text,size=14,color=TEXT,weight=400,anchor='start'):
        self.parts.append(f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" font-weight="{weight}" text-anchor="{anchor}">{escape(text)}</text>')
    def line(self,x,y,w):self.parts.append(f'<path d="M{x} {y}h{w}" stroke="{BORDER}"/>')
    def button(self,x,y,w,label,primary=False,h=44):
        self.rect(x,y,w,h,ACTIVE if primary else INPUT,r=7);self.text(x+w/2,y+h/2+5,label,14,weight=600,anchor='middle')
    def tabs(self,x,y,w,labels,selected=0):
        cell=w/len(labels)
        self.rect(x,y,w,44,INPUT,r=7)
        for i,l in enumerate(labels):
            if i==selected:self.rect(x+4+i*cell,y+4,cell-8,36,'#3a3d43',stroke='none',r=5)
            self.text(x+(i+.5)*cell,y+28,l,13,BLUE if i==selected else MUTED,600 if i==selected else 400,'middle')
    def field(self,x,y,w,label,value):
        self.text(x,y,label,13,MUTED);self.rect(x,y+9,w,44,INPUT,r=6);self.text(x+12,y+37,value,16)
    def lines(self,x,y,lines,size=14,color=MUTED):
        for i,line in enumerate(lines):self.text(x,y+i*21,line,size,color)
    def phone(self,x,y,title,active='Board',w=390,h=790):
        self.text(x,y-12,title,16,weight=600);self.parts.append(f'<g transform="translate({x} {y})">')
        self.rect(0,0,w,h,BG,r=16)
        self.tabs(12,12,w-24,['Board','Events','Import','Review','Files','Stats'],['Board','Events','Import','Review','Files','Stats'].index(active))
    def endphone(self):self.parts.append('</g>')
    def save(self,name):
        self.parts += ['</g>','</svg>'];p=OUT/name;p.write_text('\n'.join(self.parts),encoding='utf-8');ET.parse(p)
        doc=pymupdf.open(p);doc[0].get_pixmap(matrix=pymupdf.Matrix(.6,.6)).save(p.with_suffix('.png'))
        return p

def prep(s,w,direction):
    cw=w-24;s.text(12,87,'Prep',22,weight=700);s.text(w-22,84,'?',16,BLUE,anchor='end')
    if direction=='B':
        s.tabs(12,104,cw,['1 Source','2 Player','3 Start'],1)
        s.text(12,181,'Who are you preparing for?',18,weight=600)
        s.lines(12,207,['Pasted games · 12 games selected'])
        s.field(12,253,cw,'Player','Jordan Vale')
        s.text(12,333,'Your side',13,MUTED);s.tabs(12,345,cw,["I'm White","I'm Black"])
        s.rect(12,413,cw,90);s.lines(24,443,['Source ready','12 games · All dates · Any result'])
        s.button(12,525,(cw-8)/2,'Back');s.button(20+(cw-8)/2,525,(cw-8)/2,'Start prep',True)
        s.text(12,605,'Advanced filters and strength  ›',14,BLUE)
        s.lines(12,656,['B: one step at a time.','Setup is longer but each view is simpler.'])
    elif direction=='C':
        s.rect(12,107,cw,210);s.text(24,138,'Ready to practise',18,weight=600)
        s.lines(24,170,['Jordan Vale · You play White','Pasted games · 12 games','All dates · Any result'])
        s.button(24,250,(cw-32)/2,'Edit setup');s.button(32+(cw-32)/2,250,(cw-32)/2,'Start prep',True)
        s.rect(4,352,w-8,410,INPUT,r=16);s.text(20,382,'Edit prep setup',18,weight=600)
        s.field(20,415,w-40,'Games','Pasted games                  ▾')
        s.field(20,491,w-40,'Player','Jordan Vale')
        s.tabs(20,563,w-40,["I'm White","I'm Black"])
        s.text(20,640,'Dates and strength  ›',14,BLUE)
        s.button(20,687,(w-48)/2,'Cancel');s.button(28+(w-48)/2,687,(w-48)/2,'Apply',True)
    else:
        s.tabs(12,104,cw,['Player','General'])
        s.field(12,178,cw,'Prep source','Pasted games                  ▾')
        s.text(12,251,'12 games available',12,MUTED)
        gap=8; bw=(cw-gap*2)/3
        for i,label in enumerate(['Import','Strength','Builder']):s.button(12+i*(bw+gap),267,bw,label)
        s.field(12,341,cw,'Player','Jordan Vale')
        s.text(12,418,'Your side',13,MUTED);s.tabs(12,430,cw,["I'm White","I'm Black"])
        s.field(12,504,(cw-8)/2,'Minimum games','1');s.field(20+(cw-8)/2,504,(cw-8)/2,'Top moves','12')
        s.field(12,583,cw,'Result','Any result                       ▾')
        s.field(12,661,cw,'Dates      ?','All time                           ▾')
        s.button(12,727,cw,'Start prep',True)

def importer(s,w,direction):
    cw=w-24;s.text(12,88,'Import games',22,weight=700)
    s.lines(12,116,['Paste a PGN game or a FEN position.'])
    if direction=='B':s.tabs(12,137,cw,['1 Paste','2 Check','3 Open'])
    else:s.tabs(12,137,cw,['Paste PGN / FEN','Choose file'])
    s.text(12,212,'PGN or FEN',13,MUTED);s.rect(12,225,cw,208,INPUT)
    s.lines(24,252,['[Event "Example game"]','[White "Jordan Vale"]','[Black "Sam Rivera"]','','1. e4 e5 2. Nf3 Nc6','3. Bb5 a6 *'],15,TEXT)
    s.button(12,445,(cw-8)/2,'Paste');s.button(20+(cw-8)/2,445,(cw-8)/2,'Clear')
    s.field(12,524,cw,'Save as','Pasted games')
    s.text(12,603,'1 game ready to import',14,GREEN)
    s.button(12,622,cw,'Import & open',True)
    s.line(12,690,cw);s.text(12,721,'Online accounts and more sources  ›',14,BLUE)
    if direction=='C':s.text(12,754,'Same editor opens from Board and Files.',12,MUTED)

def files(s,w,direction):
    cw=w-24;s.text(12,88,'Files',22,weight=700);s.button(w-112,70,100,'Import',True)
    s.tabs(12,132,cw,['Active','Archived'])
    s.field(12,205,cw,'Find a file or database','Search files…')
    s.rect(12,275,cw,68);s.text(24,301,'Library synced',14,GREEN,600);s.text(24,325,'Novelty dev · Checked just now',12,MUTED)
    for y,title,count in [(365,'My classical games','84 games'),(467,'Opening study','25 games'),(569,'Weekend tournament','9 games')]:
        s.line(12,y-8,cw);s.text(12,y+15,title,16,weight=600);s.text(12,y+38,count,13,MUTED)
        s.button(12,y+49,(cw-8)/2,'Open');s.button(20+(cw-8)/2,y+49,(cw-8)/2,'Archive')
    s.lines(12,722,['Archive hides an item from active lists.','Games stay saved.'],13,MUTED)

def board(s,w,direction):
    cw=w-24;s.text(12,88,'Vale – Rivera',20,weight=700)
    s.button(12,105,(cw-8)/2,'Paste PGN / FEN');s.button(20+(cw-8)/2,105,(cw-8)/2,'Game actions')
    sz=240;left=(w-sz)/2
    for row in range(8):
        for col in range(8):s.rect(left+col*30,161+row*30,30,30,'#769656' if (row+col)%2 else '#eeeed2',stroke='none',r=0)
    s.text(left+95,296,'♞',31,'#111315');s.text(left+126,326,'♙',31,'#f7f7f0')
    s.tabs(12,417,cw,['⏮','‹','▶','23 / 48','›','⏭'],3)
    s.tabs(12,473,cw,['Moves','Database','Prep']);s.tabs(12,521,cw,['Analysis','Coach'],-1)
    s.text(12,599,'Mainline',13,MUTED);s.text(12,628,'12. Re1  b5  13. Bb3  d6',17)
    s.rect(12,644,cw,72,'#16222d');s.text(24,672,'Variation from 12. Re1',13,BLUE,600);s.text(24,698,'12… Bb7  13. d3',17)
    s.button(12,727,cw,'Return to mainline')

def events(s,w,direction):
    cw=w-24;s.text(12,88,'Events',22,weight=700)
    s.field(12,122,cw,'Find a tournament','Search events…')
    s.tabs(12,197,cw,['Following','Discover'])
    s.text(12,284,'Autumn Open',20,weight=700);s.text(12,312,'Round 5 · Pairings ready',14,MUTED)
    s.button(12,335,(cw-8)/2,'Refresh');s.button(20+(cw-8)/2,335,(cw-8)/2,'Stop following')
    s.tabs(12,400,cw,['Next round','Players','Standings']);s.tabs(12,448,cw,['Results','Tracking'],-1)
    s.rect(12,519,cw,185);s.text(24,549,'Your next game',14,MUTED);s.text(24,582,'Sam Rivera · 2018',20,weight=600)
    s.text(24,613,'You play White · Board 8',14,MUTED);s.button(24,642,cw-24,'Open Prep',True)

def review(s,w,direction):
    cw=w-24;s.text(12,88,'Review',22,weight=700)
    s.text(12,128,'3 of 5 positions completed',14,MUTED);s.rect(12,145,cw,6,INPUT,stroke='none',r=3);s.rect(12,145,cw*.6,6,ACTIVE,stroke='none',r=3)
    s.rect(12,178,cw,265,'#192029');s.text(w/2,306,'Chessboard / review position',16,MUTED,anchor='middle')
    s.text(12,478,'Find the best continuation',18,weight=600)
    s.button(12,505,(cw-8)/2,'Show hint');s.button(20+(cw-8)/2,505,(cw-8)/2,'Skip')
    s.line(12,577,cw);s.text(12,608,'Review settings  ›',14,BLUE)
    s.lines(12,649,['Keep the current position visible.','Feedback stays beside the next action.'])
    s.button(12,715,cw,'Next position',True)

def stats(s,w,direction):
    cw=w-24;s.text(12,88,'Stats',22,weight=700)
    s.tabs(12,108,cw,['Online','Over the board'])
    s.field(12,182,cw,'Period','Last 30 days                     ▾')
    s.text(12,266,'JordanVale · Rapid',14,MUTED);s.text(12,298,'42 games',26,weight=700)
    s.rect(12,323,cw,31,INPUT);s.rect(12,323,cw*.52,31,'#2b8a3e',stroke='none');s.rect(12+cw*.52,323,cw*.14,31,'#5c636e',stroke='none');s.rect(12+cw*.66,323,cw*.34,31,'#c92a2a',stroke='none')
    s.lines(12,388,['Wins 52%   Draws 14%   Losses 34%'],14,TEXT)
    s.rect(12,418,cw,180);s.text(24,450,'Rating',15,weight=600);s.parts.append(f'<path d="M24 561 l36 -14 36 8 36 -40 36 5 36 -23 36 8 36 -30" stroke="{BLUE}" fill="none" stroke-width="3"/>')
    s.line(12,631,cw);s.text(12,665,'Account, speed and date filters  ›',14,BLUE)
    s.text(12,710,'Missing ratings show “Unavailable”.',13,MUTED)

def states(s,w,direction):
    cw=w-24;s.text(12,88,'Clear status & recovery',20,weight=700)
    s.rect(12,109,cw,147);s.text(24,136,'Loading your files…',15,weight=600);s.text(24,163,'Existing games stay open.',13,MUTED);s.button(24,193,cw-24,'Cancel')
    s.rect(12,272,cw,166);s.text(24,299,'Library sync needs attention',15,RED,600);s.lines(24,327,['Could not reach the PC library.','Your phone changes are saved locally.'],13);s.button(24,373,cw-24,'Retry sync')
    s.rect(12,454,cw,150);s.text(24,483,'Import could not be read',15,RED,600);s.lines(24,513,['Check move 14, then retry.'],13);s.button(24,540,cw-24,'Retry import')
    s.text(12,651,'Adjacent ? help',14,BLUE);s.lines(12,680,['Hover, keyboard focus or tap.','Dismiss with Escape or outside tap.','Errors and required choices stay visible.'],13)

for direction,name,subtitle in [
    ('A','Aligned inline controls','Refines the selected compact layout. Clear rows; the same pages and navigation.'),
    ('B','Guided setup','Separate source, player and start steps. Familiar pages; more deliberate setup.'),
    ('C','Summary plus editor','Short task summary with a focused editor sheet. Apply and Cancel own the draft.')]:
    s=SVG(f'{direction} · {name}',subtitle+' All content is illustrative.')
    pages=[('Prep · 390px','Board',390,prep),('Prep · 320px','Board',320,prep),('Import · 390px','Import',390,importer),('Files · 390px','Files',390,files),('Board · 390px','Board',390,board),('Events · 390px','Events',390,events),('Review · 390px','Review',390,review),('Stats · 390px','Stats',390,stats),('States & help · 390px','Files',390,states)]
    for i,(label,active,width,fn) in enumerate(pages):
        x=24+(i%3)*414+(390-width)/2;y=114+(i//3)*828
        s.phone(x,y,label,active,width);fn(s,width,direction);s.endphone()
    p=s.save(f'{direction}-workflow.svg')
    if direction=='A':
        doc=pymupdf.open(p)
        doc[0].get_pixmap(matrix=pymupdf.Matrix(1,1),clip=pymupdf.Rect(10,88,846,914)).save(OUT/'A-prep-preview.png')

# Compact image that compares the actual design decision without hiding the other pages.
s=SVG('Phone spacing · three reviewable directions','Same existing colours, typography and touch targets. Example content throughout.',1264,932)
for i,(direction,label) in enumerate([('A','A · Aligned inline controls'),('B','B · Guided setup'),('C','C · Summary plus editor')]):
    s.phone(24+i*414,114,label);prep(s,390,direction);s.endphone()
s.save('comparison.svg')

s=SVG('Shared states · all three directions','Illustrative examples. Preserve the game and user choices while work is in progress.',1264,1030)
state_data=[
    ('Loading / cancellation',['Importing games','8 of 12 games read','Keep the draft available.'],'Cancel import'),
    ('Saved / archived',['Opening study archived','Hidden in active phone and Novelty dev lists.','25 games remain saved.'],'Unarchive'),
    ('Empty / first use',['No games here yet','Import a PGN or FEN to get started.','Choose a file or paste directly.'],'Import games'),
    ('Conflict / required choice',['Two versions need review','Keep both versions until a choice is saved.','Never replace a newer edit in the background.'],'Review versions'),
    ('Offline / retry',['Cannot reach Novelty dev','Keep your edits saved on this phone.','Show the specific failure next to retry.'],'Retry sync'),
    ('Removal confirmation',['Remove this local source?','This differs from Archive.','Keep the existing consequence and Cancel.'],'Cancel'),
]
for i,(label,lines,action) in enumerate(state_data):
    x=24+(i%3)*414;y=114+(i//3)*440
    s.text(x,y-12,label,16,weight=600);s.rect(x,y,390,388,BG,r=16)
    s.text(x+16,y+39,lines[0],20,weight=700);s.lines(x+16,y+80,lines[1:],14)
    s.button(x+16,y+158,358,action,action in ['Import games','Review versions'])
    s.line(x+16,y+234,358);s.text(x+16,y+267,'Narrow layout / 320px',14,BLUE,600)
    s.lines(x+16,y+300,['Use the same order and full-width actions.','Wrap whole labels; retain 44px tap targets.','Status changes do not remount the board.'],14)
s.save('shared-states.svg')
print('Parsed and rasterized 5 SVG sheets; 9 workflow panels per direction and 6 shared state panels.')

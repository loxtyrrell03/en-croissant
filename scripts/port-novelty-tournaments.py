"""Initial, explicit, read-only-source port. Refuses to replace existing target files."""
from pathlib import Path
import re
import json
import hashlib

TARGET = Path(__file__).resolve().parents[1]
SOURCE = TARGET.parent / "outpost-chess"
DEST = TARGET / "src/features/tournaments"
assert not DEST.exists(), "Initial port only; preserve and edit existing target work"
replacements = {
    "~/platform/bridge": "@/features/tournaments/platform",
    "~/app/toastStore": "@/features/tournaments/ui",
    "~/components/AppDialog": "@/features/tournaments/ui",
    "~/components/HelpTip": "@/features/tournaments/ui",
    "~/features/home/HomeModal": "@/features/tournaments/ui",
    "~/features/home/PlayerGameImportModal": "@/features/tournaments/TournamentPlayerImport",
    "~/features/home/otbImportModel": "@/features/tournaments/otbImportModel",
    "~/app/jobScheduler": "@/features/tournaments/jobs",
    "~/features/prep/prepPersistence": "@/features/tournaments/prepPersistence",
    "~/components/ExternalWebsiteLink": "@/features/tournaments/ExternalWebsiteLink",
}
manifest=[]
def copy(src,dst):
    data=src.read_bytes()
    text=data.decode("utf-8")
    for old,new in replacements.items():text=text.replace(old,new)
    # The fork's TypeScript configuration uses extensionless source imports.
    text=re.sub(r"(from\s+['\"][^'\"]+)\.ts(['\"])",r"\1\2",text)
    if dst.suffix in (".ts",".tsx"):
        text=text.replace('"outpost.tournamentPrep','"encroissant.tournamentPrep').replace('"outpost:tournament-prep','"encroissant:tournament-prep')
    dst.parent.mkdir(parents=True,exist_ok=True)
    dst.write_text(text,encoding="utf-8",newline="\n")
    manifest.append({"source":src.relative_to(SOURCE).as_posix(),"sourceSha256":hashlib.sha256(data).hexdigest(),"target":dst.relative_to(TARGET).as_posix()})
for src in (SOURCE/"src/features/tournaments").rglob("*"):
    if src.is_file():copy(src,DEST/src.relative_to(SOURCE/"src/features/tournaments"))
for name in ["otbImportModel.ts"]:copy(SOURCE/"src/features/home"/name,DEST/name)
for name in ["OtbDownloadControl.tsx","OtbDownloadControl.module.css","otbDownloads.ts","otbDownloadPresentation.ts","otbActivity.ts"]:
    copy(SOURCE/"src/features/settings"/name,DEST/"downloads"/name)
for src in (SOURCE/"src/features/settings/tests").glob("otb*.test.ts"):copy(src,DEST/"downloads/tests"/src.name)
copy(SOURCE/"src/components/ExternalWebsiteLink.tsx",DEST/"ExternalWebsiteLink.tsx")
# A self-contained wire contract rather than importing Novelty's platform bridge.
bridge=(SOURCE/"src/platform/bridge.ts").read_text(encoding="utf-8")
blocks={m.group(1):m.group(0) for m in re.finditer(r"export (?:interface|type) (\w+)[\s\S]*?(?=\nexport |\n(?:async )?function |\nconst |\Z)",bridge)}
names={"CollectionRow","TournamentSnapshot","TournamentPlayer","TournamentSearchResult","TournamentPairing","TournamentRoundStandings","TournamentFormat","TournamentPhase","TournamentDiscoveryRequest","TournamentDiscoveryResponse","TournamentEventMetadata","TournamentSection","OtbImportRequest","OtbImportReport","OtbImportProgress","DataPackEntry","DataPackStatus","OtbLibraryStatus","DataPackReview","DownloadedDataReview"}
while True:
    expanded=names|{name for key in names for name in blocks if re.search(r"\b"+name+r"\b",blocks.get(key,""))}
    if expanded==names:break
    names=expanded
missing=names-set(blocks)
if missing:print("Types to define explicitly:",sorted(missing))
(DEST/"types.ts").write_text("// Wire contracts ported from Novelty; see docs/TOURNAMENT_PARITY.md.\n"+"\n".join(blocks[n] for n in blocks if n in names),encoding="utf-8")
(TARGET/"docs/design/tournament-parity-20260927/port-manifest.json").write_text(json.dumps(manifest,indent=2)+"\n",encoding="utf-8")
print(f"Ported {len(manifest)} files; Novelty was read-only.")

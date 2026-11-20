"""Assert that the integrated comparison adds evidence on the intended scope."""

import argparse
from hashlib import sha256
import json
from pathlib import Path

from score_transfer import index


def compare(previous, current):
    if set(previous) != set(current):
        raise ValueError("The replayed decisions do not match.")
    changes = []
    for key, row in current.items():
        old = previous[key]["report"]
        new = row["report"]
        if new is None:
            assert old is None, key
            continue
        assert old is not None and new["version"] == 62, key
        old = {**old, "version": 62}
        proof = (new.get("mistake") or {}).get("sharedRay")
        if not proof:
            assert new == old, key
            continue
        assert {field: val for field, val in new.items() if field != "mistake"} == {
            field: val for field, val in old.items() if field != "mistake"
        }, key
        edited = {"sharedRay", "tactical", "category"}
        assert {field: val for field, val in new["mistake"].items() if field not in edited} == {
            field: val for field, val in old["mistake"].items() if field not in edited
        }, key
        reasons = new["mistake"]["tactical"]["reasons"]
        original = old["mistake"]["tactical"]
        kept = original["reasons"] if original["support"] == "supported" else []
        assert reasons == [proof["explanation"], *kept], key
        changes.append(dict(id=key, before=old["mistake"]["category"], after=new["mistake"]["category"],
                            reportedLossCp=new["mistake"]["evaluationLossCp"], proof=proof))
    return dict(requests=len(current), reports=sum(row["report"] is not None for row in current.values()),
                changes=changes)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("old_transfer", "new_transfer", "candidate", "old_archive", "output"):
        parser.add_argument(name, type=Path)
    parser.add_argument("new_archive", type=Path, nargs="+")
    args = parser.parse_args()
    archive = {}
    for path in args.new_archive:
        shard = index(path)
        assert not (archive.keys() & shard.keys()), path
        archive.update(shard)
    candidate = index(args.candidate)
    release = compare(index(args.old_transfer), index(args.new_transfer))
    assert {change["id"]: change["proof"] for change in release["changes"]} == {
        key: row["result"] for key, row in candidate.items() if row.get("result")
    }
    archived = compare(index(args.old_archive), archive)
    restricted = [row for row in candidate.values() if row.get("nomination") == "restricted"]
    source = dict(
        transfer=release, archive=archived,
        restrictedRequests=len(restricted),
        incrementalRestrictedRequests=sum(not row["alreadyRequested"] for row in restricted),
        inputs={path.name: sha256(path.read_bytes()).hexdigest() for path in (
            args.old_transfer, args.new_transfer, args.candidate, args.old_archive, *args.new_archive
        )},
    )
    with args.output.open("x", encoding="utf8", newline="\n") as stream:
        json.dump(source, stream, indent=2)
        stream.write("\n")


if __name__ == "__main__":
    main()

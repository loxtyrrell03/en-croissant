"""Event-grouped screen using archive frames only."""
from pathlib import Path
import sys

import torch
from threadpoolctl import threadpool_limits

from frames import family, key
from rank import dataset, counts, measure, predict


if __name__ == "__main__":
    data, kinds = dataset(Path(sys.argv[1]))
    events = sorted({family(d[0]["event"]) for d in data}, key=lambda event: key("inner-dev", event))
    held = set(events[::4])
    train = [d for d in data if family(d[0]["event"]) not in held]
    valid = [d for d in data if family(d[0]["event"]) in held]
    print(kinds, counts(train, range(len(train))), counts(valid, range(len(valid))), flush=True)
    torch.set_num_threads(2)
    with threadpool_limits(limits=2):
        scores, _, _, _ = predict(train, valid)
    for name, values in scores.items():
        outcome = measure(valid, values)
        print(name, {k: v for k, v in outcome.items() if k not in ("selected", "events")})

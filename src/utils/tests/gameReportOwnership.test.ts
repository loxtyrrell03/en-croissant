import { createStore } from "zustand";
import { expect, test, vi } from "vitest";
import { beginGameReport } from "../gameReportOwnership";
import { defaultTree } from "../treeReducer";

test("navigation, comments and live evals preserve ownership; a changed game cancels once", () => {
    const root = defaultTree().root;
    const store = createStore(() => ({ root }));
    const cancel = vi.fn(),
        owner = beginGameReport(store, cancel);
    store.setState({
        root: {
            ...root,
            comment: "User annotation",
            score: { value: { type: "cp", value: 25 }, wdl: null },
        },
    });
    expect(owner.hasSameGame()).toBe(true);
    expect(cancel).not.toHaveBeenCalled();
    store.setState({ root: { ...root, fen: "4k3/7p/8/8/8/8/6K1/R7 b - - 0 20" } });
    store.setState({ root });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(owner.hasSameGame()).toBe(false);
    owner.finish();
    expect(owner.isOwner()).toBe(false);
});
test("an older response cannot release a replacement request or affect another tab", () => {
    const store = createStore(() => ({ root: defaultTree().root }));
    const other = createStore(() => ({ root: defaultTree().root }));
    const old = beginGameReport(store, vi.fn()),
        current = beginGameReport(store, vi.fn());
    const independent = beginGameReport(other, vi.fn());
    old.finish();
    expect(old.isOwner()).toBe(false);
    expect(current.isOwner()).toBe(true);
    expect(independent.isOwner()).toBe(true);
    current.finish();
    independent.finish();
});

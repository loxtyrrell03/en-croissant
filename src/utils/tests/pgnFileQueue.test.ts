import { expect, it } from "vitest";
import { withPgnFileTask } from "../pgnFileQueue";

it("orders file mutations through their UI completion and recovers from failure", async () => {
    const calls: string[] = [];
    let finish!: () => void;
    const a = withPgnFileTask("C:\\Games\\a.pgn", async () => {
        calls.push("write");
        await new Promise<void>((resolve) => {
            finish = resolve;
        });
        calls.push("bind");
        throw new Error("failed");
    });
    const b = withPgnFileTask("\\\\?\\c:\\games\\a.pgn", async () => {
        calls.push("delete");
    });
    await Promise.resolve();
    expect(calls).toEqual(["write"]);
    const failed = a.catch((error) => error);
    finish();
    expect(await failed).toMatchObject({ message: "failed" });
    await b;
    expect(calls).toEqual(["write", "bind", "delete"]);
});

it("does not serialize unrelated files or collapse case-sensitive Unix paths", async () => {
    let finish!: () => void;
    const a = withPgnFileTask(
        "/Games/a.pgn",
        async () =>
            new Promise<void>((resolve) => {
                finish = resolve;
            }),
    );
    expect(await withPgnFileTask("/games/a.pgn", async () => "other file")).toBe("other file");
    finish();
    await a;
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
const { OtbImportService } = await import(
  process.env.OTB_START_SERVICE_MODULE || "../otb-import-service.mjs"
);

const request = { playerName: "Player, Example", fideId: "12345678", fromYear: 2024 };
const newId = () => `otb-${randomUUID()}`;

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "en-otb-start-"));
  const children = [];
  const terminations = [];
  const options = {
    root,
    binaryPath: join(root, "fixture-collector"),
    spawnProcess: (...args) => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      children.push({ child, args });
      return child;
    },
    terminateProcessTree: async (target) => {
      terminations.push(target);
    },
  };
  try {
    await writeFile(options.binaryPath, "Explicit fixture; never executable.");
    const service = new OtbImportService(options);
    await service.initialize();
    await run({ root, options, service, children, terminations });
  } finally {
    for (const { child } of children) {
      child.stdout.destroy();
      child.stderr.destroy();
    }
    assert.ok(resolve(root).startsWith(`${resolve(tmpdir())}${sep}`));
    assert.ok(resolve(root).split(sep).at(-1).startsWith("en-otb-start-"));
    await rm(root, { recursive: true, force: true });
  }
}

test("overlapping retries and a lost response recover one collector and durable ID", async () => {
  await fixture(async ({ service, children, root }) => {
    const id = newId();
    const jobs = await Promise.all(
      Array.from({ length: 12 }, () => service.createJob(request, id)),
    );
    assert.equal(children.length, 1);
    assert.ok(jobs.every((job) => job.id === id && job.status === "running"));
    const recovered = await service.createJob(
      { ...request, playerName: "  Player,  Example " },
      id,
    );
    assert.equal(recovered.id, id);
    assert.equal(children.length, 1);
    assert.equal(service.jobs.size, 1);
    const saved = JSON.parse(await readFile(join(root, "jobs", `${id}.json`), "utf8"));
    assert.equal(saved.id, id);
    assert.equal(saved.status, "running");
    assert.equal(service.startRequests.size, 0);
  });
});

test("an ID cannot change player, FIDE ID, start year or source coverage", async () => {
  await fixture(async ({ service, children }) => {
    const id = newId();
    const pending = service.createJob(request, id);
    await assert.rejects(service.createJob({ ...request, playerName: "Another, Player" }, id), {
      code: "OTB_JOB_REQUEST_CONFLICT",
    });
    await pending;
    for (const change of [
      { fideId: "87654321" },
      { fromYear: 2023 },
      { sources: { twic: false } },
    ]) {
      await assert.rejects(service.createJob({ ...request, ...change }, id), {
        code: "OTB_JOB_REQUEST_CONFLICT",
      });
    }
    assert.equal(children.length, 1);
    assert.equal(service.getJob(id).request.playerName, request.playerName);
  });
});

test("a failed initial save never spawns and retries the same destination", async () => {
  await fixture(async ({ service, children, root }) => {
    const id = newId();
    const persist = service.persist.bind(service);
    let failed = false;
    service.persist = async (job) => {
      if (!failed) {
        failed = true;
        throw new Error("Fixture disk unavailable");
      }
      return persist(job);
    };
    await assert.rejects(service.createJob(request, id), /Fixture disk unavailable/);
    assert.equal(children.length, 0);
    assert.equal(service.startRequests.size, 0);
    assert.equal((await service.createJob(request, id)).status, "running");
    assert.equal(children.length, 1);
    assert.equal(service.jobs.size, 1);
    assert.equal(
      JSON.parse(await readFile(join(root, "jobs", `${id}.json`), "utf8")).status,
      "running",
    );
  });
});

test("a failed post-spawn save retries persistence without spawning again", async () => {
  await fixture(async ({ service, children, root }) => {
    const id = newId();
    const persist = service.persist.bind(service);
    let failed = false;
    service.persist = async (job) => {
      if (job.status === "running" && !failed) {
        failed = true;
        throw new Error("Fixture status save failed");
      }
      return persist(job);
    };
    await assert.rejects(service.createJob(request, id), /Fixture status save failed/);
    assert.equal(children.length, 1);
    const jobs = await Promise.all([
      service.createJob(request, id),
      service.createJob(request, id),
    ]);
    assert.ok(jobs.every((job) => job.status === "running"));
    assert.equal(children.length, 1);
    assert.equal(
      JSON.parse(await readFile(join(root, "jobs", `${id}.json`), "utf8")).status,
      "running",
    );
  });
});

test("a synchronous spawn failure can retry the same queued ID", async () => {
  await fixture(async ({ service, children }) => {
    const id = newId();
    const spawnProcess = service.spawnProcess;
    service.spawnProcess = () => {
      throw new Error("Fixture launch failed before process creation");
    };
    await assert.rejects(service.createJob(request, id), /Fixture launch failed/);
    service.spawnProcess = spawnProcess;
    assert.equal((await service.createJob(request, id)).status, "running");
    assert.equal(children.length, 1);
    assert.equal(service.jobs.size, 1);
  });
});

test("Stop during the initial save prevents a later collector launch", async () => {
  await fixture(async ({ service, children }) => {
    const id = newId();
    const persist = service.persist.bind(service);
    let release;
    let arrived;
    let savingId;
    const saving = new Promise((resolvePromise) => {
      arrived = resolvePromise;
    });
    const gate = new Promise((resolvePromise) => {
      release = resolvePromise;
    });
    service.persist = async (job) => {
      if (job.status === "queued") {
        savingId = job.id;
        arrived();
        await gate;
      }
      return persist(job);
    };
    const start = service.createJob(request, id);
    await saving;
    const stopped = await service.cancelJob(savingId);
    release();
    const started = await start;
    assert.equal(stopped.status, "failed");
    assert.equal(started.status, "failed");
    assert.equal((await service.createJob(request, id)).status, "failed");
    assert.equal(children.length, 0);
  });
});

test("completed and stopped searches retain their outcomes across retry and restart", async () => {
  await fixture(async ({ service, options, children, root }) => {
    const completedId = newId();
    await service.createJob(request, completedId);
    const pgn =
      '[Event "Fixture"]\n[White "Player, Example"]\n[Black "Opponent"]\n[Result "1-0"]\n\n1. e4 e5 1-0';
    const output = join(root, "output", `${completedId}.pgn`);
    await writeFile(output, pgn);
    await service.finishCompleted(
      service.jobs.get(completedId),
      { playerName: request.playerName, coverageComplete: true, gamesFound: 1 },
      output,
    );
    const artifact = await readFile(service.getArtifactPath(completedId), "utf8");
    const completed = service.getJob(completedId);
    assert.deepEqual(await service.createJob(request, completedId), completed);
    const stoppedId = newId();
    await service.createJob(request, stoppedId);
    await service.cancelJob(stoppedId);
    const restarted = new OtbImportService(options);
    await restarted.initialize();
    assert.deepEqual(await restarted.createJob(request, completedId), completed);
    assert.equal((await restarted.createJob(request, stoppedId)).status, "failed");
    assert.equal(await readFile(service.getArtifactPath(completedId), "utf8"), artifact);
    assert.equal(children.length, 2);
    await assert.rejects(restarted.createJob({ ...request, fromYear: 2023 }, completedId), {
      code: "OTB_JOB_REQUEST_CONFLICT",
    });
  });
});

test("server restart does not automatically start a persisted interrupted search again", async () => {
  await fixture(async ({ service, options, children }) => {
    const id = newId();
    await service.createJob(request, id);
    const restarted = new OtbImportService(options);
    await restarted.initialize();
    const recovered = await restarted.createJob(request, id);
    assert.equal(recovered.status, "failed");
    assert.match(recovered.error, /restarted/);
    assert.equal(children.length, 1);
  });
});

test("invalid or legacy client-selected IDs cannot create paths or attach to older jobs", async () => {
  await fixture(async ({ service, children }) => {
    for (const id of [
      "",
      "../escape",
      "otb-legacy",
      "otb-" + "a".repeat(300),
      newId().toUpperCase(),
    ]) {
      await assert.rejects(service.createJob(request, id), /valid new OTB search ID/);
    }
    assert.equal(service.jobs.size, 0);
    assert.equal(children.length, 0);
  });
});

test("existing legacy POST callers still create separate searches", async () => {
  await fixture(async ({ service, children }) => {
    const first = await service.createJob(request);
    const second = await service.createJob(request);
    assert.notEqual(first.id, second.id);
    assert.equal(children.length, 2);
  });
});

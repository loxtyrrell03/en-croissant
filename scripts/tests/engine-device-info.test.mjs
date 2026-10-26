import { test } from "node:test";
import assert from "node:assert/strict";
import { totalmem } from "node:os";
import { readEngineDeviceInfo } from "../engine-device-info.mjs";

const read = (cpu, total, available) =>
  readEngineDeviceInfo({
    logicalThreads: () => cpu,
    totalBytes: () => total,
    availableBytes: () => available,
  });
const GiB = 1_073_741_824;

test("host resource units match the native numeric MiB contract", () => {
  assert.deepEqual(read(20, 32 * GiB, 20 * GiB), {
    logicalThreads: 20,
    totalMemoryMb: 32768,
    availableMemoryMb: 20480,
  });
  assert.equal(read(2, GiB + 524288, GiB / 2).totalMemoryMb, 1024);
});

test("zero available memory stays known and impossible available values are bounded by installed memory", () => {
  assert.deepEqual(read(2, GiB, 0), {
    logicalThreads: 2,
    totalMemoryMb: 1024,
    availableMemoryMb: 0,
  });
  assert.equal(read(2, GiB, 4 * GiB).availableMemoryMb, 1024);
});

test("missing, invalid and out-of-wire-range memory cannot masquerade as zero", () => {
  for (const total of [0, -1, NaN, Infinity, "1024", 2 ** 60]) {
    assert.deepEqual(read(4, total, 0), {
      logicalThreads: 4,
      totalMemoryMb: null,
      availableMemoryMb: null,
    });
  }
  for (const available of [-1, NaN, Infinity, "0"]) {
    assert.equal(read(4, GiB, available).availableMemoryMb, null);
  }
});

test("failed probes are independent and preserve conservative CPU and known memory facts", () => {
  const failed = () => {
    throw Error("Unavailable fixture");
  };
  assert.deepEqual(
    readEngineDeviceInfo({ logicalThreads: failed, totalBytes: () => GiB, availableBytes: failed }),
    {
      logicalThreads: 1,
      totalMemoryMb: 1024,
      availableMemoryMb: null,
    },
  );
  assert.deepEqual(
    readEngineDeviceInfo({
      logicalThreads: () => 8,
      totalBytes: failed,
      availableBytes: () => GiB,
    }),
    {
      logicalThreads: 8,
      totalMemoryMb: null,
      availableMemoryMb: null,
    },
  );
  for (const cpu of [undefined, 0, -1, 1.5, NaN, Infinity])
    assert.equal(read(cpu, 0, 0).logicalThreads, 1);
});

test("actual host metadata can be read without an engine, service or profile", () => {
  const actual = readEngineDeviceInfo();
  assert.ok(Number.isSafeInteger(actual.logicalThreads) && actual.logicalThreads >= 1);
  assert.equal(actual.totalMemoryMb, Math.floor(totalmem() / 1_048_576));
  assert.ok(actual.availableMemoryMb >= 0 && actual.availableMemoryMb <= actual.totalMemoryMb);
});

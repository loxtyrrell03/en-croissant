import { availableParallelism, freemem, totalmem } from "node:os";

const mib = 1_048_576;
const wireMax = 0xffff_ffff;
const integer = (value) => Number.isSafeInteger(value) && value >= 0;

/** Host capabilities only. No child process, benchmark, preference or cache. */
export function readEngineDeviceInfo(
  readers = {
    logicalThreads: availableParallelism,
    totalBytes: totalmem,
    availableBytes: freemem,
  },
) {
  let logicalThreads = 1,
    totalMemoryMb = null,
    availableMemoryMb = null;
  try {
    const value = readers.logicalThreads();
    if (integer(value) && value > 0) logicalThreads = Math.min(wireMax, value);
  } catch {
    /* Conservative CPU fallback; keep memory discovery independent. */
  }
  try {
    const total = readers.totalBytes();
    if (integer(total) && total >= mib && Math.floor(total / mib) <= wireMax) {
      totalMemoryMb = Math.floor(total / mib);
      try {
        const available = readers.availableBytes();
        if (integer(available)) availableMemoryMb = Math.floor(Math.min(total, available) / mib);
      } catch {
        /* Installed memory is still known if the available read fails. */
      }
    }
  } catch {
    /* Unknown is distinct from zero. */
  }
  return { logicalThreads, totalMemoryMb, availableMemoryMb };
}

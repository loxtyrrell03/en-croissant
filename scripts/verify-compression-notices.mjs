import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function verifyCompressionNotices(root, scope = "native") {
  if (!["native", "hosted-helper"].includes(scope))
    throw Error("Unknown compression-notice scope.");
  const helper = scope === "hosted-helper";
  const read = (file) => readFileSync(path.join(root, file), "utf8");
  const manifest = JSON.parse(
    read(helper ? "licenses/zstd/helper-manifest.json" : "licenses/zstd/manifest.json"),
  );
  const packages = [
    ...read(helper ? "src-tauri/tournament-core/Cargo.lock" : "src-tauri/Cargo.lock").matchAll(
      /\[\[package\]\]([\s\S]*?)(?=\[\[package\]\]|$)/g,
    ),
  ].map((match) => ({
    name: match[1].match(/^name = "([^"]+)"/m)?.[1],
    version: match[1].match(/^version = "([^"]+)"/m)?.[1],
  }));
  const names = ["zstd", "zstd-safe", "zstd-sys"];
  const notices = read(
    helper ? "licenses/PHONE_HELPER_NOTICES.txt" : "licenses/THIRD_PARTY_NOTICES.txt",
  ).replaceAll("\r\n", "\n");
  for (const name of names) {
    const installed = packages.filter((pkg) => pkg.name === name);
    if (
      !installed.length ||
      installed.some(
        (pkg) =>
          !manifest.entries.some((entry) => entry.name === name && entry.version === pkg.version),
      )
    ) {
      throw Error(`Review compression notices for changed ${name} versions.`);
    }
  }
  for (const entry of manifest.entries) {
    if (
      !names.includes(entry.name) ||
      !packages.some((pkg) => pkg.name === entry.name && pkg.version === entry.version)
    ) {
      throw Error(`Notice does not match locked ${entry.name} version.`);
    }
    if (path.isAbsolute(entry.noticePath) || entry.noticePath.split(/[\\/]/).includes(".."))
      throw Error("Notice path must stay inside the repository.");
    const bytes = readFileSync(path.join(root, entry.noticePath));
    if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256)
      throw Error(`Exact licence text changed: ${entry.noticePath}`);
    if (!notices.includes(bytes.toString("utf8").replaceAll("\r\n", "\n").trim()))
      throw Error(`Distribution omits full notice: ${entry.noticePath}`);
    if (!notices.includes(`${entry.name} ${entry.version}`))
      throw Error(`Distribution omits version: ${entry.name}`);
    if (
      helper &&
      !notices.includes(
        `${entry.name} ${entry.version} - ${entry.component}\nSelected licence: ${entry.selectedLicense}\n`,
      )
    )
      throw Error(`Distribution mislabels the ${entry.name} grant.`);
  }
  if (
    manifest.entries.length !== 4 ||
    !manifest.entries.some(
      (entry) => entry.name === "zstd-sys" && entry.sourcePath === "zstd/LICENSE",
    )
  )
    throw Error("Both wrapper and bundled C notices are required.");
  const config = helper ? null : JSON.parse(read("src-tauri/tauri.conf.json"));
  if (
    !helper &&
    config.bundle.resources?.["../licenses/THIRD_PARTY_NOTICES.txt"] !== "THIRD_PARTY_NOTICES.txt"
  )
    throw Error("Native distribution must include third-party notices.");
  return { packages: names.length, grants: manifest.entries.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--scope"))
    throw Error("Usage: verify-compression-notices.mjs [--scope native|hosted-helper]");
  const scope = args[1] ?? "native";
  const result = verifyCompressionNotices(fileURLToPath(new URL("../", import.meta.url)), scope);
  console.log(
    `Compression notices: ${result.packages} locked packages, ${result.grants} exact grants, complete text and ${scope === "native" ? "native resource mapping" : "hosted-helper labels"} verified.`,
  );
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("service-worker activation never waits for its client navigation", async () => {
  const source = await readFile(new URL("../../public/web-sw.js", import.meta.url), "utf8");
  const listeners = new Map();
  let navigationCalls = 0;
  const navigationThatNeverFinishes = new Promise(() => {});
  const client = {
    url: "https://lox.tail89d19b.ts.net/",
    navigate() {
      navigationCalls += 1;
      return navigationThatNeverFinishes;
    },
  };
  const self = {
    registration: { scope: "https://lox.tail89d19b.ts.net/" },
    location: { origin: "https://lox.tail89d19b.ts.net" },
    clients: {
      async claim() {},
      async matchAll() {
        return [client];
      },
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    async skipWaiting() {},
  };
  const caches = {
    async keys() {
      return ["old-release"];
    },
    async delete() {
      return true;
    },
    async open() {
      return { addAll: async () => {}, put: async () => {} };
    },
    async match() {
      return undefined;
    },
  };

  vm.runInNewContext(source, {
    URL,
    Promise,
    Response,
    caches,
    fetch: async () => new Response("ok"),
    self,
  });

  const activate = listeners.get("activate");
  assert.equal(typeof activate, "function");
  let activation;
  activate({
    waitUntil(promise) {
      activation = promise;
    },
  });

  await Promise.race([
    activation,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("activation waited for client.navigate()")), 250),
    ),
  ]);
  assert.equal(navigationCalls, 1);
});

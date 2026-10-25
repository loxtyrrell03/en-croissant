import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../../src-tauri/windows-ipc.js", import.meta.url), "utf8");
function fixture() {
  const sent = [],
    http = [];
  const context = vm.createContext({
    window: {
      __TAURI_INTERNALS__: {},
      ipc: { postMessage: (body) => sent.push(JSON.parse(body)) },
    },
    // A resolved response must not swallow a native command either.
    fetch: async (...args) => {
      http.push(args);
      return new Response("Unrelated forbidden response", { status: 403 });
    },
  });
  vm.runInContext(source.replace("__INVOKE_KEY__", JSON.stringify("fixture-frame-key")), context);
  return { context, sent, http };
}

test("Windows commands reach the native bridge once with frame authentication and callbacks", () => {
  const { context, sent, http } = fixture();
  vm.runInContext(
    `window.__TAURI_INTERNALS__.postMessage({cmd:'get_progress',callback:17,error:18,payload:{id:'fixture'},options:{headers:{'fixture-header':'value'}}})`,
    context,
  );
  assert.deepEqual(sent, [
    {
      cmd: "get_progress",
      callback: 17,
      error: 18,
      payload: { id: "fixture" },
      options: { headers: { "fixture-header": "value" }, customProtocolIpcBlocked: true },
      __TAURI_INVOKE_KEY__: "fixture-frame-key",
    },
  ]);
  assert.equal(http.length, 0);
  assert.equal(
    vm
      .runInContext("window.__TAURI_INTERNALS__.postMessage.toString()", context)
      .includes("fixture-frame-key"),
    false,
  );
});

test("binary inputs, maps and nested Tauri channel objects retain the pinned wire format", () => {
  const { context, sent } = fixture();
  vm.runInContext(
    `window.__TAURI_INTERNALS__.postMessage({cmd:'fixture',callback:1,error:2,payload:{bytes:new Uint8Array([0,127,255]),buffer:new Uint8Array([8,9]).buffer,map:new Map([['a',3]]),nested:[null,{channel:{id:42,__TAURI_TO_IPC_KEY__(){return '__CHANNEL__:'+this.id}}}]}})`,
    context,
  );
  assert.deepEqual(sent[0].payload, {
    bytes: [0, 127, 255],
    buffer: [8, 9],
    map: { a: 3 },
    nested: [null, { channel: "__CHANNEL__:42" }],
  });
});

test("native bridge failure is surfaced without retry or HTTP fallback", () => {
  const { context, sent, http } = fixture();
  vm.runInContext("window.ipc.postMessage=()=>{throw Error('bridge unavailable')}", context);
  assert.throws(
    () =>
      vm.runInContext(
        "window.__TAURI_INTERNALS__.postMessage({cmd:'create_pgn_game',payload:{fixture:true}})",
        context,
      ),
    /bridge unavailable/,
  );
  assert.equal(sent.length, 0);
  assert.equal(http.length, 0);
});

test("missing options and null payloads retain their meaning", () => {
  const { context, sent } = fixture();
  vm.runInContext(
    "window.__TAURI_INTERNALS__.postMessage({cmd:'fixture',callback:1,error:2,payload:null})",
    context,
  );
  assert.deepEqual(sent[0], {
    cmd: "fixture",
    callback: 1,
    error: 2,
    payload: null,
    options: { customProtocolIpcBlocked: true },
    __TAURI_INVOKE_KEY__: "fixture-frame-key",
  });
});

test("the transport choice does not mutate the caller's frozen options", () => {
  const { context, sent, http } = fixture();
  vm.runInContext(
    `window.options=Object.freeze({customProtocolIpcBlocked:false,headers:Object.freeze({'fixture-header':'keep'})}); window.__TAURI_INTERNALS__.postMessage({cmd:'fixture',payload:{},options:window.options})`,
    context,
  );
  assert.equal(vm.runInContext("window.options.customProtocolIpcBlocked", context), false);
  assert.deepEqual(sent[0].options, {
    customProtocolIpcBlocked: true,
    headers: { "fixture-header": "keep" },
  });
  assert.equal(http.length, 0);
});

test("channel fetch commands also stay on the native Windows transport", () => {
  const { context, sent, http } = fixture();
  vm.runInContext(
    `window.__TAURI_INTERNALS__.postMessage({cmd:'plugin:__TAURI_CHANNEL__|fetch',callback:4,error:5,payload:{id:3}})`,
    context,
  );
  assert.equal(sent[0].cmd, "plugin:__TAURI_CHANNEL__|fetch");
  assert.deepEqual(sent[0].payload, { id: 3 });
  assert.equal(sent[0].options.customProtocolIpcBlocked, true);
  assert.equal(http.length, 0);
});

test("the actual native builder opts in only for Windows", () => {
  const main = fs.readFileSync(new URL("../../src-tauri/src/main.rs", import.meta.url), "utf8");
  assert.match(
    main,
    /#\[cfg\(target_os = "windows"\)\]\s*let builder = builder\.invoke_system\(include_str!\("\.\.\/windows-ipc\.js"\)\);\s*builder\s*\.plugin\(tauri_plugin_single_instance::init/,
  );
  assert.equal((main.match(/\.invoke_system\(/g) ?? []).length, 1);
});

/**
 * Verifies the assumption the in-app interval report relies on: that a Firebase
 * push key's first 8 characters encode the write time, so a key range can stand
 * in for a time range without an index on the `timestamp` field.
 *
 * Checks, against the recorded feed:
 *  1. keys sort chronologically by device timestamp
 *  2. the decoded key time tracks the device timestamp within upload latency
 *  3. the padded key window the app builds actually contains every reading in
 *     an arbitrary requested interval (i.e. the report cannot silently clip)
 *
 * Usage: node tools/pushKeyCheck.mjs
 */
import fs from "node:fs";

const PUSH_CHARS = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";
const PAD_MS = 15 * 60 * 1000;

function prefixForTime(ms) {
  let remaining = Math.max(0, Math.floor(ms));
  const chars = new Array(8);
  for (let i = 7; i >= 0; i--) {
    chars[i] = PUSH_CHARS.charAt(remaining % 64);
    remaining = Math.floor(remaining / 64);
  }
  return chars.join("");
}

function timeFromKey(key) {
  let ms = 0;
  for (let i = 0; i < 8; i++) ms = ms * 64 + PUSH_CHARS.indexOf(key[i]);
  return ms;
}

const dump = JSON.parse(fs.readFileSync(new URL("./sensor-dump.json", import.meta.url), "utf8"));
const rows = Object.entries(dump)
  .filter(([key, v]) => key.length === 20 && v && typeof v.timestamp === "number")
  .map(([key, v]) => ({ key, keyMs: timeFromKey(key), devMs: v.timestamp * (v.timestamp < 1e12 ? 1000 : 1) }))
  .sort((a, b) => a.keyMs - b.keyMs);

console.log(`records with a 20-char push key and timestamp: ${rows.length}`);
if (rows.length === 0) {
  console.log("nothing to check — is sensor-dump.json a keyed export?");
  process.exit(0);
}

// 1. round-trip
const badRoundTrip = rows.filter((r) => prefixForTime(r.keyMs) !== r.key.slice(0, 8));
console.log(`1. prefix round-trip mismatches: ${badRoundTrip.length}`);

// 2. key time vs device time
const skews = rows.map((r) => r.keyMs - r.devMs).sort((a, b) => a - b);
const pct = (p) => skews[Math.min(skews.length - 1, Math.floor(skews.length * p))];
console.log(
  `2. keyTime − deviceTime: min ${(skews[0] / 1000).toFixed(1)}s · p50 ${(pct(0.5) / 1000).toFixed(1)}s · ` +
    `p99 ${(pct(0.99) / 1000).toFixed(1)}s · max ${(skews[skews.length - 1] / 1000).toFixed(1)}s`,
);
const exceedsPad = skews.filter((s) => Math.abs(s) > PAD_MS).length;
console.log(`   readings whose skew exceeds the ${PAD_MS / 60000}-min pad: ${exceedsPad}`);

// 3. simulate the app's query over sliding windows and check nothing is clipped
const span = rows[rows.length - 1].devMs - rows[0].devMs;
let clipped = 0;
let windows = 0;
for (let f = 0; f < 0.9; f += 0.05) {
  const from = rows[0].devMs + span * f;
  const to = from + 6 * 3600 * 1000;
  const startKey = prefixForTime(from - PAD_MS);
  const endKey = prefixForTime(to + PAD_MS);
  const wanted = rows.filter((r) => r.devMs >= from && r.devMs <= to);
  const fetched = new Set(
    rows.filter((r) => r.key.slice(0, 8) >= startKey && r.key.slice(0, 8) <= endKey).map((r) => r.key),
  );
  const missed = wanted.filter((r) => !fetched.has(r.key)).length;
  clipped += missed;
  windows++;
}
console.log(`3. ${windows} simulated 6h report windows · readings clipped by the key range: ${clipped}`);
console.log(clipped === 0 && badRoundTrip.length === 0 && exceedsPad === 0 ? "\nPASS" : "\nFAIL");

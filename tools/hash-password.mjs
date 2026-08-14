#!/usr/bin/env node
// Mint an AUTH_USERS entry for AUTH_MODE=basic.
//
//   node tools/hash-password.mjs aygun
//
// Prompts for the password without echoing it, prints one `username:hash` entry.
// Join several with commas to make the AUTH_USERS value:
//
//   AUTH_USERS=aygun:scrypt$...,rashad:scrypt$...
//
// Requires a build first (npm run build), because it uses the same hashing code
// the server verifies with - a second implementation here could drift.
import { createInterface } from "node:readline";
import { randomBytes } from "node:crypto";

const { hashPassword } = await import("../dist/src/password.js").catch(() => {
  console.error("error: run `npm run build` first");
  process.exit(1);
});

const user = process.argv[2];
if (!user || !/^[\w.@+-]{1,128}$/.test(user)) {
  console.error("usage: node tools/hash-password.mjs <username>");
  console.error("       username may contain letters, digits, . @ + - _");
  process.exit(1);
}

const password = process.argv[3] === "--generate" ? randomBytes(12).toString("base64url") : await prompt();

if (password.length < 12) {
  console.error("error: use at least 12 characters, or pass --generate");
  process.exit(1);
}

console.log();
if (process.argv[3] === "--generate") console.log(`password : ${password}`);
console.log(`entry    : ${user}:${hashPassword(password)}`);
console.log();
console.log("Add it to AUTH_USERS (comma-separated). Give the password to the person");
console.log("out of band; it is not recoverable from the entry above.");

function prompt() {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Suppress echo so the password does not end up in a screenshot or a
    // shared terminal recording.
    const write = rl._writeToOutput?.bind(rl);
    rl._writeToOutput = function (s) {
      if (rl.stdoutMuted) rl.output.write("");
      else write?.(s);
    };
    rl.question(`password for ${user}: `, (answer) => {
      rl.stdoutMuted = false;
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
    rl.stdoutMuted = true;
  });
}

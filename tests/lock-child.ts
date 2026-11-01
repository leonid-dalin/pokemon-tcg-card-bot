import { acquireSingleInstanceLock } from "../src/single-instance.js";

const lock = process.argv[2];
if (!lock) {
  process.stderr.write("usage: lock-child <lock-path>\n");
  process.exit(2);
}
if (acquireSingleInstanceLock(lock)) {
  process.stdout.write("READY\n");
  // Hold the lock until the parent kills this process.
  setInterval(() => {}, 1 << 30);
} else {
  process.stdout.write("REFUSED\n");
  process.exit(1);
}

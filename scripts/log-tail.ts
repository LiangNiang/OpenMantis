import { statSync, openSync, readSync, closeSync, mkdirSync, writeFileSync, existsSync } from "node:fs";

const path = ".openmantis/openmantis.log";

if (!existsSync(path)) {
  mkdirSync(".openmantis", { recursive: true });
  writeFileSync(path, "");
}

let pos = statSync(path).size;

setInterval(() => {
  const size = statSync(path).size;
  if (size > pos) {
    const buf = Buffer.alloc(size - pos);
    const fd = openSync(path, "r");
    readSync(fd, buf, 0, buf.length, pos);
    closeSync(fd);
    process.stdout.write(buf);
    pos = size;
  } else if (size < pos) {
    pos = 0;
  }
}, 200);

const fs = require('node:fs');
const path = require('node:path');

const sourceDirectory = path.resolve(__dirname, '../src/assets');
const destinationDirectory = path.resolve(__dirname, '../dist/assets');

fs.mkdirSync(destinationDirectory, { recursive: true });
for (const filename of fs.readdirSync(sourceDirectory)) {
  const source = path.join(sourceDirectory, filename);
  if (fs.statSync(source).isFile()) {
    fs.copyFileSync(source, path.join(destinationDirectory, filename));
  }
}

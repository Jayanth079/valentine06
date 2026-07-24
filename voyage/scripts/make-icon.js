// Generates assets/icon.png (and build/icon.png for electron-builder).
// Uses assets/logo.png if you saved your original logo there; otherwise
// renders the bundled vector logomark. Requires the `sharp` devDependency.
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const root = path.join(__dirname, "..");
const custom = path.join(root, "assets", "logo.png");
const fallback = path.join(root, "assets", "logomark.svg");
const src = fs.existsSync(custom) ? custom : fallback;

(async () => {
  fs.mkdirSync(path.join(root, "build"), { recursive: true });
  const png = await sharp(src).resize(1024, 1024, { fit: "contain", background: { r: 15, g: 23, b: 34, alpha: 1 } }).png().toBuffer();
  fs.writeFileSync(path.join(root, "assets", "icon.png"), png);
  fs.writeFileSync(path.join(root, "build", "icon.png"), png);
  console.log("icon.png generated from", path.basename(src));
})().catch((e) => { console.error(e); process.exit(1); });

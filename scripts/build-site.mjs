import {
  readFileSync,
  mkdirSync,
  rmSync,
  cpSync,
  writeFileSync,
} from "node:fs";
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const escape = (s) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
function inline(text) {
  return escape(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(
      /https:\/\/github\.com\/everettjf\/tabcarry\/issues/g,
      '<a href="https://github.com/everettjf/tabcarry/issues" rel="noopener noreferrer">GitHub issues</a>',
    )
    .replace(
      /xnuapp@gmail\.com/g,
      '<a href="mailto:xnuapp@gmail.com">xnuapp@gmail.com</a>',
    );
}
// Deliberately limited to the paragraphs, headings and lists in our own policy source.
const policy = readFileSync("PRIVACY_POLICY.md", "utf8")
  .trim()
  .split(/\n\s*\n/)
  .map((block) => {
    if (block.startsWith("# ")) return `<h1>${inline(block.slice(2))}</h1>`;
    if (block.startsWith("## ")) return `<h2>${inline(block.slice(3))}</h2>`;
    if (block.startsWith("- "))
      return `<ul>${block
        .split("\n")
        .map((line) => `<li>${inline(line.slice(2))}</li>`)
        .join("")}</ul>`;
    return `<p>${inline(block.replaceAll("\n", " "))}</p>`;
  })
  .join("\n");
rmSync(".site", { recursive: true, force: true });
cpSync("docs/site", ".site", { recursive: true });
mkdirSync(".site/assets", { recursive: true });
mkdirSync(".site/downloads", { recursive: true });
for (const file of ["library-light.png", "library-dark.png", "restore.png"])
  cpSync(`docs/store/${file}`, `.site/assets/${file}`);
cpSync("public/icons/128.png", ".site/assets/icon.png");
cpSync(`releases/TabCarry-${version}.zip`, ".site/downloads/TabCarry.zip");
for (const file of ["index.html", "privacy/index.html"]) {
  const template = readFileSync(`.site/${file}`, "utf8");
  writeFileSync(
    `.site/${file}`,
    template
      .replaceAll("{{version}}", escape(version))
      .replace("{{policy}}", policy),
  );
}
writeFileSync(".site/.nojekyll", "");
console.log(`Website ready in .site/ (TabCarry ${version})`);

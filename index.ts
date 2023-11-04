import { readFileSync } from "fs";
import { parseFragment, serialize } from "parse5";
import { parse } from "acorn";
import { generate } from "astring";
import { randomBytes } from "crypto";
// Might need this for reactivity later?
// import { walk } from "estree-walker";

function compile(file: string) {
  const doc = parseFragment(file);

  const scripts: string[] = [];
  const eventHandlers: string[] = [];

  // Parse script tag
  let ast: any;
  const i: any = doc.childNodes.findIndex((node) => node.nodeName === "script");
  if (i !== -1) {
    const node: any = doc.childNodes[i]!;
    ast = parse(node.childNodes[0].value, {
      ecmaVersion: "latest",
      sourceType: "module",
    });
    scripts.push(generate(ast));
    doc.childNodes.splice(i, 1);
  }

  function traverse(parent: any) {
    for (let i = 0; i < parent.childNodes.length; i++) {
      const node = parent.childNodes[i];

      // Handle replacing {var} with ${var}
      if (node.nodeName === "#text") {
        node.value = node.value.replace(
          /{(.+?)}/g,
          (_: any, p1: any) => `\${${p1}}`,
        );
      }

      // Handle @event handlers
      if (node.attrs) {
        const nodeEventHandlers: any[] = [];

        // Remove attrs that start with @ and a class for selecting and add as event
        node.attrs = node.attrs.filter((attr: any) => {
          if (attr.name.startsWith("@")) {
            nodeEventHandlers.push(attr);
            return false;
          }
          return true;
        });

        if (nodeEventHandlers.length > 0) {
          const id = randomBytes(4).toString("hex");
          const classAttr = node.attrs.find((attr: any) => attr.name);
          if (classAttr) {
            classAttr.value += " " + id;
            classAttr.value = classAttr.value.trim();
          } else {
            node.attrs.push({ name: "class", value: id });
          }

          eventHandlers.push(
            `const _${id} = document.querySelector('${
              node.tagName
            }.${id}');${nodeEventHandlers
              .map((attr) => {
                const ev = attr.name.slice(1);
                const fn = attr.value.slice(1, -1);
                // TODO: Put a render lifecycle hook here
                return `function ${ev}_${id}(...args) { ${fn}(...args) };_${id}.addEventListener('${ev}', ${fn});`;
              })
              .join("")}`,
          );
        }
      }

      if (node.childNodes) traverse(node);
    }
  }

  traverse(doc);

  let js = (scripts.join("\n") + "\n" + eventHandlers.join("\n")).trim();
  if (!js.endsWith(";")) js += ";";

  const html = serialize(doc).trim();

  const transpiler = new Bun.Transpiler({
    loader: "js",
    minifyWhitespace: true,
  });

  return transpiler.transformSync(
    `export default function component({ $render, ...props }) {${js}return \`${html}\`;};`,
  );
}

const file = readFileSync("./example.hits", "utf8");
const out = compile(file);

console.log(out);

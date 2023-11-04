import { readFileSync } from "fs";
import { parseFragment, serialize } from "parse5";
import { parse } from "acorn";
import { generate } from "astring";
import { createHash, randomBytes } from "crypto";
// Might need this for reactivity
// import { walk } from "estree-walker";

const file = readFileSync("./example.hits", "utf8");

const doc = parseFragment(file);

const scripts: string[] = [];
const eventHandlers: string[] = [];

function traverse(parent: any) {
  for (let i = 0; i < parent.childNodes.length; i++) {
    const node = parent.childNodes[i];
    if (node.nodeName === "script") {
      const script = node as any; // TODO: Validate

      const ast = parse(script.childNodes[0].value, {
        ecmaVersion: "latest",
        sourceType: "module",
      });

      scripts.push(generate(ast));

      parent.childNodes.splice(i, 1);
    } else {
      if (node.childNodes) traverse(node);

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
    }
  }
}
traverse(doc);

const js = scripts.join("\n") + "\n" + eventHandlers.join("\n");
const html = serialize(doc).trim();

console.log(html);
console.log(js);

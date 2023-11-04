import { readFileSync } from "fs";
import { parseFragment, serialize } from "parse5";
import { parse } from "acorn";
import { generate } from "astring";
import { randomBytes } from "crypto";

function compile(file: string) {
  const doc = parseFragment(file);

  let imports = "";
  let declarations = "";
  let scripts = "";
  const eventHandlers: string[] = [];

  // Parse script tag
  // TODO: This is a bit messy
  const i: any = doc.childNodes.findIndex((node) => node.nodeName === "script");
  if (i !== -1) {
    const node: any = doc.childNodes[i]!;
    const ast = parse(node.childNodes[0].value, {
      ecmaVersion: "latest",
      sourceType: "module",
    });

    const newAst: any = { ...ast, body: [] };
    const newDeclarations: any = { ...ast, body: [] };
    const newImports: any = { ...ast, body: [] };

    for (let i = 0; i < ast.body.length; i++) {
      const n = ast.body[i];
      if (["VariableDeclaration", "FunctionDeclaration"].includes(n.type)) {
        // Pull out declarations
        newDeclarations.body.push(n);
      } else if (n.type === "ImportDeclaration") {
        // Pull out imports
        newImports.body.push(n);
      } else {
        newAst.body.push(n);
      }
    }
    scripts = generate(newAst);
    declarations = generate(newDeclarations);
    imports = generate(newImports);
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
          const id = "_" + randomBytes(4).toString("hex");

          const classAttr = node.attrs.find((attr: any) => attr.name);
          if (classAttr) {
            classAttr.value += ` ${id}`;
            classAttr.value = classAttr.value.trim();
          } else {
            node.attrs.push({ name: "class", value: id });
          }

          eventHandlers.push(
            `const ${id} = document.querySelector('${
              node.tagName
            }.${id}');${nodeEventHandlers
              .map((attr) => {
                const ev = attr.name.slice(1);
                const fn = attr.value.slice(1, -1);
                // TODO: Put a render lifecycle hook here
                return `function ${ev}${id}(...args) { ${fn}(...args) };${id}.addEventListener('${ev}', ${fn});`;
              })
              .join("")}`,
          );
        }
      }

      if (node.childNodes) traverse(node);
    }
  }

  traverse(doc);

  let js = (scripts + "\n" + eventHandlers.join("\n")).trim();
  if (!js.endsWith(";")) js += ";";

  const html = serialize(doc).trim();

  const transpiler = new Bun.Transpiler({
    loader: "js",
    minifyWhitespace: true,
    target: "browser",
    allowBunRuntime: false,
  });

  return transpiler.transformSync(
    `${imports}
export default function component(target, $props = {}) {
        const $state = new Proxy({}, {
            set: (t, key, value) => {
                t[key] = value;
                // TODO: Update the changed value in the DOM
                return true;
            }
        });
        ${declarations}
        function $render() { return \`${html}\` };
        target.innerHTML = $render()
        return {
            mount: () => { ${js} },
        };
     };`,
  );
}

const file = readFileSync("./example.hits", "utf8");
const out = compile(file);
const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>hits</title>
  </head>
  <body>
  </body>
  <script type="module">
    ${out}
    component(document.body, { name: "Dan" }).mount()
  </script>
</html>`;

console.log(out);

const server = Bun.serve({
  port: 3000,
  fetch() {
    return new Response(html, {
      headers: { "Content-Type": "text/html" },
    });
  },
});

console.log(`Listening on localhost: ${server.port}`);

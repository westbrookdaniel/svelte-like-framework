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
  let state: any = {};
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
      const n: any = ast.body[i];
      if (
        n.type === "VariableDeclaration" &&
        n.declarations[0].id.name === "$state"
      ) {
        // Special case for $state declaration
        state = Object.fromEntries(
          n.declarations[0].init.properties.map((p: any) => [
            p.key.name,
            { value: p.value.value, subs: [] },
          ]),
        );
      } else if (
        ["VariableDeclaration", "FunctionDeclaration"].includes(n.type)
      ) {
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

      // Handle $state subs (currently only works in text nodes lol)
      if (node.nodeName === "#text") {
        const matches = node.value.match(/{(.+?)}/g);

        if (matches) {
          const id = "_" + randomBytes(4).toString("hex");
          // TODO: this is dupe of below, refactor
          const classAttr = node.parentNode.attrs.find(
            (attr: any) => attr.name,
          );
          if (classAttr) {
            classAttr.value += ` ${id}`;
            classAttr.value = classAttr.value.trim();
          } else {
            node.parentNode.attrs.push({ name: "class", value: id });
          }

          for (let i = 0; i < matches.length; i++) {
            const match = matches[i];
            const key = match.slice("{$state.".length, -1);
            if (state[key]) {
              state[key].subs.push(
                `function ${id}(value) { 
                    document.querySelector('.${id}').textContent = \`${node.value
                      .replace(match, "{value}")
                      .replace(/{/g, "${")}\`;
                }`,
              );
            }
          }
        }

        // Handle replacing {var} with ${var}
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

  let strState = "{";
  for (const key in state) {
    strState += `"${key}": { value: ${JSON.stringify(state[key].value)}, subs: [
        ${state[key].subs.join(",")}
    ] },`;
  }
  strState += "}";

  return transpiler.transformSync(
    `${imports}
export default function component(target, $props = {}) {
        const $state = new Proxy(${strState}, {
            set: (t, key, value) => {
                t[key].value = value;
                t[key].subs.forEach((fn) => fn(value));
                return true;
            },
            get: (t, key) => t[key].value,
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

const file = readFileSync("./example", "utf8");
const out = compile(file);
const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>App</title>
  <script type="module">
    ${out}
    component(document.body).mount()
  </script>
  </head>
  <body>
  </body>
</html>`;

const server = Bun.serve({
  port: 3000,
  fetch() {
    return new Response(html, {
      headers: { "Content-Type": "text/html" },
    });
  },
});

console.log(`Listening on localhost: ${server.port}`);

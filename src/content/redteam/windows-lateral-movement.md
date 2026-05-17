---
title: "Windows Lateral Movement: Pass-the-Hash & SMB/RPC Exec Tooling"
date: 2022-06-13
category: "lateral-movement"
difficulty: "advanced"
tags: [lateral-movement, windows, smb, rpc, pass-the-hash, ntlm, impacket, wmi, dcom, detection-engineering, mitre-attack]
excerpt: "A researcher-style study of Windows lateral movement: SMB/RPC fundamentals, LM and NTLM authentication, pass-the-hash, Impacket execution methods, Windows-native alternatives, protocol flow, forensic artifacts, detection opportunities, and defensive controls."
draft: false
---

# Windows Lateral Movement: Pass-the-Hash & SMB/RPC Exec Tooling

> Educational material for authorized red-team research and defensive learning
> only. Use these techniques exclusively in lab environments or systems you are
> explicitly contracted to test. The purpose of this article is to understand
> Windows lateral movement mechanics, artifacts, and defenses.

## Executive Summary

Compromising one Windows host is rarely the final objective. After initial
access, an operator tries to understand the internal network, collect credential
material, identify reachable systems, and move laterally toward higher-value
assets such as file servers, application servers, databases, or Domain
Controllers.

This research studies a common Windows lateral movement path:

```text
Initial foothold
  -> internal enumeration
  -> credential / hash collection
  -> SMB/RPC authentication
  -> remote command execution
  -> output retrieval
  -> repeat across hosts
```

The core ideas:

- **SMB is enabled in many Windows environments** and exposes administrative
  shares such as `ADMIN$`, `C$`, and `IPC$`.
- **RPC/DCOM/WMI provide remote management primitives** that can be used for
  administration or abused for remote execution.
- **NTLM hashes can authenticate without knowing the plaintext password** in
  pass-the-hash scenarios.
- **Impacket tools automate Windows remote execution paths** by combining SMB,
  RPC, SVCCTL, Task Scheduler, WMI, and DCOM.
- **Every method creates artifacts**, including logon events, service creation,
  scheduled task activity, WMI/DCOM process creation, temporary files, and
  network connections.

This article is written from a security researcher's perspective: not only how
the tools are used, but how the protocols connect, what evidence each method
leaves, why detection differs by method, and how defenders can reduce the
attack surface.

## Research Scope

Covered:

- Lateral movement concepts in Windows networks.
- SMB, administrative shares, IPC$, and RPC fundamentals.
- UAC Remote Restriction and why local admin rights may not behave as expected.
- LM, NTLMv1, NTLMv2, and pass-the-hash concepts.
- Hash acquisition research using Metasploit, `ntdsutil`, `smbclient.py`, and
  `secretsdump.py` in a lab.
- Remote execution tooling:
  - `smbexec.py`
  - `sc.exe`
  - `atexec.py`
  - `at.exe`
  - `schtasks.exe`
  - `wmiexec.py`
  - `wmic.exe`
  - `dcomexec.py`
  - `MMC20.Application`
- Artifacts, detection engineering, and prevention.

Not covered:

- Exploitation to obtain the first foothold.
- Malware development.
- Credential theft bypasses.
- Evasion of EDR.
- Real-world unauthorized access.

## MITRE ATT&CK Mapping

| Activity | ATT&CK ID | Notes |
|---|---|---|
| Lateral Tool Transfer | T1570 | Tools or payloads may be copied over SMB shares. |
| Pass the Hash | T1550.002 | NTLM hashes are reused for authentication. |
| Windows Admin Shares | T1021.002 | `ADMIN$`, `C$`, and `IPC$` are common channels. |
| SMB/Windows Admin Shares Execution | T1021.002 / T1569.002 | Service creation through SVCCTL. |
| Scheduled Task/Job | T1053.005 | Remote scheduled task creation and execution. |
| Windows Management Instrumentation | T1047 | WMI remote process creation. |
| Distributed Component Object Model | T1021.003 | DCOM objects such as MMC20 can execute commands remotely. |
| Remote Services | T1021 | Parent technique family for remote management protocols. |

Mapping matters because lateral movement is not one technique. It is a chain of
authentication, remote management, command execution, and output retrieval.

## Research Lab Assumptions

The source research used controlled Windows lab hosts. The important
assumptions were:

- The operator has administrative credentials or hashes for the target.
- SMB/RPC connectivity exists between source and destination.
- Windows Firewall and segmentation allow required ports.
- Remote UAC restrictions are understood or configured for the lab.
- Commands are benign validation commands such as `whoami`, `hostname`,
  `notepad.exe`, or `ping 127.0.0.1 -t`.

For a real engagement, all of those assumptions must be validated and scoped.

## What Is Lateral Movement?

Lateral movement is the process of moving from one compromised system to
another inside the same environment. The goal is usually one of the following:

- reach higher-value systems;
- obtain stronger credentials;
- discover sensitive data;
- access administrative shares;
- reach a network segment not directly accessible from the original foothold;
- prepare for later objectives.

Example:

```text
Compromised workstation
  -> dump local admin hash
  -> discover file server
  -> authenticate over SMB
  -> execute command via service creation
  -> collect new credentials
  -> move toward Domain Controller
```

In Windows environments, lateral movement often depends less on "exploiting a
vulnerability" and more on abusing legitimate administration features with
valid credentials.

## Lateral Movement Prerequisites

Before lateral movement is possible, the operator usually needs:

| Requirement | Why It Matters |
|---|---|
| Reachable target host | Network segmentation, firewall rules, and routing define what can be reached. |
| Valid credential or reusable hash | Most Windows remote management paths require authentication. |
| Sufficient privileges | Many remote execution methods require local administrator rights on the target. |
| Open management services | SMB, RPC, WMI, DCOM, or Task Scheduler must be reachable. |
| Understanding of remote UAC | Local admin credentials may be filtered over the network. |
| Output channel | Many tools use SMB to retrieve command output. |

This is why internal enumeration comes before lateral execution. Without a map
of users, groups, hosts, ports, and shares, lateral movement becomes noisy
guesswork.

## SMB Fundamentals

### What SMB Provides

SMB (Server Message Block) is a Windows file-sharing and inter-process
communication protocol. It lets clients access files, named pipes, printers, and
administrative shares on remote systems.

SMB is not just "file sharing." Many Windows remote administration workflows use
SMB as a transport for named pipes and RPC communication.

Common ports:

| Port | Meaning |
|---:|---|
| 445/tcp | SMB over TCP/IP. |
| 139/tcp | SMB over NetBIOS Session Service. |
| 135/tcp | RPC Endpoint Mapper. |
| 49152-65535/tcp | Dynamic RPC high ports on modern Windows. |

The source research also notes `4915x` as the observed dynamic range in the lab.
On modern Windows, RPC dynamic ports normally live in the high ephemeral range.

### Administrative Shares

Default administrative shares:

| Share | Purpose |
|---|---|
| `ADMIN$` | Remote admin share mapped to `%SystemRoot%`, usually `C:\Windows`. |
| `C$` | Hidden administrative share for the `C:` drive. |
| `IPC$` | Inter-process communication share used for named pipes and RPC over SMB. |

`IPC$` is especially important. It is not a normal file share; it is the path
many tools use to reach named pipes such as SVCCTL and Task Scheduler RPC
interfaces.

Research takeaway:

```text
SMB provides the session.
IPC$ provides the named-pipe/RPC path.
Admin shares provide file write/read paths for payloads and output.
```

## RPC and Dynamic Ports

RPC (Remote Procedure Call) lets a client call functions exposed by a remote
service. On Windows, RPC often starts with the Endpoint Mapper on port `135`.
After authentication and endpoint negotiation, the server assigns a dynamic high
port for the actual interface.

Generic flow:

```text
Client -> TCP 135 Endpoint Mapper
Server -> returns endpoint / dynamic high port
Client -> connects to dynamic RPC port
Client -> binds to interface
Client -> invokes remote method
```

This is why tools such as `wmiexec.py`, `atexec.py`, and `dcomexec.py` may need:

- `445/tcp` for SMB session and output;
- `135/tcp` for RPC endpoint mapping;
- high dynamic RPC ports for the selected interface.

Defensive implication: blocking only one port may not be enough; proper lateral
movement reduction requires segmentation and remote administration policy.

## UAC Remote Restriction

Windows UAC separates a user's standard token from elevated administrative
capability. Over the network, **UAC Remote Restriction** can filter local
administrator tokens. This means a local admin account may authenticate but
still fail to perform privileged remote operations.

The lab bypass setting is:

```bat
reg add HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\system ^
  /v LocalAccountTokenFilterPolicy /t REG_DWORD /d 1 /f
```

Security interpretation:

- Setting `LocalAccountTokenFilterPolicy=1` weakens remote UAC filtering.
- It may make lab demonstrations easier.
- In production, it can increase lateral movement risk for local admin accounts.

Defensive recommendation:

- Keep remote UAC restrictions enabled.
- Avoid shared local administrator passwords.
- Use LAPS / Windows LAPS for local administrator password uniqueness.

## Credential Material and Pass-the-Hash

### Why Hashes Matter

A common question in the original research was: if we already have a password
hash, why not crack it?

Cracking requires:

- knowing the hash format;
- building or obtaining a strong wordlist;
- compute resources;
- time;
- luck.

Pass-the-hash avoids cracking. In NTLM authentication, the hash can be used to
produce valid challenge responses. The operator does not need the plaintext
password if the protocol and service accept NTLM authentication.

Research concept:

```text
Plaintext password is not always required.
Reusable credential material may be enough.
```

### LM Authentication

LAN Manager (LM) is old and insecure. It was introduced in 1987 and remains
important mainly because of backward compatibility history.

Weaknesses:

- Passwords are converted to uppercase before hashing.
- LM is case-insensitive.
- Passwords shorter than 14 characters are padded.
- The password is split into two 7-byte chunks.
- If the password is shorter than 8 characters, the second half is a known
  value.
- The two halves can be attacked independently.

This design makes LM hashes dramatically weaker than modern password storage
mechanisms. LM should be disabled in modern environments.

### NTLM Authentication

NTLM (New Technology LAN Manager) replaced LM and remains relevant in Windows
environments. It has two major versions:

- **NTLMv1** - legacy and not recommended.
- **NTLMv2** - default in modern Windows environments.

NTLM is a challenge/response protocol:

1. Client sends the username to the server.
2. Server sends a random challenge, also called a nonce.
3. Client uses the user's password hash to produce a response.
4. Server forwards username, challenge, and response to the Domain Controller.
5. Domain Controller retrieves the user's stored hash and computes its own
   expected response.
6. If responses match, authentication succeeds.

NTLMv1 and NTLMv2 differ in challenge construction and cryptographic handling.

| Version | Weakness / Property |
|---|---|
| NTLMv1 | Uses DES and fixed-size challenge behavior; should be disabled. |
| NTLMv2 | Uses HMAC-MD5 with additional fields such as timestamp, username, target, and client nonce; stronger but still exposes pass-the-hash risk when hashes are stolen. |

Security conclusion:

- Disable LM and NTLMv1.
- Prefer Kerberos where possible.
- Reduce NTLM exposure and monitor NTLM usage.
- Treat NTLM hashes as password-equivalent secrets.

## Obtaining Hashes in a Lab

The original research demonstrated two ways to obtain hashes in a lab:

1. Using Metasploit's `auxiliary/gather/windows_secrets_dump`.
2. Creating an offline NTDS copy with `ntdsutil`, transferring files, and using
   Impacket `secretsdump.py`.

### Metasploit Secrets Dump

In a friendly lab where credentials and target information are already known,
Metasploit can connect and dump secrets:

```text
auxiliary/gather/windows_secrets_dump
```

Output can include:

- local account hashes;
- NTLM hashes;
- Kerberos material;
- domain credential material, depending on host and privilege.

The source research then tested a local administrator hash with `smbexec.py`.
This is the classic pass-the-hash validation path.

### Offline NTDS Extraction

In a scenario where the operator has remote code execution or administrative
access to a Domain Controller, Windows-native tooling can create install media
style copies of Active Directory database files.

Lab command:

```powershell
powershell "ntdsutil.exe 'ac i ntds' 'ifm' 'create full c:\temp' q q"
```

The resulting files can be collected in the lab. The source research used
Impacket `smbclient.py` for file transfer and cleanup.

Basic `smbclient.py` commands:

```text
shares
use
ls
cd
get
put
rm
```

Then parse the offline database:

```bash
secretsdump.py -ntds ntds.dit -system SYSTEM LOCAL
```

Defensive interpretation:

- `ntdsutil.exe` creating IFM media is a very high-signal event on a Domain
  Controller.
- Unexpected access to `ntds.dit`, `SYSTEM`, or backup directories should be
  treated as critical.
- File transfer from administrative shares after `ntdsutil` activity is a
  strong credential-theft indicator.

## Why SMB/RPC Tooling Instead of RDP?

The original research asked a practical question: if we already have high
privilege, why not use Remote Desktop?

Reasons:

- RDP is often disabled by default.
- RDP requires interactive logon and creates obvious user-session artifacts.
- SMB is commonly enabled in Windows networks.
- Remote administration protocols can execute commands non-interactively.
- Tools can retrieve output through admin shares.

This is why Impacket-style lateral movement is centered around SMB, RPC, WMI,
DCOM, SVCCTL, and Task Scheduler.

## Tooling Overview

| Tool / Method | Main Protocols | Privilege | Output Channel | Primary Artifact |
|---|---|---|---|---|
| `smbexec.py` | SMB + SVCCTL | Administrator | SMB file output | Service creation, temp batch/output files |
| `sc.exe` remote service | SMB/RPC + SVCCTL | Administrator | Depends on command | Service creation/modification |
| `atexec.py` | SMB + RPC Task Scheduler | Administrator | SMB temp output | Scheduled task XML, task events |
| `schtasks.exe` | RPC Task Scheduler | Administrator or supplied user | Depends on command | Scheduled task events |
| `wmiexec.py` | SMB + RPC/WMI/DCOM | Administrator | SMB output file | WmiPrvSE process creation |
| `wmic.exe` | RPC/WMI | Administrator | No built-in output capture | WmiPrvSE process creation |
| `dcomexec.py` | SMB + RPC/DCOM | Administrator | SMB output file | DCOM activation, mmc.exe / chosen COM server |
| MMC20 PowerShell | RPC/DCOM | Administrator | No built-in output capture | Remote COM activation, process creation |

The next sections break these down from a research and detection point of
view.

## SMBExec and SVCCTL

### Requirements

```text
Privilege: Administrator on target
Ports:     445/tcp, or 139/tcp fallback
Shares:    IPC$, C$
Protocol:  SVCCTL over SMB named pipe
```

`smbexec.py` connects to:

```text
\\<target>\IPC$
```

Then it requests the SVCCTL interface, creates a temporary service, executes a
command, retrieves output, and cleans up.

### Execution Flow

High-level flow:

```text
1. Connect to SMB on 445.
2. Authenticate with password or NTLM hash.
3. Open IPC$.
4. Bind to SVCCTL named pipe.
5. Create a service.
6. Service runs a command through cmd.exe.
7. Command writes output to C:\__output.
8. Tool reads \\<target>\C$\__output.
9. Tool deletes temporary files/service.
```

The original research observed the default Impacket service name:

```text
BTOBTO
```

That default is useful for lab learning but dangerous operationally because it
is widely known by defenders.

Example command structure observed in the research:

```bat
C:\Windows\system32\cmd.exe /Q /c echo ping 127.0.0.1 -t ^
  ^> \\127.0.0.1\C$\__output 2^>^&1 ^
  > C:\Windows\TEMP\execute.bat ^
  & C:\Windows\system32\cmd.exe /Q /c C:\Windows\TEMP\execute.bat ^
  & del C:\Windows\TEMP\execute.bat
```

Artifacts:

```text
Service:
  Temporary service, often BTOBTO in default Impacket behavior

Files:
  C:\Windows\TEMP\execute.bat
  C:\__output

Shares:
  \\<target>\IPC$
  \\<target>\C$

Logs:
  System 7045 - service installed
  System 7036 / 7035 - service state/control activity
  Security 4624 - network logon
  Security 5140 / 5145 - share access, if enabled
  Sysmon 1 - process creation
  Sysmon 11 - file creation
```

### Port 139 Fallback

If port 445 is unavailable but NetBIOS SMB is available, Impacket can use port
139:

```bash
smbexec.py -port 139 <domain>/<user>:<password>@<machine>
```

Defensive implication: closing 445 alone is not sufficient if 139 remains
available and reachable.

### Remote `sc.exe`

Windows-native `sc.exe` can operate against remote systems:

```bat
sc \\<machine-or-ip> create <ServiceName> binPath= "<CommandOrBinary>"
sc \\<machine-or-ip> start <ServiceName>
sc \\<machine-or-ip> stop <ServiceName>
sc \\<machine-or-ip> delete <ServiceName>
```

Important OPSEC/research note from the source document:

- `sc.exe` uses the current machine's credential context.
- The target can log the username used for the remote service operation.
- `net use` against `IPC$` or `runas` may be used in a lab to present a
  different credential context.

Detection:

- Remote service creation through SVCCTL is a high-value detection.
- Correlate `4624` type 3 logon with `7045` service creation.
- Alert on service binaries that execute shell commands directly.

## ATExec, `at.exe`, and `schtasks.exe`

### Requirements

```text
Privilege: Administrator
Ports:     445/tcp, 135/tcp, dynamic RPC high ports
Shares:    IPC$, ADMIN$
Protocol:  Task Scheduler RPC
```

`atexec.py` automates remote command execution through Task Scheduler. It is
inspired by legacy `at.exe`, which has been deprecated in favor of
`schtasks.exe`.

### ATExec Execution Flow

High-level flow:

```text
1. Connect to \\<target>\IPC$ over SMB.
2. Authenticate.
3. Request TaskSchedulerService.
4. Re-authenticate / bind through RPC on 135 and dynamic high port.
5. Create a scheduled task using XML content.
6. Task executes the command.
7. Output is written under ADMIN$\Temp.
8. Tool reads output over SMB.
9. Tool deletes the scheduled task and output file.
```

The source research observed payload/config locations such as:

```text
\\<target>\ADMIN$\System32\Tasks\<xml_payload_file>
\\<target>\ADMIN$\Temp\<output_file_name>.tmp
```

Research artifact:

- The scheduled task can be visible in Task Scheduler.
- XML task content defines the command to execute.
- File artifacts can appear under `C:\Windows\System32\Tasks` and
  `C:\Windows\Temp`.

### Known Tooling Fingerprint

The original research noted that `atexec.py` used a hard-coded task time:

```text
15-07-2015
```

This is the kind of tiny toolmark that matters in security research. Detection
engineering often depends on such implementation details, especially when they
are stable across common tool versions.

### `schtasks.exe`

Modern Windows uses `schtasks.exe` for task creation and execution.

Useful options:

```text
/?              Show help
/TN             Task name
/TR             Task run command
/Create         Create task
/Run            Run task
/xml <file>     Create from XML config
/st HH:MM       Start time
/sd MM/DD/YYYY  Start date
/sc             Schedule type
/s              Remote server
/u              Username
/p              Password
```

Schedule examples:

```text
MINUTE
HOURLY
DAILY
WEEKLY
MONTHLY
ONCE
ONLOGON
ONIDLE
ONEVENT
```

Remote lab example:

```bat
schtasks /Create /S 192.168.7.131 /U dc-local\user1 /P PassW0rd ^
  /TN ResearchTask ^
  /TR "%COMSPEC% /Q /c notepad.exe" ^
  /SC ONCE /ST 23:59 /RL HIGHEST

schtasks /Run /S 192.168.7.131 /U dc-local\user1 /P PassW0rd ^
  /TN ResearchTask
```

### Task Scheduler Artifacts

Artifacts:

```text
Registry:
  HKLM\Software\Microsoft\Windows NT\CurrentVersion\Schedule\TaskCache\Tasks
  HKLM\Software\Microsoft\Windows NT\CurrentVersion\Schedule\TaskCache\Tree

Disk:
  C:\Windows\System32\Tasks\<TaskName>
  C:\Windows\Temp\<output>.tmp

Logs:
  Security 4624 - network logon
  Security 4698 - scheduled task created
  Security 4702 - scheduled task updated
  Security 4699 - scheduled task deleted
  TaskScheduler/Operational 106 - task registered
  TaskScheduler/Operational 140 - task updated
  TaskScheduler/Operational 200/201 - action started/completed
```

Detection ideas:

- Task created remotely shortly after a type 3 logon.
- Task action launches `cmd.exe`, `powershell.exe`, `wscript.exe`,
  `cscript.exe`, `mshta.exe`, or LOLBins.
- Task name appears random or tool-generated.
- Task creation followed quickly by task deletion.
- Output file created under `C:\Windows\Temp`.

## WMIExec and `wmic.exe`

### Requirements

```text
Privilege: Administrator
Ports:     135/tcp, 445/tcp, dynamic RPC high ports
Process:   WmiPrvSE.exe
Protocol:  WMI over DCOM/RPC
```

`wmiexec.py` supports two common modes:

1. Semi-interactive shell.
2. Silent command mode.

In default mode, it uses SMB for output retrieval. In `-silentcommand` or
`-nooutput` style execution, it can execute and disconnect without collecting
output through SMB.

### WMIExec Protocol Flow

The original research captured the default flow with Wireshark:

```text
1. SMB connects to the target and authenticates.
2. SMB session is established.
3. Client requests RPC access to ISystemActivator on port 135.
4. Server grants an ISystemActivator session on a dynamic high port.
5. Client requests RemoteCreateInstance.
6. Client logs into IWbemLevel1Login.
7. IRemUnknown manages remote object lifetime.
8. DCERPC waits for commands.
9. Command is executed through WmiPrvSE.exe.
10. Output is written to %SystemRoot%\__<output_name_file>.
11. SMB repeatedly checks for the output file.
12. SMB reads output and returns it to the operator.
13. Output file is deleted.
14. Tool waits for the next command.
```

This is an excellent example of why protocol-level research matters. The tool
is not magic; it is a chain of SMB authentication, RPC activation, WMI object
access, command execution, file output, and cleanup.

### Silent Command Mode

Lab example:

```bash
wmiexec.py -silentcommand dc-local/user1:PassW0rd@192.168.7.131 "ping 127.0.0.1 -t"
```

In silent mode:

- the command is executed;
- the session disconnects;
- output retrieval may not occur;
- SMB output artifacts can be reduced, but process creation artifacts remain.

### Windows-Native `wmic.exe`

Paths:

```text
C:\Windows\System32\wbem\WMIC.exe
C:\Windows\SysWOW64\wbem\WMIC.exe
```

Remote process creation example:

```bat
wmic /node:"192.168.7.131" /USER:"dc-local\user1" /PASSWORD:PassW0rd ^
  PROCESS call create "%comspec% /Q /c notepad.exe"
```

This behaves similarly to `wmiexec.py` silent command mode: WMI creates a remote
process, but it does not provide the same interactive output loop.

### WMI Artifacts

Artifacts:

```text
Network:
  TCP 135
  Dynamic RPC high ports
  Optional SMB 445 for output retrieval

Processes:
  WmiPrvSE.exe
  Child process launched by WMI, often cmd.exe or requested command

Files:
  %SystemRoot%\__<output_name_file> in default wmiexec output mode

Logs:
  Security 4624 - network logon
  Security 4688 - process creation, if enabled
  Sysmon 1 - process creation
  WMI-Activity/Operational 5857/5858/5861 depending on telemetry
```

Detection ideas:

- `WmiPrvSE.exe` spawning `cmd.exe`, `powershell.exe`, `rundll32.exe`,
  `regsvr32.exe`, or unusual binaries.
- Remote logon followed by WMI process creation.
- Output files named like `%SystemRoot%\__*`.
- Network connections to RPC high ports followed by process execution.

Example hunting logic:

```powershell
Get-WinEvent -LogName "Microsoft-Windows-WMI-Activity/Operational" |
  Select-Object TimeCreated, Id, ProviderName, Message
```

Process relationship to watch:

```text
WmiPrvSE.exe -> cmd.exe
WmiPrvSE.exe -> powershell.exe
WmiPrvSE.exe -> notepad.exe
WmiPrvSE.exe -> suspicious payload
```

## DCOMExec and MMC20.Application

### COM and DCOM Concepts

COM (Component Object Model) is a Microsoft binary-interface standard that
allows software components to communicate across process boundaries.

DCOM (Distributed COM) extends COM across the network through RPC. This allows a
remote client to instantiate and interact with COM objects on another host.

From a lateral movement perspective, this matters because some COM objects
expose methods that can launch commands.

### DCOMExec Requirements

```text
Privilege: Administrator
Ports:     135/tcp, 445/tcp, dynamic RPC high ports
Objects:   MMC20.Application, ShellWindows, ShellBrowserWindow, etc.
```

The source research focused on:

```text
MMC20.Application
```

### Similarity to WMIExec

`dcomexec.py` and `wmiexec.py` share several mechanics:

- SMB session for output handling in default modes.
- RPC activation through `ISystemActivator`.
- `RemoteCreateInstance` to create remote COM objects.
- Output loop that writes to a file, reads it over SMB, deletes it, and waits.
- `-nooutput` and `-silentcommand` modes can reduce SMB output behavior.

### Difference From WMIExec

Key difference:

```text
wmiexec.py
  -> IWbemServices / WMI
  -> WmiPrvSE.exe
  -> command execution

dcomexec.py with MMC20
  -> MMC20.Application
  -> ActiveView.ExecuteShellCommand
  -> mmc.exe / COM server behavior
  -> command execution
```

This distinction matters for detection because the parent process and COM
activation artifacts differ.

### MMC20.Application From PowerShell

The source research used PowerShell to instantiate the remote DCOM object:

```powershell
$com = [Activator]::CreateInstance(
  [type]::GetTypeFromProgID("MMC20.Application", "192.168.7.131")
)

$com.Document.ActiveView.ExecuteShellCommand(
  "C:\Windows\System32\calc.exe",
  $null,
  $null,
  "7"
)
```

This executes without SMB output retrieval. It demonstrates the DCOM execution
primitive directly.

List DCOM applications:

```powershell
Get-CimInstance Win32_DCOMApplication
```

### DCOM Artifacts

Artifacts:

```text
Network:
  TCP 135
  Dynamic RPC high ports
  Optional SMB 445 for output retrieval

Processes:
  mmc.exe or selected COM server
  Child process launched through ExecuteShellCommand

Logs:
  Security 4624 - network logon
  Security 4688 / Sysmon 1 - process creation
  DCOM-related operational logs depending on configuration
```

Detection ideas:

- `mmc.exe` spawning command shells or unexpected binaries.
- Remote activation of MMC20.Application from non-admin workstations.
- RPC/DCOM connections followed by process creation.
- PowerShell usage of `[Activator]::CreateInstance` with remote ProgID.

Example suspicious process chain:

```text
mmc.exe -> cmd.exe
mmc.exe -> powershell.exe
mmc.exe -> calc.exe
```

## Side-by-Side Method Analysis

| Method | Execution Primitive | Parent Process | Output Behavior | Most Useful Detection |
|---|---|---|---|---|
| `smbexec.py` | Temporary service | services.exe / cmd.exe | `C:\__output` via SMB | Event 7045 + temp files |
| `sc.exe` | Remote service | services.exe | No built-in output | Remote service creation |
| `atexec.py` | Scheduled task | taskeng/taskhost/cmd depending on OS | `ADMIN$\Temp\*.tmp` | Event 4698/4702/140 + temp output |
| `schtasks.exe` | Scheduled task | task scheduler engine | Depends on command | Remote task creation |
| `wmiexec.py` | WMI process create | WmiPrvSE.exe | `%SystemRoot%\__*` via SMB | WmiPrvSE child process |
| `wmic.exe` | WMI process create | WmiPrvSE.exe | No native output capture | WmiPrvSE child process |
| `dcomexec.py` | DCOM object method | mmc.exe / COM server | SMB output in default mode | DCOM parent spawning shell |
| MMC20 PowerShell | DCOM object method | mmc.exe | No native output capture | Remote COM activation |

This comparison is useful in a report because it tells defenders where to look
for each technique instead of treating "lateral movement" as a single generic
alert.

## Detection Engineering

### Network Signals

Potential signals:

- Workstation-to-workstation SMB connections.
- SMB admin share access from non-admin management hosts.
- RPC Endpoint Mapper connections followed by high-port RPC sessions.
- Authentication using NTLM where Kerberos is expected.
- Repeated connections to `IPC$`.
- Access to `ADMIN$`, `C$`, and named pipes from unusual systems.

Network hunting questions:

- Which hosts initiate SMB to many peers?
- Which users authenticate to many workstations in a short time?
- Which non-management systems connect to RPC high ports?
- Are there NTLM authentications from unexpected segments?

### Windows Event Signals

High-value events:

| Event | Meaning |
|---:|---|
| 4624 | Successful logon. Type 3 is common for network logons. |
| 4625 | Failed logon. Useful for password spray or failed lateral attempts. |
| 4648 | Logon with explicit credentials. |
| 4672 | Special privileges assigned to new logon. |
| 4688 | Process creation, if enabled. |
| 4697 | Service installed, when audited. |
| 4698 | Scheduled task created. |
| 4702 | Scheduled task updated. |
| 5140 | Network share accessed. |
| 5145 | Detailed file share access. |
| 7045 | Service installed in System log. |
| 5857/5858 | WMI Activity events, depending on logging. |

### Sysmon Signals

Useful Sysmon events:

| Event | Meaning |
|---:|---|
| 1 | Process creation. |
| 3 | Network connection. |
| 7 | Image loaded, useful for some service/COM cases. |
| 11 | File creation. |
| 12/13/14 | Registry changes. |
| 17/18 | Named pipe events. |

### Service Creation Detection

Detection idea:

```text
Network logon from source host
  + admin share or IPC$ access
  + Event ID 7045 service creation
  + service binary path launching cmd.exe
```

Sigma-style example:

```yaml
title: Remote Service Creation With Suspicious Command
logsource:
  product: windows
  service: system
detection:
  selection:
    EventID: 7045
  suspicious:
    ImagePath|contains:
      - 'cmd.exe'
      - 'powershell.exe'
      - 'C:\Windows\TEMP\'
      - '__output'
  condition: selection and suspicious
level: high
```

### Scheduled Task Detection

Detection idea:

```text
Event 4698/4702 or TaskScheduler 106/140
  + task action launches shell/interpreter
  + remote logon shortly before creation
  + task deleted shortly after execution
```

Sigma-style example:

```yaml
title: Suspicious Remote Scheduled Task Execution
logsource:
  product: windows
  service: security
detection:
  selection:
    EventID:
      - 4698
      - 4702
  action:
    TaskContent|contains:
      - 'cmd.exe'
      - 'powershell.exe'
      - 'wscript.exe'
      - 'cscript.exe'
      - 'mshta.exe'
  condition: selection and action
level: medium
```

### WMI Detection

Detection idea:

```text
WmiPrvSE.exe spawning unexpected child process
```

Process chains:

```text
WmiPrvSE.exe -> cmd.exe
WmiPrvSE.exe -> powershell.exe
WmiPrvSE.exe -> rundll32.exe
WmiPrvSE.exe -> regsvr32.exe
WmiPrvSE.exe -> unknown binary
```

PowerShell hunt:

```powershell
Get-WinEvent -FilterHashtable @{
  LogName='Microsoft-Windows-WMI-Activity/Operational'
} | Select-Object TimeCreated, Id, Message
```

### DCOM Detection

Detection idea:

```text
mmc.exe or COM server spawning command shell
```

Process chains:

```text
mmc.exe -> cmd.exe
mmc.exe -> powershell.exe
mmc.exe -> notepad.exe
```

Hunt PowerShell remote COM instantiation:

```text
[Activator]::CreateInstance
GetTypeFromProgID
MMC20.Application
ExecuteShellCommand
```

### Pass-the-Hash Detection

Pass-the-hash is difficult to detect from one event alone. Look for
correlation:

- NTLM authentication from unusual source hosts.
- Type 3 logons to many systems in a short period.
- Same account authenticating to multiple hosts without normal interactive
  behavior.
- Admin share access immediately after NTLM logon.
- Logon followed by service creation, task creation, WMI, or DCOM execution.
- Local administrator account used across multiple machines.

Defensive correlation pattern:

```text
4624 Type 3 NTLM logon
  -> 5140/5145 admin share access
  -> 7045 service creation OR 4698 task creation OR WmiPrvSE child process
```

## Prevention and Hardening

### Reduce Credential Reuse

- Use Windows LAPS / Microsoft LAPS for local administrator passwords.
- Disable shared local administrator passwords.
- Rotate privileged credentials regularly.
- Tier admin accounts by role and environment.
- Prevent domain admin logon to workstations.

### Disable Weak Authentication

- Disable LM hash storage.
- Disable NTLMv1.
- Audit and reduce NTLM usage.
- Prefer Kerberos where possible.
- Enable SMB signing where appropriate.

### Limit Remote Administration Paths

- Restrict SMB and RPC between workstations.
- Allow SMB/RPC only from management servers where possible.
- Block workstation-to-workstation lateral paths.
- Restrict WMI/DCOM remote access by firewall and group policy.
- Disable unnecessary admin shares where operationally feasible.

### Apply Least Privilege

- Remove users from local Administrators unless required.
- Use just-in-time administration.
- Separate admin accounts from daily user accounts.
- Monitor privileged group membership changes.

### Harden Execution Controls

- Use WDAC or AppLocker on high-value systems.
- Block execution from user-writable directories.
- Monitor script interpreter usage.
- Restrict PowerShell where appropriate while preserving logging.

### Improve Monitoring

- Enable command-line process creation logging.
- Enable PowerShell Script Block logging where feasible.
- Deploy Sysmon or equivalent EDR telemetry.
- Collect Task Scheduler Operational logs.
- Collect WMI Activity logs.
- Centralize Windows Security and System logs.

## Incident Response Checklist

When investigating suspected lateral movement:

1. Identify source and destination hosts from logon events.
2. Review `4624`, `4625`, `4648`, and `4672`.
3. Check for admin share access events `5140` and `5145`.
4. Check for service creation `7045` and `4697`.
5. Check for scheduled task events `4698`, `4702`, `106`, and `140`.
6. Review WMI Activity logs.
7. Review process trees for:
   - `services.exe -> cmd.exe`
   - `WmiPrvSE.exe -> cmd.exe`
   - `mmc.exe -> cmd.exe`
8. Search for temporary output files:
   - `C:\__output`
   - `C:\Windows\Temp\*.tmp`
   - `%SystemRoot%\__*`
9. Review recent files under `C:\Windows\System32\Tasks`.
10. Determine whether NTLM hashes or credential stores were accessed.
11. Reset affected credentials and rotate local admin passwords.
12. Hunt for the same account and source host across the environment.

## Research Takeaways

Lateral movement in Windows is a protocol and identity problem. Tools such as
Impacket are wrappers around Windows administration primitives:

- SMB sessions;
- named pipes;
- RPC interfaces;
- service control;
- scheduled task registration;
- WMI object invocation;
- DCOM object activation.

For offensive research, understanding the protocol flow explains why a tool
works and when it will fail. For defensive research, the same understanding
reveals where evidence must exist.

Key takeaways:

- Pass-the-hash treats NTLM hashes as reusable secrets.
- SMB admin shares are central to many remote execution methods.
- RPC dynamic ports explain why lateral movement may require more than 445.
- `smbexec.py` is service-based and highly visible through service events.
- `atexec.py` is task-based and visible through scheduled task artifacts.
- `wmiexec.py` is WMI-based and visible through `WmiPrvSE.exe` process trees.
- `dcomexec.py` is COM/DCOM-based and visible through COM server behavior.
- Detection should correlate authentication, share access, remote management,
  process creation, and cleanup.

## Conclusion

Lateral movement is not a single command. It is a chain:

```text
credential material
  -> SMB/RPC reachability
  -> remote management interface
  -> command execution
  -> output retrieval
  -> cleanup
  -> next host
```

The same features that make Windows manageable at scale also create lateral
movement paths when credentials are stolen or administrative boundaries are too
wide. A strong defense does not depend on one control. It combines credential
hygiene, segmentation, least privilege, remote administration restrictions,
execution control, and telemetry correlation.

For a security researcher, the value is in explaining the complete behavior:
what protocol is used, what privilege is required, which Windows subsystem
executes the command, what artifacts remain, and what defenders can do with
that evidence.

## References

- <https://www.cloudflare.com/learning/security/glossary/what-is-lateral-movement/>
- <https://hackmag.com/security/lateral-guide/>
- <https://github.com/SecureAuthCorp/impacket>
- <https://docs.microsoft.com/en-us/sysinternals/downloads/sysinternals-suite>
- <https://www.varonis.com/blog/smb-port>
- <https://medium.com/codex/what-are-smb-ports-1459040b089c>
- <https://docs.microsoft.com/en-us/troubleshoot/windows-server/networking/inter-process-communication-share-null-session>
- <https://www.thesecuritybuddy.com/vulnerabilities/what-is-a-pass-the-hash-attack/>
- <https://www.strongdm.com/blog/lateral-movement>
- <https://docs.microsoft.com/en-us/windows/win32/taskschd/schtasks>
- <https://ss64.com/>
- <https://bohops.com/2018/03/17/abusing-exported-functions-and-exposed-dcom-interfaces-for-pass-thru-command-execution-and-lateral-movement/>
- <https://miriamxyra.com/2017/11/08/stop-using-lan-manager-and-ntlmv1/>
- <https://www.ncsc.gov.uk/guidance/preventing-lateral-movement>
- <https://www.exabeam.com/information-security/protecting-your-network-from-lateral-movement/>
- <https://docs.microsoft.com/en-us/windows/win32/api/wbemcli/nn-wbemcli-iwbemservices>

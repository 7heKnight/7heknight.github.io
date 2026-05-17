---
title: "Windows Host Persistence: Services, Scheduled Tasks & Run Keys"
date: 2022-07-31
category: "persistence"
difficulty: "intermediate"
tags: [persistence, windows, services, scheduled-tasks, registry, svchost, opsec, mitre-attack]
excerpt: "Three Windows persistence techniques that survive reboots — Windows Services (including svchost hijacking), the Task Scheduler, and Run keys / Startup folders — with the OPSEC and event-log artifacts each one leaves behind."
draft: false
---

# Windows Host Persistence: Services, Scheduled Tasks & Run Keys

> Educational material for authorized red-team work and defensive
> understanding only. Run these techniques exclusively on systems you own
> or are explicitly contracted to test.

## 1. What Is Persistence?

In the cyber kill chain, *establish persistence* is the phase that follows
the initial compromise. Persistence keeps a foothold alive quietly — across
reboots, credential rotations, and other events that would otherwise sever
the connection between the victim host and the operator's infrastructure.

Windows persistence abuses legitimate OS features to auto-run a payload
(for example a reverse or bind shell). Two broad approaches exist:

- **OS-feature driven** — let a Windows subsystem launch the payload
  automatically.
- **User-behavior driven** — e.g. DLL-hijack a library Microsoft Word
  loads, so the payload fires whenever the user opens Word.

This article focuses on the OS-feature approach with three techniques:

1. **Windows Services** — create or modify a system process.
2. **Scheduled Tasks** — run on a schedule or trigger.
3. **Registry Run keys / Startup folder** — run on logon/boot.

Many more exist — see [MITRE ATT&CK](https://attack.mitre.org/).

## 2. Windows Services

> **Privilege required:** Administrator (or a system account).

Services run long-lived background tasks without an interactive login,
started automatically at boot, and are managed by the **Service Control
Manager (SCM)**. A service binary must speak the *Service Control Handler*
protocol; a binary that runs as a service but never reports back is stopped
by the SCM after a timeout. An operator abuses this to auto-run and
maintain a C2 connection.

Five common ways to talk to the SCM: `sc.exe`, `net` commands, PowerShell,
`svchost.exe`, or writing the service config straight into the registry.
RPC-based tooling (Impacket, Microsoft `PsExec.exe`) also reaches the SCM.

Service account contexts:

- **LocalSystem** — almost everything; token holds both
  `NT AUTHORITY\SYSTEM` and `BUILTIN\Administrators`.
- **LocalService** — minimal local rights, anonymous on the network.
- **NetworkService** — minimal local rights, machine identity on network.

### 2.1 Making a Service Look Legitimate

A working service binary is not enough — it has to avoid an
administrator's suspicion. Things that matter:

1. **Service name** — never random. Avoid names baked into common tools
   (e.g. `BTOBTO`, used by Impacket's `smbexec.py`). Admins enumerate with
   `gwmi Win32_Service | select Name, Displayname`.
2. **Description** — services with no description stand out. Admins hunt
   them with `gwmi win32_service | where-object {$_.description -eq $null}`.
3. **Service binaries** — `*.exe` files are well-known to defenders; a
   `*.dll` hosted under `svchost.exe` blends in far better.
4. **Account & privileges** — defaulting to LocalSystem is convenient but
   loud. Running as LocalService and elevating only when needed is quieter.
5. **Activities** — high-privilege actions (opening ports, registry edits)
   are caught by Sysinternals **Process Monitor**.
6. **Strings & API calls** — binaries are readable with `strings`; favor
   Windows APIs (also keeps the binary small).
7. **Self-defense** — declare the service non-stoppable via
   `SERVICE_STATUS` and host it inside `svchost.exe` so it resists removal.
8. **Digital signatures** — unsigned binaries are flagged by Sysinternals
   tooling and PowerShell signature checks.

### 2.2 Service Structure

A service binary needs a main control entry and a control handler:

1. **`main`** — initializes variables and the service-table thread.
2. **`svc_main`** — talks to the SCM (reports status, receives control
   requests).
3. **`control_handler`** — handles the control requests `svc_main` passes
   in and updates service state.

C# and C++ are the most practical languages on Windows. A binary that does
*not* follow this contract is terminated after the SCM timeout.

### 2.3 `sc.exe`

Found at `C:\Windows\System32\sc.exe` (and `SysWOW64`). By default it
creates services as LocalSystem (`NT AUTHORITY\SYSTEM`).

```bat
:: create or modify
sc create  <ServiceName> binPath= <BinaryPath> DisplayName= <Display> ^
  start= <boot|system|auto|demand|disabled|delayed-auto>
sc config  <ServiceName> binPath= <BinaryPath>

:: control / inspect / remove
sc start   <ServiceName>
sc query   <ServiceName>     :: basic status
sc queryex <ServiceName>     :: status + extra info
sc qc      <ServiceName>     :: configuration
sc delete  <ServiceName>
```

### 2.4 `net` Commands

`net.exe` cannot create/modify/delete services — only control them:

```bat
net start  <ServiceName>
net stop   <ServiceName>
net pause  <ServiceName>
net continue <ServiceName>
```

### 2.5 PowerShell

```text
Get-Service      New-Service      Remove-Service
Start-Service    Stop-Service     Restart-Service
Suspend-Service  Resume-Service   Set-Service
```

### 2.6 Hosting a Service Inside `svchost.exe`

`svchost.exe` hosts one or more Windows services so same-group services
share a process. Common arguments:

- `-k <host>` — declares which svchost group the service belongs to.
- `-s <service>` — pins a specific service into that host.
- `-p` — enforces process-mitigation policies (DynamicCodePolicy,
  BinarySignaturePolicy, ExtensionPolicy).

To run a service DLL inside a svchost group:

```bat
:: 1. create a shared-type service pointing at svchost
sc create 7k binPath= "%SystemRoot%\System32\svchost.exe -k TestHost" ^
  type= share start= auto

:: 2. point the service at the payload DLL
reg add HKLM\SYSTEM\CurrentControlSet\Services\7k\Parameters ^
  /v ServiceDll /t REG_EXPAND_SZ /d ^%SystemRoot^%\TestService.dll

:: 3. register the svchost group and add the service to it
reg add "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Svchost" ^
  /v TestHost /t REG_MULTI_SZ /d 7k
```

The result is a service running as `NT AUTHORITY\SYSTEM` hosted under
`svchost.exe`.

### 2.7 Writing the Service Straight into the Registry

When a service is created, the SCM stores its parameters as a key under
`HKLM\SYSTEM\CurrentControlSet\Services`. Writing that key directly means
the SCM only picks it up on the **next reboot** (no create request is seen,
so no live status update). Practical approach: create a real service with
`sc.exe`, export its key, edit it, then re-import:

```text
[Key_location]
REG_DWORD:      "Name"=dword:<hex>
REG_SZ:         "Name"="<string>"
REG_EXPAND_SZ:  "Name"=hex(2):<hex>

start value: Boot | System | Automatic | Manual | Disabled
```

### 2.8 OPSEC

A created service is logged in the **Event Log with ID 7045**.
Sysinternals `autoruns.exe` will also surface unknown services. Plan
accordingly.

## 3. Task Scheduler

> **Privilege required:** Administrator, System, or User.

The Task Scheduler runs programs at a chosen time or on an event. A
created task is stored in **two places**:

- **Registry** — `Tasks` key (full config) and `Tree` key (name + ID
  pointer), both under
  `HKLM\Software\Microsoft\Windows NT\CurrentVersion\Schedule\TaskCache\`.
  `taskschd.msc` reads these directly.
- **Disk** — an XML config at
  `C:\Windows\System32\Tasks\<config>.xml`. Editing it does not affect a
  registered task, but deleting/altering it prevents future config
  changes.

A valid task XML needs three sections:

- **Trigger** — when it runs (`StartBoundary` is mandatory).
- **Principal** — which user/group it runs as.
- **Actions** — what it does: `ComHandler`, `Exec`, `SendEmail`,
  `ShowMessage`.

Plus optional `RegistrationInfo` (creator/time — auto-filled by
`schtasks.exe` for command-line tasks) and `Settings`.

### 3.1 `schtasks.exe`

Located at `C:\Windows\System32\schtasks.exe`. Two ways to create a task:

- **XML config** — no creation date or creating account is recorded.
- **Command line** — the Task Scheduler UI records creator name and time.

```bat
:: via XML config
schtasks /create /tn InOCeKtw /xml config.xml && schtasks /run /tn InOCeKtw

:: via command line
schtasks /create /tn RunSvc /tr "%COMSPEC% /Q /c Notepad.exe" ^
  /sc minute /mo 1 /rl HIGHEST && schtasks /run /tn RunSvc
```

### 3.2 PowerShell

PowerShell-created tasks also omit the creating account and time:

```powershell
$a = New-ScheduledTaskAction -WorkingDirectory %systemroot%\System32\ `
       -Execute cmd.exe -Argument "/Q /c notepad.exe"
$t = New-ScheduledTaskTrigger -AtStartup
Register-ScheduledTask -TaskName Test_task -Trigger $t -Action $a `
  -RunLevel Highest -Force

Start-ScheduledTask -TaskName Test_task   # run immediately
```

### 3.3 Creating a Task via the Registry

You *can* import a task's `Tasks`+`Tree` keys via `reg.exe` (only under
the **System** account — Administrator/standard user cannot). The task
appears in Task Scheduler but will not run and no XML lands on disk, until
you fix the task's permissions so the scheduler reloads its config.

Event-log artifacts observed:

- **4657** — a registry value was modified.
- **4698** — a scheduled task was created.
- **140** — task updated. *(Only 140 fired for the registry-import path.)*

## 4. Registry Run Keys / Startup Folder

Two ways to auto-run on logon/boot: add a value to a Run key, or drop a
program/shortcut into a Startup folder.

### 4.1 Startup folders

- `shell:startup` →
  `C:\Users\<user>\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup`
  — fires when that user logs in.
- `shell:common startup` →
  `C:\ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp`
  — fires for any user logging in.

### 4.2 Registry Run keys

Windows Registry hives: `HKCR`, `HKCU`, `HKLM`, `HKU`, `HKCC`. Both `HKLM`
and `HKCU` carry `Run`, `RunOnce`, and (if created) `RunOnceEx`:

- **Run** — runs every time the user logs in.
- **RunOnce** — the value is deleted after execution.
- **RunOnceEx** — value removed after a *successful* run; not present by
  default, must be created.

Paths:

```text
HKLM\Software\Microsoft\Windows\CurrentVersion\Run
HKCU\Software\Microsoft\Windows\CurrentVersion\Run
HKLM\Software\Microsoft\Windows\CurrentVersion\RunOnce
HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce
```

Created with `reg.exe` (Administrator for HKLM, user for HKCU) or
PowerShell (`New-ItemProperty`); verify with `reg query`.

## 5. Conclusion

These techniques keep an operator's program running across reboots by
leaning on built-in Windows subsystems. Each leaves distinct artifacts —
Event ID 7045 for services, 4698/140 for scheduled tasks, Run-key values
visible to Sysinternals **Autoruns**. For defenders, those same artifacts
are exactly where to hunt.

## References

- <https://attack.mitre.org/techniques/T1543/003/> (Windows Service)
- <https://attack.mitre.org/techniques/T1053/005/> (Scheduled Task)
- <https://attack.mitre.org/techniques/T1547/001/> (Run Keys / Startup)
- <https://docs.microsoft.com/en-us/windows/win32/services/installing-a-service>
- <https://docs.microsoft.com/en-us/windows/win32/taskschd/schtasks>
- <https://docs.microsoft.com/en-us/sysinternals/downloads/sysinternals-suite>
- <https://csandker.io/2021/01/10/Offensive-Windows-IPC-1-NamedPipes.html>
- <https://ss64.com/nt/sc.html>

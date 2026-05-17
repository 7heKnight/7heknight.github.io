---
title: "Windows Host Persistence: Services, Scheduled Tasks & Run Keys"
date: 2022-07-31
category: "persistence"
difficulty: "intermediate"
tags: [persistence, windows, services, scheduled-tasks, registry, svchost, opsec, detection-engineering, mitre-attack]
excerpt: "A researcher-style study of Windows host persistence through Services, Scheduled Tasks, and Run keys: execution model, privilege requirements, configuration internals, forensic artifacts, detection logic, OPSEC tradeoffs, and defensive hardening."
draft: false
---

# Windows Host Persistence: Services, Scheduled Tasks & Run Keys

> Educational material for authorized red-team research and defensive
> understanding only. The techniques below must be tested only inside a lab or
> an environment where you have explicit written authorization. The goal of this
> article is to understand persistence mechanisms, their artifacts, and how to
> detect and harden against them.

## Executive Summary

Persistence is the phase where an operator tries to make access survive normal
disruption: reboot, user logout, process crash, credential rotation, or manual
cleanup. On Windows, persistence often works by abusing legitimate operating
system features that were designed to start programs automatically.

This research focuses on three Windows host persistence families:

1. **Windows Services** - long-running background components managed by the
   Service Control Manager (SCM).
2. **Scheduled Tasks** - programs launched by Task Scheduler based on time,
   boot, logon, or event triggers.
3. **Registry Run keys and Startup folders** - user or machine logon
   auto-start locations.

These mechanisms are not malicious by themselves. Administrators and software
vendors use them every day. The security risk appears when an attacker creates,
modifies, or hides inside those same mechanisms to maintain a foothold.

The practical research questions are:

- What privilege is required for each persistence method?
- Which Windows subsystem executes the payload?
- Where is the configuration stored?
- What logs and forensic artifacts are created?
- Which choices make the technique noisy or quiet?
- How can defenders hunt, validate, and harden against it?

## Scope and Assumptions

This article covers host-level persistence on Windows systems after an initial
foothold has already been obtained. It does not cover exploitation, initial
access, credential theft, lateral movement, or C2 design.

Scope:

- Windows Services and SCM-backed persistence.
- Service DLL hosting through `svchost.exe`.
- Direct service configuration through the registry.
- Scheduled Tasks created by `schtasks.exe`, PowerShell, XML, and registry
  import.
- Registry Run / RunOnce / RunOnceEx keys.
- Startup folder persistence.
- Defensive artifacts and hunting opportunities.

Assumptions:

- The operator already has code execution.
- The lab payload is benign, such as `notepad.exe` or a controlled test binary.
- Administrator or SYSTEM privileges are available where required.
- All commands are for lab validation and defensive understanding.

## MITRE ATT&CK Mapping

| Technique | ATT&CK ID | Persistence Location | Typical Privilege |
|---|---|---|---|
| Windows Service | T1543.003 | `HKLM\SYSTEM\CurrentControlSet\Services\*` | Administrator / SYSTEM |
| Scheduled Task | T1053.005 | TaskCache registry + `C:\Windows\System32\Tasks\*` | User / Administrator / SYSTEM depending on run context |
| Registry Run Keys / Startup Folder | T1547.001 | `Run`, `RunOnce`, Startup folder paths | User for HKCU, Administrator for HKLM |

These techniques also intersect with:

- **Privilege Escalation** when the autorun mechanism executes with a stronger
  token than the creator.
- **Defense Evasion** when names, paths, signatures, or host processes are made
  to look legitimate.
- **Command and Control** if the autorun program launches a beacon or shell.

## Technique Comparison

| Method | Survives Reboot | Trigger | Scope | Strength | Weakness |
|---|---|---|---|---|---|
| Service | Yes | Boot, manual start, service recovery | Machine-wide | Strong persistence, can run as SYSTEM | Requires admin; Event ID 7045 is high-signal |
| Scheduled Task | Yes | Time, boot, logon, event, idle | User or machine | Flexible trigger model | Easy to enumerate; Event ID 4698/4702/140 |
| Run Key | Usually yes | User logon | User or machine | Simple and reliable | Very common hunting location |
| Startup Folder | Yes | User logon | User or all users | Simple and visible | File-system artifact is obvious |

As a researcher, the important point is not "which technique is best." Each
technique has a different operating model and produces different evidence. A
good report explains both the attacker utility and the defender visibility.

## Persistence in the Kill Chain

Persistence normally occurs after initial compromise:

```text
Initial Access
  -> Execution
  -> Privilege Discovery / Escalation
  -> Establish Persistence
  -> Command and Control
  -> Actions on Objectives
```

The operator wants a reliable way back into the host. Windows provides many
legitimate auto-start mechanisms, so attackers prefer mechanisms that blend into
normal administrative behavior:

- services installed by enterprise agents;
- scheduled maintenance tasks;
- software update tasks;
- logon startup programs;
- helper DLLs under service hosts.

For defenders, this means persistence hunting is not about finding "bad"
features. It is about finding abnormal use of normal features.

## Windows Services

### Service Model

Windows Services are long-running background programs managed by the **Service
Control Manager**. They can start during boot, run without an interactive user,
restart after failure, and execute under privileged service accounts.

Unlike a normal interactive program, a real service must communicate with the
SCM. The service reports status such as starting, running, stopping, paused, or
stopped. If the binary does not implement the expected service control flow, SCM
allows it to run briefly and then terminates it after a timeout.

This requirement matters in offensive and defensive research:

- A random executable may start through `sc.exe`, but it may fail as a real
  service if it does not implement the service contract.
- A properly written service binary can persist cleanly and appear normal.
- A misconfigured service that repeatedly fails creates noisy logs and restart
  artifacts.

### Privilege Requirements

Service creation normally requires Administrator or SYSTEM privileges. The
created service may then run as one of several service accounts:

| Account | Local Privilege | Network Identity | Research Notes |
|---|---|---|---|
| LocalSystem | Very high | Machine account | Convenient for attackers but high-risk and closely monitored. |
| LocalService | Low local privilege | Anonymous network identity | Lower local footprint; useful for least-privilege service design. |
| NetworkService | Low local privilege | Machine account | Useful when network access as the host is required. |
| Domain / local user | Depends on assigned rights | User identity | Requires credential management and creates account-based evidence. |

From an attacker's perspective, LocalSystem is attractive. From a research and
detection perspective, a new unknown service running as LocalSystem should be
treated as high priority.

### Service Configuration Storage

Installed services are stored under:

```text
HKLM\SYSTEM\CurrentControlSet\Services\<ServiceName>
```

Common values:

| Value | Meaning |
|---|---|
| `ImagePath` | Executable path or `svchost.exe` command line. |
| `DisplayName` | Human-readable service name. |
| `Description` | Service description shown in GUI tools. |
| `Start` | Startup type. |
| `Type` | Service type, such as own-process or shared-process. |
| `ObjectName` | Account used by the service. |
| `FailureActions` | Recovery behavior after crashes. |
| `Parameters\ServiceDll` | DLL loaded by a shared `svchost.exe` service. |

Startup values:

| Value | Meaning |
|---:|---|
| `0` | Boot |
| `1` | System |
| `2` | Automatic |
| `3` | Manual |
| `4` | Disabled |

### Service Structure

A service-oriented binary usually contains three conceptual pieces:

1. **`main`** initializes the service table and calls the service dispatcher.
2. **`svc_main`** registers with SCM, reports state, and starts the service
   workload.
3. **`control_handler`** receives stop, pause, continue, shutdown, and other
   service control events.

The structure exists because SCM needs to manage the service lifecycle. If the
program does not respond correctly, Windows can mark the service as failed or
stop it.

Research takeaway:

- A service persistence sample should be tested for lifecycle correctness, not
  only "does the process start."
- A defender can hunt for services that fail repeatedly, hang at start, or
  report abnormal state transitions.

### Creating and Managing Services With `sc.exe`

`sc.exe` is Microsoft's native command-line client for SCM.

Paths:

```text
C:\Windows\System32\sc.exe
C:\Windows\SysWOW64\sc.exe
```

Example creation with a benign lab binary:

```bat
sc create ResearchSvc binPath= "C:\Windows\System32\notepad.exe" ^
  DisplayName= "Research Service" start= demand
```

Common operations:

```bat
sc start ResearchSvc
sc stop ResearchSvc
sc query ResearchSvc
sc queryex ResearchSvc
sc qc ResearchSvc
sc config ResearchSvc start= auto
sc delete ResearchSvc
```

Important syntax detail: `sc.exe` requires a space after parameter names such as
`binPath=` and `start=`.

Research interpretation:

- `sc create` creates a service configuration and logs a service-install event.
- `sc config` modifies service configuration.
- `sc qc` is useful for inspecting suspicious services.
- `sc queryex` exposes process IDs when the service is running.

### Managing Services With `net.exe`

`net.exe` can control services but does not create or delete them.

Paths:

```text
C:\Windows\System32\net.exe
C:\Windows\SysWOW64\net.exe
```

Commands:

```bat
net start ResearchSvc
net stop ResearchSvc
net pause ResearchSvc
net continue ResearchSvc
```

Defensive note: `net start` and `net stop` are common administrative actions.
They are less suspicious alone than service creation, but they are useful when
correlated with a newly created service or unusual binary path.

### Managing Services With PowerShell

PowerShell service cmdlets expose the same management surface:

```powershell
Get-Service
New-Service
Start-Service
Stop-Service
Restart-Service
Suspend-Service
Resume-Service
Set-Service
Remove-Service
```

Example:

```powershell
New-Service -Name "ResearchSvc" `
  -BinaryPathName "C:\Windows\System32\notepad.exe" `
  -DisplayName "Research Service" `
  -StartupType Manual
```

PowerShell is powerful for both operations and hunting:

```powershell
Get-CimInstance Win32_Service |
  Select-Object Name, DisplayName, StartMode, State, PathName, StartName
```

Hunt for services without descriptions:

```powershell
Get-CimInstance Win32_Service |
  Where-Object { -not $_.Description } |
  Select-Object Name, DisplayName, PathName, StartName
```

Hunt for services running from suspicious paths:

```powershell
Get-CimInstance Win32_Service |
  Where-Object {
    $_.PathName -match '\\Users\\|\\AppData\\|\\Temp\\|\\ProgramData\\'
  } |
  Select-Object Name, DisplayName, PathName, StartName
```

### Service Tradecraft and Research Considerations

When studying service persistence, the configuration quality matters. A service
that works technically may still be noisy from an operator perspective or easy
to detect from a defender perspective.

Research dimensions:

| Dimension | Why It Matters | Defensive Angle |
|---|---|---|
| Service name | Random or tool-default names stand out. | Compare against baseline service inventory. |
| Display name | Missing or strange display names are suspicious. | Hunt display/name mismatch. |
| Description | Empty descriptions attract manual review. | List services with null descriptions. |
| Binary path | User-writable paths are dangerous. | Alert on services from `%TEMP%`, `%APPDATA%`, downloads. |
| Account | LocalSystem is powerful. | Review newly created SYSTEM services. |
| Signature | Unsigned binaries are higher risk. | Validate Authenticode signatures. |
| Start type | Auto-start survives reboot. | Hunt new auto-start services. |
| Failure actions | Can restart a payload automatically. | Inspect service recovery settings. |

This is the point where red-team and blue-team thinking meet. The attacker
wants reliability and low suspicion; the defender wants to identify
configuration choices that deviate from normal enterprise software.

### Service Artifacts

High-value artifacts:

```text
Registry:
  HKLM\SYSTEM\CurrentControlSet\Services\<ServiceName>

Event Logs:
  System 7045 - A service was installed in the system
  System 7036 - Service entered running/stopped state
  System 7035 - Service control request sent
  Security 4697 - A service was installed in the system, when audited

Files:
  Service executable or DLL path

Process:
  Running service process or svchost-hosted service
```

Event ID `7045` is particularly important because it records service creation.
This is one of the most reliable service-persistence detections.

### Defender Hunting for Services

PowerShell baseline query:

```powershell
Get-CimInstance Win32_Service |
  Select-Object Name, DisplayName, State, StartMode, StartName, PathName |
  Sort-Object Name
```

Hunt new auto-start services:

```powershell
Get-CimInstance Win32_Service |
  Where-Object { $_.StartMode -eq "Auto" } |
  Select-Object Name, DisplayName, PathName, StartName
```

Hunt unsigned service binaries:

```powershell
Get-CimInstance Win32_Service | ForEach-Object {
  $path = ($_.PathName -replace '^"', '') -replace '".*$', ''
  if (Test-Path $path) {
    $sig = Get-AuthenticodeSignature $path
    [PSCustomObject]@{
      Name = $_.Name
      Path = $path
      Signature = $sig.Status
      Publisher = $sig.SignerCertificate.Subject
    }
  }
}
```

Hunt with Sysinternals:

```text
Autoruns -> Services tab
Process Monitor -> service binary activity
Process Explorer -> signature and parent/child process review
```

## Service DLL Hosting With `svchost.exe`

### What `svchost.exe` Does

`svchost.exe` is a generic host process for Windows services. Instead of each
service running as a separate process, Windows can group services into a shared
host process to reduce resource usage.

Paths:

```text
C:\Windows\System32\svchost.exe
C:\Windows\SysWOW64\svchost.exe
```

Common flags:

| Flag | Meaning |
|---|---|
| `-k <group>` | Selects the service host group. |
| `-s <service>` | Specifies a particular service inside the group. |
| `-p` | Enables additional process mitigation policy behavior. |

A service hosted by `svchost.exe` usually points to:

```text
ImagePath: %SystemRoot%\System32\svchost.exe -k <GroupName>
ServiceDll: %SystemRoot%\Path\To\Service.dll
```

### Lab Creation Flow

The source research used a service named `7k` and a test host group called
`TestHost`. The flow is:

1. Create a shared-process service pointing at `svchost.exe`.
2. Add a `ServiceDll` value pointing to the service DLL.
3. Register the service name inside the `Svchost` group list.
4. Start or reboot so SCM can load the configuration.

Commands:

```bat
sc create 7k binPath= "%SystemRoot%\System32\svchost.exe -k TestHost" ^
  type= share start= auto

reg add HKLM\SYSTEM\CurrentControlSet\Services\7k\Parameters ^
  /v ServiceDll /t REG_EXPAND_SZ /d ^%SystemRoot^%\TestService.dll

reg add "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Svchost" ^
  /v TestHost /t REG_MULTI_SZ /d 7k
```

If the DLL implements the required service entry points and SCM can load it,
the service runs under `svchost.exe`.

### Why This Matters

From an operator perspective, service DLL hosting is attractive because many
legitimate Windows services use `svchost.exe`. From a defender perspective, that
same fact makes it important to inspect the hosted service list and the
`ServiceDll` path.

Hunting opportunities:

- New values under:

```text
HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Svchost
```

- Suspicious `ServiceDll` values under:

```text
HKLM\SYSTEM\CurrentControlSet\Services\<ServiceName>\Parameters
```

- Service DLLs loaded from non-standard directories.
- Unsigned service DLLs.
- `svchost.exe` instances with unusual command-line groups.

PowerShell inspection:

```powershell
Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Svchost"
```

Query service DLL paths:

```powershell
Get-ChildItem "HKLM:\SYSTEM\CurrentControlSet\Services" |
  ForEach-Object {
    $paramPath = Join-Path $_.PsPath "Parameters"
    if (Test-Path $paramPath) {
      Get-ItemProperty $paramPath -ErrorAction SilentlyContinue |
        Select-Object PSChildName, ServiceDll
    }
  }
```

## Direct Service Creation Through Registry

### Concept

When a service is created normally, SCM writes configuration to:

```text
HKLM\SYSTEM\CurrentControlSet\Services
```

Because the registry is the service database, it is possible to create or modify
service configuration directly in the registry. The source research validated a
practical workflow:

1. Create a normal service with `sc.exe`.
2. Export the generated service registry key.
3. Modify the `.reg` file.
4. Import it as a new service key.
5. Reboot so SCM reloads the database.

This matters because direct registry creation changes the artifact pattern. SCM
does not receive the same live create request, and the service may not be
recognized until reboot.

### Registry File Structure

`.reg` values commonly appear as:

```text
[Key_location_to_be_created]
"ValueName"=dword:<hex_value>
"ValueName"="<string_data>"
"ValueName"=hex(2):<hex_value>
```

Value types:

| Type | Example Meaning |
|---|---|
| `REG_DWORD` | Start mode, service type, error control. |
| `REG_SZ` | Display name, object name, static strings. |
| `REG_EXPAND_SZ` | Expandable paths such as `%SystemRoot%`. |
| `REG_MULTI_SZ` | Multi-string values, such as svchost group entries. |

### Research Notes

Direct registry service persistence is useful to study because it changes the
timing:

- The registry key may exist before the service is actually loaded.
- Reboot or SCM reload may be required.
- Event artifacts can differ from `sc.exe` creation.
- The final service still becomes visible in normal service inventory after it
is loaded.

Defensive approach:

- Monitor writes under `HKLM\SYSTEM\CurrentControlSet\Services`.
- Alert on new service keys created by unexpected processes.
- Compare service registry keys against SCM service inventory.
- Review recently modified service keys after suspicious admin activity.

## Task Scheduler Persistence

### Task Scheduler Model

Task Scheduler runs programs automatically based on triggers. It is flexible
because a task can run:

- at boot;
- at user logon;
- on a timer;
- daily/weekly/monthly;
- when the system is idle;
- when a specific event occurs;
- under a selected user, group, or elevated context.

This flexibility makes it popular for both administrators and attackers.

Privilege requirements vary:

- A normal user can create tasks in their own context.
- Administrator privileges are needed for elevated or machine-wide tasks.
- SYSTEM-level manipulation is needed for certain registry-level task tricks.

### Where Tasks Are Stored

Task Scheduler stores task state in both registry and disk.

Registry:

```text
HKLM\Software\Microsoft\Windows NT\CurrentVersion\Schedule\TaskCache\Tasks
HKLM\Software\Microsoft\Windows NT\CurrentVersion\Schedule\TaskCache\Tree
```

Disk:

```text
C:\Windows\System32\Tasks\<TaskName>
```

The `Tasks` registry key stores detailed task configuration. The `Tree` key
stores the human-readable task path and an ID pointer to the corresponding
configuration under `Tasks`.

The XML file under `C:\Windows\System32\Tasks` can be used to clone or back up
a task. However, modifying the XML file directly does not necessarily update
the registered task configuration already loaded by Task Scheduler.

### Task XML Structure

A valid task XML needs at least:

| Section | Purpose |
|---|---|
| `Triggers` | Defines when the task runs. `StartBoundary` is required for many trigger types. |
| `Principals` | Defines the user or group context. |
| `Actions` | Defines what the task runs. |

Action types:

| Action | Meaning |
|---|---|
| `Exec` | Run a command or executable. |
| `ComHandler` | Activate a COM handler. |
| `SendEmail` | Legacy email action. |
| `ShowMessage` | Legacy message action. |

Optional sections:

- `RegistrationInfo` - creator and creation time.
- `Settings` - behavior such as battery handling, hidden state, run conditions,
  and restart settings.

### Creating Tasks With `schtasks.exe`

Paths:

```text
C:\Windows\System32\schtasks.exe
C:\Windows\SysWOW64\schtasks.exe
```

Create from XML:

```bat
schtasks /create /tn InOCeKtw /xml config.xml
schtasks /run /tn InOCeKtw
```

Create from command line:

```bat
schtasks /create /tn RunSvc /tr "%COMSPEC% /Q /c Notepad.exe" ^
  /sc minute /mo 1 /rl HIGHEST

schtasks /run /tn RunSvc
```

Research observation from the original document:

- Creating a task from XML may omit visible creator/time fields in the GUI.
- Creating from command line records creator and creation time in Task
  Scheduler UI.

This difference matters in forensic review because task provenance can be
clearer or less clear depending on creation method.

### Creating Tasks With PowerShell

PowerShell can create tasks through scheduled-task cmdlets:

```powershell
$action = New-ScheduledTaskAction `
  -WorkingDirectory "$env:SystemRoot\System32" `
  -Execute "cmd.exe" `
  -Argument "/Q /c notepad.exe"

$trigger = New-ScheduledTaskTrigger -AtStartup

Register-ScheduledTask `
  -TaskName "Test_task" `
  -Trigger $trigger `
  -Action $action `
  -RunLevel Highest `
  -Force
```

Run immediately:

```powershell
Start-ScheduledTask -TaskName "Test_task"
```

PowerShell-created tasks may also differ in visible creator/time fields,
depending on method and Windows version.

### Creating Tasks Through Registry Import

The source research tested whether a task could be recreated by exporting and
importing the relevant TaskCache registry keys.

Observed workflow:

1. Create a test task.
2. Export the related `Tasks` and `Tree` registry keys.
3. Delete the task.
4. Merge the registry content into a `.reg` file.
5. Import the keys using `reg.exe` under SYSTEM.
6. Observe the task appearing in Task Scheduler.

Important observations:

- Administrator and standard user context were not enough for this registry
  import path; SYSTEM was required.
- After import, the task appeared in Task Scheduler but did not immediately run.
- The XML config was not recreated on disk.
- Restarting the schedule service did not fully fix execution.
- Adjusting task permissions caused Task Scheduler to reload or repair the
  configuration, after which the task could run.

This is a strong research detail because it shows the difference between
"configuration appears" and "execution works."

### Task Scheduler Artifacts

Important artifacts:

```text
Registry:
  HKLM\Software\Microsoft\Windows NT\CurrentVersion\Schedule\TaskCache\Tasks
  HKLM\Software\Microsoft\Windows NT\CurrentVersion\Schedule\TaskCache\Tree

Disk:
  C:\Windows\System32\Tasks\<TaskName>

Event logs:
  Security 4698 - A scheduled task was created
  Security 4702 - A scheduled task was updated
  Security 4699 - A scheduled task was deleted
  Microsoft-Windows-TaskScheduler/Operational 106 - Task registered
  Microsoft-Windows-TaskScheduler/Operational 140 - Task updated
  Security 4657 - Registry value modified, if registry auditing is enabled
```

The original research specifically observed:

```text
4657 - A registry value was successfully modified
4698 - A scheduled task was created
140  - Task updated
```

During the registry-import path, only Event ID `140` was observed. This is an
important hunting nuance because relying only on `4698` can miss unusual task
creation paths.

### Defender Hunting for Scheduled Tasks

List all tasks:

```powershell
Get-ScheduledTask |
  Select-Object TaskName, TaskPath, State
```

Inspect actions:

```powershell
Get-ScheduledTask | ForEach-Object {
  $task = $_
  $task.Actions | ForEach-Object {
    [PSCustomObject]@{
      TaskPath = $task.TaskPath
      TaskName = $task.TaskName
      Execute = $_.Execute
      Arguments = $_.Arguments
    }
  }
}
```

Hunt suspicious action paths:

```powershell
Get-ScheduledTask | ForEach-Object {
  $task = $_
  $task.Actions | Where-Object {
    $_.Execute -match 'AppData|Temp|Users|ProgramData|powershell|cmd|wscript|cscript|mshta'
  } | ForEach-Object {
    [PSCustomObject]@{
      TaskName = $task.TaskName
      TaskPath = $task.TaskPath
      Execute = $_.Execute
      Arguments = $_.Arguments
    }
  }
}
```

Compare registry and disk:

```powershell
Get-ChildItem "HKLM:\Software\Microsoft\Windows NT\CurrentVersion\Schedule\TaskCache\Tree" -Recurse
Get-ChildItem "C:\Windows\System32\Tasks" -Recurse
```

Suspicious signs:

- Task exists in registry but not on disk.
- Task XML exists but cannot be opened or modified normally.
- Hidden task running from user-writable path.
- Task action launches `cmd.exe`, `powershell.exe`, `wscript.exe`,
  `cscript.exe`, `mshta.exe`, or LOLBins.
- Task trigger fires at logon or startup and was created recently.

## Registry Run Keys and Startup Folder

### Logon Auto-Start Model

Run keys and Startup folders are simpler than services or scheduled tasks. They
launch programs when a user logs in.

Two common approaches:

1. Add a registry value under a Run-family key.
2. Place an executable or shortcut inside a Startup folder.

The simplicity is the advantage and the weakness. These locations are reliable,
but defenders monitor them heavily.

### Startup Folders

User-specific startup:

```text
shell:startup
C:\Users\<user>\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup
```

All-users startup:

```text
shell:common startup
C:\ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp
```

Behavior:

- User startup triggers when that user logs in.
- Common startup triggers when any user logs in.
- Files and shortcuts are visible on disk.

Defender hunting:

```powershell
Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup"
Get-ChildItem "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp"
```

Review shortcut targets:

```powershell
$shell = New-Object -ComObject WScript.Shell
Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup" -Filter *.lnk |
  ForEach-Object {
    $shortcut = $shell.CreateShortcut($_.FullName)
    [PSCustomObject]@{
      Shortcut = $_.FullName
      Target = $shortcut.TargetPath
      Arguments = $shortcut.Arguments
    }
  }
```

### Windows Registry Hives

Core hives relevant to this research:

| Hive | Purpose |
|---|---|
| `HKCR` | File associations, COM class registration, OLE object classes. |
| `HKCU` | Configuration for the currently logged-in user. |
| `HKLM` | Machine-wide configuration for all users. |
| `HKU` | User profiles loaded on the machine. |
| `HKCC` | Runtime hardware profile information. |

Run-key persistence commonly uses `HKCU` or `HKLM`.

### Run, RunOnce, and RunOnceEx

Paths:

```text
HKLM\Software\Microsoft\Windows\CurrentVersion\Run
HKCU\Software\Microsoft\Windows\CurrentVersion\Run
HKLM\Software\Microsoft\Windows\CurrentVersion\RunOnce
HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce
```

Behavior:

| Key | Behavior |
|---|---|
| `Run` | Executes at each user logon. |
| `RunOnce` | Executes once, then removes the value. |
| `RunOnceEx` | Executes once after successful run; not always present by default. |

Privilege:

- `HKCU` can usually be written by the current user.
- `HKLM` requires Administrator privileges.

### Creating Run-Key Values With `reg.exe`

Paths:

```text
C:\Windows\System32\reg.exe
C:\Windows\SysWOW64\reg.exe
```

Example lab value:

```bat
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" ^
  /v ResearchRun ^
  /t REG_SZ ^
  /d "C:\Windows\System32\notepad.exe"
```

Verify:

```bat
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Run"
```

Delete:

```bat
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" ^
  /v ResearchRun /f
```

### Creating Run-Key Values With PowerShell

Create:

```powershell
New-ItemProperty `
  -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" `
  -Name "ResearchRun" `
  -Value "C:\Windows\System32\notepad.exe" `
  -PropertyType String `
  -Force
```

Query:

```powershell
Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
```

Delete:

```powershell
Remove-ItemProperty `
  -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" `
  -Name "ResearchRun"
```

### Run-Key Artifacts

Important artifacts:

```text
Registry:
  HKCU\Software\Microsoft\Windows\CurrentVersion\Run
  HKLM\Software\Microsoft\Windows\CurrentVersion\Run
  HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce
  HKLM\Software\Microsoft\Windows\CurrentVersion\RunOnce

Event logs:
  Security 4657 - Registry value modified, if auditing is enabled
  Sysmon Event ID 13 - Registry value set, if Sysmon is deployed
  Sysmon Event ID 1 - Process creation after logon

Tools:
  Autoruns -> Logon tab
```

Hunt suspicious Run values:

```powershell
$paths = @(
  "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run",
  "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run",
  "HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce",
  "HKLM:\Software\Microsoft\Windows\CurrentVersion\RunOnce"
)

foreach ($path in $paths) {
  if (Test-Path $path) {
    Get-ItemProperty $path | Select-Object * -ExcludeProperty PS*
  }
}
```

Suspicious patterns:

- Values pointing to `%TEMP%`, `%APPDATA%`, Downloads, or user profile paths.
- Values launching script interpreters.
- Recently created values with generic names.
- Values with encoded or heavily quoted command lines.
- HKLM Run values created outside software installation windows.

## OPSEC Versus Detection

The original research included OPSEC observations, and they are important, but
they should be framed carefully. OPSEC is not a guide to hiding from defenders;
it is an analysis lens for understanding why some persistence choices generate
stronger evidence than others.

| Choice | Operator Benefit | Defender Detection |
|---|---|---|
| LocalSystem service | Strong access and boot persistence | New SYSTEM service, 7045 event, suspicious binary path |
| svchost-hosted DLL | Blends into normal Windows service model | New `Svchost` group and suspicious `ServiceDll` |
| Scheduled task at startup | Flexible trigger and easy execution | Task creation events, TaskCache changes |
| HKCU Run key | Does not require admin | Autoruns/logon artifact, registry-set telemetry |
| Startup shortcut | Very simple | Visible file or shortcut in known folder |

Research takeaway:

- Every persistence method creates evidence.
- The evidence differs by subsystem.
- Good detection engineering starts by understanding where Windows stores and
  executes each configuration.

## Detection Engineering Notes

### High-Signal Events

| Event | Source | Meaning |
|---:|---|---|
| 7045 | System | Service installed. |
| 4697 | Security | Service installed, when audit policy captures it. |
| 4698 | Security | Scheduled task created. |
| 4702 | Security | Scheduled task updated. |
| 4699 | Security | Scheduled task deleted. |
| 140 | TaskScheduler/Operational | Task updated. |
| 106 | TaskScheduler/Operational | Task registered. |
| 4657 | Security | Registry value modified, when auditing is enabled. |
| 1 | Sysmon | Process creation. |
| 11 | Sysmon | File creation. |
| 12/13/14 | Sysmon | Registry object/value changes. |

### Service Detection Logic

Detection ideas:

- New service created by unusual parent process.
- Service binary path in user-writable directory.
- Service name not in enterprise baseline.
- Service running as LocalSystem with unsigned binary.
- `ImagePath` launching shell interpreters or LOLBins.
- New `ServiceDll` under a non-standard path.
- New values under the `Svchost` group registry key.

Example Sigma-style logic:

```yaml
title: Suspicious Windows Service Creation From User-Writable Path
logsource:
  product: windows
  service: system
detection:
  selection:
    EventID: 7045
  suspicious_path:
    ImagePath|contains:
      - '\Users\'
      - '\AppData\'
      - '\Temp\'
      - '\ProgramData\'
  condition: selection and suspicious_path
level: high
```

### Scheduled Task Detection Logic

Detection ideas:

- Task action launches `cmd.exe`, `powershell.exe`, `wscript.exe`,
  `cscript.exe`, `mshta.exe`, `rundll32.exe`, or `regsvr32.exe`.
- Task created by Office, browser, archive tools, or script interpreters.
- Task registered under unusual path or random-looking name.
- Task exists in TaskCache registry but corresponding XML is missing.
- Task is hidden and runs at logon/startup.

Example Sigma-style logic:

```yaml
title: Scheduled Task Launching Script Interpreter
logsource:
  product: windows
  service: security
detection:
  selection:
    EventID:
      - 4698
      - 4702
  suspicious_action:
    TaskContent|contains:
      - 'powershell.exe'
      - 'cmd.exe'
      - 'wscript.exe'
      - 'cscript.exe'
      - 'mshta.exe'
  condition: selection and suspicious_action
level: medium
```

### Run Key Detection Logic

Detection ideas:

- Registry value set under Run or RunOnce.
- Value data points to user-writable path.
- Value data includes encoded PowerShell or script interpreters.
- New autorun value appears after suspicious process execution.

Example Sigma-style logic:

```yaml
title: Suspicious Run Key Persistence
logsource:
  product: windows
  category: registry_set
detection:
  selection:
    TargetObject|contains:
      - '\Software\Microsoft\Windows\CurrentVersion\Run'
      - '\Software\Microsoft\Windows\CurrentVersion\RunOnce'
  suspicious_data:
    Details|contains:
      - '\AppData\'
      - '\Temp\'
      - 'powershell'
      - 'cmd.exe'
      - 'wscript'
      - 'mshta'
  condition: selection and suspicious_data
level: high
```

## Defensive Hardening

### Service Hardening

- Restrict local administrator rights.
- Monitor service creation events.
- Baseline legitimate services and alert on drift.
- Require signed binaries for enterprise service deployment where possible.
- Restrict write permissions to service binary directories.
- Review service recovery actions.
- Disable unnecessary services.

### Scheduled Task Hardening

- Baseline scheduled tasks across endpoints.
- Monitor task creation, updates, deletion, and TaskCache registry changes.
- Review hidden tasks.
- Audit task actions that launch script interpreters.
- Restrict who can create elevated tasks.
- Use EDR/Sysmon telemetry for task action process creation.

### Run Key and Startup Folder Hardening

- Monitor Run and RunOnce registry writes.
- Monitor Startup folder file creation.
- Review autoruns regularly with Sysinternals Autoruns.
- Block execution from user-writable directories where possible.
- Use application control, such as WDAC or AppLocker, for high-risk systems.

### General Host Controls

- Enable PowerShell logging where operationally feasible.
- Deploy Sysmon or equivalent endpoint telemetry.
- Centralize Windows event logs.
- Maintain a known-good autorun baseline.
- Validate digital signatures for new auto-start binaries.
- Alert on suspicious parent-child process chains after boot or logon.

## Incident Response Checklist

When investigating suspected host persistence:

1. Export service inventory.
2. Export scheduled task inventory.
3. Export Run/RunOnce keys from HKCU and HKLM.
4. Review Startup folders for all users and common startup.
5. Pull recent System, Security, TaskScheduler, and Sysmon events.
6. Validate file paths, hashes, signatures, and timestamps.
7. Compare against enterprise baseline.
8. Disable suspected persistence mechanism before deleting evidence.
9. Preserve related binaries and registry exports.
10. Hunt for the same artifact across other hosts.

Useful commands:

```powershell
Get-CimInstance Win32_Service |
  Export-Csv .\services.csv -NoTypeInformation

Get-ScheduledTask |
  Export-Csv .\scheduled_tasks.csv -NoTypeInformation

reg export "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" hklm_run.reg
reg export "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" hkcu_run.reg
```

## Research Takeaways

Windows persistence is a study of legitimate subsystem abuse. The attacker does
not need a strange exploit if Windows already provides reliable auto-start
mechanisms. That is why the best defensive approach is not only malware
signature matching, but configuration monitoring and baseline drift detection.

Key takeaways:

- Services are powerful and durable, but service creation is highly visible.
- `svchost.exe` hosting changes the process appearance but adds registry
  artifacts that defenders can inspect.
- Scheduled Tasks are flexible and common, but task creation and action content
  are huntable.
- Run keys and Startup folders are simple and reliable, but heavily monitored.
- Registry-only techniques can change which event IDs appear, so detection
  should not rely on one event source.
- Every persistence mechanism should be documented with execution model,
  privilege requirement, storage location, event evidence, and cleanup path.

## Conclusion

Persistence is not only an offensive technique. It is also a defender's roadmap.
If we understand how Windows starts programs automatically, we know where to
hunt when a host behaves suspiciously.

The three techniques studied here can be summarized as:

```text
Windows Service
  -> SCM database
  -> machine-wide persistence
  -> strong privileges
  -> service-install logs

Scheduled Task
  -> TaskCache + XML
  -> flexible triggers
  -> user or elevated context
  -> task registration/update logs

Run Key / Startup Folder
  -> registry or filesystem autorun
  -> logon trigger
  -> simple execution
  -> autoruns and registry artifacts
```

For a security researcher, the value is not memorizing commands. The value is
understanding the operating model deeply enough to explain impact, reproduce
behavior in a lab, identify artifacts, and recommend controls that actually
reduce risk.

## References

- <https://attack.mitre.org/techniques/T1543/003/> - Windows Service
- <https://attack.mitre.org/techniques/T1053/005/> - Scheduled Task
- <https://attack.mitre.org/techniques/T1547/001/> - Run Keys / Startup Folder
- <https://docs.microsoft.com/en-us/windows/win32/services/installing-a-service>
- <https://docs.microsoft.com/en-us/windows/win32/services/database-of-installed-services>
- <https://docs.microsoft.com/en-us/windows/win32/services/service-user-accounts>
- <https://docs.microsoft.com/en-us/windows/win32/api/winsvc/nf-winsvc-setservicestatus>
- <https://docs.microsoft.com/en-us/dotnet/api/system.serviceprocess.servicebase.servicehandle>
- <https://docs.microsoft.com/en-us/dotnet/api/system.serviceprocess.servicecontroller>
- <https://docs.microsoft.com/en-us/windows/win32/taskschd/schtasks>
- <https://docs.microsoft.com/en-us/windows/win32/taskschd/daily-trigger-example--xml->
- <https://docs.microsoft.com/en-us/sysinternals/downloads/sysinternals-suite>
- <https://docs.microsoft.com/en-us/sysinternals/downloads/psexec>
- <https://docs.microsoft.com/en-us/windows-server/administration/windows-commands/reg>
- <https://docs.microsoft.com/en-us/powershell/module/microsoft.powershell.management/new-itemproperty>
- <https://docs.microsoft.com/en-us/powershell/module/cimcmdlets/>
- <https://devblogs.microsoft.com/scripting/use-powershell-to-create-scheduled-tasks/>
- <https://adamtheautomator.com/powershell-scheduled-task/>
- <https://ss64.com/nt/sc.html>
- <https://ss64.com/nt/net-service.html>
- <https://csandker.io/2021/01/10/Offensive-Windows-IPC-1-NamedPipes.html>
- <https://pusha.be/index.php/2020/05/07/exploration-of-svchost-exe-p-flag/>
- <https://docs.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-setprocessmitigationpolicy>
- <https://docs.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute>

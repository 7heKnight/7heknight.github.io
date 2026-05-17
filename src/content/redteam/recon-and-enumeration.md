---
title: "OSINT Recon & Enumeration: A Full Footprinting Pass Against certifiedhacker.com"
date: 2022-09-22
category: "recon-enum"
difficulty: "intermediate"
tags: [OSINT, recon, footprinting, nmap, whois, crt.sh, shodan, wayback, exiftool, google-dorking, HUMINT]
excerpt: "A researcher-grade reconnaissance methodology applied end-to-end against a deliberately vulnerable training host: HUMINT harvesting from people-facing pages, WHOIS, certificate-transparency subdomain enumeration with a custom validator, passive intelligence from Shodan and the Wayback Machine, full Nmap service and vulnerability scanning, and document/image metadata extraction — with the analytic reasoning that ties each finding to the next kill-chain phase."
draft: false
---

# OSINT Recon & Enumeration: A Full Footprinting Pass Against certifiedhacker.com

> Educational material only. Every technique below was performed against
> `certifiedhacker.com`, a host published by EC-Council expressly for
> security training. Do not run any of this against systems you are not
> explicitly authorized to test.

## Why reconnaissance is the whole game

Reconnaissance is the first phase of the cyber kill chain, and it is the
phase that disproportionately determines the cost of every phase after it.
An attacker who skips it is reduced to noisy, opportunistic scanning; an
attacker who does it well walks into the engagement already knowing the
people, the technology stack, the exposed services, and the small data
leaks that stitch them together.

This writeup is a complete footprinting pass against a single lab host. The
goal is not to list tools — it is to show the *reasoning*: what each source
yields, why it matters, and how each finding feeds the next. The work is
deliberately structured **passive-first** (no packets to the target) and
only then **active**, because in a real engagement the order matters for
both stealth and legal scope.

The methodology, mapped to MITRE ATT&CK's *Reconnaissance* tactic (TA0043):

1. **Footprinting people and assets** — Gather Victim Identity Information
   (T1589), Gather Victim Org Information (T1591).
2. **Infrastructure intelligence** — WHOIS (T1590.001), DNS / certificate
   transparency (T1590.002 / Search Open Technical Databases T1596.003).
3. **Passive technical databases** — Shodan, Wayback (T1596 / T1593).
4. **Active scanning** — port and vulnerability scanning (T1595.001 /
   T1595.002).
5. **Metadata harvesting** — file and image metadata (T1597 / leaked
   internal fields).

## 1. Baseline footprint

Before any tooling, establish the anchor facts. Everything else hangs off
these:

- **Hostname:** `certifiedhacker.com`
- **Hosting provider:** BLUEHOST
- **IP:** `162.241.216.11`

These three values alone already branch the investigation: the hostname
drives certificate-transparency and DNS work, the IP drives Shodan and
reverse lookups, and the provider tells us this is shared hosting (which
shapes expectations about what we can and cannot attribute to the target).

## 2. HUMINT — harvesting the people-facing surface

The single highest-value, lowest-noise activity in early recon is reading
the target's own website like an intelligence analyst, not a user. Each
mini-application on `certifiedhacker.com` leaks human intelligence that
feeds phishing, password attacks, and social-engineering pretexts.

### 2.1 P-folio (`/P-folio/index.html`)

A corporate portfolio page — the richest HUMINT source on the site.

- **Organization:** Systematic Software Limited
- **Address:** 2512 Old Road – Alian Street Alioha – Arizuwa
- **ZIP:** `01234-567`
- **Phone:** `+90 123 45 67`
- **Email:** `aalia@alisan.com`
- **Named staff with roles** — the part that matters most for an attacker:
  - **Samuel Andrews** — *Network Administrator* (deploys/configures
    network hardware and software → privileged infrastructure access).
  - **Jonathon T.** — *Human Resource (HR)* (broad internal contact;
    classic phishing entry point).
  - **Margerete Peterson** — *Manager (HRM)* (authority figure; useful for
    business-email-compromise pretexts).

Names + roles + an email format (`first@domain`) is enough to *predict*
other internal addresses and to craft a role-targeted pretext. This is the
raw material the rest of the kill chain consumes.

### 2.2 Under Construction (`/Under Construction/index.html`)

The most useful kind of leak: a single identity reused across platforms.

- Facebook: `http://www.facebook.com/san.terpstra`
- Flickr: `http://flickr.com/photos/sanneterpstra`
- Twitter: `http://twitter.com/sanneterpstra`
- Skype: `skype:sanneterpstra?call`
- Linked document: `/docs/NIST.SP.800-63-3.pdf`

`san.terpstra` / `sanneterpstra` is the same handle across four services —
a username pivot that turns a flat site into a person you can profile,
correlate, and target.

### 2.3 Remaining mini-apps

Each additional page contributes more contactable surface:

- **Social Media** (`/Social Media/index.html`) — `contact@unite-magazine-community.com`,
  phone `(888) 564.2891`, address *1658 Street Ln., City, ST 6523*,
  customer service `1-800-123-986563`.
- **Corporate-learning-website** — *45 Cornscrew Drive Washington, DC, 20500*,
  phones `202-483-1111` / `896-563-2323` / `156-542-9532`, fax
  `202-483-1111`, emails `info@introspire.web`, `sales@introspire.web`,
  `support@introspire.web`.
- **Real Estate** — *0325 Carter Way, VA, 60215*, `(666) 256-8972`.
- **Online Booking** — `1-800-123-986563` (USA), `+123-456-598632` (intl).
- **Under the trees** — Twitter handle *Under the tree*, document
  `/docs/NIST.SP.800-63a.pdf`.

Individually trivia; together a contact graph and a list of document paths
worth pulling for metadata (see §7).

## 3. WHOIS — infrastructure ownership

```text
Domain Name:                CERTIFIEDHACKER.COM
Registry Domain ID:         88849376_DOMAIN_COM-VRSN
Registrar WHOIS Server:     whois.networksolutions.com
Registrar URL:              http://networksolutions.com
Updated Date:               2021-05-30T08:52:04Z
Creation Date:              2002-07-30T00:32:00Z
Registry Expiry Date:       2022-07-30T00:32:00Z
Registrar:                  Network Solutions, LLC
Registrar IANA ID:          2
Registrar Abuse Contact:    abuse@web.com / +1.8003337680
Domain Status:              clientTransferProhibited
Name Server:                NS1.BLUEHOST.COM
Name Server:                NS2.BLUEHOST.COM
DNSSEC:                      unsigned
```

What an analyst actually reads out of this:

- **Creation 2002, registrar Network Solutions** — a long-lived domain;
  good Wayback coverage is likely (confirmed in §6).
- **Name servers on BLUEHOST** — consistent with the shared-hosting
  hypothesis from §1.
- **`DNSSEC: unsigned`** — DNS responses are not cryptographically
  protected; relevant to any later DNS-spoofing or cache-poisoning
  considerations.
- **`clientTransferProhibited`** — a registrar lock; noted, not actionable
  here, but part of a complete picture.

## 4. Subdomain discovery via Certificate Transparency

Every publicly trusted TLS certificate is logged in Certificate
Transparency. `crt.sh` makes those logs queryable, which makes it one of
the highest-signal *passive* subdomain sources available — the target
itself published these names by requesting certificates for them.

A `crt.sh` query (`https://crt.sh/?q=certifiedhacker.com`) returned
certificates covering a large set of Subject Alternative Names. Rather than
eyeball the HTML, the candidates were extracted and then validated by
liveness — a host in a cert is interesting; a host that *answers* is a
target:

```python
import requests
import re

headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_1) '
                  'AppleWebKit/537.36 (KHTML, like Gecko) '
                  'Chrome/39.0.2171.95 Safari/537.36'
}

if __name__ == '__main__':
    orig_url = 'https://crt.sh/?q=certifiedhacker.com'
    result = requests.get(orig_url)
    links = re.findall(r'>(.+?certifiedhacker.com)', result.text)
    result.close()
    links = list(dict.fromkeys(links))
    links.sort()
    for link in links:
        try:
            new_request = requests.get('http://' + link, headers=headers)
            if new_request.ok:
                print(f'{new_request.status_code} - {link}')
        except IOError:
            pass
```

Live subdomains recovered (HTTP 200), including `www.` mirrors of each:

```text
blog.certifiedhacker.com           news.certifiedhacker.com
events.certifiedhacker.com         notifications.certifiedhacker.com
fleet.certifiedhacker.com          pstn.certifiedhacker.com
iam.certifiedhacker.com            sftp.certifiedhacker.com
itf.certifiedhacker.com            soc.certifiedhacker.com
mail.certifiedhacker.com           trustcenter.certifiedhacker.com
                                   webmail.certifiedhacker.com
```

Reading this list as an attacker:

- **`iam.`** — an identity/access surface. Highest-priority target; IAM is
  where authentication and authorization live.
- **`sftp.` / `webmail.` / `mail.`** — credential-bearing services and
  file transfer; prime targets for credential attacks and data access.
- **`soc.` / `trustcenter.`** — security-operations and trust surfaces;
  interesting both as targets and as indicators of the defender's posture.

CT enumeration converted one domain into a prioritized target list without
sending a single packet to those hosts.

## 5. Google dorking

Targeted search-engine queries surface references the target did not intend
to be correlated. Querying:

```text
"certifiedhacker.com" site:github.com
```

returned ~7 results — public GitHub repositories (the *Ethical-Hacking-Labs*
collection) that reference the host across recon, theHarvester, Maltego, and
ZAP exercises, plus a "Misconfigured access control" issue thread pointing
at `/corporate-learning-website/index.php`. Dorking is the cheapest way to
find third-party mentions, exposed files, and known-misconfiguration
breadcrumbs.

## 6. Passive technical databases

### 6.1 Shodan

`https://www.shodan.io/host/162.241.216.11` returns Shodan's last banner
grab — intelligence about the host *without scanning it ourselves*:

```text
Hostnames:     bluehost.com, box5331.bluehost.com
Domains:       BLUEHOST.COM
Country:       United States
City:          Houston
Organization:  Unified Layer
ISP:           Oso Grande IP Services, LLC
ASN:           AS26337
```

Shodan also implies version-based vulnerabilities. Its banner for the SSH
service (OpenSSH on this shared host) maps to a long list of historically
reported CVEs — useful as *leads to verify*, not as confirmed findings:

| CVE | Summary |
|---|---|
| CVE-2011-5000 | `ssh_gssapi_parse_ename` DoS (memory consumption) when gssapi-with-mic is enabled. |
| CVE-2010-4478 | J-PAKE shared-secret bypass / forged authentication. |
| CVE-2014-1692 | `hash_buffer` uninitialized data when J-PAKE is built in (DoS / memory corruption). |
| CVE-2010-5107 | Fixed login time limit → connection-slot exhaustion DoS. |
| CVE-2017-15906 | `process_open` allows zero-length file creation in read-only SFTP mode. |
| CVE-2016-10708 | Out-of-sequence NEWKEYS → NULL deref / daemon crash. |
| CVE-2016-0777 | `resend_bytes` roaming client info leak (can read a private key). |
| CVE-2011-4327 | `ssh-keysign` leaks key info via ptrace on certain platforms. |
| CVE-2010-4755 | `(1) remote_glob` / `(2) process_put` crafted-glob DoS. |
| CVE-2012-0814 | `auth-options.c` debug messages leak `authorized_keys` command options. |

The discipline here matters: these are **version-implied**, not validated.
They become findings only after active confirmation, but they tell us
*where to look* and they shape the active-scan plan in §7.

### 6.2 Wayback Machine

`https://web.archive.org/web/*/http://certifiedhacker.com` shows ~708
captured URLs. Crucially, it has archived **documents that are no longer
linked** from the live site, including:

- `/docs/822990.pdf`, `/docs/923332.pdf`, `/docs/NIST.SP.800-63a.pdf`,
  `/docs/NIST.SP.800-63-3.pdf`
- `Technology-Innovation-How-To-2.ppt` — which leaks an internal contact:
  **Marc G. Stanley | (301) 975-2162 | marc.stanley@nist.gov**

Archived-but-delinked documents are a recurring high-value find: the
organization "removed" them, but the archive didn't, and they often carry
internal names, emails, and metadata.

## 7. Active scanning with Nmap

Only now — passive map in hand — do we touch the target. The Shodan-implied
service list and the CT subdomain list tell us exactly what to verify.

### 7.1 Service discovery

```bash
$ nmap certifiedhacker.com
```

```text
PORT      STATE  SERVICE
21/tcp    open   ftp
22/tcp    open   ssh
25/tcp    open   smtp
26/tcp    open   rsftp
53/tcp    open   domain
80/tcp    open   http
110/tcp   open   pop3
143/tcp   open   imap
443/tcp   open   https
465/tcp   open   smtps
587/tcp   open   submission
993/tcp   open   imaps
995/tcp   open   pop3s
2222/tcp  open   EtherNetIP-1
3306/tcp  open   mysql
5432/tcp  open   postgresql
```

The notable surface, read as an attacker:

- A **full mail stack** (25/110/143/465/587/993/995) — large credential and
  user-enumeration surface.
- **`3306` MySQL and `5432` PostgreSQL exposed to the internet** — database
  ports should never be internet-facing; immediate high-priority leads.
- **`2222` (EtherNetIP-1)** — a non-standard port worth fingerprinting; on
  shared hosts this is frequently a second SSH or admin service.

### 7.2 Vulnerability scripts

```bash
$ nmap certifiedhacker.com --script=vuln \
  -p 21,22,25,26,53,80,110,143,443,465,587,993,995,2222,3306,5432
```

The mail-over-TLS ports (110, 143, 993, 995) confirmed a weak
Diffie-Hellman key exchange — a finding now *validated*, not merely
version-implied:

```text
Vulnerable ports: 110 (pop3), 143 (imap), 993 (imaps), 995 (pop3s)
| ssl-dh-params:
|   VULNERABLE:
|   Diffie-Hellman Key Exchange Insufficient Group Strength
|     State: VULNERABLE
|       Transport Layer Security (TLS) services that use Diffie-Hellman
|       groups of insufficient strength, especially those using one of a
|       few commonly shared groups, may be susceptible to passive
|       eavesdropping attacks.
|     Check results:
|       WEAK DH GROUP 1
|         Cipher Suite:        TLS_DHE_RSA_WITH_AES_128_GCM_SHA256
|         Modulus Type:        Safe prime
|         Modulus Source:      Unknown/Custom-generated
|         Modulus Length:      1024
|         Generator Length:    8
|         Public Key Length:   1024
|     References:
|_      https://weakdh.org
```

A 1024-bit DH group is the *Logjam* class of weakness: a sufficiently
resourced passive adversary can recover session keys and decrypt captured
mail traffic. This single confirmed finding is the kind of concrete,
defensible result a recon phase is supposed to produce.

## 8. Metadata harvesting (ExifTool)

Public images and documents routinely carry authoring metadata — software,
timestamps, hardware, and sometimes internal usernames. Pulling EXIF from
site images:

```text
featured-4.jpg
  Software:             Paint.NET v3.5.6
  File Creation:        2022:05:04 08:49:44+07:00
  Image Size:           640x480

home_slider2.jpg
  Creator Tool:         Adobe Photoshop CS3 Windows
  Modify Date:          2009:04:28 22:48:34
  Device Manufacturer:  Hewlett-Packard
  Primary Platform:     Microsoft Corporation
  Profile Copyright:    Copyright (c) 1998 Hewlett-Packard Company
```

On its own, trivia. Combined with the named staff (§2.1), the reused
`sanneterpstra` handle (§2.2), and the Wayback-leaked `marc.stanley@nist.gov`
(§6.2), it builds a *credible pretext*: software in use, timezone offset
(`+07:00`), and toolchain — all detail that makes a social-engineering
approach look authentic.

## 9. Analysis: turning recon into an attack plan

The point of this much collection is the synthesis. From the data above, a
prioritized plan emerges with zero guesswork:

1. **`iam.` and the exposed `3306`/`5432`** — the highest-impact technical
   targets. Internet-facing databases and an identity surface are where a
   real intrusion would start.
2. **Mail stack + confirmed weak DH** — a validated cryptographic weakness
   plus a large credential surface; credential attacks and traffic
   interception are in scope.
3. **HUMINT graph** — named admins (Samuel Andrews / network), HR contacts
   (Jonathon T., Margerete Peterson), reused handle `sanneterpstra`, and
   `marc.stanley@nist.gov` — the social-engineering and password-attack
   inventory.
4. **Wayback/dork artifacts** — delinked documents and a known
   access-control misconfiguration on `/corporate-learning-website/` worth
   probing.

## 10. Takeaways

- **Passive-first is a discipline, not a preference.** WHOIS, `crt.sh`,
  Shodan, Wayback, and dorking built ~80% of the map with zero packets to
  the target — and with zero legal/stealth risk.
- **Certificate Transparency is the single best passive subdomain source.**
  The target signs its own infrastructure into a public log.
- **Version-implied CVEs are leads, not findings.** Shodan tells you where
  to look; only active validation (the confirmed weak-DH result) produces a
  defensible conclusion.
- **HUMINT is technical recon.** Names, roles, reused handles, and leaked
  internal contacts feed phishing and password attacks as directly as an
  open port feeds an exploit.
- **Archives and metadata outlive cleanup.** Delinked Wayback documents and
  EXIF fields routinely expose what the organization thought it had removed.

## References

- <https://crt.sh/?q=certifiedhacker.com>
- <https://www.shodan.io/host/162.241.216.11>
- <https://web.archive.org/web/*/http://certifiedhacker.com>
- <https://weakdh.org>
- MITRE ATT&CK — Reconnaissance (TA0043)

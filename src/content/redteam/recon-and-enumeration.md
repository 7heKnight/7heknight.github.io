---
title: "OSINT Recon & Enumeration: Research-Grade Footprinting Against certifiedhacker.com"
date: 2022-09-22
category: "recon-enum"
difficulty: "intermediate"
tags: [OSINT, recon, enumeration, footprinting, nmap, whois, crt.sh, shodan, wayback, exiftool, google-dorking, HUMINT, red-team]
excerpt: "A complete researcher-style reconnaissance case study against EC-Council's training host: passive intelligence collection, HUMINT extraction, WHOIS, certificate transparency, Google dorking, Shodan analysis, Wayback recovery, Nmap validation, metadata harvesting, risk synthesis, and defensive recommendations."
draft: false
---

# OSINT Recon & Enumeration: Research-Grade Footprinting Against certifiedhacker.com

> Educational material only. The work below was performed against
> `certifiedhacker.com`, a host published by EC-Council for security training.
> Do not run scanning, enumeration, credential attacks, or social-engineering
> activity against systems you are not explicitly authorized to test.

## Executive Summary

This research documents a full reconnaissance and enumeration pass against
`certifiedhacker.com`. The objective was not simply to collect open ports or
copy tool output. The objective was to work like a security researcher during
the first stage of a red-team engagement: identify people, assets, technologies,
exposed services, archived material, metadata leakage, and weak cryptographic
configuration, then convert those observations into an attack-path hypothesis
and defensive guidance.

The target exposed enough information to build a meaningful external profile
without authentication. Passive sources revealed organization names, people,
roles, phone numbers, email addresses, reused social handles, archived
documents, subdomains, hosting information, and Shodan banner history. Active
validation confirmed a broad internet-facing service surface, including a full
mail stack, FTP, SSH, DNS, web, database ports, and a validated weak
Diffie-Hellman configuration on mail-related TLS services.

The most important finding is not one isolated port or one leaked document.
The important finding is the way the data connects:

- HUMINT identifies staff names, roles, emails, phone numbers, and reused
  handles.
- Certificate Transparency expands one domain into a targetable infrastructure
  list.
- Shodan provides passive service and hosting intelligence.
- Wayback exposes documents that may no longer be visible through normal
  navigation.
- Nmap validates real exposed services and confirms weak TLS parameters.
- ExifTool turns public files into operational context: software, timestamps,
  and platform hints.

That is what makes reconnaissance valuable. It transforms scattered public
facts into a prioritized map for later kill-chain phases.

## Research Scope

The scoped target for this case study was:

```text
Domain: certifiedhacker.com
IP:     162.241.216.11
Host:   BLUEHOST / Unified Layer shared hosting
```

The research used a passive-first methodology:

1. Collect visible website information and people-facing details.
2. Query registration and infrastructure records.
3. Mine public technical databases.
4. Recover archived URLs and documents.
5. Enumerate subdomains from Certificate Transparency.
6. Validate exposed services with active scanning.
7. Extract metadata from public files.
8. Correlate findings into attack paths and remediation actions.

The active portion was limited to service discovery and Nmap vulnerability
scripts against the training host. No credential attacks, exploitation,
destructive testing, persistence, lateral movement, or data exfiltration were
performed.

## Methodology Map

The workflow maps cleanly to MITRE ATT&CK Reconnaissance (TA0043):

| Research Activity | ATT&CK Technique | Purpose |
|---|---|---|
| Website HUMINT review | Gather Victim Identity Information (T1589), Gather Victim Org Information (T1591) | Identify names, roles, email formats, phone numbers, and social handles. |
| WHOIS review | Gather Victim Network Information (T1590.001) | Identify registrar, creation dates, nameservers, DNSSEC posture, and hosting assumptions. |
| Certificate Transparency | Search Open Technical Databases (T1596.003) | Discover subdomains and certificate-linked infrastructure. |
| Google dorking | Search Open Websites/Domains (T1593) | Find public references, GitHub mentions, known lab paths, and exposed breadcrumbs. |
| Shodan review | Search Open Technical Databases (T1596) | Obtain passive service banners and hosting metadata. |
| Wayback review | Search Open Websites/Domains (T1593) | Recover deleted or delinked URLs and documents. |
| Nmap scanning | Active Scanning (T1595.001 / T1595.002) | Validate exposed services and weak configurations. |
| Metadata extraction | Gather Victim Org Information (T1591) | Recover authoring software, timestamps, platform hints, and internal context. |

This ordering is intentional. Passive sources reduce noise and help define a
focused active-scan plan. In a professional assessment, this is the difference
between targeted validation and blind scanning.

## Findings Overview

| ID | Finding | Evidence Source | Risk | Research Value |
|---|---|---|---|---|
| R-01 | Public website leaks names, job roles, emails, phone numbers, addresses, and social handles. | Website pages | Medium | Enables targeted phishing, username generation, and pretext development. |
| R-02 | Reused handle `sanneterpstra` appears across social profiles. | Under Construction page | Medium | Enables cross-platform identity pivoting. |
| R-03 | Domain uses Bluehost nameservers and unsigned DNSSEC posture. | WHOIS | Low | Confirms hosting model and DNS trust posture. |
| R-04 | Certificate Transparency reveals multiple subdomains, including `iam`, `mail`, `webmail`, `sftp`, `soc`, and `trustcenter`. | crt.sh | Medium | Expands target surface and prioritizes high-value services. |
| R-05 | Public GitHub references and lab-related paths are discoverable by dorking. | Google dorking | Low to Medium | Reveals third-party mentions and possible known routes. |
| R-06 | Shodan identifies the host as Unified Layer / Bluehost infrastructure and exposes passive service intelligence. | Shodan | Informational | Supports active scan planning and hosting attribution. |
| R-07 | Wayback contains archived documents and URLs, including old NIST-related files. | Wayback Machine | Medium | Archived documents can outlive cleanup and leak contacts or metadata. |
| R-08 | Internet-facing service surface includes FTP, SSH, SMTP, POP3, IMAP, HTTP, HTTPS, MySQL, PostgreSQL, and mail-over-TLS ports. | Nmap | High | Large external attack surface; databases exposed to the internet are high-value leads. |
| R-09 | Nmap vuln scripts confirmed weak 1024-bit Diffie-Hellman parameters on mail-related TLS services. | Nmap `ssl-dh-params` | High | Validated cryptographic weakness, not only a version-based suspicion. |
| R-10 | Public images disclose authoring tools and timestamps through metadata. | ExifTool | Low | Helps build environment assumptions and realistic pretexts. |

## Baseline Footprint

Before collecting anything else, establish anchor facts. A good recon workflow
keeps these values stable because every later pivot depends on them.

```text
Hostname: certifiedhacker.com
Provider: BLUEHOST
IP:       162.241.216.11
```

These facts immediately shape the research plan:

- The hostname drives WHOIS, Certificate Transparency, Google dorking, and
  Wayback queries.
- The IP drives Shodan review, reverse hosting assumptions, and active scanning.
- The Bluehost provider signal suggests shared hosting, which means some
  services and banners may belong to the hosting environment rather than the
  individual training site.

That last point matters. A researcher must separate "observed on the same IP"
from "owned by the target application." Shared hosting can produce noisy
attribution, so every technical claim should say whether it is confirmed at the
domain, the IP, the virtual host, or only the hosting provider layer.

## HUMINT From Website Content

The first data source was the website itself. This stage is sometimes dismissed
as manual browsing, but it is one of the highest-signal recon steps. People,
roles, email formats, phone numbers, addresses, documents, and social links are
often more useful than a raw port list.

### P-folio

Page:

```text
http://certifiedhacker.com/P-folio/index.html
```

Observed contact information:

```text
Organization: Systematic Software Limited
Address:      2512 Old Road - Alian Street Alioha - Arizuwa
ZIP:          01234-567
Phone:        +90 123 45 67
Email:        aalia@alisan.com
```

Observed staff:

| Name | Role | Recon Value |
|---|---|---|
| Samuel Andrews | Network Administrator | High-value technical identity. The role implies access to network hardware, services, and administrative workflows. |
| Jonathon T. | Human Resource | Useful for HR-themed pretexts, onboarding lures, document requests, and identity-verification stories. |
| Margerete Peterson | Manager (HRM) | Authority figure. Useful for business-email-compromise style pretexts in a real engagement. |

The combination of a named network administrator and HR contacts is useful
because it supports both technical and human attack paths. For example, a
network administrator identity can guide password-spray username lists or help
prioritize exposed management interfaces. HR identities can support carefully
scoped social-engineering simulations if that is included in the engagement.

The email value `aalia@alisan.com` also gives a format to test against other
names. Even if the email domain is not the target domain, observed naming
conventions help generate candidate identities:

```text
first@domain
firstname.lastname@domain
firstinitiallastname@domain
```

In a professional report, this is not a finding by itself. It becomes an
input into identity enumeration and pretext risk.

### Under Construction

Page:

```text
http://certifiedhacker.com/Under%20Construction/index.html
```

Observed social links:

```text
Facebook: http://www.facebook.com/san.terpstra
Flickr:   http://flickr.com/photos/sanneterpstra
Twitter:  http://twitter.com/sanneterpstra
Skype:    skype:sanneterpstra?call
```

Observed document:

```text
http://certifiedhacker.com/docs/NIST.SP.800-63-3.pdf
```

The key observation is username reuse. The handle `san.terpstra` /
`sanneterpstra` appears across several platforms. A reused public handle lets a
researcher pivot from a single website to a broader identity graph. In a red
team, this can support:

- social profile discovery;
- likely personal email or username generation;
- password-reuse risk assessment;
- social-engineering pretext validation;
- document and image correlation across platforms.

The linked NIST document is also important because document paths often lead to
metadata extraction and archive discovery.

### Social Media

Page:

```text
http://certifiedhacker.com/Social%20Media/index.html
```

Observed information:

```text
Email:            contact@unite-magazine-community.com
Phone:            (888) 564.2891
Address:          1658 Street Ln., City, ST 6523
Customer Service: 1-800-123-986563
```

This data increases the target's contact graph. For an assessment, the value is
not only "there is a phone number." The value is that numbers and emails allow
the researcher to identify departments, support workflows, third-party brands,
and possible impersonation routes.

### Corporate Learning Website

Page:

```text
http://certifiedhacker.com/corporate-learning-website/01-homepage.html
```

Observed information:

```text
Address: 45 Cornscrew Drive Washington, DC, 20500

Telephone:
  202-483-1111
  896-563-2323
  156-542-9532

Fax:
  202-483-1111

Email:
  info@introspire.web
  sales@introspire.web
  support@introspire.web
```

The role-based mailboxes are useful because they suggest function-specific
entry points. `support@`, `sales@`, and `info@` addresses often feed ticketing
systems or shared inboxes. Shared inboxes are commonly monitored by multiple
users, which changes the social-engineering risk profile.

### Real Estate

Page:

```text
http://certifiedhacker.com/Real%20Estates/index.html
```

Observed information:

```text
Office:  0325 Carter Way, VA, 60215
Phone:   (666) 256-8972
```

This looks minor, but it still contributes to the organization profile. Physical
addresses are useful for validating brands, finding satellite offices, and
building realistic pretexts.

### Online Booking

Observed phone numbers:

```text
USA:           1-800-123-986563
International: +123-456-598632
```

Repeated phone numbers across pages are correlation points. They can identify
shared templates, reused content, or a central support line.

### Under the Trees

Page:

```text
http://certifiedhacker.com/Under%20the%20trees/index.html
```

Observed information:

```text
Twitter:       Under the tree
Document file: http://certifiedhacker.com/docs/NIST.SP.800-63a.pdf
```

This adds another document path and another social artifact. Document paths are
especially useful because they can be queried directly, searched in archives,
and fed into metadata extraction.

## HUMINT Analysis

The people-facing surface produced several intelligence classes:

| Data Type | Examples | Why It Matters |
|---|---|---|
| Named identities | Samuel Andrews, Jonathon T., Margerete Peterson | Supports targeted identity enumeration and realistic pretexts. |
| Job roles | Network Administrator, HR, HRM Manager | Helps prioritize targets by likely access and influence. |
| Emails | `aalia@alisan.com`, `support@introspire.web` | Reveals naming patterns and shared inboxes. |
| Phone numbers | Multiple local and toll-free numbers | Enables vishing simulation if authorized. |
| Social handles | `sanneterpstra` | Enables cross-platform pivoting. |
| Documents | NIST PDFs | Enables archive and metadata analysis. |

This is why HUMINT belongs in a technical recon report. It is not separate from
security research; it becomes the identity and pretext layer of the attack
surface.

## WHOIS and Registration Intelligence

WHOIS output:

```text
Domain Name:             CERTIFIEDHACKER.COM
Registry Domain ID:      88849376_DOMAIN_COM-VRSN
Registrar WHOIS Server:  whois.networksolutions.com
Registrar URL:           http://networksolutions.com
Updated Date:            2021-05-30T08:52:04Z
Creation Date:           2002-07-30T00:32:00Z
Registry Expiry Date:    2022-07-30T00:32:00Z
Registrar:               Network Solutions, LLC
Registrar IANA ID:       2
Registrar Abuse Email:   abuse@web.com
Registrar Abuse Phone:   +1.8003337680
Domain Status:           clientTransferProhibited
Name Server:             NS1.BLUEHOST.COM
Name Server:             NS2.BLUEHOST.COM
DNSSEC:                  unsigned
```

Research interpretation:

- The domain was created in 2002, so historical records and archived URLs are
  likely to exist.
- Network Solutions is the registrar, while Bluehost nameservers host DNS.
- `clientTransferProhibited` indicates registrar transfer lock. This is normal
  but still worth documenting.
- `DNSSEC: unsigned` means DNS responses are not protected by DNSSEC. This is
  not immediately exploitable in this case, but it is part of the domain trust
  posture.

WHOIS does not provide a vulnerability by itself here. It provides
infrastructure context and validates the next pivots: nameservers, historical
timeline, and archive likelihood.

## Certificate Transparency Enumeration

Certificate Transparency logs are public ledgers of TLS certificates. When an
organization requests certificates for subdomains, those names can appear in CT
logs even if they are not linked from the main website.

Query:

```text
https://crt.sh/?q=certifiedhacker.com
```

I used a small Python script to extract candidate names and then validate which
hosts responded over HTTP:

```python
import requests
import re

headers = {
    'User-Agent': (
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_1) '
        'AppleWebKit/537.36 (KHTML, like Gecko) '
        'Chrome/39.0.2171.95 Safari/537.36'
    )
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

Live hosts recovered:

```text
blog.certifiedhacker.com
events.certifiedhacker.com
fleet.certifiedhacker.com
iam.certifiedhacker.com
itf.certifiedhacker.com
mail.certifiedhacker.com
news.certifiedhacker.com
notifications.certifiedhacker.com
pstn.certifiedhacker.com
sftp.certifiedhacker.com
soc.certifiedhacker.com
trustcenter.certifiedhacker.com
webmail.certifiedhacker.com
www.blog.certifiedhacker.com
www.certifiedhacker.com
www.events.certifiedhacker.com
www.fleet.certifiedhacker.com
www.iam.certifiedhacker.com
www.itf.certifiedhacker.com
www.news.certifiedhacker.com
www.notifications.certifiedhacker.com
www.pstn.certifiedhacker.com
www.sftp.certifiedhacker.com
www.soc.certifiedhacker.com
www.trustcenter.certifiedhacker.com
```

Subdomain prioritization:

| Subdomain | Priority | Reason |
|---|---:|---|
| `iam.certifiedhacker.com` | High | Identity and access management surfaces are high-impact targets. |
| `mail.certifiedhacker.com` / `webmail.certifiedhacker.com` | High | Credential-bearing mail surfaces; likely authentication targets. |
| `sftp.certifiedhacker.com` | High | File transfer surface; often tied to credentials and data exposure. |
| `soc.certifiedhacker.com` | Medium | Security operations naming can reveal defensive tooling or workflows. |
| `trustcenter.certifiedhacker.com` | Medium | Trust/compliance portals often expose documents and vendor integrations. |
| `fleet.certifiedhacker.com` | Medium | May indicate asset, device, or vehicle management depending on context. |
| `blog`, `news`, `events`, `notifications` | Low to Medium | Content surfaces; useful for tech stack, archived content, and account flows. |

Certificate Transparency is one of the best passive recon sources because the
target's own certificate requests publish infrastructure names. It turned one
root domain into a prioritized attack-surface inventory.

## Google Dorking

The Google dork used:

```text
"certifiedhacker.com" site:github.com
```

This returned several public GitHub references connected to ethical hacking
labs and exercises. Dorking also surfaced references to paths such as:

```text
/corporate-learning-website/index.php
```

The research value is twofold:

- Third-party references can reveal old exercises, writeups, scanners, or
  vulnerable paths that are not obvious from the live site.
- Public issues or lab notes can reveal known weaknesses, expected endpoints,
  and common student attack paths.

Google dorking should be treated as intelligence triage. It does not confirm a
vulnerability, but it tells the researcher what to validate.

## Shodan Passive Intelligence

Host lookup:

```text
https://www.shodan.io/host/162.241.216.11
```

Observed Shodan context:

```text
Hostnames:     bluehost.com, box5331.bluehost.com
Domains:       BLUEHOST.COM
Country:       United States
City:          Houston
Organization:  Unified Layer
ISP:           Oso Grande IP Services, LLC
ASN:           AS26337
```

This confirms the shared hosting hypothesis. Shodan is useful here because it
collects banners without requiring us to scan first. It is a passive way to
build a service hypothesis.

However, a researcher must be careful with Shodan CVE output. CVEs inferred
from banners are leads, not confirmed vulnerabilities. For example, Shodan may
associate OpenSSH banners with historical CVEs such as:

| CVE | Shodan-Inferred Risk |
|---|---|
| CVE-2011-5000 | `ssh_gssapi_parse_ename` denial of service under specific GSSAPI conditions. |
| CVE-2010-4478 | J-PAKE shared-secret authentication weakness in affected builds. |
| CVE-2014-1692 | J-PAKE-related uninitialized data / crash risk. |
| CVE-2010-5107 | Connection-slot exhaustion due to fixed login grace behavior. |
| CVE-2017-15906 | Zero-length file creation through read-only SFTP mode. |
| CVE-2016-10708 | Out-of-sequence NEWKEYS crash condition. |
| CVE-2016-0777 | Roaming client information leak. |
| CVE-2011-4327 | `ssh-keysign` key information exposure in specific local conditions. |
| CVE-2010-4755 | Crafted glob denial of service in SFTP handling. |
| CVE-2012-0814 | Debug messages leak command options in `authorized_keys`. |

These should be written as "potentially relevant" until validated by direct
version checking and exploitability analysis. This distinction is what
separates a professional report from a tool dump.

## Wayback Machine Research

Wayback query:

```text
https://web.archive.org/web/*/http://certifiedhacker.com
```

The archive contained hundreds of historical URLs, including document paths
that may not be obvious from current navigation:

```text
/docs/822990.pdf
/docs/923332.pdf
/docs/NIST.SP.800-63a.pdf
/docs/NIST.SP.800-63-3.pdf
Technology-Innovation-How-To-2.ppt
```

One archived document reference contained an internal-style contact:

```text
Marc G. Stanley | (301) 975-2162 | marc.stanley@nist.gov
```

The original extracted note had a typo (`nist.giv`), but the intended address
format is clearly NIST-related based on the document context.

Wayback value:

- It can reveal documents removed from live navigation.
- It can recover old endpoints and parameters.
- It can show technology and content changes over time.
- It can expose third-party documents that still contain author metadata.

Archive findings should be triaged carefully. An archived file is evidence of
historical exposure, but the current impact depends on whether the file is still
reachable, sensitive, and relevant.

## Active Service Enumeration

After passive mapping, active validation was performed with Nmap.

Command:

```bash
nmap certifiedhacker.com
```

Observed open services:

```text
PORT      STATE SERVICE
21/tcp    open  ftp
22/tcp    open  ssh
25/tcp    open  smtp
26/tcp    open  rsftp
53/tcp    open  domain
80/tcp    open  http
110/tcp   open  pop3
143/tcp   open  imap
443/tcp   open  https
465/tcp   open  smtps
587/tcp   open  submission
993/tcp   open  imaps
995/tcp   open  pop3s
2222/tcp  open  EtherNetIP-1
3306/tcp  open  mysql
5432/tcp  open  postgresql
```

Service analysis:

| Service Area | Ports | Risk Notes |
|---|---|---|
| FTP | 21 | Legacy file transfer; investigate anonymous access, weak credentials, and plaintext exposure. |
| SSH | 22, possibly 2222 | Administrative access surface; validate version and authentication policy. |
| Mail | 25, 110, 143, 465, 587, 993, 995 | Large credential-bearing surface; validate TLS, user enumeration, auth methods, and weak cipher suites. |
| DNS | 53 | Validate recursion, zone transfer, and authoritative behavior. |
| Web | 80, 443 | Main application surface; crawl, fingerprint, and test known discovered paths. |
| Databases | 3306, 5432 | High-risk exposure. Internet-facing MySQL/PostgreSQL should be restricted unless explicitly required. |
| Unknown / non-standard | 26, 2222 | Requires fingerprinting; non-standard ports often hide alternate admin services. |

The database ports are the most concerning from an external attack-surface
perspective. Even if authentication is strong, exposing database services to the
internet increases brute-force, fingerprinting, vulnerability, and
misconfiguration risk.

## Vulnerability Script Validation

Nmap vulnerability scripts were run against the identified open ports:

```bash
nmap certifiedhacker.com --script=vuln \
  -p 21,22,25,26,53,80,110,143,443,465,587,993,995,2222,3306,5432
```

Validated finding:

```text
Vulnerable ports:
  110/tcp  pop3
  143/tcp  imap
  993/tcp  imaps
  995/tcp  pop3s

ssl-dh-params:
  VULNERABLE:
    Diffie-Hellman Key Exchange Insufficient Group Strength

  Check results:
    WEAK DH GROUP 1
      Cipher Suite:       TLS_DHE_RSA_WITH_AES_128_GCM_SHA256
      Modulus Type:       Safe prime
      Modulus Source:     Unknown/Custom-generated
      Modulus Length:     1024
      Generator Length:   8
      Public Key Length:  1024

  Reference:
    https://weakdh.org
```

This is stronger evidence than Shodan banner inference because it is active
validation. The services accepted a DHE cipher suite using a 1024-bit group.
That fits the weak Diffie-Hellman / Logjam class of issues.

Impact:

- A passive adversary with sufficient resources may be able to decrypt captured
  TLS sessions that use weak shared DH groups.
- Mail protocols are sensitive because they carry credentials and private
  communications.
- Even if modern clients prefer stronger suites, weak suites should be removed
  because negotiation behavior can vary across clients and downgrade conditions.

Recommended remediation:

- Disable export-grade and weak DHE suites.
- Use ECDHE suites with modern curves where possible.
- If DHE must remain enabled, use a unique DH group of at least 2048 bits.
- Validate with `testssl.sh`, Nmap `ssl-enum-ciphers`, and external TLS
  scanners after remediation.

## Metadata Harvesting With ExifTool

Public images and documents can leak operational context. ExifTool was used to
inspect downloaded assets.

Example: `featured-4.jpg`

```text
ExifTool Version Number     : 12.41
File Name                   : featured-4.jpg
File Size                   : 180 KiB
File Modification Date/Time : 2022:05:04 08:49:46+07:00
File Creation Date/Time     : 2022:05:04 08:49:44+07:00
File Type                   : JPEG
MIME Type                   : image/jpeg
X Resolution                : 300
Y Resolution                : 300
Software                    : Paint.NET v3.5.6
Image Width                 : 640
Image Height                : 480
Image Size                  : 640x480
```

Example: `home_slider2.jpg`

```text
Software              : Adobe Photoshop CS3 Windows
Modify Date           : 2009:04:28 22:48:34
Writer Name           : Adobe Photoshop
Reader Name           : Adobe Photoshop CS3
Creator Tool          : Adobe Photoshop CS3 Windows
Create Date           : 2009:04:28 22:48:34+03:00
Primary Platform      : Microsoft Corporation
Device Manufacturer   : Hewlett-Packard
Profile Creator       : Hewlett-Packard
Profile Copyright     : Copyright (c) 1998 Hewlett-Packard Company
```

Research interpretation:

- Paint.NET and Adobe Photoshop CS3 indicate authoring tools that may exist in
  the content-production workflow.
- Timestamps reveal timezones and old asset age.
- Hewlett-Packard and Microsoft platform metadata support environment
  assumptions, but should not be overstated.

Metadata rarely gives direct compromise by itself. Its value is correlation.
When combined with staff names, emails, public documents, and social handles,
it helps build credible operational context.

## Evidence Quality Model

During research, I classify evidence into three levels:

| Level | Description | Example From This Case |
|---|---|---|
| Observed | Directly visible in a page, document, record, or tool output. | Contact information on website pages; WHOIS data. |
| Inferred | Reasonable conclusion from observed data, but not independently validated. | Shodan CVEs inferred from service banners. |
| Validated | Confirmed through active testing or reproducible checks. | Weak DH parameters confirmed by Nmap `ssl-dh-params`. |

This model prevents overclaiming. It is acceptable to list inferred risks, but
they must be labeled as leads. Only validated evidence should become a confirmed
finding.

## Attack-Path Synthesis

After collection, the next step is synthesis. The following paths would be
prioritized in a real authorized engagement.

### Path 1: Identity and Mail Surface

Inputs:

- `iam.certifiedhacker.com`
- `mail.certifiedhacker.com`
- `webmail.certifiedhacker.com`
- full mail stack on 25/110/143/465/587/993/995
- names and roles from HUMINT
- weak DH on mail-related TLS services

Research hypothesis:

An attacker would likely target identity and mail first because those surfaces
combine authentication, sensitive communication, and many human users.

Validation plan:

- Fingerprint login portals.
- Check TLS configuration across mail endpoints.
- Validate whether user enumeration exists.
- Review password policy if allowed by scope.
- Test mail-related security controls only if explicitly authorized.

### Path 2: Database Exposure

Inputs:

- MySQL exposed on 3306.
- PostgreSQL exposed on 5432.
- Hosting environment appears shared.

Research hypothesis:

Internet-facing database ports are high-value because a single weak password,
old version, misconfiguration, or exposed admin interface can create direct
data-access risk.

Validation plan:

- Fingerprint versions without authentication where possible.
- Confirm whether access is restricted by source IP.
- Check for default banners and supported auth methods.
- Avoid brute force unless explicitly authorized.

### Path 3: Archived Document and Metadata Pivot

Inputs:

- Wayback document paths.
- NIST PDFs and old PowerPoint file.
- ExifTool metadata.
- Staff and contact information.

Research hypothesis:

Documents and archived files may expose names, authoring software, internal
contacts, old paths, or historical technology hints that are no longer visible
on the live site.

Validation plan:

- Download only public documents in scope.
- Extract metadata and embedded links.
- Compare archived URLs against current availability.
- Identify sensitive data exposure, not just file existence.

### Path 4: Subdomain-Specific Web Testing

Inputs:

- CT-derived hosts: `iam`, `sftp`, `soc`, `trustcenter`, `fleet`, `blog`,
  `events`, `notifications`, `pstn`.

Research hypothesis:

Each subdomain may represent a separate application or virtual host with its
own technology stack, auth boundary, and misconfiguration risk.

Validation plan:

- Crawl each host.
- Capture headers and TLS configuration.
- Fingerprint frameworks and login flows.
- Check for default files, exposed admin panels, and old paths.

## Defensive Recommendations

### Reduce Public HUMINT Exposure

- Remove unnecessary personal names and direct role descriptions from public
  pages.
- Use role-based contact forms instead of publishing individual staff details.
- Review public social links and reused handles.
- Treat old microsites as part of the current attack surface.

### Harden DNS and Domain Posture

- Evaluate DNSSEC deployment for the domain.
- Review registrar lock, recovery contacts, and domain-expiry monitoring.
- Periodically audit authoritative DNS records and stale subdomains.

### Control Certificate Transparency Exposure

CT logs cannot be hidden after certificates are issued, but exposure can be
managed:

- Avoid unnecessary public SAN names.
- Use wildcard certificates carefully.
- Monitor CT logs for unexpected certificates.
- Decommission unused subdomains and remove DNS records.

### Reduce Internet-Facing Services

- Restrict MySQL and PostgreSQL to trusted networks or private interfaces.
- Disable FTP or replace it with a hardened file-transfer workflow.
- Restrict SSH by source IP, enforce key-based authentication, and monitor
  login attempts.
- Validate whether port 2222 is intentional and document its purpose.

### Harden Mail TLS

- Remove weak DHE groups.
- Prefer ECDHE suites.
- Use at least 2048-bit DH parameters if DHE is required.
- Re-test POP3/IMAP/SMTP TLS after configuration changes.

### Clean Archives and Metadata

- Strip metadata from public images and documents before publishing.
- Maintain an inventory of public documents and old microsites.
- Request archive removals where sensitive documents were historically exposed,
  understanding that archive removal is not guaranteed.
- Monitor public search results and GitHub mentions for sensitive references.

## Researcher Notes

Several lessons stand out from this case:

1. Recon is not a checklist. It is a reasoning process.
2. Tool output must be classified as observed, inferred, or validated.
3. HUMINT and technical recon are connected; names and roles guide technical
   testing priorities.
4. Passive recon can produce most of the target map before active scanning.
5. Shared hosting complicates attribution, so evidence must be precise.
6. A single validated issue, such as weak DH on mail services, is more valuable
   than a long unverified CVE list.

## Final Takeaway

The complete chain from this research can be summarized as:

```text
website HUMINT
  -> identity and contact graph
  -> WHOIS and hosting context
  -> CT subdomain expansion
  -> Shodan and Wayback passive enrichment
  -> Nmap service validation
  -> weak TLS finding
  -> metadata correlation
  -> prioritized attack paths and remediation
```

That is the role of a security researcher in reconnaissance: not only finding
facts, but connecting them into evidence, risk, and decisions.

## References

- <https://crt.sh/?q=certifiedhacker.com>
- <https://www.shodan.io/host/162.241.216.11>
- <https://web.archive.org/web/*/http://certifiedhacker.com>
- <https://weakdh.org>
- MITRE ATT&CK - Reconnaissance (TA0043)

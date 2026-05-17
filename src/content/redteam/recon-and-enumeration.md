---
title: "OSINT Recon & Enumeration: certifiedhacker.com Case Study"
date: 2022-09-22
category: "recon-enum"
difficulty: "beginner"
tags: [OSINT, recon, nmap, whois, crt.sh, shodan, exiftool]
excerpt: "A passive-then-active reconnaissance walkthrough against a deliberately vulnerable lab host: footprinting people and assets, certificate-transparency subdomain discovery, port and vulnerability scanning, and metadata extraction."
draft: false
---

# OSINT Recon & Enumeration: certifiedhacker.com Case Study

> Educational material only. Every technique below was performed against
> `certifiedhacker.com`, a host published expressly for security training.
> Do not run any of this against systems you are not explicitly authorized
> to test.

Reconnaissance is the first phase of the cyber kill chain. The goal is to
build a picture of the target — people, infrastructure, exposed services,
and the small metadata leaks that tie them together — *before* sending a
single intrusive packet. This writeup walks through a full pass against one
lab host.

## 1. Target Footprint

Baseline facts about the host:

- **Hostname:** `certifiedhacker.com`
- **Hosting provider:** BLUEHOST
- **IP:** `162.241.216.11`

Browsing the site surfaced several mini-applications, each leaking
human-intelligence (HUMINT) useful for later phishing or password attacks:

- **P-folio** (`/P-folio/index.html`) — named staff with roles:
  *Samuel Andrews (Network Administrator)*, *Jonathon T. (HR)*,
  *Margerete Peterson (HR Manager)*, plus a postal address and phone.
- **Under Construction** page — social handles all pointing at the same
  identity (`san.terpstra` / `sanneterpstra` on Facebook, Flickr, Twitter,
  Skype) and a linked document (`/docs/NIST.SP.800-63-3.pdf`).
- **Social Media / Corporate-learning / Real Estate / Online Booking /
  Under the trees** pages — additional emails, phone numbers and a second
  document (`/docs/NIST.SP.800-63a.pdf`).

Reused handles and document paths are exactly the kind of pivot that turns
a flat website into a map of an organization.

## 2. WHOIS

```text
Domain Name:        CERTIFIEDHACKER.COM
Registry Domain ID: 88849376_DOMAIN_COM-VRSN
Registrar:          Network Solutions, LLC
Creation Date:      2002-07-30T00:32:00Z
Registry Expiry:    2022-07-30T00:32:00Z
Name Server:        NS1.BLUEHOST.COM
Name Server:        NS2.BLUEHOST.COM
DNSSEC:             unsigned
Registrar Abuse:    abuse@web.com / +1.8003337680
```

WHOIS confirms the registrar, name servers and an unsigned-DNSSEC posture —
all useful context for the active phase.

## 3. Subdomain Discovery via Certificate Transparency

Certificate-transparency logs (`crt.sh`) list every TLS certificate ever
issued for a domain, which makes them an excellent passive source of
subdomains. The following script pulls candidates from `crt.sh` and keeps
only the ones that respond with HTTP 200:

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
    links = sorted(set(links))
    for link in links:
        try:
            r = requests.get('http://' + link, headers=headers)
            if r.ok:
                print(f'{r.status_code} - {link}')
        except IOError:
            pass
```

Live subdomains recovered:

```text
blog.        events.        fleet.       iam.
itf.         mail.          news.        notifications.
pstn.        sftp.          soc.         trustcenter.
webmail.     www.           (+ www.* mirrors of each)
```

`mail.`, `webmail.`, `sftp.` and `soc.` immediately stand out as
high-value targets.

## 4. Active Scanning with Nmap

### 4.1 Open ports

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

A broad mail stack plus directly exposed `mysql` and `postgresql` ports.

### 4.2 Vulnerability scripts

```bash
$ nmap certifiedhacker.com --script=vuln \
  -p 21,22,25,26,53,80,110,143,443,465,587,993,995,2222,3306,5432
```

The mail-over-TLS ports (110, 143, 993, 995) flagged a weak Diffie-Hellman
key exchange:

```text
| ssl-dh-params:
|   VULNERABLE: Diffie-Hellman Key Exchange Insufficient Group Strength
|     Modulus Length: 1024
|     Cipher Suite: TLS_DHE_RSA_WITH_AES_128_GCM_SHA256
|_    References: https://weakdh.org
```

A 1024-bit DH group is susceptible to passive eavesdropping (the *Logjam*
class of attack).

## 5. Metadata: Exiftool

Public images frequently carry authoring software and timestamps:

```text
featured-4.jpg     -> Software: Paint.NET v3.5.6
                      Created: 2022:05:04
home_slider2.jpg   -> Creator Tool: Adobe Photoshop CS3 Windows
                      Modify Date: 2009:04:28
                      Device Manufacturer: Hewlett-Packard
```

On its own this is trivia; combined with the named staff and reused social
handles it helps build a credible pretext.

## 6. Other Passive Sources

- **Google dorking** — surfaced hostname references in public GitHub repos.
- **Shodan** (`shodan.io/host/162.241.216.11`) — version-based vulnerability
  hints without touching the target.
- **Wayback Machine** — an archived `Technology-Innovation-How-To-2.ppt`
  exposing `Marc G. Stanley | (301) 975-2162 | marc.stanley@nist.gov`.

## 7. Takeaways

- Passive sources (WHOIS, `crt.sh`, Shodan, Wayback) build most of the map
  with zero packets to the target.
- Certificate transparency is one of the highest-signal subdomain sources.
- People-facing pages leak HUMINT (names, roles, reused handles) that feeds
  directly into the next kill-chain phases.
- Active Nmap scanning then confirms and prioritizes the attack surface.

## References

- <https://crt.sh/?q=certifiedhacker.com>
- <https://www.shodan.io/host/162.241.216.11>
- <https://web.archive.org/web//http://certifiedhacker.com>
- <https://weakdh.org>

# GL-iNet Captive Portal Setup

Badge Generator running on MacBook, GL-iNet router redirecting all connected fans to it.

## Architecture

```
Fan's Phone → GL-iNet WiFi ("Help Desk Inc") → Captive Portal Redirect
                                                      ↓
                                              MacBook (bun + SQLite)
                                              http://<macbook-ip>:3000
```

## Pre-Show Setup

### 1. Connect MacBook to GL-iNet

**Option A: USB-C ethernet adapter (recommended)**
Plug MacBook into GL-iNet's LAN port via a USB-C to ethernet adapter. MacBook
gets GL-iNet IP via wired interface while your WiFi stays free for venue internet
or hotspot. MacBook can be on two networks simultaneously (one wired, one WiFi).

**Option B: Connect to GL-iNet WiFi**
Join the "Help Desk Inc" SSID from your MacBook. Simpler, no adapter needed, but
your MacBook is now on the captive portal network with no internet. Override your
MacBook's DNS manually if you need internet:
```bash
# Set MacBook DNS to bypass GL-iNet's wildcard (use Cloudflare DNS)
networksetup -setdnsservers Wi-Fi 1.1.1.1 8.8.8.8
# Revert after show:
networksetup -setdnsservers Wi-Fi Empty
```
Note: this only helps YOUR MacBook. Fan devices still use GL-iNet's DNS.

**Option C: Phone hotspot for MacBook internet**
Connect MacBook to GL-iNet WiFi for the badge server. Use your phone's cellular
hotspot via Bluetooth/USB tethering if you need internet on the MacBook during
the show.

Note your MacBook's IP on the GL-iNet network:
```bash
# Wired (Option A)
ifconfig en0 | grep "inet " | awk '{print $2}'
# WiFi (Option B/C) — look for the 192.168.8.x address
ifconfig en0 | grep "inet " | awk '{print $2}'
```

### 2. Start the Badge Server

```bash
cd ~/Documents/HelpDesk/badge-app
ADMIN_TOKEN=your-secret-here ./start.sh --show-mode
```

By default, the admin panel is **localhost-only** — the admin token never travels
over WiFi, even on an open network. Fans can create badges but can't access
`/admin` or any `/api/admin/*` endpoints from their phones.

If you need admin from another device (e.g., Cloudflare Tunnel), use:
```bash
ADMIN_TOKEN=your-secret-here ./start.sh --show-mode --remote-admin
```

Verify it's reachable from the router's network:
```bash
curl http://localhost:3000
```

### 3. Configure GL-iNet WiFi

Access GL-iNet admin panel at `http://192.168.8.1` (default).

- **SSID:** `Help Desk Inc` (or `HELP DESK GUEST WIFI`)
- **Security:** Open (no password — fans need frictionless access)
- **Band:** 2.4 GHz (better range in venue)

### 4. SSH Into Router

```bash
ssh root@192.168.8.1
# Default password is on the router's label (or whatever you set)
```

### 5. Set Up DNS Redirect

Add a wildcard DNS entry so ALL domain lookups resolve to your MacBook:

```bash
# Replace 192.168.8.XXX with your MacBook's actual IP
echo "address=/#/192.168.8.XXX" >> /etc/dnsmasq.conf

# Restart dnsmasq
/etc/init.d/dnsmasq restart
```

This makes every URL (google.com, apple.com, etc.) point to your MacBook.

### 6. Firewall — Redirect Port 80/443 to 3000

Fans' phones will try port 80/443. Redirect to your Bun server on 3000:

```bash
MACBOOK_IP="192.168.8.XXX"  # Your MacBook's IP

# Redirect HTTP (80) to badge server (3000)
iptables -t nat -A PREROUTING -i br-lan -p tcp --dport 80 -j DNAT --to-destination $MACBOOK_IP:3000
iptables -t nat -A PREROUTING -i br-lan -p tcp --dport 443 -j DNAT --to-destination $MACBOOK_IP:3000

# Allow forwarding
iptables -A FORWARD -p tcp -d $MACBOOK_IP --dport 3000 -j ACCEPT
```

### 7. Captive Portal Detection (iOS, Android, Windows, Firefox)

The badge server handles captive portal detection for all major platforms using
a two-phase approach:

**Phase 1 — First connect (triggers captive portal browser):**

| OS | Detection URL | OS Expects | Server Returns |
|----|---------------|-----------|----------------|
| iOS/macOS | `http://captive.apple.com/hotspot-detect.html` | `"Success"` text | 302 redirect to `/` |
| Android | `http://connectivitycheck.gstatic.com/generate_204` | HTTP 204 | 302 redirect to `/` |
| Samsung | `http://connectivitycheck.samsung.com/generate_204` | HTTP 204 | 302 redirect to `/` |
| Windows | `http://www.msftconnecttest.com/connecttest.txt` | `"Microsoft Connect Test"` | 302 redirect to `/` |
| Firefox | `http://detectportal.firefox.com/success.txt` | `"success"` | 302 redirect to `/` |

The OS gets an "unexpected" response → opens the captive portal mini-browser →
fan sees the badge generator.

**Phase 2 — After page loads (prevents "no internet" disconnect):**

When the badge page loads, it calls `POST /api/portal/clear` which marks that
device's IP as "cleared." All subsequent connectivity checks get the correct
"success" response, so the OS believes it has internet and stays connected.

This prevents the common problem where modern devices auto-disconnect from WiFi
networks that report "no internet."

**No additional captive portal software needed.** The DNS wildcard + port redirect
\+ server-side detection handling covers all platforms.

## Testing Checklist

Before the show, test with your own phone:

- [ ] Connect phone to GL-iNet WiFi
- [ ] Captive portal browser should auto-open (iOS: within 5-10 sec)
- [ ] Badge generator loads in captive portal browser
- [ ] Can customize and download a badge
- [ ] Can "Join Org Chart" and submit
- [ ] Open Safari/Chrome manually — still goes to badge generator
- [ ] Test on both iOS and Android if possible
- [ ] Admin panel accessible from MacBook: `http://localhost:3000/admin`

## Admin Panel Access

Go to `http://localhost:3000/admin` — you'll see a login screen. Enter the same
`ADMIN_TOKEN` value you used when starting the server. The token is stored in
`sessionStorage` (survives page refreshes, cleared when you close the browser tab).

To log out, click "Logout" in the admin panel header — clears the stored token.

**Note:** The admin token is sent as an `Authorization: Bearer` header on every
API request. It never appears in the URL. If you need to access admin from a
different device (e.g., your phone at the merch table), open `/admin` on that
device's browser and enter the token there too.

## During the Show

Monitor from MacBook:
```bash
cd ~/Documents/HelpDesk/badge-app
./status.sh                    # Check badge count
open "http://localhost:3000/admin"  # Admin panel (enter token in login prompt)
```

## Post-Show Teardown

### 1. Stop the Server

```bash
cd ~/Documents/HelpDesk/badge-app
./stop.sh
```

### 2. Remove DNS Redirect

```bash
ssh root@192.168.8.1

# Remove the wildcard DNS line
sed -i '/address=\/#\//d' /etc/dnsmasq.conf
/etc/init.d/dnsmasq restart

# Flush iptables NAT rules
iptables -t nat -F PREROUTING
iptables -F FORWARD
```

### 3. Back Up Data

The SQLite DB and images are in `data/`:
```bash
# Copy data dir somewhere safe
cp -r data/ ~/Desktop/badge-show-backup-$(date +%Y%m%d)/
```

## Troubleshooting

**Captive portal doesn't appear:**
- Some phones need 10-15 seconds after connecting
- Try opening any HTTP URL manually (e.g., `http://neverssl.com`)
- Check DNS is resolving: `nslookup google.com 192.168.8.1` should return your MacBook IP

**Page loads but looks broken:**
- Verify MacBook firewall isn't blocking port 3000
- macOS: System Settings → Network → Firewall → allow incoming connections

**Badge submission fails:**
- Check server logs: `tail -f data/server.log`
- Verify SQLite DB isn't locked: `./status.sh`

**Rate limit hit too quickly:**
- Start with `--show-mode` for relaxed limits (10/hour instead of 3)

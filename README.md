# GMU34 Development Server

This project serves a simple Express + SQLite backend from `backend/server.js` and a static frontend in `public/`.

Goal: run the server on your machine and access it from other devices on the same Wi‑Fi network.

## Quick steps (Windows PowerShell)

1. Install dependencies (if not already installed):

```powershell
npm install
```

2. Run the server (default port 4000):

```powershell
node backend/server.js
```

You should see console output like:

```
Server running with SQLite DB on http://localhost:4000
Accessible on your network at http://192.168.1.42:4000
```

3. From another device on the same Wi‑Fi, open a browser to the `Accessible on your network` address (e.g. `http://192.168.1.42:4000`).

## If you need a different port or host

To change the port or host when starting the server in PowerShell:

```powershell
$env:PORT = '5000'; $env:HOST = '0.0.0.0'; node backend/server.js
```

Note: `HOST` defaults to `0.0.0.0` which listens on all interfaces. You usually don't need to set it.

## Finding your machine's local IP (simple)

Run one of these in PowerShell and look for the `IPv4 Address` on your Wi‑Fi adapter:

```powershell
ipconfig
```

Or (PowerShell cmdlet):

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike 'Loopback*' -and $_.IPAddress -notlike '169.*' } | Select-Object -First 1
```

## Allow the port through Windows Firewall (PowerShell admin required)

Replace `4000` with your chosen port:

```powershell
New-NetFirewallRule -DisplayName "Allow Node 4000" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 4000
```

To remove the rule later:

```powershell
Remove-NetFirewallRule -DisplayName "Allow Node 4000"
```

## Security notes

- Only do this on a trusted Wi‑Fi / local network. Exposing a dev server on public networks can be risky.
- Do not expose this to the wider internet without proper authentication and HTTPS.
- Consider using `ngrok` or similar for temporary secure remote access instead of opening ports permanently.

## Need help?

If you want, I can:
- Add a `start` script to `package.json`.
- Run the server here to verify (I can attempt to run it and report the result).
- Create simpler commands or a PowerShell script to automate firewall rules and startup.

Tell me which next step you'd like.
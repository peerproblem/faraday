#!/bin/bash
# One-time server setup for the Vultr box (Ubuntu). Safe to re-run.
# Usage: ssh root@<server> 'bash -s' < scripts/provision.sh
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive
hostnamectl set-hostname faraday
apt-get update
apt-get -y -o Dpkg::Options::=--force-confold upgrade
apt-get install -y fail2ban unattended-upgrades ufw curl ca-certificates gnupg rsync git debian-keyring debian-archive-keyring apt-transport-https

# Automatic security updates
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'X'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
X

# SSH: keys only
cat > /etc/ssh/sshd_config.d/00-faraday.conf <<'X'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PermitEmptyPasswords no
MaxAuthTries 4
LoginGraceTime 30
X
sshd -t
systemctl reload ssh || systemctl reload sshd

# Firewall
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

# fail2ban
cat > /etc/fail2ban/jail.local <<'X'
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5
backend = systemd
banaction = ufw

[sshd]
enabled = true
mode = aggressive

[recidive]
enabled = true
logpath = /var/log/fail2ban.log
backend = auto
bantime = 1w
findtime = 1d
maxretry = 3
X
systemctl enable --now fail2ban
systemctl restart fail2ban

# Kernel network hardening
cat > /etc/sysctl.d/90-faraday.conf <<'X'
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.tcp_syncookies = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
fs.file-max = 200000
X
sysctl --system >/dev/null

# Node 24
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs

# Caddy
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy

# App user. The database is Aiven for MySQL (managed), so nothing is installed here for it.
id faraday >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/faraday --shell /usr/sbin/nologin faraday
mkdir -p /opt/faraday/shared /opt/faraday/releases /opt/faraday/backups
chmod 750 /opt/faraday/backups
chown -R faraday:faraday /opt/faraday

# Releases live in /opt/faraday/releases, /opt/faraday/app links to the live one, and the production env goes in
# /opt/faraday/shared/.env. Services and the Caddyfile ship with the app (scripts/deploy.sh installs them).
node -v; caddy version; fail2ban-client status; ufw status verbose
echo PROVISION_DONE

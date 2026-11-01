#!/bin/sh
# Sets vibemusic up with docker compose: writes .env from .env.example (and navidrome.env for the
# bundled Navidrome), starts everything, and can create the Navidrome account the relay uses for
# "This is" playlists. Safe to run again: it keeps existing files and only offers the steps that
# are still missing.
set -eu

cd "$(dirname "$0")"

ask() {
	# ask VARIABLE "Question" "default"
	printf '%s' "$2${3:+ [$3]}: "
	read -r answer || answer=''
	eval "$1=\${answer:-\$3}"
}

ask_secret() {
	printf '%s: ' "$2"
	if [ -t 0 ]; then stty -echo; fi
	read -r answer || answer=''
	if [ -t 0 ]; then stty echo; fi
	printf '\n'
	eval "$1=\$answer"
}

env_value() {
	sed -n "s/^$1=//p" .env | tail -n 1
}

# set_env FILE KEY value: replaces an existing line or a commented-out example of it.
set_env() {
	escaped=$(printf '%s' "$3" | sed 's/[\\&|]/\\&/g')
	if grep -q "^#* *$2=" "$1"; then
		# Rewritten in place so the file keeps its owner-only permissions.
		sed "s|^#* *$2=.*|$2=$escaped|" "$1" >"$1.tmp" && cat "$1.tmp" >"$1" && rm "$1.tmp"
	else
		printf '%s=%s\n' "$2" "$3" >>"$1"
	fi
}

json_string() {
	printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"
}

for tool in docker curl; do
	command -v "$tool" >/dev/null 2>&1 || {
		echo "setup.sh needs $tool." >&2
		exit 1
	}
done
docker compose version >/dev/null 2>&1 || {
	echo "setup.sh needs Docker Compose (docker compose)." >&2
	exit 1
}

if [ -f .env ]; then
	echo "Using the existing .env."
else
	cp .env.example .env
	chmod 600 .env
	ask own "Do you already run Navidrome? (y/n)" "n"
	case "$own" in
	[yY]*)
		navidrome=''
		while [ -z "$navidrome" ]; do
			ask navidrome "Navidrome's address as Docker containers reach it (e.g. http://192.168.1.10:4533)" ""
		done
		set_env .env NAVIDROME_URL "$navidrome"
		set_env .env COMPOSE_PROFILES relay
		echo "For share links, set ND_ENABLESHARING=true in your Navidrome, and ND_SHAREURL to vibemusic's"
		echo "public address if you have one."
		;;
	*)
		ask music "Your music folder" "./music"
		set_env .env MUSIC_FOLDER "$music"
		set_env .env COMPOSE_PROFILES relay,navidrome
		;;
	esac
	ask port "Port for vibemusic on this machine" "8080"
	set_env .env VIBEMUSIC_PORT "$port"
	echo "Wrote .env. Every other setting is optional; see the comments in it."
fi

case ",$(env_value COMPOSE_PROFILES)," in
*,navidrome,*)
	if [ ! -f navidrome.env ]; then
		cp navidrome.env.example navidrome.env
		chmod 600 navidrome.env
		ask public "Public address for vibemusic, if you have a domain (e.g. https://music.example.com)" ""
		[ -z "$public" ] || set_env navidrome.env ND_SHAREURL "$public"
		echo "Wrote navidrome.env, for Navidrome's own options."
	fi
	;;
esac

port=$(env_value VIBEMUSIC_PORT)
base="http://localhost:${port:-8080}"

echo "Starting vibemusic (the first run builds the images, which takes a few minutes)…"
docker compose up -d --build

printf 'Waiting for vibemusic to answer…'
tries=0
until curl -fsS -o /dev/null "$base/" 2>/dev/null; do
	tries=$((tries + 1))
	[ "$tries" -lt 60 ] || {
		echo " no answer from $base; see: docker compose logs" >&2
		exit 1
	}
	printf '.'
	sleep 2
done
echo " ok"

first_run=$(curl -fsS "$base/app/" 2>/dev/null | grep -c 'firstTime\\":true' || true)
if [ "$first_run" != 0 ]; then
	echo "Open $base in a browser: the first visit creates your admin account."
else
	echo "vibemusic is running at $base"
fi

case ",$(env_value COMPOSE_PROFILES)," in
*,relay,*) ;;
*) exit 0 ;;
esac
[ -z "$(env_value VIBEMUSIC_RELAY_NAVIDROME_USER)" ] || exit 0

echo
echo '"This is" playlists need a separate Navidrome account for the relay (not an admin).'
ask setup_this_is "Create it now? You'll need your admin login (y/n)" "y"
case "$setup_this_is" in
[yY]*) ;;
*) exit 0 ;;
esac
if [ "$first_run" != 0 ]; then
	printf 'Create your admin account at %s first, then press Enter.' "$base"
	read -r _ || true
fi

ask admin_user "Admin username" ""
ask_secret admin_password "Admin password"
login=$(curl -sS -X POST -H 'content-type: application/json' \
	-d "{\"username\":$(json_string "$admin_user"),\"password\":$(json_string "$admin_password")}" \
	"$base/auth/login")
token=$(printf '%s' "$login" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
admin=$(printf '%s' "$login" | grep -c '"isAdmin":true' || true)
if [ -z "$token" ] || [ "$admin" = 0 ]; then
	echo "That isn't an admin login. Run ./setup.sh again to retry." >&2
	exit 1
fi

relay_user=vibemusic-relay
relay_password=$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)
status=$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
	-H 'content-type: application/json' -H "x-nd-authorization: Bearer $token" \
	-d "{\"userName\":\"$relay_user\",\"name\":\"vibemusic relay\",\"password\":\"$relay_password\",\"isAdmin\":false}" \
	"$base/api/user")
case "$status" in
2*) ;;
*)
	echo "Navidrome refused to create the account '$relay_user' (HTTP $status). If it already exists," >&2
	echo "set VIBEMUSIC_RELAY_NAVIDROME_USER and VIBEMUSIC_RELAY_NAVIDROME_PASSWORD in .env by hand." >&2
	exit 1
	;;
esac

set_env .env VIBEMUSIC_RELAY_NAVIDROME_USER "$relay_user"
set_env .env VIBEMUSIC_RELAY_NAVIDROME_PASSWORD "$relay_password"
docker compose up -d relay
echo "Created the account '$relay_user' and restarted the relay. \"This is\" playlists appear after its first run."

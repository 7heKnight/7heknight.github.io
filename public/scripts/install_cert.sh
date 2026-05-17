#!/system/bin/sh

# Certificate injection script for Android (supports both pre-14 and 14+ with APEX)
# Usage: Push cert to /data/local/tmp/<hash>.0, then run this script.
# Optionally pass the cert filename as $1:  ./install_cert.sh 9a5ba575.0

SYSTEM_CA_PATH='/system/etc/security/cacerts'
ANDROID_TEMP='/data/local/tmp'
CERT_FILENAME="${1:-9a5ba575.0}"
CERTIFICATE_PATH="${ANDROID_TEMP}/${CERT_FILENAME}"
INJECTION_SCRIPT_PATH="${ANDROID_TEMP}/install_cert.sh"
HTK_CA_COPY="${ANDROID_TEMP}/htk-ca-copy"

set -e # Fail on error

# Cleanup handler — remove temp files on failure so we don't leave junk behind
cleanup() {
    echo "Cleaning up temporary files..."
    rm -rf "$HTK_CA_COPY" 2>/dev/null || true
}
trap cleanup EXIT

# ── Pre-flight checks ──────────────────────────────────────────────────────

if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: This script must run as root. Got UID=$(id -u)"
    exit 1
fi

if [ ! -f "$CERTIFICATE_PATH" ]; then
    echo "ERROR: Certificate not found at $CERTIFICATE_PATH"
    echo "Push your cert first:  adb push <hash>.0 ${ANDROID_TEMP}/<hash>.0"
    exit 1
fi

# Check if we already have a tmpfs mount on the cacerts path (idempotency guard)
if mount | grep -q "tmpfs on ${SYSTEM_CA_PATH}"; then
    echo "WARNING: tmpfs is already mounted on ${SYSTEM_CA_PATH}"
    echo "If you need to re-inject, reboot first, then re-run this script."
    exit 1
fi

printf "\n---\nInjecting certificate: %s\n" "$CERT_FILENAME"

# ── Copy existing certs to temp ────────────────────────────────────────────

mkdir -p "$HTK_CA_COPY"
chmod 700 "$HTK_CA_COPY"
rm -rf "${HTK_CA_COPY:?}/"*

if [ -d "/apex/com.android.conscrypt/cacerts" ]; then
    cp /apex/com.android.conscrypt/cacerts/* "$HTK_CA_COPY/"
else
    cp "${SYSTEM_CA_PATH}/"* "$HTK_CA_COPY/"
fi

# ── Mount tmpfs and populate ───────────────────────────────────────────────

mount -t tmpfs tmpfs "$SYSTEM_CA_PATH"

mv "$HTK_CA_COPY/"* "$SYSTEM_CA_PATH/"

# Copy our new cert in, so we trust that too
mv "$CERTIFICATE_PATH" "$SYSTEM_CA_PATH/"

# Update the perms & selinux context labels, so everything is as readable as before
chown root:root "$SYSTEM_CA_PATH/"*
chmod 644 "$SYSTEM_CA_PATH/"*

chcon u:object_r:system_file:s0 "$SYSTEM_CA_PATH/"
chcon u:object_r:system_file:s0 "$SYSTEM_CA_PATH/"*

echo 'System cacerts setup completed'

# ── APEX namespace injection (Android 14+) ─────────────────────────────────

if [ -d "/apex/com.android.conscrypt/cacerts" ]; then
    echo 'Injecting certificates into APEX cacerts'

    # When the APEX manages cacerts, we need to mount them at that path too. We can't do
    # this globally as APEX mounts are namespaced per process, so we need to inject a
    # bind mount for this directory into every mount namespace.

    # First we mount for the shell itself, for completeness and so we can see this
    # when we check for correct installation on later runs
    mount --bind "$SYSTEM_CA_PATH" /apex/com.android.conscrypt/cacerts

    # First we get the Zygote process(es), which launch each app
    ZYGOTE_PID=$(pidof zygote || true)
    ZYGOTE64_PID=$(pidof zygote64 || true)
    Z_PIDS="$ZYGOTE_PID $ZYGOTE64_PID"
    # N.b. some devices appear to have both, some have >1 of each (!)

    if [ -z "$(echo $Z_PIDS | tr -d ' ')" ]; then
        echo "WARNING: No Zygote PIDs found — newly launched apps won't inherit the cert"
    fi

    # Apps inherit the Zygote's mounts at startup, so we inject here to ensure all newly
    # started apps will see these certs straight away:
    for Z_PID in $Z_PIDS; do
        if [ -n "$Z_PID" ]; then
            nsenter --mount=/proc/$Z_PID/ns/mnt -- \
                /bin/mount --bind "$SYSTEM_CA_PATH" /apex/com.android.conscrypt/cacerts
        fi
    done

    echo 'Zygote APEX certificates remounted'

    # Then we inject the mount into all already running apps, so they see these certs immediately.

    # Get the PID of every process whose parent is one of the Zygotes:
    APP_PIDS=$(
        echo $Z_PIDS | \
        xargs -n1 ps -o 'PID' -P | \
        grep -v PID
    )

    # Inject into the mount namespace of each of those apps:
    for PID in $APP_PIDS; do
        nsenter --mount=/proc/$PID/ns/mnt -- \
            /bin/mount --bind "$SYSTEM_CA_PATH" /apex/com.android.conscrypt/cacerts &
    done
    wait # Launched in parallel - wait for completion here

    echo "APEX certificates remounted for $(echo $APP_PIDS | wc -w) apps"
fi

# ── Cleanup ────────────────────────────────────────────────────────────────

# Remove the temp cert copy directory & this script itself
rm -rf "$HTK_CA_COPY"
trap - EXIT  # Disarm the cleanup trap since we cleaned up successfully
rm "$INJECTION_SCRIPT_PATH"

printf "System cert successfully injected\n---\n"
